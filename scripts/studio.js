(() => {
  const { request, user } = window.studioContext,
    main = document.querySelector("#studio-main");
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
    );
  const view = new URLSearchParams(location.search).get("view") || "profile";
  $$("[data-studio-nav]").forEach((link) =>
    link.classList.toggle("active", link.dataset.studioNav === view)
  );
  $$(".studio-mobile-nav a").forEach((link) =>
    link.classList.toggle(
      "active",
      link.href === location.href || (view === "dashboard" && link.href.includes("view=projects"))
    )
  );
  const projectCard = (project) =>
    `<article class="project-list-card" data-project-id="${project.id}"><img src="./images/editorial-house.webp" alt="" class="project-list-cover"><div class="project-list-copy"><h2>${esc(project.name)}</h2><p class="project-list-meta"><span>▣ ${project.area} м²</span><i>·</i><span>♙ ${project.rooms} комнат</span><i>·</i><span>▣ ${new Date(project.updatedAt).toLocaleDateString("ru")}</span></p><span class="project-list-status">${esc(project.status)}</span></div><button class="project-list-more" type="button" data-project-menu="${project.id}" aria-label="Действия с проектом" aria-expanded="false">⋮</button><div class="project-card-menu" data-project-menu-panel="${project.id}" hidden><button type="button" data-project-edit="${project.id}">Изменить проект</button><button type="button" class="danger" data-project-delete="${project.id}">Удалить проект</button></div><a class="project-list-open" href="./project.html?id=${encodeURIComponent(project.id)}">Открыть <span>→</span></a></article>`;
  function profile() {
    const parts = user.name.trim().split(/\s+/),
      firstName = parts[0] || "",
      lastName = parts.slice(1).join(" ");
    main.innerHTML = `<section class="account-content"><header class="account-heading"><h1>Профиль</h1><p>Управляйте своей личной информацией и настройками аккаунта.</p></header><section class="account-card"><header class="account-card-head"><h2>Личные данные</h2><p>Обновите информацию о себе.</p></header><form id="account-profile-form" class="profile-form-grid"><div class="account-avatar-wrap"><div class="account-avatar" aria-hidden="true">♟</div><button class="avatar-button" type="button" disabled>Изменить фото</button></div><label class="account-field">Имя<input name="firstName" value="${esc(firstName)}" maxlength="40" required></label><label class="account-field">Фамилия<input name="lastName" value="${esc(lastName)}" maxlength="40"></label><label class="account-field account-field-email">Email<input name="email" type="email" value="${esc(user.email)}" maxlength="254" required></label><div class="account-form-actions"><button class="account-primary" type="submit">Сохранить изменения</button></div></form><p class="account-status" id="profile-status" role="status"></p></section><section class="account-card" id="account-password"><header class="account-card-head"><h2>Смена пароля</h2><p>Используйте надёжный пароль для защиты аккаунта.</p></header><form id="account-password-form" class="password-form"><label for="current-password">Текущий пароль</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" placeholder="Введите текущий пароль" required><label for="new-password">Новый пароль</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="Введите новый пароль" required><label for="confirm-password">Подтвердите новый пароль</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="Повторите новый пароль" required><div class="account-form-actions"><button class="account-primary" type="submit">Изменить пароль</button></div></form><p class="account-status" id="password-status" role="status"></p></section><section class="account-card"><header class="account-card-head"><h2>Дополнительные действия</h2><p>Управление аккаунтом и связанными данными.</p></header><div class="account-actions"><button class="account-action" type="button" id="export-account"><span>⇩</span><div><strong>Экспортировать данные</strong><small>Скачайте копию своих данных</small></div></button><button class="account-action danger" type="button" id="delete-account"><span>♲</span><div><strong>Удалить аккаунт</strong><small>Удалить аккаунт и все данные</small></div></button></div><p class="account-status" id="actions-status" role="status"></p></section></section>`;
    const exportButton = $("#export-account"),
      actions = exportButton.parentElement;
    exportButton.querySelector("strong").textContent = "Экспортировать проекты";
    exportButton.querySelector("small").textContent = "Скачать метаданные проектов в JSON";
    exportButton.insertAdjacentHTML(
      "afterend",
      '<button class="account-action" type="button" id="import-account"><span>⇧</span><div><strong>Импортировать проекты</strong><small>Добавить или обновить проекты из JSON</small></div></button>'
    );
    actions.insertAdjacentHTML(
      "beforeend",
      '<input id="import-account-file" type="file" accept="application/json,.json" hidden>'
    );
    actions.insertAdjacentHTML(
      "afterend",
      '<p class="account-hint">Импорт не меняет профиль и не удаляет проекты. IFC/GLB-модели в JSON не входят — их нужно загрузить отдельно.</p>'
    );
    $("#account-profile-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        status = $("#profile-status"),
        button = form.querySelector("button");
      button.disabled = true;
      status.textContent = "Сохраняем…";
      try {
        const result = await request("/api/auth/profile", {
          method: "PATCH",
          body: JSON.stringify({
            name: `${form.firstName.value} ${form.lastName.value}`.trim(),
            email: form.email.value,
          }),
        });
        Object.assign(user, result.user);
        status.textContent = "Изменения сохранены.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    $("#account-password-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        status = $("#password-status"),
        button = form.querySelector("button");
      if (form.newPassword.value !== form.confirmPassword.value)
        return (status.textContent = "Новые пароли не совпадают.");
      button.disabled = true;
      status.textContent = "Обновляем пароль…";
      try {
        await request("/api/auth/password", {
          method: "PATCH",
          body: JSON.stringify({
            currentPassword: form.currentPassword.value,
            newPassword: form.newPassword.value,
          }),
        });
        form.reset();
        status.textContent = "Пароль изменён.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    $("#export-account").onclick = async () => {
      const status = $("#actions-status");
      try {
        const projects = await request("/api/projects"),
          blob = new Blob(
            [
              JSON.stringify(
                {
                  format: "roomark-projects",
                  version: 1,
                  projects,
                  exportedAt: new Date().toISOString(),
                },
                null,
                2
              ),
            ],
            { type: "application/json" }
          ),
          link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `roomark-projects-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 0);
        status.textContent = `Экспортировано проектов: ${projects.length}.`;
      } catch (error) {
        status.textContent = error.message;
      }
    };
    $("#import-account").onclick = () => $("#import-account-file").click();
    $("#import-account-file").onchange = async (event) => {
      const status = $("#actions-status"),
        file = event.target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        status.textContent = "Файл импорта не должен превышать 1 МБ.";
        event.target.value = "";
        return;
      }
      status.textContent = "Проверяем файл…";
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.projects)) throw new Error("Это не файл экспорта Roomark.");
        if (
          !confirm(
            `Импортировать проектов: ${data.projects.length}? Совпадающие проекты будут обновлены, остальные добавлены.`
          )
        )
          return;
        const result = await request("/api/account/import", {
          method: "POST",
          body: JSON.stringify(data),
        });
        status.textContent = `Импорт завершён: добавлено ${result.added}, обновлено ${result.updated}. Модели не импортировались.`;
      } catch (error) {
        status.textContent =
          error instanceof SyntaxError ? "Не удалось прочитать JSON-файл." : error.message;
      } finally {
        event.target.value = "";
      }
    };
    $("#delete-account").onclick = async () => {
      const status = $("#actions-status");
      if (!confirm("Удалить аккаунт и все проекты без возможности восстановления?")) return;
      try {
        await request("/api/auth/account", { method: "DELETE" });
        location.href = "./";
      } catch (error) {
        status.textContent = error.message;
      }
    };
  }
  async function dashboard() {
    const projects = await request("/api/projects"),
      project = projects[0];
    main.innerHTML = `<section class="studio-shell"><div class="studio-eyebrow"><p>Рабочее пространство / ${new Date().toLocaleDateString("ru", { month: "long", year: "numeric" })}</p><a class="button button-small" href="?view=new">Новый проект <span>＋</span></a></div><h1 class="studio-title">Добрый день, ${esc(user.name.split(" ")[0])}.<br><em>Продолжим работу?</em></h1>${project ? `<div class="dashboard-grid"><a class="project-feature" href="./project.html?id=${project.id}"><img src="./images/editorial-house.webp" alt=""><div class="project-feature-content"><p class="kicker light">Последний проект</p><h2>${esc(project.name)}</h2><div class="project-meta-line"><span>${project.area} м²</span><span>${project.rooms} комнат</span><span>${esc(project.status)}</span></div></div></a><aside class="dashboard-aside"><h3>Проект остаётся живым</h3><p>Редактируйте данные и модель на отдельной странице объекта.</p></aside></div>` : `<div class="empty-projects"><h2>Создайте первый проект</h2><a class="button" href="?view=new">Начать <span>→</span></a></div>`}</section>`;
  }
  async function list() {
    const projects = await request("/api/projects");
    main.innerHTML = `<section class="studio-shell projects-page"><div class="projects-page-head"><div><p class="projects-count">Все объекты / <span id="projects-total">${projects.length}</span></p><h1>Ваши <em>проекты</em></h1><p class="projects-lede">Создавайте, просматривайте и управляйте своими проектами<br>в одном месте</p></div></div><div class="projects-toolbar"><label class="projects-search"><span>⌕</span><input id="projects-search" type="search" placeholder="Поиск проектов…" aria-label="Поиск проектов"></label><select id="projects-status" aria-label="Фильтр по статусу"><option value="">Все статусы</option>${[...new Set(projects.map((project) => project.status))].map((status) => `<option value="${esc(status)}">${esc(status)}</option>`).join("")}</select><select id="projects-sort" aria-label="Сортировка проектов"><option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="name">По названию</option></select></div><div class="projects-list" id="projects-list"></div><div class="projects-empty-search" id="projects-empty-search" hidden>Проекты по заданным условиям не найдены.</div><div class="projects-onboarding"><span class="projects-folder">▱</span><div><h2>${projects.length ? "Создайте ещё один проект" : "У вас пока нет проектов"}</h2><p>${projects.length ? "Добавьте новый объект и продолжайте работу в одном пространстве" : "Создайте свой первый проект и начните работать над ним"}</p></div><a class="projects-create" href="?view=new">Создать проект <span>＋</span></a></div><dialog class="project-edit-dialog" id="project-edit-dialog"><form method="dialog" id="project-edit-form"><header><div><h2>Изменить проект</h2><p>Обновите название и параметры объекта.</p></div><button value="cancel" aria-label="Закрыть">×</button></header><label>Название<input name="name" required minlength="2" maxlength="100"></label><div class="project-edit-grid"><label>Площадь, м²<input name="area" type="number" min="0" max="100000" required></label><label>Количество комнат<input name="rooms" type="number" min="1" max="1000" required></label></div><label>Оформление<select name="theme"><option>Тёплый</option><option>Ночной</option><option>Нейтральный</option></select></label><p class="project-edit-status" role="status"></p><footer><button value="cancel" class="project-dialog-cancel">Отмена</button><button type="submit" value="save" class="projects-create">Сохранить</button></footer></form></dialog></section>`;
    const drawProjects = () => {
      const query = $("#projects-search").value.trim().toLowerCase(),
        status = $("#projects-status").value,
        sort = $("#projects-sort").value;
      const visible = projects
        .filter(
          (project) =>
            (!query || project.name.toLowerCase().includes(query)) &&
            (!status || project.status === status)
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name, "ru")
            : sort === "old"
              ? new Date(a.updatedAt) - new Date(b.updatedAt)
              : new Date(b.updatedAt) - new Date(a.updatedAt)
        );
      $("#projects-list").innerHTML = visible.map(projectCard).join("");
      $("#projects-empty-search").hidden = visible.length > 0 || (!query && !status);
    };
    [$("#projects-search"), $("#projects-status"), $("#projects-sort")].forEach((control) =>
      control.addEventListener("input", drawProjects)
    );
    drawProjects();
    const closeMenus = () => {
      $$("[data-project-menu-panel]").forEach((menu) => {
        menu.hidden = true;
      });
      $$("[data-project-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    };
    $("#projects-list").addEventListener("click", async (event) => {
      const menuButton = event.target.closest("[data-project-menu]");
      if (menuButton) {
        const menu = $(`[data-project-menu-panel="${menuButton.dataset.projectMenu}"]`),
          opening = menu.hidden;
        closeMenus();
        menu.hidden = !opening;
        menuButton.setAttribute("aria-expanded", String(opening));
        return;
      }
      const editButton = event.target.closest("[data-project-edit]"),
        deleteButton = event.target.closest("[data-project-delete]");
      if (editButton) {
        const project = projects.find((item) => item.id === editButton.dataset.projectEdit),
          dialog = $("#project-edit-dialog"),
          form = $("#project-edit-form"),
          fields = form.elements;
        form.dataset.projectId = project.id;
        fields.name.value = project.name;
        fields.area.value = project.area;
        fields.rooms.value = project.rooms;
        fields.theme.value = project.theme;
        form.querySelector(".project-edit-status").textContent = "";
        closeMenus();
        dialog.showModal();
      }
      if (deleteButton) {
        const project = projects.find((item) => item.id === deleteButton.dataset.projectDelete);
        closeMenus();
        if (
          !confirm(`Удалить проект «${project.name}» и его модель без возможности восстановления?`)
        )
          return;
        try {
          await request(`/api/projects/${project.id}`, { method: "DELETE" });
          projects.splice(projects.indexOf(project), 1);
          $("#projects-total").textContent = projects.length;
          drawProjects();
        } catch (error) {
          alert(error.message);
        }
      }
    });
    document.addEventListener(
      "click",
      (event) => {
        if (!event.target.closest("[data-project-menu],.project-card-menu")) closeMenus();
      },
      { once: false }
    );
    $("#project-edit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") {
        $("#project-edit-dialog").close();
        return;
      }
      const form = event.currentTarget,
        fields = form.elements,
        status = form.querySelector(".project-edit-status"),
        submit = form.querySelector('[type="submit"]'),
        project = projects.find((item) => item.id === form.dataset.projectId);
      submit.disabled = true;
      status.textContent = "Сохраняем…";
      try {
        const updated = await request(`/api/projects/${project.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: fields.name.value,
            area: Number(fields.area.value),
            rooms: Number(fields.rooms.value),
            theme: fields.theme.value,
          }),
        });
        Object.assign(project, updated);
        $("#project-edit-dialog").close();
        drawProjects();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
  }
  function wizard() {
    let step = 1,
      data = { name: "", area: "", rooms: "", theme: "Тёплый", model: null };
    const draw = () => {
      const titles = ["Расскажите об объекте", "Оформление и модель", "Проверьте детали"];
      main.innerHTML = `<section class="studio-shell"><div class="studio-eyebrow"><p>Новый проект / шаг ${step} из 3</p><a href="?view=projects">Закрыть ×</a></div><div class="wizard"><ol class="wizard-steps">${["Объект", "Оформление", "Создание"].map((label, index) => `<li class="${index + 1 === step ? "active" : ""}"><span>${index + 1}</span>${label}</li>`).join("")}</ol><div class="wizard-main"><p class="kicker">Шаг 0${step}</p><h1>${titles[step - 1]}</h1><form id="wizard-form">${step === 1 ? `<div class="wizard-form"><label class="full">Название комплекса или объекта<input name="name" value="${esc(data.name)}" required minlength="2" placeholder="Дом у сосен"></label><label>Площадь, м²<input name="area" type="number" min="1" value="${esc(data.area)}" required></label><label>Количество помещений<input name="rooms" type="number" min="1" value="${esc(data.rooms)}" required></label></div>` : step === 2 ? `<div class="theme-choices">${["Тёплый", "Ночной", "Нейтральный"].map((theme) => `<button type="button" data-theme="${theme}" class="theme-choice ${data.theme === theme ? "active" : ""}"><span class="theme-swatch"></span><strong>${theme}</strong></button>`).join("")}</div><label class="file-drop"><input name="model" type="file" accept=".ifc,.glb"><span><strong>Выберите IFC или GLB</strong><p>Файл можно добавить сейчас или позже · до 200 МБ</p></span></label>` : `<div class="review-sheet"><dl><div><dt>Объект</dt><dd>${esc(data.name)}</dd></div><div><dt>Площадь</dt><dd>${esc(data.area)} м²</dd></div><div><dt>Комнаты</dt><dd>${esc(data.rooms)}</dd></div><div><dt>Оформление</dt><dd>${esc(data.theme)}</dd></div></dl></div>`}</form><p class="form-status" id="wizard-status"></p><div class="wizard-actions">${step > 1 ? '<button class="button-secondary" id="wizard-back">← Назад</button>' : "<span></span>"}<button class="button" id="wizard-next">${step === 3 ? "Создать проект" : "Продолжить"} <span>→</span></button></div></div></div></section>`;
      $$("[data-theme]").forEach(
        (button) =>
          (button.onclick = () => {
            data.theme = button.dataset.theme;
            draw();
          })
      );
      $("#wizard-back")?.addEventListener("click", () => {
        step--;
        draw();
      });
      $("#wizard-next").onclick = async (event) => {
        if (step === 1) {
          const form = $("#wizard-form");
          if (!form.reportValidity()) return;
          data = {
            ...data,
            name: form.name.value,
            area: Number(form.area.value),
            rooms: Number(form.rooms.value),
          };
        }
        if (step === 2)
          data.model = document.querySelector("#wizard-form").model.files[0] || data.model;
        if (step < 3) {
          step++;
          draw();
          return;
        }
        event.currentTarget.disabled = true;
        try {
          const project = await request("/api/projects", {
            method: "POST",
            body: JSON.stringify(data),
          });
          if (data.model) {
            const upload = new FormData();
            upload.append("model", data.model);
            await request(`/api/projects/${project.id}/model`, { method: "POST", body: upload });
          }
          location.href = `./project.html?id=${project.id}`;
        } catch (error) {
          $("#wizard-status").textContent = error.message;
          event.currentTarget.disabled = false;
        }
      };
    };
    draw();
  }
  function billing() {
    const plans = {
      trial: { name: "Пробный доступ", note: "7 дней бесплатно", period: "7 дней", price: 0 },
      standard: {
        name: "Стандарт",
        note: "Для небольших проектов и команд",
        period: "1 месяц",
        price: 990,
      },
      pro: {
        name: "Профи",
        note: "Для профессионалов и больших команд",
        period: "1 месяц",
        price: 1990,
      },
    };
    main.innerHTML = `<section class="studio-shell payment-page"><header class="payment-head"><p>Аккаунт / Подписка / <strong>Оплата</strong></p><h1>Оплата <em>подписки</em></h1><span>Выберите тариф и способ оплаты для активации подписки</span></header><div class="payment-layout"><div class="payment-main"><section class="payment-panel"><h2>1. Выберите тариф</h2><div class="plan-list"><label class="plan-option selected"><input type="radio" name="plan" value="trial" checked><span class="plan-radio">✓</span><span class="plan-copy"><strong>Пробный доступ</strong><small>7 дней бесплатно</small></span><span class="plan-price"><strong>0 ₽</strong><small>7 дней</small></span><b>Текущий</b></label><label class="plan-option"><input type="radio" name="plan" value="standard"><span class="plan-radio"></span><span class="plan-copy"><strong>Стандарт</strong><small>Для небольших проектов и команд</small></span><span class="plan-price"><strong>990 ₽ <i>/ мес</i></strong><small>или 9 900 ₽ / год <mark>−17%</mark></small></span></label><label class="plan-option"><input type="radio" name="plan" value="pro"><span class="plan-radio"></span><span class="plan-copy"><strong>Профи</strong><small>Для профессионалов и больших команд</small></span><span class="plan-price"><strong>1 990 ₽ <i>/ мес</i></strong><small>или 19 900 ₽ / год <mark>−17%</mark></small></span></label></div><p class="payment-terms">ⓘ Нажимая «Перейти к оплате», вы соглашаетесь с <a href="#">условиями оферты</a></p></section><section class="payment-panel"><h2>2. Способ оплаты</h2><div class="payment-methods"><button type="button" class="selected" data-method="Банковская карта"><span>▣</span><strong>Банковская карта</strong><small>Visa, Mastercard, МИР</small></button><button type="button" data-method="ЮKassa"><span>▧</span><strong>ЮKassa</strong><small>Онлайн-оплата</small></button><button type="button" data-method="СБП"><span>◇</span><strong>СБП</strong><small>Быстрая оплата</small></button><button type="button" data-method="Счёт для юр. лиц"><span>▤</span><strong>Счёт для юр. лиц</strong><small>Безналичный расчёт</small></button></div></section></div><aside class="payment-summary"><p class="summary-kicker">Ваш заказ</p><dl><div><dt>Тариф<strong id="summary-plan">Пробный доступ</strong><small id="summary-note">7 дней бесплатно</small></dt><dd id="summary-price">0 ₽</dd></div><div><dt>Период</dt><dd id="summary-period">7 дней</dd></div><div class="summary-total"><dt>Итого к оплате</dt><dd id="summary-total">0 ₽</dd></div></dl><div class="payment-unavailable">ⓘ <span>Платёжная система пока не подключена.<br>Здесь появятся история платежей и реквизиты.</span></div><button type="button" disabled>Перейти к оплате <span>→</span></button></aside></div><footer class="payment-security"><span>♙</span><div><strong>Безопасная оплата</strong><small>Платёжные данные будут передаваться напрямую сертифицированному провайдеру</small></div><p>Защищённое соединение · 3-D Secure</p></footer></section>`;
    const updatePlan = (key) => {
      const plan = plans[key];
      $$(".plan-option").forEach((option) =>
        option.classList.toggle("selected", option.querySelector("input").value === key)
      );
      $("#summary-plan").textContent = plan.name;
      $("#summary-note").textContent = plan.note;
      $("#summary-period").textContent = plan.period;
      $("#summary-price").textContent = $("#summary-total").textContent =
        `${plan.price.toLocaleString("ru")} ₽`;
    };
    $$('input[name="plan"]').forEach((input) =>
      input.addEventListener("change", () => updatePlan(input.value))
    );
    $$(".payment-methods button").forEach((button) =>
      button.addEventListener("click", () => {
        $$(".payment-methods button").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
      })
    );
  }
  const result = (
    view === "projects"
      ? list
      : view === "new"
        ? wizard
        : view === "billing"
          ? billing
          : view === "dashboard"
            ? dashboard
            : profile
  )();
  if (result?.catch)
    result.catch((error) => {
      main.innerHTML = `<section class="studio-shell"><p class="form-status">${esc(error.message)}</p></section>`;
    });
})();
