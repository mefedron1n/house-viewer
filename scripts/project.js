(() => {
  const API = window.HouseConfig?.apiBaseUrl || location.origin;
  const main = document.querySelector("#project-main"),
    id = new URLSearchParams(location.search).get("id");
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
    );
  const request = async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      credentials: "include",
      headers:
        options.body instanceof FormData
          ? undefined
          : { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || "Не удалось выполнить запрос.");
    return body;
  };
  const uploadModel = (projectId, data, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API}/api/projects/${encodeURIComponent(projectId)}/model`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 70));
      };
      xhr.onerror = () => reject(new Error("Не удалось связаться с сервером загрузки."));
      xhr.onabort = () => reject(new Error("Загрузка отменена."));
      xhr.onload = () => {
        let body;
        try {
          body = JSON.parse(xhr.responseText || "null");
        } catch {
          body = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body?.error || "Не удалось загрузить модель."));
      };
      xhr.send(data);
      window.activeProjectModelUpload = xhr;
    });
  async function render() {
    const [{ user }, project] = await Promise.all([
      request("/api/auth/me"),
      request(`/api/projects/${encodeURIComponent(id)}`),
    ]);
    window.createProfileMenu(document.querySelector("#profile-menu-host"), user, API);
    document.title = `${project.name} — Roomark`;
    main.innerHTML = `<section class="studio-shell project-editor"><div class="studio-eyebrow"><p>Проект / ${esc(project.status)}</p><a href="./studio.html?view=projects">Все проекты ×</a></div><div class="project-editor-head"><div><p class="kicker">Страница отдельного объекта</p><h1>${esc(project.name)}</h1><p>Настройте страницу, которую увидят заказчик и команда проекта.</p></div>${project.modelUrl ? `<a class="button-secondary" href="./viewer.html?project=${project.id}&model=${encodeURIComponent(API + project.modelUrl)}" target="_blank" rel="noopener">Открыть модель ↗</a>` : ""}</div><div class="project-editor-grid"><form id="project-settings" class="project-settings"><p class="kicker">Основные данные</p><label>Название комплекса или объекта<input name="name" value="${esc(project.name)}" minlength="2" maxlength="100" required></label><div class="project-fields"><label>Площадь, м²<input name="area" type="number" min="1" value="${project.area}" required></label><label>Помещения<input name="rooms" type="number" min="1" value="${project.rooms}" required></label></div><label>Оформление<select name="theme"><option ${project.theme === "Тёплый" ? "selected" : ""}>Тёплый</option><option ${project.theme === "Ночной" ? "selected" : ""}>Ночной</option><option ${project.theme === "Нейтральный" ? "selected" : ""}>Нейтральный</option></select></label><button class="button" type="submit">Сохранить изменения <span>→</span></button><p class="form-status" id="settings-status"></p></form><form id="model-upload" class="model-editor"><p class="kicker">3D-модель проекта</p><div class="model-state"><strong>${project.modelUrl ? "Модель загружена" : "Загрузите IFC-модель"}</strong><p>${project.modelUrl ? "Новая загрузка заменит текущую модель проекта." : "После загрузки IFC мы найдём комнаты, создадим GLB и откроем готовый проект."}</p></div><label class="file-drop"><input id="project-model-file" name="model" type="file" accept=".ifc,.glb" required><span><strong id="project-model-file-name">Перетащите IFC сюда или выберите файл</strong><p id="project-model-file-meta">IFC или GLB · до 200 МБ</p></span></label><div id="project-upload-progress" class="project-upload-progress" hidden><div class="project-upload-track"><span id="project-upload-bar"></span></div><div class="project-upload-progress-copy"><strong id="project-upload-percent">0%</strong><span id="project-upload-stage">Подготовка файла…</span></div></div><div class="project-upload-actions"><button id="project-model-upload-button" class="button-secondary" type="button">Выбрать и загрузить модель</button><button id="project-model-cancel" class="button-secondary" type="button" hidden>Отменить</button></div><p class="form-status" id="model-status" role="status" aria-live="polite"></p></form></div></section>`;
    document.querySelector("#project-settings").onsubmit = async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button"),
        status = document.querySelector("#settings-status");
      button.disabled = true;
      status.textContent = "";
      try {
        const data = Object.fromEntries(new FormData(event.currentTarget));
        await request(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) });
        status.classList.add("success");
        status.textContent = "Изменения сохранены.";
        setTimeout(render, 500);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    };
    const modelForm = document.querySelector("#model-upload"),
      modelInput = document.querySelector("#project-model-file"),
      modelButton = document.querySelector("#project-model-upload-button"),
      modelFileName = document.querySelector("#project-model-file-name"),
      modelFileMeta = document.querySelector("#project-model-file-meta"),
      progress = document.querySelector("#project-upload-progress"),
      progressBar = document.querySelector("#project-upload-bar"),
      progressPercent = document.querySelector("#project-upload-percent"),
      progressStage = document.querySelector("#project-upload-stage"),
      cancelButton = document.querySelector("#project-model-cancel");
    const setProgress = (value, stage, indeterminate = false) => {
      const percent = Math.max(0, Math.min(100, value));
      progress.hidden = false;
      progress.classList.toggle("indeterminate", indeterminate);
      progressBar.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      progressStage.textContent = stage;
    };
    modelButton.onclick = () => {
      if (modelButton.disabled) return;
      if (modelInput.files.length) modelForm.requestSubmit();
      else modelInput.click();
    };
    modelInput.onchange = () => {
      const file = modelInput.files[0];
      if (!file) return;
      modelFileName.textContent = file.name;
      modelFileMeta.textContent = `${(file.size / 1024 / 1024).toFixed(1)} МБ · ${file.name.split(".").pop().toUpperCase()}`;
      modelButton.textContent = "Загрузить выбранную модель";
      modelForm.requestSubmit();
    };
    cancelButton.onclick = () => window.activeProjectModelUpload?.abort();
    modelForm.onsubmit = async (event) => {
      event.preventDefault();
      const button = modelButton,
        status = document.querySelector("#model-status"),
        data = new FormData(event.currentTarget);
      button.disabled = true;
      cancelButton.hidden = false;
      status.textContent = "Загрузка модели…";
      setProgress(0, "Передача файла на сервер…");
      try {
        const result = await uploadModel(id, data, (percent) =>
          setProgress(percent, "Передача файла на сервер…")
        );
        window.activeProjectModelUpload = null;
        cancelButton.hidden = true;
        if (result.jobId) {
          status.textContent = "IFC загружен. Идёт преобразование…";
          setProgress(72, "Подготовка BIM-анализа…", true);
          const timer = setInterval(async () => {
            try {
              const job = await request(`/api/models/${result.jobId}/status?t=${Date.now()}`, {
                cache: "no-store",
              });
              const stageText = job.queuePosition
                ? `В очереди: позиция ${job.queuePosition}`
                : job.stage || "Обработка IFC…";
              status.textContent = `${stageText}${job.elapsedSeconds ? ` · ${job.elapsedSeconds} сек.` : ""}`;
              const stageProgress =
                job.status === "analyzing"
                  ? 75 + Math.min(10, Math.floor((job.stageElapsedSeconds || 0) / 6))
                  : job.status === "converting"
                    ? 86 + Math.min(10, Math.floor((job.stageElapsedSeconds || 0) / 4))
                    : { queued: 72, validating: 74, optimizing: 97, ready: 100 }[job.status] || 75;
              const detailedStage =
                job.status === "analyzing"
                  ? `${stageText} · обычно около 1 минуты`
                  : stageText;
              setProgress(
                stageProgress,
                detailedStage,
                !["ready", "failed"].includes(job.status)
              );
              if (job.status === "ready") {
                clearInterval(timer);
                status.classList.add("success");
                status.textContent = "IFC обработан, модель готова.";
                setProgress(100, "Модель готова. Открываем проект…");
                location.href = `./viewer.html?project=${encodeURIComponent(id)}&model=${encodeURIComponent(API + job.modelUrl)}`;
              } else if (job.status === "failed") {
                clearInterval(timer);
                status.textContent = job.error || "Не удалось обработать IFC.";
                button.disabled = false;
                cancelButton.hidden = true;
              }
            } catch (error) {
              try {
                const currentProject = await request(`/api/projects/${encodeURIComponent(id)}`, {
                  cache: "no-store",
                });
                if (currentProject.modelUrl) {
                  clearInterval(timer);
                  setProgress(100, "Модель готова. Открываем проект…");
                  location.href = `./viewer.html?project=${encodeURIComponent(id)}&model=${encodeURIComponent(API + currentProject.modelUrl)}`;
                  return;
                }
              } catch {
                /* Ни статус задачи, ни готовый проект пока не доступны. */
              }
              status.textContent = `${error.message} Повторяем проверку…`;
            }
          }, 1000);
        } else {
          status.classList.add("success");
          status.textContent = "Модель загружена.";
          setProgress(100, "Модель готова. Открываем проект…");
          location.href = `./viewer.html?project=${encodeURIComponent(id)}&model=${encodeURIComponent(API + result.modelUrl)}`;
        }
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
        cancelButton.hidden = true;
      }
    };
  }
  render()
    .catch((error) => {
      if (error.message === "Требуется вход.") location.replace("./auth.html");
      else
        main.innerHTML = `<section class="studio-shell empty-projects"><h1>Проект не найден</h1><p>${esc(error.message)}</p><a class="button" href="./studio.html?view=projects">К проектам <span>→</span></a></section>`;
    })
    .finally(() => main.removeAttribute("aria-busy"));
})();
