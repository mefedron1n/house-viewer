(() => {
  const API_URL = window.HouseConfig?.apiBaseUrl || location.origin;
  const fetchApi = (url, options = {}) => fetch(url, { credentials: "include", ...options });
  const projectId = new URLSearchParams(location.search).get("project");
  const projectQuery = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const passwordHeader = (value) => `roomark-uri:${encodeURIComponent(value)}`;
  const actionPassword = (message) => window.RoomarkSessionPassword?.get() || prompt(message) || "";
  const rememberActionPassword = (value) => window.RoomarkSessionPassword?.set(value);
  const roomNames = Object.fromEntries(window.HOUSE_ROOMS.map(({ id, name }) => [id, name]));
  const roomCatalog = Object.fromEntries(window.HOUSE_ROOMS.map((room) => [room.id, room]));
  const placeholder = "./images/room-placeholder.svg";
  let roomData = {},
    notes = [],
    activeNoteId = null,
    projectFloorplanUrl = null,
    projectFloorplanAspect = null,
    floorplanCalibration = null,
    calibrationImagePoints = [],
    draftPlanPoint = null,
    planNoteFilter = "all",
    planRoomFilter = "all",
    planZoom = 1,
    noteActionPassword = "";
  let photoQuery = "",
    photoFilter = "all",
    photoSort = "updated",
    photoView = "cards";
  const absoluteUrl = (url) => (url ? `${API_URL}${url}` : null);
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  function roomIconUrl(key) {
    const value = `${key} ${roomNames[key] || ""}`.toLowerCase();
    let icon = "living-room";
    if (/кухня[- ]гостиная|kitchen[- ]living/.test(value)) icon = "kitchen-living";
    else if (/гостин|living/.test(value)) icon = "living-room";
    else if (/кух|kitchen/.test(value)) icon = "kitchen";
    else if (/детск|nursery|child/.test(value)) icon = "nursery";
    else if (/спаль|bedroom|\bbed\b/.test(value)) icon = "bedroom";
    else if (/кабин|office|study/.test(value)) icon = "office";
    else if (/сануз|туал|toilet|\bwc\b/.test(value)) icon = "toilet";
    else if (/ванн|bathroom|\bbath\b/.test(value)) icon = "bathroom";
    else if (/прихож|entryway|foyer/.test(value)) icon = "entryway";
    else if (/корид|холл|hallway|corridor/.test(value)) icon = "hallway";
    else if (/гардероб|wardrobe|closet/.test(value)) icon = "wardrobe";
    else if (/кладов|pantry|storage/.test(value)) icon = "pantry";
    else if (/постир|laundry/.test(value)) icon = "laundry";
    else if (/балкон|лоджи|balcon|loggia/.test(value)) icon = "balcony";
    else if (/террас|terrace/.test(value)) icon = "terrace";
    return `./images/room-icons/${icon}.png`;
  }

  function setMode(mode) {
    document.documentElement.classList.toggle("plan-mode", mode === "plan");
    if (mode !== "3d") window.closeHouseRoom?.();
    document
      .querySelectorAll("[data-mode]")
      .forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    document
      .querySelectorAll("[data-panel]")
      .forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === mode));
    if (mode === "plan") {
      document.getElementById("panel-plan")?.scrollTo(0, 0);
      requestAnimationFrame(() => requestAnimationFrame(renderPlanWorkspace));
    }
    document.querySelector(".project-card").hidden = mode !== "3d";
    document.querySelector(".tools").hidden = mode !== "3d";
    if (mode === "3d") window.dispatchEvent(new Event("resize"));
  }
  window.showApartment = () => setMode("3d");
  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) setMode(modeButton.dataset.mode);
  });

  document
    .querySelectorAll(".settings-toggle")
    .forEach((button) =>
      button.addEventListener("click", () =>
        document.getElementById("settings-drawer").classList.toggle("open")
      )
    );
  const themeButton = document.getElementById("theme-button");
  function setTheme(dark) {
    document.documentElement.classList.toggle("dark", dark);
    themeButton.classList.toggle("active", dark);
    themeButton.setAttribute("aria-pressed", dark);
    themeButton.setAttribute("aria-label", dark ? "Включить светлую тему" : "Включить тёмную тему");
    themeButton.title = dark ? "Светлая тема" : "Тёмная тема";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#20251F" : "#F2EFE7");
    localStorage.setItem("theme", dark ? "dark" : "light");
    window.dispatchEvent(new CustomEvent("theme-changed", { detail: { dark } }));
  }
  setTheme(
    localStorage.getItem("theme") === "dark" ||
      (!localStorage.getItem("theme") && matchMedia("(prefers-color-scheme:dark)").matches)
  );
  themeButton.onclick = () => setTheme(!document.documentElement.classList.contains("dark"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.getElementById("settings-drawer").classList.remove("open");
      activeNoteId = null;
      renderPins();
    }
  });

  function roomTile(key, room) {
    const image = absoluteUrl(room.floorplanUrl || room.renderUrls?.[0]);
    return `<button class="room-tile" data-room-focus="${escapeHtml(key)}" type="button"><span class="room-visual">${image ? `<img src="${escapeHtml(image)}" alt="Планировка: ${escapeHtml(roomNames[key])}">` : `<img class="room-type-icon" src="${roomIconUrl(key)}" alt="">`}</span><span class="room-copy"><strong>${escapeHtml(roomNames[key])}</strong><small>Открыть страницу помещения</small></span></button>`;
  }
  function renderPlan() {
    const container = document.getElementById("plan-rooms");
    if (!container) return;
    container.innerHTML = Object.entries(roomNames)
      .map(([key]) => roomTile(key, roomData[key] || {}))
      .join("");
  }
  function calibrationState(message) {
    const state = document.getElementById("calibration-state");
    if (state) state.innerHTML = `<strong>Привязка к 3D:</strong> ${message}`;
  }
  function applyProjectFloorplan(url, calibration = floorplanCalibration) {
    projectFloorplanUrl = absoluteUrl(url);
    floorplanCalibration = window.RoomarkSpatial?.validCalibration(calibration) ? calibration : null;
    const board = document.getElementById("pin-board");
    if (projectFloorplanUrl) {
      board.style.backgroundImage = `url("${projectFloorplanUrl}")`;
      board.classList.add("has-floorplan");
      renderPlanWorkspace();
      const dimensions = new Image();
      dimensions.onload = () => {
        if (!dimensions.naturalWidth || !dimensions.naturalHeight) return;
        projectFloorplanAspect = dimensions.naturalWidth / dimensions.naturalHeight;
        renderPlanWorkspace();
      };
      dimensions.src = projectFloorplanUrl;
      document.getElementById("project-floorplan-status").textContent = "Общий план проекта загружен.";
    } else {
      board.style.backgroundImage = "";
      projectFloorplanAspect = null;
      board.classList.remove("has-floorplan");
      floorplanCalibration = null;
      renderPlanWorkspace();
    }
  }
  async function loadProjectFloorplan() {
    try {
      const response = await fetchApi(`${API_URL}/api/project${projectQuery}`, { cache: "no-store" });
      if (response.ok) {
        const manifest = await response.json();
        applyProjectFloorplan(manifest.floorplanUrl, manifest.calibration);
      }
    } catch {}
  }
  const projectFloorplanInput = document.createElement("input");
  projectFloorplanInput.type = "file";
  projectFloorplanInput.accept = "image/jpeg,image/png,image/webp";
  projectFloorplanInput.hidden = true;
  document.body.append(projectFloorplanInput);
  document.getElementById("project-floorplan-upload").onclick = () => projectFloorplanInput.click();
  projectFloorplanInput.onchange = async () => {
    const file = projectFloorplanInput.files[0],
      status = document.getElementById("project-floorplan-status");
    if (!file) return;
    const password = actionPassword("Введите пароль для загрузки общей планировки:");
    if (!password) return;
    status.textContent = "Загрузка…";
    const data = new FormData();
    data.append("file", file);
    try {
      const response = await fetchApi(`${API_URL}/api/project/floorplan${projectQuery}`, {
          method: "POST",
          headers: { "X-Upload-Password": passwordHeader(password) },
          body: data,
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить планировку.");
      applyProjectFloorplan(result.floorplanUrl, null);
      status.textContent = "Общий план проекта сохранён. Теперь на нём можно ставить замечания.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      projectFloorplanInput.value = "";
    }
  };
  const galleryIndexes = { photos: 0, renders: 0 };
  function galleryItems(kind) {
    return Object.entries(roomNames).flatMap(([key, title]) => {
      const room = roomData[key] || {};
      if (kind === "photos")
        return (room.photos || []).map((photo, index) => ({
          url: absoluteUrl(photo.url),
          title,
          caption: `${title} · фото ${index + 1}`,
        }));
      return (room.renderUrls || []).map((url, index) => ({
        url: absoluteUrl(url),
        title,
        caption: `${title} · рендер ${index + 1}`,
      }));
    });
  }
  function mediaRoomTile(key, kind) {
    const room = roomData[key] || {},
      photo = room.photos?.[0]?.url,
      render = room.renderUrls?.[0],
      image = absoluteUrl(kind === "photos" ? photo : render);
    return `<button class="room-tile" data-room-focus="${escapeHtml(key)}" data-room-tab-target="${kind}" type="button"><span class="room-visual">${image ? `<img src="${escapeHtml(image)}" alt="${kind === "photos" ? "Фото" : "Рендер"}: ${escapeHtml(roomNames[key])}">` : `<img class="room-type-icon" src="${roomIconUrl(key)}" alt="">`}</span><span class="room-copy"><strong>${escapeHtml(roomNames[key])}</strong><small>Открыть ${kind === "photos" ? "фотографии" : "рендеры"} комнаты</small></span></button>`;
  }
  function rendersMarkup() {
    const items = galleryItems("renders"),
      keys = Object.keys(roomNames),
      withRenders = keys.filter((key) => roomData[key]?.renderUrls?.length).length;
    const cards = keys.map((key) => {
      const urls = roomData[key]?.renderUrls || [], image = absoluteUrl(urls[0]);
      return `<article class="render-room-card"><button class="render-room-cover" type="button" data-room-focus="${escapeHtml(key)}" data-room-tab-target="renders" aria-label="Рендеры: ${escapeHtml(roomNames[key])}">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(roomNames[key])}" loading="lazy"><span class="render-room-count">${urls.length} визуализаций</span>` : `<span class="render-room-empty"><img src="${roomIconUrl(key)}" alt=""><span>Рендеров пока нет</span></span>`}</button><div class="render-room-copy"><h3>${escapeHtml(roomNames[key])}</h3><p>${urls.length ? "Дизайн и ракурсы помещения" : "Добавьте первый взгляд на будущий интерьер"}</p><button type="button" data-room-focus="${escapeHtml(key)}" data-room-tab-target="renders">${urls.length ? "Смотреть рендеры" : "+ Добавить рендер"}<span aria-hidden="true">→</span></button></div></article>`;
    }).join("");
    return `<div class="renders-summary"><span><b>${items.length}</b> визуализаций</span><span><b>${withRenders}</b> помещений с рендерами</span><span><b>${keys.length}</b> помещений в проекте</span></div><section id="render-rooms" class="render-rooms" tabindex="-1"><header><div><p class="eyebrow">Каждая комната — своя история</p><h3>Рендеры по помещениям</h3></div><span>${keys.length} помещений</span></header><p id="renders-upload-hint" class="renders-upload-hint" hidden>Выберите помещение — загрузка и просмотр откроются в отдельном окне.</p><div class="render-room-grid">${cards || `<p class="renders-no-rooms">Добавьте помещение в проект, чтобы загрузить его визуализации.</p>`}</div></section>`;
  }
  function galleryMarkup(kind) {
    if (kind === "renders") return rendersMarkup();
    const items = galleryItems(kind),
      index = items.length ? galleryIndexes[kind] % items.length : 0,
      item = items[index];
    if (!item) {
      const empty =
        kind === "renders"
          ? `<div class="workspace-empty"><span class="workspace-empty-icon" aria-hidden="true">◇</span><h3>Рендеры проекта</h3><p>Здесь появятся визуализации помещений. Выберите комнату ниже, чтобы добавить первый рендер.</p></div>`
          : `<div class="empty-state">Материалы ещё не загружены. Добавить их можно на странице соответствующей комнаты.</div>`;
      return `${empty}<h3 class="gallery-room-title">Выбрать комнату</h3><div class="room-grid">${Object.keys(
        roomNames
      )
        .map((key) => mediaRoomTile(key, kind))
        .join("")}</div>`;
    }
    return `<section class="media-showcase" data-gallery-kind="${kind}"><div class="media-stage"><button class="media-arrow previous" type="button" data-gallery-step="-1" aria-label="Предыдущее изображение">‹</button><button class="media-main" type="button" data-image="${item.url}" data-caption="${item.caption}"><img src="${item.url}" alt="${item.caption}"><span>${item.caption}</span></button><button class="media-arrow next" type="button" data-gallery-step="1" aria-label="Следующее изображение">›</button></div><div class="media-counter">${index + 1} / ${items.length}</div><div class="media-thumbnails">${items.map((entry, itemIndex) => `<button class="media-thumbnail ${itemIndex === index ? "active" : ""}" type="button" data-gallery-index="${itemIndex}" aria-label="${entry.caption}"><img src="${entry.url}" alt="" loading="lazy"></button>`).join("")}</div></section><h3 class="gallery-room-title">Выбрать комнату</h3><div class="room-grid">${Object.keys(
      roomNames
    )
      .map((key) => mediaRoomTile(key, kind))
      .join("")}</div>`;
  }
  const photoTimestamp = (photo) => {
    const value = photo?.createdAt || photo?.date;
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  const relativePhotoDate = (timestamp) => {
    if (!timestamp) return "ещё не обновлялось";
    const days = Math.floor((Date.now() - timestamp) / 86400000);
    if (days <= 0) return "обновлено сегодня";
    if (days === 1) return "обновлено вчера";
    if (days < 7) return `обновлено ${days} дн. назад`;
    return `обновлено ${new Date(timestamp).toLocaleDateString("ru")}`;
  };
  const roomStorey = (key) => {
    const value = String(roomCatalog[key]?.storeyId || roomCatalog[key]?.floor || "").toLowerCase();
    const match = value.match(/(\d+)/);
    return match ? `${match[1]} этаж` : "Помещения";
  };
  function photoRoomEntries() {
    return Object.keys(roomNames).map((key) => {
      const data = roomData[key] || {}, photos = data.photos || [], latest = [...photos].sort((a, b) => photoTimestamp(b) - photoTimestamp(a))[0];
      const openNotes = notes.filter((note) => note.roomId === key && note.status !== "resolved").length;
      const updated = photoTimestamp(latest), isNew = updated > Date.now() - 7 * 86400000;
      return { key, data, photos, latest, openNotes, updated, isNew, storey: roomStorey(key) };
    });
  }
  function photoRoomCard(item) {
    const { key, photos, latest, openNotes, updated, isNew } = item;
    const image = latest && !/\.pdf(?:$|\?)/i.test(latest.url || "") && absoluteUrl(latest.thumbnailUrl || latest.url),
      hasPdfPreview = latest && /\.pdf(?:$|\?)/i.test(latest.url || "");
    const type = latest?.type === "defect" ? "Замечание" : latest?.type === "completed" ? "Готовая работа" : latest?.type === "construction" ? "Ход строительства" : photos.length ? "Фото ремонта" : "Фотографий пока нет";
    return `<article class="photo-room-card ${openNotes ? "has-notes" : ""}" data-photo-room-card data-photo-room-name="${escapeHtml(roomNames[key].toLowerCase())}">
      <button class="photo-room-cover" type="button" data-room-focus="${key}" data-room-tab-target="photos">
        ${image ? `<img src="${escapeHtml(image)}" alt="Последние фотографии: ${escapeHtml(roomNames[key])}" loading="lazy">` : `<span class="photo-room-empty">${hasPdfPreview ? `<span class="photo-pdf-icon">PDF</span><b>Последний материал — PDF</b>` : `<img src="${roomIconUrl(key)}" alt=""><b>Фотографий пока нет</b>`}</span>`}
        <span class="photo-room-badges">${isNew ? `<i>Новое</i>` : ""}${openNotes ? `<i class="attention">${openNotes} ${openNotes === 1 ? "замечание" : "замечания"}</i>` : ""}</span>
      </button>
      <div class="photo-room-body"><div class="photo-room-title"><h3>${escapeHtml(roomNames[key])}</h3><span>${escapeHtml(type)}</span></div>
        <div class="photo-room-meta"><span>${photos.length} фото</span><span>${relativePhotoDate(updated)}</span></div>
        <button class="photo-room-open" type="button" data-room-focus="${key}" data-room-tab-target="photos">${photos.length ? "Открыть журнал →" : "Добавить первые фотографии"}</button>
      </div></article>`;
  }
  function photoOverviewMarkup() {
    const all = photoRoomEntries(), totalPhotos = all.reduce((sum, item) => sum + item.photos.length, 0), newPhotos = all.reduce((sum, item) => sum + (item.isNew ? item.photos.filter((photo) => photoTimestamp(photo) > Date.now() - 7 * 86400000).length : 0), 0), openNotes = all.reduce((sum, item) => sum + item.openNotes, 0);
    let items = all.filter((item) => {
      if (photoQuery && !roomNames[item.key].toLowerCase().includes(photoQuery)) return false;
      if (photoFilter === "new" && !item.isNew) return false;
      if (photoFilter === "notes" && !item.openNotes) return false;
      if (photoFilter === "empty" && item.photos.length) return false;
      return true;
    });
    items.sort((a, b) => photoSort === "name" ? roomNames[a.key].localeCompare(roomNames[b.key], "ru") : b.updated - a.updated);
    const groups = Object.groupBy ? Object.groupBy(items, (item) => item.storey) : items.reduce((result, item) => ((result[item.storey] ||= []).push(item), result), {});
    return `<section class="photo-summary" aria-label="Сводка по фотографиям"><span><b>${all.length}</b><small>помещений</small></span><span><b>${totalPhotos}</b><small>фотографий</small></span><span><b>${newPhotos}</b><small>новых за 7 дней</small></span><span class="attention"><b>${openNotes}</b><small>открытых замечаний</small></span></section>
      <section class="photo-overview-toolbar"><label class="photo-search"><span aria-hidden="true">⌕</span><input id="photo-room-search" name="photo-room-filter-query" type="search" autocomplete="new-password" autocapitalize="none" spellcheck="false" readonly data-form-type="other" data-lpignore="true" data-1p-ignore data-bwignore="true" value="${escapeHtml(photoQuery)}" placeholder="Найти помещение"></label><div class="photo-filter-group">${[["all","Все"],["new","Новые фото"],["notes","С замечаниями"],["empty","Без фотографий"]].map(([value,label]) => `<button class="${photoFilter === value ? "active" : ""}" type="button" data-photo-filter="${value}">${label}</button>`).join("")}</div><select id="photo-sort" aria-label="Сортировка"><option value="updated" ${photoSort === "updated" ? "selected" : ""}>Сначала обновлённые</option><option value="name" ${photoSort === "name" ? "selected" : ""}>По названию</option></select><div class="photo-view-toggle"><button class="${photoView === "cards" ? "active" : ""}" type="button" data-photo-view="cards">Карточки</button><button class="${photoView === "list" ? "active" : ""}" type="button" data-photo-view="list">Список</button></div></section>
      <div class="photo-room-groups ${photoView === "list" ? "list-view" : ""}">${items.length ? Object.entries(groups).map(([storey, entries]) => `<section class="photo-floor"><h3>${escapeHtml(storey)}</h3><div class="photo-room-grid">${entries.map(photoRoomCard).join("")}</div></section>`).join("") : `<div class="workspace-empty"><h3>Ничего не найдено</h3><p>Измените поиск или фильтры помещений.</p><button class="secondary" type="button" data-photo-reset>Сбросить фильтры</button></div>`}</div>`;
  }
  function renderGalleries() {
    document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
    document.getElementById("renders-content").innerHTML = galleryMarkup("renders");
    [0, 100, 350, 1000, 2000].forEach((delay) =>
      setTimeout(() => {
        const input = document.getElementById("photo-room-search");
        if (input && document.activeElement !== input && input.value.includes("@")) {
          input.value = "";
          photoQuery = "";
        }
      }, delay)
    );
  }
  async function loadRooms() {
    const entries = await Promise.all(
      Object.keys(roomNames).map(async (key) => {
        try {
          const response = await fetchApi(`${API_URL}/api/rooms/${key}`, { cache: "no-store" });
          return [key, response.ok ? await response.json() : {}];
        } catch {
          return [key, {}];
        }
      })
    );
    roomData = Object.fromEntries(entries);
    renderPlan();
    renderGalleries();
  }
  const roomMediaDialog = document.getElementById("room-media-dialog"),
    roomMediaFiles = document.getElementById("room-media-files");
  let roomMediaKind = "photos",
    roomMediaKey = null,
    roomMediaIndex = 0;
  function roomMediaItems() {
    const data = roomData[roomMediaKey] || {};
    if (roomMediaKind === "photos")
      return (data.photos || []).map((photo, index) => ({
        ...photo,
        url: absoluteUrl(photo.url),
        filename: decodeURIComponent(new URL(absoluteUrl(photo.url), location.href).pathname.split("/").pop()),
        label: photo.comment || `Фото ${index + 1}`,
        pdf: /\.pdf(?:$|\?)/i.test(photo.url),
      }));
    return (data.renderUrls || []).map((url, index) => ({
      url: absoluteUrl(url),
      filename: decodeURIComponent(new URL(absoluteUrl(url), location.href).pathname.split("/").pop()),
      label: `Рендер ${index + 1}`,
      pdf: false,
    }));
  }
  function renderRoomMediaNotes() {
    const section = document.getElementById("room-media-notes"),
      list = document.getElementById("room-media-notes-list");
    section.hidden = roomMediaKind !== "photos";
    if (section.hidden) return;
    const roomNotes = notes.filter((note) => note.roomId === roomMediaKey);
    list.innerHTML = roomNotes.length
      ? roomNotes.map((note, index) => `<article class="room-media-note ${note.status === "resolved" ? "resolved" : ""}"><span>${index + 1}</span><div><strong>Изменения</strong><p>${escapeHtml(note.text)}</p><small>${escapeHtml(noteDate(note.createdAt))}${note.status === "resolved" ? " · исправлено" : ""}</small></div></article>`).join("")
      : `<p class="room-media-notes-empty">В этой комнате замечаний пока нет.</p>`;
  }
  function renderRoomMedia() {
    if (!roomMediaKey) return;
    const items = roomMediaItems(),
      stage = document.getElementById("room-media-stage"),
      thumbnails = document.getElementById("room-media-thumbnails");
    roomMediaIndex = items.length ? Math.max(0, Math.min(roomMediaIndex, items.length - 1)) : 0;
    const item = items[roomMediaIndex];
    document.getElementById("room-media-title").textContent = roomNames[roomMediaKey] || "Помещение";
    document.getElementById("room-media-subtitle").textContent = roomMediaKind === "photos" ? "Фото и документы" : "Рендеры";
    document.getElementById("room-media-counter").textContent = items.length ? `${roomMediaIndex + 1} / ${items.length}` : "0 / 0";
    document.getElementById("room-media-types").textContent = roomMediaKind === "photos" ? "JPEG, PNG, PDF" : "JPEG, PNG";
    document.getElementById("room-media-delete").hidden = !item;
    stage.innerHTML = item
      ? `${item.pdf ? `<iframe src="${escapeHtml(item.url)}" title="${escapeHtml(item.label)}"></iframe>` : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.label)}">`}<button class="room-media-arrow previous" type="button" data-room-media-step="-1" aria-label="Предыдущий материал" ${items.length < 2 ? "disabled" : ""}>‹</button><button class="room-media-arrow next" type="button" data-room-media-step="1" aria-label="Следующий материал" ${items.length < 2 ? "disabled" : ""}>›</button>`
      : `<div class="room-media-empty"><span>${roomMediaKind === "photos" ? "▧" : "◇"}</span><strong>${roomMediaKind === "photos" ? "Фотографий пока нет" : "Рендеров пока нет"}</strong><p>Загрузите первый материал для этого помещения.</p></div>`;
    thumbnails.innerHTML = items.map((entry, index) => `<button class="${index === roomMediaIndex ? "active" : ""}" type="button" data-room-media-index="${index}" aria-label="${escapeHtml(entry.label)}" aria-pressed="${index === roomMediaIndex}">${entry.pdf ? `<span>PDF</span>` : `<img src="${escapeHtml(entry.url)}" alt="" loading="lazy">`}</button>`).join("");
    renderRoomMediaNotes();
  }
  function openRoomMedia(key, kind) {
    if (!roomNames[key]) return;
    roomMediaKey = key;
    roomMediaKind = kind === "renders" ? "renders" : "photos";
    roomMediaIndex = 0;
    document.getElementById("room-media-status").textContent = "";
    roomMediaFiles.accept = roomMediaKind === "photos" ? "image/jpeg,image/png,application/pdf,.pdf" : "image/jpeg,image/png";
    renderRoomMedia();
    roomMediaDialog.showModal();
  }
  roomMediaDialog.addEventListener("click", (event) => {
    if (event.target === roomMediaDialog) roomMediaDialog.close();
    const step = event.target.closest("[data-room-media-step]"),
      selected = event.target.closest("[data-room-media-index]"),
      items = roomMediaItems();
    if (step && items.length) {
      roomMediaIndex = (roomMediaIndex + Number(step.dataset.roomMediaStep) + items.length) % items.length;
      renderRoomMedia();
    } else if (selected) {
      roomMediaIndex = Number(selected.dataset.roomMediaIndex);
      renderRoomMedia();
    }
  });
  document.getElementById("room-media-close").addEventListener("click", () => roomMediaDialog.close());
  document.getElementById("room-media-upload").addEventListener("click", () => {
    roomMediaFiles.value = "";
    roomMediaFiles.click();
  });
  roomMediaFiles.addEventListener("change", async () => {
    const files = [...roomMediaFiles.files],
      status = document.getElementById("room-media-status"),
      password = actionPassword(`Введите пароль для загрузки ${roomMediaKind === "photos" ? "фотографий" : "рендеров"}:`);
    if (!files.length || !password) return;
    status.textContent = "Загружаем материалы…";
    try {
      for (const file of files) {
        const data = new FormData();
        data.append("file", file);
        if (roomMediaKind === "photos") {
          data.append("type", "other");
          data.append("date", new Date().toISOString().slice(0, 10));
          data.append("comment", file.name.replace(/\.[^.]+$/, ""));
        }
        const response = await fetchApi(`${API_URL}/api/rooms/${encodeURIComponent(roomMediaKey)}/assets/${roomMediaKind === "photos" ? "photo" : "render"}`, {
          method: "POST",
          headers: { "X-Upload-Password": passwordHeader(password) },
          body: data,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Не удалось загрузить ${file.name}.`);
        roomData[roomMediaKey] = result;
      }
      rememberActionPassword(password);
      roomMediaIndex = Math.max(0, roomMediaItems().length - 1);
      renderGalleries();
      renderRoomMedia();
      status.textContent = "Материалы загружены.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.getElementById("room-media-delete").addEventListener("click", async () => {
    const item = roomMediaItems()[roomMediaIndex];
    if (!item || !confirm(`Удалить «${item.label}»?`)) return;
    const password = actionPassword("Введите пароль для удаления материала:");
    if (!password) return;
    const status = document.getElementById("room-media-status");
    try {
      const response = await fetchApi(`${API_URL}/api/rooms/${encodeURIComponent(roomMediaKey)}/assets/${encodeURIComponent(item.filename)}`, {
        method: "DELETE",
        headers: { "X-Upload-Password": passwordHeader(password) },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось удалить материал.");
      roomData[roomMediaKey] = result;
      rememberActionPassword(password);
      roomMediaIndex = Math.max(0, roomMediaIndex - 1);
      renderGalleries();
      renderRoomMedia();
      status.textContent = "Материал удалён.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.getElementById("room-media-note-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("room-media-note-text"),
      status = document.getElementById("room-media-status"),
      password = noteActionPassword || actionPassword("Введите пароль, чтобы добавить замечание:");
    if (!password || !input.value.trim()) return;
    try {
      const response = await fetchApi(`${API_URL}/api/notes${projectQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
        body: JSON.stringify({ text: input.value.trim(), roomId: roomMediaKey, position: { x: .5, y: .5, z: .5 }, coordinateSpace: "legacy-normalized-v1" }),
      });
      const note = await response.json();
      if (!response.ok) throw new Error(note.error || "Не удалось добавить замечание.");
      noteActionPassword = password;
      rememberActionPassword(password);
      notes.push(note);
      input.value = "";
      renderRoomMediaNotes();
      document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
      window.dispatchEvent(new Event("notes-changed"));
      status.textContent = "Замечание добавлено и связано с комнатой.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.addEventListener("click", (event) => {
    const photoFilterButton = event.target.closest("[data-photo-filter]");
    if (photoFilterButton) {
      photoFilter = photoFilterButton.dataset.photoFilter;
      document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
      return;
    }
    const photoViewButton = event.target.closest("[data-photo-view]");
    if (photoViewButton) {
      photoView = photoViewButton.dataset.photoView;
      document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
      return;
    }
    if (event.target.closest("[data-photo-reset]")) {
      photoQuery = "";
      photoFilter = "all";
      document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
      return;
    }
    const tile = event.target.closest("[data-room-focus]");
    if (tile && ["photos", "renders"].includes(tile.dataset.roomTabTarget))
      return openRoomMedia(tile.dataset.roomFocus, tile.dataset.roomTabTarget);
    if (tile) return window.openHouseRoom?.(tile.dataset.roomFocus, tile.dataset.roomTabTarget);
    const gallery = event.target.closest("[data-gallery-kind]");
    if (!gallery) return;
    const kind = gallery.dataset.galleryKind,
      total = galleryItems(kind).length,
      step = event.target.closest("[data-gallery-step]"),
      selected = event.target.closest("[data-gallery-index]");
    if (step && total)
      galleryIndexes[kind] =
        (galleryIndexes[kind] + Number(step.dataset.galleryStep) + total) % total;
    else if (selected) galleryIndexes[kind] = Number(selected.dataset.galleryIndex);
    else return;
    document.getElementById(`${kind}-content`).innerHTML = galleryMarkup(kind);
  });
  document.getElementById("photos-content").addEventListener("input", (event) => {
    if (event.target.id !== "photo-room-search") return;
    if (event.target.value.includes("@")) {
      event.target.value = "";
      photoQuery = "";
      return;
    }
    photoQuery = event.target.value.trim().toLowerCase();
    const position = event.target.selectionStart;
    document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
    const next = document.getElementById("photo-room-search");
    next.focus();
    next.setSelectionRange(position, position);
  });
  const unlockPhotoSearch = (event) => {
    if (event.target.id !== "photo-room-search") return;
    event.target.readOnly = false;
    if (event.target.value.includes("@")) {
      event.target.value = "";
      photoQuery = "";
    }
  };
  document.getElementById("photos-content").addEventListener("pointerdown", unlockPhotoSearch);
  document.getElementById("photos-content").addEventListener("keydown", unlockPhotoSearch);
  document.getElementById("photos-content").addEventListener("change", (event) => {
    if (event.target.id !== "photo-sort") return;
    photoSort = event.target.value;
    document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
  });
  function chooseRenderRoom() {
    const rooms = document.getElementById("render-rooms");
    if (!rooms) return;
    document.getElementById("renders-upload-hint").hidden = false;
    rooms.focus({ preventScroll: true });
    rooms.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  }
  document.getElementById("renders-choose-room").addEventListener("click", chooseRenderRoom);
  document.getElementById("renders-content").addEventListener("click", (event) => {
    if (event.target.closest("[data-choose-render-room]")) chooseRenderRoom();
  });

  const lightbox = document.getElementById("lightbox"),
    lightboxImage = lightbox.querySelector(".lightbox-image");
  let lightboxItems = [],
    lightboxIndex = 0,
    touchStartX = 0;
  function showLightboxItem(index) {
    if (!lightboxItems.length) return;
    lightboxIndex = (index + lightboxItems.length) % lightboxItems.length;
    const item = lightboxItems[lightboxIndex];
    lightboxImage.src = item.dataset.image;
    lightboxImage.alt = item.dataset.caption;
    document.getElementById("lightbox-caption").textContent = item.dataset.caption;
    document.getElementById("lightbox-counter").textContent =
      `${lightboxIndex + 1} / ${lightboxItems.length}`;
  }
  document.addEventListener("click", (event) => {
    const imageButton = event.target.closest("[data-image]");
    if (!imageButton) return;
    lightboxItems = [...document.querySelectorAll("[data-image]")].filter(
      (item) => item.offsetParent !== null
    );
    lightboxIndex = lightboxItems.indexOf(imageButton);
    showLightboxItem(lightboxIndex);
    lightbox.showModal();
  });
  document.getElementById("lightbox-close").addEventListener("click", () => lightbox.close());
  document
    .getElementById("lightbox-prev")
    .addEventListener("click", () => showLightboxItem(lightboxIndex - 1));
  document
    .getElementById("lightbox-next")
    .addEventListener("click", () => showLightboxItem(lightboxIndex + 1));
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });
  lightboxImage.addEventListener(
    "touchstart",
    (event) => {
      touchStartX = event.changedTouches[0].clientX;
    },
    { passive: true }
  );
  lightboxImage.addEventListener(
    "touchend",
    (event) => {
      const distance = event.changedTouches[0].clientX - touchStartX;
      if (Math.abs(distance) > 45) showLightboxItem(lightboxIndex + (distance < 0 ? 1 : -1));
    },
    { passive: true }
  );
  document.addEventListener("keydown", (event) => {
    if (!lightbox.open) return;
    if (event.key === "ArrowLeft") showLightboxItem(lightboxIndex - 1);
    if (event.key === "ArrowRight") showLightboxItem(lightboxIndex + 1);
  });

  if (false) {
  function numberFromId(id, offset) {
    const fragment = id.slice(offset, offset + 6) || "1";
    return Number.parseInt(fragment, 16) || 1;
  }
  function pinPosition(note) {
    if (note.coordinateSpace === "model-world-v1" && floorplanCalibration) {
      const mapped = window.RoomarkSpatial.worldToImage(floorplanCalibration.matrix, note.position);
      if (mapped) return { left: mapped.x * 100, top: mapped.z * 100 };
    }
    if (Number.isFinite(note.position?.x) && Number.isFinite(note.position?.z))
      return { left: note.position.x * 100, top: (1 - note.position.z) * 100 };
    return { left: 8 + (numberFromId(note.id, 0) % 78), top: 12 + (numberFromId(note.id, 6) % 70) };
  }
  function floorplanRect(board) {
    const width = board.clientWidth,
      height = board.clientHeight;
    if (!projectFloorplanAspect || !width || !height)
      return { left: 0, top: 0, width, height };
    if (width / height > projectFloorplanAspect) {
      const imageWidth = height * projectFloorplanAspect;
      return { left: (width - imageWidth) / 2, top: 0, width: imageWidth, height };
    }
    const imageHeight = width / projectFloorplanAspect;
    return { left: 0, top: (height - imageHeight) / 2, width, height: imageHeight };
  }
  function pinPixelPosition(note, board) {
    const position = pinPosition(note),
      image = floorplanRect(board);
    return {
      left: image.left + (position.left / 100) * image.width,
      top: image.top + (position.top / 100) * image.height,
    };
  }
  function eventImagePoint(event, board) {
    const bounds = board.getBoundingClientRect(),
      image = floorplanRect(board);
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left - image.left) / image.width)),
      z: Math.max(0, Math.min(1, (event.clientY - bounds.top - image.top) / image.height)),
    };
  }
  function worldPositionFromImage(point, previousY) {
    if (!floorplanCalibration) return null;
    const world = window.RoomarkSpatial.imageToWorld(floorplanCalibration.matrix, point);
    return world && {
      x: world.x,
      y: Number.isFinite(previousY) ? previousY : Number(floorplanCalibration.floorY || 0) + 0.12,
      z: world.z,
    };
  }
  function planImageRect(board) {
    const width = board.clientWidth, height = board.clientHeight;
    if (!projectFloorplanAspect || !width || !height) return { left: 0, top: 0, width, height };
    let rect;
    // The uploaded plan may be an export with large margins. Fill the canvas like the reference,
    // cropping those margins instead of shrinking the actual drawing into the centre.
    if (width / height > projectFloorplanAspect) {
      const imageHeight = width / projectFloorplanAspect;
      rect = { left: 0, top: (height - imageHeight) / 2, width, height: imageHeight };
    } else {
      const imageWidth = height * projectFloorplanAspect;
      rect = { left: (width - imageWidth) / 2, top: 0, width: imageWidth, height };
    }
    const scaledWidth = rect.width * planZoom, scaledHeight = rect.height * planZoom;
    return { left: (width - scaledWidth) / 2, top: (height - scaledHeight) / 2, width: scaledWidth, height: scaledHeight };
  }
  function visiblePlanNotes() {
    return notes.filter((note) => {
      const resolved = note.status === "resolved";
      return !(planNoteFilter === "open" && resolved) && !(planNoteFilter === "resolved" && !resolved) &&
        (planRoomFilter === "all" || note.roomId === planRoomFilter);
    });
  }
  function notePlanPoint(note) {
    if (note.coordinateSpace !== "model-world-v1")
      return { x: Number(note.position?.x ?? .5), y: 1 - Number(note.position?.z ?? .5) };
    if (floorplanCalibration && window.RoomarkSpatial?.worldToImage) {
      const mapped = window.RoomarkSpatial.worldToImage(floorplanCalibration.matrix, note.position);
      if (mapped) return { x: mapped.x, y: mapped.z };
    }
    const bounds = window.RoomarkSpatialContext?.bounds,
      width = Number(bounds?.max?.x) - Number(bounds?.min?.x),
      depth = Number(bounds?.max?.z) - Number(bounds?.min?.z);
    if (width > 0 && depth > 0)
      return {
        x: (Number(note.position?.x) - Number(bounds.min.x)) / width,
        y: 1 - (Number(note.position?.z) - Number(bounds.min.z)) / depth,
      };
    return { x: .5, y: .5 };
  }
  function positionFromPlanPoint(point, note) {
    if (note?.coordinateSpace !== "model-world-v1")
      return { position: { x: point.x, y: note?.position?.y ?? .5, z: 1 - point.y }, coordinateSpace: "legacy-normalized-v1" };
    if (floorplanCalibration && window.RoomarkSpatial?.imageToWorld) {
      const mapped = window.RoomarkSpatial.imageToWorld(floorplanCalibration.matrix, { x: point.x, z: point.y });
      if (mapped) return { position: { x: mapped.x, y: note.position?.y ?? floorplanCalibration.floorY ?? 0, z: mapped.z }, coordinateSpace: "model-world-v1" };
    }
    const bounds = window.RoomarkSpatialContext?.bounds,
      width = Number(bounds?.max?.x) - Number(bounds?.min?.x),
      depth = Number(bounds?.max?.z) - Number(bounds?.min?.z);
    if (width > 0 && depth > 0)
      return {
        position: {
          x: Number(bounds.min.x) + point.x * width,
          y: note.position?.y ?? Number(bounds.floorY || 0),
          z: Number(bounds.min.z) + (1 - point.y) * depth,
        },
        coordinateSpace: "model-world-v1",
      };
    return { position: { x: point.x, y: .5, z: 1 - point.y }, coordinateSpace: "legacy-normalized-v1" };
  }
  function renderPlanWorkspace() {
    const board = document.getElementById("pin-board");
    if (!board) return;
    if (!projectFloorplanUrl) {
      board.innerHTML = `<div class="workspace-empty"><span class="workspace-empty-icon">⌖</span><h3>Загрузите общий план проекта</h3><p>Один план для всего объекта — без отдельных планировок комнат.</p></div>`;
      return;
    }
    const image = planImageRect(board);
    if (image.width > 0 && image.height > 0)
      board.style.backgroundSize = `${image.width}px ${image.height}px`;
    else board.style.removeProperty("background-size");
    board.innerHTML = visiblePlanNotes().map((note) => {
      let x = Number(note.position?.x ?? .5), y = 1 - Number(note.position?.z ?? .5);
      if (note.coordinateSpace === "model-world-v1" && floorplanCalibration) {
        const mapped = window.RoomarkSpatial?.worldToImage(floorplanCalibration.matrix, note.position);
        if (mapped) { x = mapped.x; y = mapped.z; }
      }
      return `<button class="note-pin ${note.status === "resolved" ? "resolved" : ""} ${activeNoteId === note.id ? "active" : ""}" type="button" data-note-id="${note.id}" style="left:${image.left + x * image.width}px;top:${image.top + y * image.height}px"><span>${visiblePlanNotes().indexOf(note) + 1}</span></button>`;
    }).join("");
    if (draftPlanPoint) {
      const marker = document.createElement("span");
      marker.className = "draft-note-pin"; marker.textContent = "+";
      marker.style.left = `${image.left + draftPlanPoint.x * image.width}px`;
      marker.style.top = `${image.top + draftPlanPoint.y * image.height}px`;
      board.append(marker);
    }
  }
  function noteDate(value) {
    try {
      return new Intl.DateTimeFormat("ru", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    } catch {
      return "";
    }
  }
  function renderPins() {
    const board = document.getElementById("pin-board");
    board.innerHTML = notes.length
      ? notes
          .map((note, index) => {
            const position = pinPixelPosition(note, board);
            return `<button class="note-pin ${activeNoteId === note.id ? "active" : ""}" type="button" data-note-id="${note.id}" style="left:${position.left}px;top:${position.top}px" aria-label="Открыть замечание ${index + 1}"><span>${index + 1}</span></button>`;
          })
          .join("")
      : `<div class="workspace-empty"><span class="workspace-empty-icon" aria-hidden="true">⌖</span><h3>План проекта</h3><p>Здесь будут отображаться ваши замечания.<br>Добавьте первый пин на плане.</p></div>`;
    if (draftPlanPoint && floorplanCalibration) {
      const image = floorplanRect(board), marker = document.createElement("span");
      marker.className = "calibration-point";
      marker.textContent = "+";
      marker.style.left = `${image.left + draftPlanPoint.x * image.width}px`;
      marker.style.top = `${image.top + draftPlanPoint.z * image.height}px`;
      board.append(marker);
    }
    const note = notes.find(({ id }) => id === activeNoteId);
    if (!note) return;
    const position = pinPixelPosition(note, board),
      popover = document.createElement("article");
    popover.className = "note-popover";
    popover.style.left = `${Math.max(14, Math.min(position.left + 12, board.clientWidth - 304))}px`;
    popover.style.top = `${Math.max(14, Math.min(position.top + 12, board.clientHeight - 150))}px`;
    const text = document.createElement("p"),
      footer = document.createElement("footer"),
      date = document.createElement("span"),
      remove = document.createElement("button");
    text.textContent = note.text;
    date.textContent = noteDate(note.createdAt);
    remove.type = "button";
    remove.className = "note-delete";
    remove.dataset.deleteNote = note.id;
    remove.textContent = "Удалить";
    footer.append(date, remove);
    popover.append(text, footer);
    board.append(popover);
  }
  async function loadNotes() {
    const status = document.getElementById("notes-status");
    try {
      const response = await fetchApi(`${API_URL}/api/notes${projectQuery}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      notes = await response.json();
      renderPins();
    } catch {
      status.textContent = "Не удалось загрузить общие замечания.";
    }
  }
  const calibrationButton = document.getElementById("calibration-start");
  calibrationButton.addEventListener("click", () => {
    if (!projectFloorplanUrl) return calibrationState("сначала загрузите планировку.");
    if (!window.RoomarkSpatialContext)
      return calibrationState("данные помещений ещё загружаются; попробуйте через несколько секунд.");
    window.RoomarkCalibrationCapture = { phase: "model", worldPoints: [] };
    calibrationImagePoints = [];
    calibrationButton.textContent = "Калибровка…";
    calibrationButton.disabled = true;
    calibrationState("в 3D дважды щёлкните по точке A (например, углу комнаты). Затем выберите B и C.");
    document.querySelector('[data-mode="3d"]')?.click();
  });
  window.addEventListener("calibration-model-point", (event) => {
    const count = event.detail.count;
    if (count < 3) {
      calibrationState(`точка ${"ABC"[count - 1]} в 3D сохранена. Дважды щёлкните точку ${"ABC"[count]}.`);
      return;
    }
    window.RoomarkCalibrationCapture.phase = "plan";
    calibrationState("теперь щёлкните на плане те же точки A, B и C в том же порядке.");
    document.querySelector('[data-mode="notes"]')?.click();
    document.getElementById("pin-board").classList.add("calibrating");
  });
  async function captureCalibrationImagePoint(event, board) {
    const capture = window.RoomarkCalibrationCapture;
    calibrationImagePoints.push(eventImagePoint(event, board));
    const image = floorplanRect(board), point = calibrationImagePoints.at(-1), marker = document.createElement("span");
    marker.className = "calibration-point";
    marker.textContent = "ABC"[calibrationImagePoints.length - 1];
    marker.style.left = `${image.left + point.x * image.width}px`;
    marker.style.top = `${image.top + point.z * image.height}px`;
    board.append(marker);
    if (calibrationImagePoints.length < 3) {
      calibrationState(`точка ${marker.textContent} на плане сохранена. Укажите ${"ABC"[calibrationImagePoints.length]}.`);
      return;
    }
    const worldPoints = capture.worldPoints,
      matrix = window.RoomarkSpatial.solveAffine(calibrationImagePoints, worldPoints);
    if (!matrix) {
      calibrationState("точки лежат почти на одной прямой. Начните заново и выберите разнесённые точки.");
      window.RoomarkCalibrationCapture = null;
      board.classList.remove("calibrating");
      calibrationButton.disabled = false;
      calibrationButton.textContent = "Привязать план к 3D";
      return;
    }
    const password = document.getElementById("notes-password").value || prompt("Введите пароль, чтобы сохранить привязку:") || "";
    if (!password) {
      calibrationState("привязка не сохранена: пароль не введён.");
      window.RoomarkCalibrationCapture = null;
      board.classList.remove("calibrating");
      calibrationButton.disabled = false;
      calibrationButton.textContent = "Привязать план к 3D";
      renderPins();
      return;
    }
    const calibration = {
      version: 1,
      matrix,
      imagePoints: calibrationImagePoints,
      worldPoints: worldPoints.map(({ x, z }) => ({ x, z })),
      floorY: Number(window.RoomarkSpatialContext.bounds?.floorY ?? Math.min(...worldPoints.map(({ y }) => y))),
      modelKey: window.RoomarkSpatialContext.modelKey,
    };
    try {
      const response = await fetchApi(`${API_URL}/api/project/floorplan-calibration${projectQuery}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
        body: JSON.stringify(calibration),
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || "Не удалось сохранить привязку.");
      floorplanCalibration = saved;
      const migrated = await Promise.all(
        notes.map(async (note) => {
          if (note.coordinateSpace === "model-world-v1") return note;
          const position = worldPositionFromImage(
            { x: Number(note.position?.x ?? 0.5), z: 1 - Number(note.position?.z ?? 0.5) }
          );
          const migration = await fetchApi(`${API_URL}/api/notes/${note.id}${projectQuery}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
            body: JSON.stringify({ position, coordinateSpace: "model-world-v1" }),
          });
          return migration.ok ? migration.json() : note;
        })
      );
      notes = migrated;
      calibrationState("готова — метки используют координаты модели.");
      document.getElementById("notes-password").value ||= password;
      renderPins();
    } catch (error) {
      calibrationState(error.message);
    } finally {
      window.RoomarkCalibrationCapture = null;
      board.classList.remove("calibrating");
      calibrationButton.disabled = false;
      calibrationButton.textContent = "Перепривязать план";
    }
  }
  document.addEventListener("click", async (event) => {
    const board = document.getElementById("pin-board");
    if (!board.contains(event.target)) return;
    if (window.RoomarkCalibrationCapture?.phase === "plan") {
      event.preventDefault();
      event.stopPropagation();
      await captureCalibrationImagePoint(event, board);
      return;
    }
    const remove = event.target.closest("[data-delete-note]");
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      const passwordInput = document.getElementById("notes-password"),
        modelPasswordInput = document.getElementById("pin-password"),
        password =
          passwordInput.value ||
          modelPasswordInput?.value ||
          window.prompt("Введите пароль, чтобы удалить замечание:") ||
          "";
      if (!password) return;
      try {
        const response = await fetchApi(`${API_URL}/api/notes/${remove.dataset.deleteNote}${projectQuery}`, {
          method: "DELETE",
          headers: { "X-Upload-Password": passwordHeader(password) },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Не удалось удалить замечание.");
        notes = result;
        activeNoteId = null;
        renderPins();
        window.dispatchEvent(new Event("notes-changed"));
        document.getElementById("notes-status").textContent = "Замечание удалено.";
      } catch (error) {
        document.getElementById("notes-status").textContent = error.message;
      }
      return;
    }
    const pin = event.target.closest("[data-note-id]");
    if (pin) {
      if (suppressPinClick) return;
      activeNoteId = activeNoteId === pin.dataset.noteId ? null : pin.dataset.noteId;
      renderPins();
      return;
    }
    if (floorplanCalibration && projectFloorplanUrl) {
      draftPlanPoint = eventImagePoint(event, board);
      renderPins();
      document.getElementById("note-text").focus();
      document.getElementById("notes-status").textContent = "Точка выбрана. Введите описание и нажмите «Добавить пин».";
    } else if (projectFloorplanUrl) {
      calibrationState("сначала привяжите план к 3D.");
    }
  }, true);
  let draggedPin = null,
    dragMoved = false,
    dragPointerId = null,
    suppressPinClick = false;
  const board = document.getElementById("pin-board");
  document.addEventListener("pointerdown", (event) => {
    const pin = event.target.closest("[data-note-id]");
    if (!pin || !board.contains(pin) || event.button !== 0) return;
    draggedPin = pin;
    dragMoved = false;
    dragPointerId = event.pointerId;
    pin.classList.add("dragging");
    document.body.classList.add("dragging-note-pin");
    event.preventDefault();
    event.stopPropagation();
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (!draggedPin || event.pointerId !== dragPointerId) return;
    const bounds = board.getBoundingClientRect(),
      image = floorplanRect(board),
      x = Math.max(0, Math.min(1, (event.clientX - bounds.left - image.left) / image.width)),
      y = Math.max(0, Math.min(1, (event.clientY - bounds.top - image.top) / image.height));
    draggedPin.style.left = `${image.left + x * image.width}px`;
    draggedPin.style.top = `${image.top + y * image.height}px`;
    draggedPin.dataset.x = x;
    draggedPin.dataset.y = y;
    dragMoved = true;
    event.preventDefault();
  }, { passive: false });
  document.addEventListener("pointerup", async (event) => {
    if (!draggedPin || event.pointerId !== dragPointerId) return;
    const pin = draggedPin;
    pin.classList.remove("dragging");
    document.body.classList.remove("dragging-note-pin");
    draggedPin = null;
    dragPointerId = null;
    if (!dragMoved) return;
    suppressPinClick = true;
    setTimeout(() => (suppressPinClick = false), 0);
    const password =
      document.getElementById("notes-password").value ||
      document.getElementById("pin-password")?.value ||
      window.prompt("Введите пароль, чтобы сохранить положение пина:") ||
      "";
    if (!password) return renderPins();
    const note = notes.find((item) => item.id === pin.dataset.noteId),
      imagePoint = { x: Number(pin.dataset.x), z: Number(pin.dataset.y) },
      worldPosition = worldPositionFromImage(imagePoint, note?.coordinateSpace === "model-world-v1" ? note.position.y : undefined),
      position = worldPosition || {
        x: imagePoint.x,
        y: note?.position?.y ?? 0.5,
        z: 1 - imagePoint.z,
      },
      coordinateSpace = worldPosition ? "model-world-v1" : "legacy-normalized-v1";
    try {
      const response = await fetchApi(`${API_URL}/api/notes/${pin.dataset.noteId}${projectQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
        body: JSON.stringify({ position, coordinateSpace }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Не удалось переместить пин.");
      notes = notes.map((item) => (item.id === updated.id ? updated : item));
      activeNoteId = updated.id;
      renderPins();
      window.dispatchEvent(new Event("notes-changed"));
      document.getElementById("notes-status").textContent = "Положение пина сохранено.";
    } catch (error) {
      renderPins();
      document.getElementById("notes-status").textContent = error.message;
    }
  });
  document.addEventListener("pointercancel", (event) => {
    if (!draggedPin || event.pointerId !== dragPointerId) return;
    draggedPin.classList.remove("dragging");
    document.body.classList.remove("dragging-note-pin");
    draggedPin = null;
    dragPointerId = null;
    renderPins();
  });
  if ("ResizeObserver" in window) new ResizeObserver(() => renderPins()).observe(board);
  else window.addEventListener("resize", renderPins);
  document.getElementById("notes-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = document.getElementById("note-text"),
      password = document.getElementById("notes-password"),
      submit = document.getElementById("note-submit"),
      status = document.getElementById("notes-status");
    if (!floorplanCalibration) {
      status.textContent = "Сначала привяжите планировку к 3D по трём точкам.";
      return;
    }
    if (!draftPlanPoint) {
      status.textContent = "Сначала щёлкните на плане в месте, где нужно поставить пин.";
      return;
    }
    const position = worldPositionFromImage(draftPlanPoint);
    submit.disabled = true;
    status.textContent = "Сохраняем замечание…";
    try {
      const response = await fetchApi(`${API_URL}/api/notes${projectQuery}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Password": passwordHeader(password.value),
        },
        body: JSON.stringify({
          text: text.value,
          roomId: window.NOTE_ROOM_ID || null,
          position,
          coordinateSpace: "model-world-v1",
        }),
      });
      const note = await response.json();
      if (!response.ok) throw new Error(note.error || "Не удалось добавить замечание.");
      notes.push(note);
      text.value = "";
      draftPlanPoint = null;
      activeNoteId = note.id;
      renderPins();
      window.dispatchEvent(new Event("notes-changed"));
      status.textContent = "Пин добавлен и виден всем пользователям.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  }
  function planImageRect(board) {
    const width = board.clientWidth, height = board.clientHeight;
    if (!projectFloorplanAspect || !width || !height) return { left: 0, top: 0, width, height };
    const imageWidth = Math.min(width, height * projectFloorplanAspect) * planZoom,
      imageHeight = imageWidth / projectFloorplanAspect;
    return { left: (width - imageWidth) / 2, top: (height - imageHeight) / 2, width: imageWidth, height: imageHeight };
  }
  function visiblePlanNotes() {
    return notes.filter((note) => {
      if (note.coordinateSpace === "model-world-v1") return false;
      const resolved = note.status === "resolved";
      return !(planNoteFilter === "open" && resolved) && !(planNoteFilter === "resolved" && !resolved) &&
        (planRoomFilter === "all" || note.roomId === planRoomFilter);
    });
  }
  function renderPlanWorkspace() {
    const board = document.getElementById("pin-board");
    if (!board) return;
    if (!projectFloorplanUrl) {
      board.innerHTML = `<div class="workspace-empty"><span class="workspace-empty-icon">⌖</span><h3>Загрузите общий план проекта</h3><p>Один план для всего объекта — без отдельных планировок комнат.</p></div>`;
      return;
    }
    const image = planImageRect(board);
    if (image.width > 0 && image.height > 0)
      board.style.backgroundSize = `${image.width}px ${image.height}px`;
    else board.style.removeProperty("background-size");
    const shown = visiblePlanNotes();
    board.innerHTML = shown.map((note) => {
      const { x, y } = notePlanPoint(note);
      return `<button class="note-pin ${note.status === "resolved" ? "resolved" : ""} ${activeNoteId === note.id ? "active" : ""}" type="button" data-note-id="${note.id}" style="left:${image.left + x * image.width}px;top:${image.top + y * image.height}px"><span>${shown.indexOf(note) + 1}</span></button>`;
    }).join("");
    if (draftPlanPoint) {
      const marker = document.createElement("span");
      marker.className = "draft-note-pin";
      marker.textContent = "+";
      marker.style.left = `${image.left + draftPlanPoint.x * image.width}px`;
      marker.style.top = `${image.top + draftPlanPoint.y * image.height}px`;
      board.append(marker);
    }
  }
  function noteDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ru");
  }
  function renderNotesList() {
    const list = document.getElementById("notes-list");
    if (!list) return;
    const shown = visiblePlanNotes();
    list.innerHTML = shown.length
      ? shown.map((note) => {
          const resolved = note.status === "resolved";
          return `<article class="plan-note-card ${resolved ? "resolved" : ""} ${activeNoteId === note.id ? "active" : ""}" data-open-note="${note.id}"><div class="plan-note-card-top"><span class="plan-note-number">${shown.indexOf(note) + 1}</span><strong>Изменения</strong>${note.roomId && roomNames[note.roomId] ? `<small class="plan-note-room">${escapeHtml(roomNames[note.roomId])}</small>` : ""}<span class="note-state">${resolved ? "Исправлено" : "Открыто"}</span><button class="plan-note-delete" type="button" data-delete-plan-note="${note.id}" aria-label="Удалить замечание" title="Удалить замечание">×</button></div><p>${escapeHtml(note.text)}</p><footer><small>${noteDate(note.createdAt)}</small><label class="note-resolved-toggle"><input type="checkbox" data-note-status="${note.id}" ${resolved ? "checked" : ""}> <span>Готово</span></label></footer></article>`;
        }).join("")
      : `<div class="notes-list-empty">По выбранному фильтру замечаний нет.</div>`;
    const count = notes.filter((note) => note.status !== "resolved").length;
    document.getElementById("plan-open-count").textContent = `${count} открытых`;
    const planNotes = notes,
      resolvedCount = planNotes.length - count;
    document.getElementById("plan-project-summary").textContent = `${Object.keys(roomNames).length} помещений · ${planNotes.length} замечаний на общем плане`;
    document.querySelectorAll("[data-plan-count]").forEach((label) => {
      label.textContent = { all: planNotes.length, open: count, resolved: resolvedCount }[label.dataset.planCount];
    });
    document.querySelectorAll("[data-plan-note-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.planNoteFilter === planNoteFilter);
      button.setAttribute("aria-pressed", String(button.dataset.planNoteFilter === planNoteFilter));
    });
    document.getElementById("plan-show-resolved").textContent = planNoteFilter === "resolved"
      ? "Показать все замечания" : `Показать исправленные (${resolvedCount})`;

    renderPlanWorkspace();
  }
  async function loadNotesList() {
    try {
      const response = await fetchApi(`${API_URL}/api/notes${projectQuery}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      notes = await response.json();
      renderNotesList();
      if (Object.keys(roomData).length) document.getElementById("photos-content").innerHTML = photoOverviewMarkup();
    } catch {
      document.getElementById("notes-status").textContent = "Не удалось загрузить заметки.";
    }
  }
  document.getElementById("notes-list")?.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-note-status]");
    if (!checkbox) return;
    const password = noteActionPassword || actionPassword("Введите пароль, чтобы изменить статус замечания:"),
      status = document.getElementById("notes-status");
    if (!password) {
      checkbox.checked = !checkbox.checked;
      return;
    }
    checkbox.disabled = true;
    try {
      const response = await fetchApi(`${API_URL}/api/notes/${checkbox.dataset.noteStatus}${projectQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
        body: JSON.stringify({ status: checkbox.checked ? "resolved" : "new" }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Не удалось изменить статус заметки.");
      notes = notes.map((note) => note.id === updated.id ? updated : note);
      noteActionPassword = password;
      rememberActionPassword(password);
      renderNotesList();
      window.dispatchEvent(new Event("notes-changed"));
      status.textContent = checkbox.checked ? "Пин выполнен и скрыт в 3D." : "Пин снова открыт и показан в 3D.";
    } catch (error) {
      if (/парол/i.test(error.message)) noteActionPassword = "";
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      status.textContent = error.message;
    }
  });
  document.getElementById("notes-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-plan-note]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const note = notes.find((item) => item.id === button.dataset.deletePlanNote);
    if (!note || !confirm(`Удалить замечание «${note.text}»?`)) return;
    const password = noteActionPassword || actionPassword("Введите пароль, чтобы удалить замечание:");
    if (!password) return;
    const status = document.getElementById("notes-status");
    button.disabled = true;
    try {
      const response = await fetchApi(`${API_URL}/api/notes/${note.id}${projectQuery}`, {
        method: "DELETE",
        headers: { "X-Upload-Password": passwordHeader(password) },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось удалить замечание.");
      noteActionPassword = password;
      rememberActionPassword(password);
      notes = result;
      if (activeNoteId === note.id) activeNoteId = null;
      renderNotesList();
      window.dispatchEvent(new Event("notes-changed"));
      status.textContent = "Замечание удалено.";
    } catch (error) {
      if (/парол/i.test(error.message)) noteActionPassword = "";
      button.disabled = false;
      status.textContent = error.message;
    }
  });
  document.getElementById("notes-list")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-note-status], [data-delete-plan-note]")) return;
    const card = event.target.closest("[data-open-note]");
    if (!card) return;
    activeNoteId = card.dataset.openNote;
    renderNotesList();
  });
  document.querySelectorAll("[data-plan-note-filter]").forEach((button) => button.addEventListener("click", () => {
    planNoteFilter = button.dataset.planNoteFilter;
    document.querySelectorAll("[data-plan-note-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderNotesList();
  }));
  document.getElementById("plan-show-resolved").addEventListener("click", () => {
    document.querySelector(`[data-plan-note-filter="${planNoteFilter === "resolved" ? "all" : "resolved"}"]`).click();
  });
  document.getElementById("plan-notes-sort").addEventListener("change", (event) => {
    notes.sort((a, b) => (new Date(b.createdAt) - new Date(a.createdAt)) * (event.target.selectedIndex ? -1 : 1));
    renderNotesList();
  });
  document.querySelectorAll("[data-plan-zoom]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.planZoom;
    planZoom = Math.max(.6, Math.min(2.4, planZoom + (action === "in" ? .2 : -.2)));
    document.getElementById("plan-zoom-value").textContent = `${Math.round(planZoom * 100)}%`;
    renderPlanWorkspace();
  }));
  const planRoomSelect = document.getElementById("plan-room-filter");
  if (planRoomSelect) {
    Object.entries(roomNames).forEach(([id, name]) => planRoomSelect.add(new Option(name, id)));
    planRoomSelect.addEventListener("change", () => { planRoomFilter = planRoomSelect.value; renderNotesList(); });
  }
  const activePlanBoard = document.getElementById("pin-board");
  let draggedPlanNoteId = null,
    draggedPlanPoint = null,
    draggedPlanMoved = false,
    draggingDraftPlanPoint = false,
    suppressPlanClick = false;
  const eventPlanPoint = (event) => {
    const bounds = activePlanBoard.getBoundingClientRect(), image = planImageRect(activePlanBoard);
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left - activePlanBoard.clientLeft - image.left) / image.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top - activePlanBoard.clientTop - image.top) / image.height)),
    };
  };
  activePlanBoard.addEventListener("click", (event) => {
    if (suppressPlanClick) return;
    const pin = event.target.closest("[data-note-id]");
    if (pin) { activeNoteId = pin.dataset.noteId; renderNotesList(); return; }
    if (!projectFloorplanUrl) return;
    const board = event.currentTarget, bounds = board.getBoundingClientRect(), image = planImageRect(board),
      x = (event.clientX - bounds.left - board.clientLeft - image.left) / image.width,
      y = (event.clientY - bounds.top - board.clientTop - image.top) / image.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    draftPlanPoint = { x, y };
    board.classList.add("placing-note"); renderPlanWorkspace();
    document.getElementById("note-text").focus();
    document.getElementById("notes-status").textContent = "Место выбрано. Чёрный маркер можно перетащить мышью.";
  });
  activePlanBoard.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".draft-note-pin") && event.button === 0) {
      draggingDraftPlanPoint = true;
      activePlanBoard.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const pin = event.target.closest("[data-note-id]");
    if (!pin || event.button !== 0) return;
    draggedPlanNoteId = pin.dataset.noteId;
    draggedPlanPoint = notePlanPoint(notes.find((note) => note.id === draggedPlanNoteId));
    draggedPlanMoved = false;
    pin.classList.add("dragging");
    activePlanBoard.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  activePlanBoard.addEventListener("pointermove", (event) => {
    if (draggingDraftPlanPoint) {
      draftPlanPoint = eventPlanPoint(event);
      renderPlanWorkspace();
      event.preventDefault();
      return;
    }
    if (draggedPlanNoteId) {
      draggedPlanPoint = eventPlanPoint(event);
      draggedPlanMoved = true;
      const pin = activePlanBoard.querySelector(`[data-note-id="${CSS.escape(draggedPlanNoteId)}"]`), image = planImageRect(activePlanBoard);
      if (pin) {
        pin.style.left = `${image.left + draggedPlanPoint.x * image.width}px`;
        pin.style.top = `${image.top + draggedPlanPoint.y * image.height}px`;
      }
      event.preventDefault();
      return;
    }
  });
  activePlanBoard.addEventListener("pointerup", async (event) => {
    if (draggingDraftPlanPoint) {
      draggingDraftPlanPoint = false;
      suppressPlanClick = true;
      setTimeout(() => (suppressPlanClick = false), 0);
      activePlanBoard.releasePointerCapture?.(event.pointerId);
      document.getElementById("note-text").focus();
      document.getElementById("notes-status").textContent = "Место выбрано — опишите замечание.";
      return;
    }
    if (!draggedPlanNoteId) return;
    const noteId = draggedPlanNoteId,
      point = draggedPlanPoint,
      note = notes.find((item) => item.id === noteId);
    draggedPlanNoteId = null;
    draggedPlanPoint = null;
    activePlanBoard.releasePointerCapture?.(event.pointerId);
    if (!draggedPlanMoved || !note || !point) return renderPlanWorkspace();
    suppressPlanClick = true;
    setTimeout(() => (suppressPlanClick = false), 0);
    const password = noteActionPassword || actionPassword("Введите пароль, чтобы сохранить положение пина:");
    if (!password) return renderPlanWorkspace();
    try {
      const update = positionFromPlanPoint(point, note),
        response = await fetchApi(`${API_URL}/api/notes/${noteId}${projectQuery}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
          body: JSON.stringify(update),
        }),
        saved = await response.json();
      if (!response.ok) throw new Error(saved.error || "Не удалось переместить пин.");
      notes = notes.map((item) => item.id === saved.id ? saved : item);
      noteActionPassword = password;
      rememberActionPassword(password);
      activeNoteId = saved.id;
      document.getElementById("notes-status").textContent = "Положение пина сохранено и обновлено в 3D.";
      renderNotesList();
      window.dispatchEvent(new Event("notes-changed"));
    } catch (error) {
      document.getElementById("notes-status").textContent = error.message;
      renderPlanWorkspace();
    }
  });
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      if (document.getElementById("panel-plan")?.classList.contains("active")) renderPlanWorkspace();
    }).observe(document.getElementById("pin-board"));
  }
  document.getElementById("notes-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = document.getElementById("note-text"), status = document.getElementById("notes-status");
    if (!draftPlanPoint) { status.textContent = "Сначала выберите место на плане."; return; }
    const password = noteActionPassword || actionPassword("Введите пароль, чтобы добавить замечание:");
    if (!password) return;
    try {
      const response = await fetchApi(`${API_URL}/api/notes${projectQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
        body: JSON.stringify({ text: text.value, roomId: planRoomFilter === "all" ? null : planRoomFilter, ...positionFromPlanPoint(draftPlanPoint, null) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось добавить замечание.");
      noteActionPassword = password;
      rememberActionPassword(password);
      notes.push(result); activeNoteId = result.id; draftPlanPoint = null; text.value = ""; text.style.height = "42px";
      status.textContent = "Замечание добавлено."; renderNotesList(); window.dispatchEvent(new Event("notes-changed"));
    } catch (error) { status.textContent = error.message; }
  });
  const planNoteText = document.getElementById("note-text");
  planNoteText.addEventListener("input", () => {
    planNoteText.style.height = "42px";
    planNoteText.style.height = `${Math.min(planNoteText.scrollHeight, 108)}px`;
    planNoteText.style.overflowY = planNoteText.scrollHeight > 108 ? "auto" : "hidden";
  });
  document.getElementById("plan-download").addEventListener("click", () => {
    if (projectFloorplanUrl) window.open(projectFloorplanUrl, "_blank", "noopener");
  });
  loadRooms();
  loadNotesList();
  window.addEventListener("notes-changed", loadNotesList);
  loadProjectFloorplan();
})();
