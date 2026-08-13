# Развёртывание IFC API на Render

Этот вариант оставляет интерфейс на Netlify, а тяжёлую конвертацию IFC запускает в Docker-сервисе Render. API хранит файлы локально с TTL, поэтому для первой версии достаточно одного экземпляра сервиса.

## 1. Подготовьте репозиторий

1. Создайте GitHub-репозиторий и загрузите весь проект, включая папки `server/` и `docs/`.
2. Не добавляйте `server/.env` в Git: в репозитории должен оставаться только шаблон `server/.env.example`.
3. Убедитесь, что Docker можно собрать локально:

   ```sh
   docker compose up --build
   ```

   После запуска откройте `http://localhost:3001/health`. Безопасный ответ: `{ "ok": true }`.

## 2. Создайте Web Service

1. В Render выберите **New → Web Service** и подключите GitHub-репозиторий.
2. В разделе настроек выберите:

   | Поле Render | Значение |
   | --- | --- |
   | Language | `Docker` |
   | Root Directory | `server` |
   | Dockerfile Path | `./Dockerfile` |
   | Docker Context | `.` |
   | Health Check Path | `/health` |
   | Auto-Deploy | `Yes` для основной ветки |

   При Root Directory `server` все пути выше рассчитываются от папки `server`.

3. Нажмите **Create Web Service**. Render соберёт образ из `server/Dockerfile` и выдаст адрес вида `https://roomark-ifc-api.onrender.com`.

## 3. Добавьте переменные окружения

В **Environment → Environment Variables** добавьте следующие значения. Не публикуйте их в клиентском JavaScript, кроме URL самого API.

```env
PORT=3001
FRONTEND_ORIGIN=https://YOUR-SITE.netlify.app
IFC_CONVERT_PATH=IfcConvert
MODEL_STORAGE_DIR=/data/models
MAX_IFC_UPLOAD_MB=100
MAX_GLB_UPLOAD_MB=100
MAX_IMAGE_UPLOAD_MB=15
MAX_CONCURRENT_CONVERSIONS=1
MAX_CONVERSION_QUEUE=10
MAX_USER_CONVERSION_JOBS=2
CONVERSION_TIMEOUT_MS=300000
MAX_CONCURRENT_CONVERSIONS=1
MODEL_TTL_HOURS=24
UPLOAD_PASSWORD=<generate-a-long-random-secret>
```

`FRONTEND_ORIGIN` должен точно совпадать с доменом Netlify, включая `https://`, без завершающего `/`. Для тестового Netlify preview добавьте отдельный origin только если он действительно нужен; не используйте `*`.

`UPLOAD_PASSWORD` защищает загрузку IFC, планировок, рендеров и моделей комнат. Создайте собственный длинный случайный пароль; он проверяется только на сервере и не записывается в код интерфейса.

После добавления переменных выберите **Manual Deploy → Deploy latest commit**.

## 4. Файлы: два допустимых режима

### Рекомендуемый для первой версии: временное хранение

Не добавляйте диск. API удалит исходный IFC после успешной конвертации, а GLB и метаданные — после `MODEL_TTL_HOURS`. Это подходит для демонстрации и небольших файлов, когда результаты не обязаны переживать перезапуск или новый deploy.

### Постоянный диск

Если готовые GLB должны переживать перезапуск, добавьте в Render **Disks → Add Disk**:

```text
Mount path: /data
```

Оставьте `MODEL_STORAGE_DIR=/data/models`. Материалы комнат сохраняются в `/data/models/rooms`, общая планировка — в `/data/models/project`, а общие заметки — в `/data/models/site-notes.json`; они не удаляются по TTL. Постоянный диск обязателен: без него пины и загруженные планировки исчезнут при перезапуске или deploy. Диск привязан к одному экземпляру: не увеличивайте число инстансов этого сервиса, пока результаты лежат на локальном диске. Для масштабирования вынесите файлы в объектное хранилище (например, S3/R2) и очередь в Redis/SQS.

## 5. Подключите Netlify

В `viewer.html` непосредственно перед строкой подключения `./scripts/app.js` добавьте URL Render:

```html
<script>
  window.MODEL_API_URL = "https://roomark-ifc-api.onrender.com";
</script>
<script type="module" src="./scripts/app.js"></script>
```

Замените домен на фактический адрес из панели Render, закоммитьте изменение и опубликуйте сайт на Netlify. В Netlify не нужны серверные переменные для этой версии: URL намеренно доступен браузеру.

## 6. Проверка после публикации

1. Откройте `https://YOUR-API.onrender.com/health`. Ожидаемый ответ:

   ```json
   { "ok": true, "ifcConvert": true }
   ```

2. Откройте Netlify-сайт, загрузите небольшой IFC.
3. В браузере откройте DevTools → Network. Запрос `POST /api/models` должен вернуть `202` и `jobId`.
4. Запрос статуса должен смениться на `ready`; затем просмотрщик загрузит `model.glb`.

## Типовые ошибки

| Симптом | Причина и действие |
| --- | --- |
| `ifcConvert: false` | Проверьте build logs. Контейнер не содержит исполняемый `IfcConvert`; исправьте Dockerfile/пакет и пересоберите сервис. |
| В браузере CORS-ошибка | Проверьте точное значение `FRONTEND_ORIGIN`, включая домен Netlify. После изменения переменной выполните redeploy. |
| `413` или сообщение о лимите | Файл превышает соответствующий `MAX_IFC_UPLOAD_MB`, `MAX_GLB_UPLOAD_MB` или `MAX_IMAGE_UPLOAD_MB`; увеличивайте лимит только после оценки диска и времени обработки. |
| `IfcConvert завершился с ошибкой` | Просмотрите Render Logs: файл может быть неполным или использует неподдерживаемую схему IFC. |
| Конвертация обрывается | Увеличьте `CONVERSION_TIMEOUT_MS`, но не отключайте timeout. |
| Готовая модель исчезла | Истёк TTL или сервис перезапустился без persistent disk. Используйте disk либо объектное хранилище. |

## Перед production

- Добавьте авторизацию перед выдачей результатов: сейчас случайный `jobId` не является заменой авторизации.
- Для приватных моделей используйте object storage и подписанные ссылки вместо локального диска.
- Вынесите очередь и статусы в Redis/БД, если потребуется более одного экземпляра.
- Ограничьте доступ по rate limit и настройте мониторинг ошибок/диска.
# Устаревший вариант: Render

Этот документ сохранён как справка для прежней схемы. Актуальная целевая архитектура — Cloudflare Pages + VPS + R2; см. `production-architecture.md` и корневой `README.md`.
