(() => {
  const passwordHeader = (value) => `roomark-uri:${encodeURIComponent(value)}`;
  document.querySelectorAll("svg.icon").forEach((icon) => {
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
  });
  if (new URLSearchParams(location.search).has("preview")) return;
  const API_URL = window.HouseConfig?.apiBaseUrl || location.origin;
  const projectId = new URLSearchParams(location.search).get("project"),
    projectQuery = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  let rooms = window.AUTO_ROOMS?.length ? window.AUTO_ROOMS : window.HOUSE_ROOMS,
    roomBySlug = {},
    roomById = {};
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
    );
  const indexRooms = () => {
    roomBySlug = Object.fromEntries(rooms.map((room) => [room.slug, room]));
    roomById = Object.fromEntries(rooms.map((room) => [room.id, room]));
  };
  indexRooms();
  const page = document.getElementById("room-page"),
    content = document.getElementById("room-content"),
    sidebar = document.getElementById("rooms-sidebar");
  let manifests = {},
    notes = [],
    selectedRoom = null,
    selectedTab = "overview",
    photoFilter = "all",
    selectedFiles = [];
  const roomOverridesKey = "roomark:room-overrides";
  const deletedRoomsKey = "roomark:deleted-rooms";
  const readStoredObject = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };
  const applyLocalRoomChanges = () => {
    const overrides = readStoredObject(roomOverridesKey, {}),
      deleted = new Set(readStoredObject(deletedRoomsKey, []));
    rooms = rooms
      .filter((room) => !deleted.has(room.id))
      .map((room) => ({
        ...room,
        ...(overrides[room.id] || {}),
      }));
    indexRooms();
  };
  applyLocalRoomChanges();
  const absolute = (url) => (url ? `${API_URL}${url}` : "./images/room-placeholder.svg");
  const typeLabels = {
    construction: "Ход строительства",
    completed: "Готовая работа",
    defect: "Замечание",
    control: "Контрольный снимок",
    other: "Другое",
  };
  const currentRoute = () =>
    new URLSearchParams(window.top.location.search).get("route") ||
    (window.top.location.pathname.startsWith("/rooms/") ? window.top.location.pathname : "");
  const browserUrl = (route = "") => {
    const url = new URL(window.top.location.href);
    url.pathname = "/viewer.html";
    if (route) url.searchParams.set("route", route);
    else url.searchParams.delete("route");
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const navigate = (path, replace = false) => {
    const history = window.top.history;
    history[replace ? "replaceState" : "pushState"](
      {},
      "",
      browserUrl(path.startsWith("/rooms/") ? path : "")
    );
    if (path.startsWith("/rooms/")) openRoom(roomBySlug[path.split("/")[2]], false);
    else closeRoom(false);
  };

  async function loadData() {
    try {
      const catalogResponse = await fetch(`${API_URL}/api/rooms`, { cache: "no-store" });
      if (catalogResponse.ok && !window.AUTO_ROOMS?.length) {
        rooms = await catalogResponse.json();
        indexRooms();
        window.HOUSE_ROOMS = rooms;
        const routeSlug = currentRoute().split("/")[2];
        if (!selectedRoom && routeSlug && roomBySlug[routeSlug])
          openRoom(roomBySlug[routeSlug], false);
      }
    } catch {
      /* Используем встроенный список, если API временно недоступен. */
    }
    const results = await Promise.all(
      rooms.map(async (room) => {
        try {
          const response = await fetch(`${API_URL}/api/rooms/${room.id}`, { cache: "no-store" });
          return [room.id, response.ok ? await response.json() : {}];
        } catch {
          return [room.id, {}];
        }
      })
    );
    manifests = Object.fromEntries(results);
    try {
      const response = await fetch(`${API_URL}/api/notes${projectQuery}`, { cache: "no-store" });
      notes = response.ok ? await response.json() : [];
    } catch {
      notes = [];
    }
    renderSidebar();
    if (selectedRoom) {
      renderProjectCard(selectedRoom);
      if (!selectedRoom.automatic) renderRoom();
    }
  }
  function roomCounts(room) {
    const data = manifests[room.id] || {},
      roomNotes = notes.filter((note) => note.roomId === room.id);
    return { photos: (data.photos || []).length, notes: roomNotes.length };
  }
  const roomIconOptions = [
    ["living-room", "Гостиная"],
    ["kitchen", "Кухня"],
    ["kitchen-living", "Кухня-гостиная"],
    ["bedroom", "Спальня"],
    ["nursery", "Детская"],
    ["office", "Кабинет"],
    ["bathroom", "Ванная"],
    ["toilet", "Санузел"],
    ["entryway", "Прихожая"],
    ["hallway", "Коридор / холл"],
    ["wardrobe", "Гардеробная"],
    ["pantry", "Кладовая"],
    ["laundry", "Постирочная"],
    ["balcony", "Балкон / лоджия"],
    ["terrace", "Терраса"],
  ];
  const roomIconIds = new Set(roomIconOptions.map(([id]) => id));
  function roomIcon(room) {
    if (roomIconIds.has(room.icon)) return room.icon;
    const value = `${room.id} ${room.slug || ""} ${room.name}`.toLowerCase();
    if (/кухня[- ]гостиная|kitchen[- ]living/.test(value)) return "kitchen-living";
    if (/гостин|living/.test(value)) return "living-room";
    if (/кух|kitchen/.test(value)) return "kitchen";
    if (/детск|nursery|child/.test(value)) return "nursery";
    if (/спаль|bedroom|\bbed\b/.test(value)) return "bedroom";
    if (/кабин|office|study/.test(value)) return "office";
    if (/сануз|туал|toilet|\bwc\b/.test(value)) return "toilet";
    if (/ванн|bathroom|\bbath\b/.test(value)) return "bathroom";
    if (/прихож|entryway|foyer/.test(value)) return "entryway";
    if (/корид|холл|hallway|corridor/.test(value)) return "hallway";
    if (/гардероб|wardrobe|closet/.test(value)) return "wardrobe";
    if (/кладов|pantry|storage/.test(value)) return "pantry";
    if (/постир|laundry/.test(value)) return "laundry";
    if (/балкон|лоджи|balcon|loggia/.test(value)) return "balcony";
    if (/террас|terrace/.test(value)) return "terrace";
    return "living-room";
  }
  const roomIconMarkup = (id, label = "") =>
    `<img src="./images/room-icons/${id}.png" alt="" title="${esc(label)}" loading="lazy">`;
  function renderSidebar() {
    document.getElementById("room-links").innerHTML =
      `<button class="room-link ${selectedRoom ? "" : "active"}" data-go-home><span class="room-link-icon">${roomIconMarkup("living-room", "Все помещения")}</span><span class="room-link-copy"><strong>Все помещения</strong><small>Общая 3D-модель</small></span></button>${rooms
        .map((room) => {
          const count = roomCounts(room),
            icon = roomIcon(room);
          return `<div class="room-link-row"><button class="room-link ${selectedRoom?.id === room.id ? "active" : ""}" data-open-room="${esc(room.slug)}"><span class="room-link-icon">${roomIconMarkup(icon, room.name)}</span><span class="room-link-copy"><strong>${esc(room.name)}</strong><small>${count.photos} фото · ${count.notes} замечаний →</small></span></button><button class="room-actions-toggle" type="button" data-room-actions="${esc(room.id)}" aria-label="Действия с комнатой ${esc(room.name)}" aria-expanded="false">⋮</button><div class="room-actions-menu" data-room-menu="${esc(room.id)}" hidden><button type="button" data-edit-room="${esc(room.id)}">Изменить информацию</button><button class="danger" type="button" data-delete-room="${esc(room.id)}">Удалить комнату</button></div></div>`;
        })
        .join("")}`;
  }
  function renderProjectCard(room) {
    if (!room) return;
    const data = manifests[room.id] || {},
      count = roomCounts(room),
      preview = absolute(data.photos?.[0]?.url || data.renderUrls?.[0] || data.floorplanUrl);
    const name = document.getElementById("selected-room-name"),
      area = document.getElementById("selected-room-area"),
      description = document.getElementById("selected-room-description"),
      photos = document.getElementById("selected-room-photos"),
      roomNotes = document.getElementById("selected-room-notes"),
      open = document.getElementById("selected-room-open");
    if (name) name.textContent = room.name;
    if (area) area.textContent = `${Number(room.area || 0).toLocaleString("ru")} м²`;
    if (description)
      description.textContent = room.description || "Описание помещения пока не добавлено.";
    const image = document.getElementById("selected-room-preview");
    if (image) {
      image.src = preview;
      image.alt = room.name;
    }
    if (photos) photos.textContent = `${count.photos} фото`;
    if (roomNotes) roomNotes.textContent = `${count.notes} замечаний`;
    if (open) open.dataset.openSelectedRoom = room.id;
  }
  function openRoom(room, updateUrl = true) {
    if (!room) return navigate("/", true);
    selectedRoom = room;
    window.NOTE_ROOM_ID = room.id;
    selectedTab = "overview";
    window.showRoom?.(room.id);
    window.focusRoom?.(room.id);
    sidebar.classList.remove("open");
    renderProjectCard(room);
    if (updateUrl) window.top.history.pushState({}, "", browserUrl(`/rooms/${room.slug}`));
    if (room.automatic) {
      window.setViewerActive?.(true);
      page.classList.remove("active");
      document.querySelector(".project-card").hidden = false;
      document.querySelector(".tools").hidden = false;
      renderSidebar();
      return;
    }
    window.setViewerActive?.(false);
    page.classList.add("active");
    document.querySelector(".project-card").hidden = true;
    document.querySelector(".tools").hidden = true;
    renderSidebar();
    renderRoom();
  }
  function closeRoom(updateUrl = true, preserveNoteRoom = false) {
    selectedRoom = null;
    window.showAllRooms?.();
    if (!preserveNoteRoom) window.NOTE_ROOM_ID = null;
    page.classList.remove("active");
    window.setViewerActive?.(true);
    document.querySelector(".project-card").hidden = false;
    document.querySelector(".tools").hidden = false;
    if (updateUrl) window.top.history.pushState({}, "", browserUrl());
    renderSidebar();
  }
  window.openSelectedRoomSection = (mode) => {
    if (!selectedRoom) return false;
    const tab = {
      "3d": "overview",
      plan: "floorplan",
      photos: "photos",
      renders: "renders",
      documents: "documents",
      notes: "notes",
    }[mode];
    if (!tab) return false;
    selectedTab = tab;
    window.setViewerActive?.(false);
    page.classList.add("active");
    document.querySelector(".project-card").hidden = true;
    document.querySelector(".tools").hidden = true;
    renderRoom();
    return true;
  };
  window.openHouseRoom = (roomId, tab) => {
    openRoom(roomById[roomId]);
    if (tab && ["photos", "renders"].includes(tab)) {
      window.openSelectedRoomSection(tab);
    }
  };
  function updatedAt(data) {
    const values = [...(data.photos || []).map((photo) => photo.createdAt)];
    return values.sort().at(-1) || null;
  }
  function renderRoom() {
    const data = manifests[selectedRoom.id] || {},
      count = roomCounts(selectedRoom),
      updated = updatedAt(data);
    document.getElementById("room-page-title").textContent = selectedRoom.name;
    document.getElementById("room-breadcrumbs").textContent = `Главная / ${selectedRoom.name}`;
    document.getElementById("room-stats").innerHTML =
      `<span>${selectedRoom.area} м²</span><span>${count.photos} фото</span><span>${count.notes} замечаний</span><span>${updated ? `Обновлено ${new Date(updated).toLocaleDateString("ru")}` : "Материалы не обновлялись"}</span>`;
    document
      .querySelectorAll("[data-room-tab]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.roomTab === selectedTab)
      );
    renderTab(data);
  }
  function photoCards(photos) {
    return photos.length
      ? `<div class="gallery-grid">${photos.map((photo) => `<button class="gallery-card" data-image="${esc(absolute(photo.url))}" data-caption="${esc(typeLabels[photo.type] || "Фото")} · ${esc(photo.date)}"><img src="${esc(absolute(photo.thumbnailUrl || photo.url))}" alt="${esc(photo.comment || selectedRoom.name)}" loading="lazy"><span>${esc(typeLabels[photo.type] || "Фото")}<small style="display:block;color:#64748b;margin-top:4px">${esc(photo.date)}${photo.comment ? ` · ${esc(photo.comment)}` : ""}</small></span></button>`).join("")}</div>`
      : `<div class="empty-state">В этой комнате пока нет фотографий.</div>`;
  }
  function renderTab(data) {
    const roomNotes = notes.filter((note) => note.roomId === selectedRoom.id),
      photos = data.photos || [];
    if (selectedTab === "overview") {
      const hero = absolute(photos[0]?.url || data.renderUrls?.[0] || data.floorplanUrl);
      content.innerHTML = `<div class="overview-grid"><article class="overview-card overview-hero"><img src="${hero}" alt="${selectedRoom.name}"><button class="primary" data-select-room-tab="3d">Показать в 3D</button></article><div style="display:grid;gap:16px"><article class="overview-card"><h3>Материалы</h3><p>${photos.length} фото · ${(data.renderUrls || []).length} рендеров</p><button class="primary" data-open-photo-upload>Загрузить фото</button></article><article class="overview-card"><h3>Замечания</h3><p>${roomNotes.length} связанных замечаний</p><button class="secondary" data-select-room-tab="notes">Открыть заметки</button></article></div></div>`;
    }
    if (selectedTab === "floorplan") {
      const plan = data.floorplanUrl
        ? absolute(data.floorplanUrl)
        : "./images/room-placeholder.svg";
      content.innerHTML = `<article class="overview-card"><div class="photo-toolbar"><h2>Планировка</h2><button class="primary" data-upload-room-floorplan>${data.floorplanUrl ? "Заменить планировку" : "Загрузить планировку"}</button></div><img src="${plan}" alt="Планировка: ${selectedRoom.name}" style="display:block;width:100%;max-height:70vh;object-fit:contain;border-radius:14px;background:#e9eef5"></article>`;
    }
    if (selectedTab === "3d") {
      content.innerHTML = `<div class="photo-toolbar"><button class="secondary" data-go-home>Вернуться к общей модели</button><button class="primary" data-upload-room-model>${data.modelUrl ? "Заменить 3D-модель" : "Загрузить 3D-модель"}</button></div>${data.modelUrl ? `<iframe class="room-model-frame" src="./viewer.html?preview=1&room=${encodeURIComponent(selectedRoom.id)}&model=${encodeURIComponent(absolute(data.modelUrl))}" title="3D: ${selectedRoom.name}"></iframe>` : `<div class="empty-state"><strong style="display:block;margin-bottom:8px;color:var(--color-text-primary)">3D-модель помещения не загружена</strong><span>Нажмите «Загрузить 3D-модель» и выберите файл GLB.</span></div>`}`;
    }
    if (selectedTab === "photos") {
      const filtered =
        photoFilter === "all" ? photos : photos.filter((photo) => photo.type === photoFilter);
      content.innerHTML = `<div class="photo-toolbar"><h2>Фотографии</h2><button class="primary" data-open-photo-upload>Загрузить фото</button></div><div class="photo-filters">${[
        ["all", "Все"],
        ["construction", "Ход строительства"],
        ["completed", "Готовая работа"],
        ["defect", "Замечания"],
        ["control", "Контрольные"],
      ]
        .map(
          ([id, label]) =>
            `<button class="photo-filter ${photoFilter === id ? "active" : ""}" data-photo-filter="${id}">${label}</button>`
        )
        .join("")}</div>${photoCards(filtered)}`;
    }
    if (selectedTab === "renders")
      content.innerHTML = `<div class="photo-toolbar"><h2>Рендеры</h2><button class="primary" data-open-render-upload>Загрузить рендер</button></div>${(data.renderUrls || []).length ? `<div class="gallery-grid">${data.renderUrls.map((url, index) => `<button class="gallery-card" data-image="${absolute(url)}" data-caption="${selectedRoom.name} · рендер ${index + 1}"><img src="${absolute(url)}" alt="Рендер ${index + 1}"><span>Рендер ${index + 1}</span></button>`).join("")}</div>` : `<div class="empty-state">Рендеры ещё не загружены.</div>`}`;
    if (selectedTab === "documents") {
      const documents = [
        data.floorplanUrl && { name: `Планировка — ${selectedRoom.name}`, type: "Изображение", url: data.floorplanUrl },
        data.modelUrl && { name: `3D-модель — ${selectedRoom.name}`, type: "GLB", url: data.modelUrl },
        ...photos.map((photo, index) => ({ name: photo.comment || `Фото ${index + 1}`, type: "Фотография", url: photo.url })),
        ...(data.renderUrls || []).map((url, index) => ({ name: `Рендер ${index + 1}`, type: "Изображение", url })),
      ].filter(Boolean);
      content.innerHTML = `<div class="photo-toolbar"><h2>Документы комнаты</h2><span><button class="secondary" data-upload-room-floorplan>Добавить план</button> <button class="primary" data-upload-room-model>Добавить 3D-модель</button></span></div>${documents.length ? `<div class="document-list">${documents.map((document) => `<article class="document-row"><span class="document-type model">▱</span><div class="document-copy"><strong>${esc(document.name)}</strong><small>${esc(document.type)} · ${esc(selectedRoom.name)}</small></div><a class="document-open" href="${esc(absolute(document.url))}" target="_blank" rel="noopener">Открыть</a></article>`).join("")}</div>` : `<div class="empty-state">В этой комнате пока нет документов.</div>`}`;
    }
    if (selectedTab === "notes")
      content.innerHTML = `<div class="photo-toolbar"><h2>Заметки комнаты</h2><button class="primary" data-add-room-note-3d>Добавить в 3D</button></div>${roomNotes.length ? `<div class="notes-list">${roomNotes.map((note, index) => { const resolved = note.status === "resolved"; return `<label class="notes-list-item ${resolved ? "resolved" : ""}"><input type="checkbox" data-room-note-status="${note.id}" ${resolved ? "checked" : ""}><span><p>${esc(note.text)}</p><small>Пин ${index + 1} · ${esc(new Date(note.createdAt).toLocaleString("ru"))}</small></span><small>${resolved ? "Выполнено" : "Открыто"}</small></label>`; }).join("")}</div>` : `<div class="empty-state">Для комнаты пока нет связанных заметок.</div>`}`;
  }
  document.addEventListener("click", (event) => {
    const noteStatus = event.target.closest("[data-room-note-status]");
    if (noteStatus && selectedRoom) {
      event.preventDefault();
      const currentNote = notes.find((note) => note.id === noteStatus.dataset.roomNoteStatus),
        nextStatus = currentNote?.status === "resolved" ? "new" : "resolved",
        password = prompt("Введите пароль, чтобы изменить статус заметки:") || "";
      if (!password) return;
      noteStatus.disabled = true;
      fetch(`${API_URL}/api/notes/${noteStatus.dataset.roomNoteStatus}${projectQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
        body: JSON.stringify({ status: nextStatus }),
      })
        .then(async (response) => {
          const updated = await response.json();
          if (!response.ok) throw new Error(updated.error || "Не удалось изменить статус заметки.");
          notes = notes.map((note) => note.id === updated.id ? updated : note);
          renderRoom();
          window.dispatchEvent(new Event("notes-changed"));
          showToast(nextStatus === "resolved" ? "Пин выполнен и скрыт в 3D" : "Пин снова открыт");
        })
        .catch((error) => {
          noteStatus.disabled = false;
          noteStatus.checked = !noteStatus.checked;
          showToast(error.message);
        });
      return;
    }
    const actions = event.target.closest("[data-room-actions]");
    if (actions) {
      const menu = document.querySelector(
          `[data-room-menu="${CSS.escape(actions.dataset.roomActions)}"]`
        ),
        opening = menu.hidden;
      document.querySelectorAll("[data-room-menu]").forEach((item) => (item.hidden = true));
      document
        .querySelectorAll("[data-room-actions]")
        .forEach((button) => button.setAttribute("aria-expanded", "false"));
      menu.hidden = !opening;
      actions.setAttribute("aria-expanded", String(opening));
      return;
    }
    if (!event.target.closest("[data-room-menu]")) {
      document.querySelectorAll("[data-room-menu]").forEach((item) => (item.hidden = true));
      document
        .querySelectorAll("[data-room-actions]")
        .forEach((button) => button.setAttribute("aria-expanded", "false"));
    }
    const editRoom = event.target.closest("[data-edit-room]");
    if (editRoom) return openEditModal(roomById[editRoom.dataset.editRoom]);
    const deleteButton = event.target.closest("[data-delete-room]");
    if (deleteButton) return deleteRoom(roomById[deleteButton.dataset.deleteRoom]);
    const roomLink = event.target.closest("[data-open-room]");
    if (roomLink) return openRoom(roomBySlug[roomLink.dataset.openRoom]);
    const openSelected = event.target.closest("[data-open-selected-room]");
    if (openSelected) return openRoom(roomById[openSelected.dataset.openSelectedRoom]);
    if (event.target.closest("[data-go-home]")) return closeRoom();
    if (event.target.closest("[data-add-room-note-3d]") && selectedRoom) {
      page.classList.remove("active");
      window.setViewerActive?.(true);
      document.querySelector(".project-card").hidden = false;
      document.querySelector(".tools").hidden = false;
      document.querySelectorAll("[data-mode]").forEach((button) =>
        button.classList.toggle("active", button.dataset.mode === "3d")
      );
      window.showRoom?.(selectedRoom.id);
      window.focusRoom?.(selectedRoom.id);
      return;
    }
    const tab = event.target.closest("[data-room-tab],[data-select-room-tab]");
    if (tab && selectedRoom) {
      selectedTab = tab.dataset.roomTab || tab.dataset.selectRoomTab;
      renderRoom();
      if (selectedTab === "3d") window.focusRoom?.(selectedRoom.id);
      return;
    }
    const filter = event.target.closest("[data-photo-filter]");
    if (filter) {
      photoFilter = filter.dataset.photoFilter;
      renderRoom();
      return;
    }
    if (event.target.closest("[data-open-photo-upload]")) openUpload();
    if (event.target.closest("[data-open-render-upload]")) renderFilesInput.click();
    if (event.target.closest("[data-upload-room-model]")) roomModelInput.click();
    if (event.target.closest("[data-upload-room-floorplan]")) roomFloorplanInput.click();
    if (event.target.closest("[data-global-notes]")) {
      selectedTab = "notes";
      renderRoom();
    }
  });
  document.getElementById("room-back").onclick = () => {
    closeRoom();
    window.showApartment?.();
  };
  document.querySelector(".brand").style.cursor = "pointer";
  document.querySelector(".brand").onclick = (event) => {
    event.preventDefault();
    closeRoom();
    window.showApartment?.();
    document.getElementById("home-button")?.click();
  };
  let pointerPressed = false;
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "touch") pointerPressed = true;
    },
    true
  );
  document.addEventListener(
    "pointerup",
    () => {
      pointerPressed = false;
    },
    true
  );
  document.addEventListener(
    "pointercancel",
    () => {
      pointerPressed = false;
    },
    true
  );
  window.addEventListener("blur", () => {
    pointerPressed = false;
  });
  document.getElementById("rooms-mobile-button").onclick = () => sidebar.classList.toggle("open");
  document.getElementById("rooms-collapse").onclick = () => sidebar.classList.toggle("collapsed");
  const addRoomModal = document.getElementById("add-room-modal"),
    addRoomForm = document.getElementById("add-room-form");
  let editingRoom = null;
  const roomIconPicker = document.getElementById("new-room-icons");
  roomIconPicker.insertAdjacentHTML(
    "beforebegin",
    `<label class="room-icon-search"><span>Поиск типа комнаты</span><input id="room-icon-search" type="search" autocomplete="off" placeholder="Например, кухня или спальня"></label>`
  );
  roomIconPicker.insertAdjacentHTML(
    "afterend",
    `<p class="room-icon-empty" id="room-icon-empty" hidden>Подходящих иконок не найдено.</p>`
  );
  roomIconPicker.innerHTML = roomIconOptions
    .map(
      ([icon, label], index) =>
        `<button class="icon-choice ${index === 0 ? "selected" : ""}" type="button" role="radio" aria-label="${label}" aria-checked="${index === 0}" data-room-icon="${icon}" data-room-label="${label.toLowerCase()}">${roomIconMarkup(icon, label)}<span>${label}</span></button>`
    )
    .join("");
  const roomIconSearch = document.getElementById("room-icon-search"),
    roomNameInput = document.getElementById("new-room-name");
  const selectRoomIcon = (icon) => {
    const value = roomIconIds.has(icon) ? icon : "living-room";
    document.getElementById("new-room-icon").value = value;
    document.querySelectorAll("[data-room-icon]").forEach((button) => {
      const selected = button.dataset.roomIcon === value;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", selected);
    });
  };
  document.getElementById("new-room-icon").value = "living-room";
  roomIconSearch.oninput = () => {
    const query = roomIconSearch.value.trim().toLocaleLowerCase("ru");
    let visible = 0;
    roomIconPicker.querySelectorAll("[data-room-icon]").forEach((button) => {
      const show = !query || button.dataset.roomLabel.includes(query);
      button.hidden = !show;
      if (show) visible++;
    });
    document.getElementById("room-icon-empty").hidden = visible > 0;
  };
  roomIconPicker.onclick = (event) => {
    const choice = event.target.closest("[data-room-icon]");
    if (!choice) return;
    selectRoomIcon(choice.dataset.roomIcon);
    roomNameInput.value = choice.getAttribute("aria-label");
  };
  document.getElementById("add-room-button").onclick = () => {
    editingRoom = null;
    addRoomForm.reset();
    roomIconSearch.value = "";
    roomIconSearch.oninput();
    document.getElementById("new-room-icon").value = "living-room";
    document.getElementById("add-room-state").textContent = "";
    selectRoomIcon("living-room");
    addRoomModal.querySelector("h2").textContent = "Добавить помещение";
    addRoomModal.querySelector(".status").textContent = "Заполните данные новой комнаты.";
    document.getElementById("add-room-submit").textContent = "Добавить помещение";
    addRoomModal.showModal();
    roomIconSearch.focus();
  };
  function openEditModal(room) {
    if (!room) return;
    editingRoom = room;
    addRoomForm.reset();
    roomIconSearch.value = "";
    roomIconSearch.oninput();
    roomNameInput.value = room.name;
    document.getElementById("new-room-area").value = room.area ?? 0;
    document.getElementById("new-room-description").value = room.description || "";
    selectRoomIcon(roomIcon(room));
    document.getElementById("add-room-state").textContent = "";
    addRoomModal.querySelector("h2").textContent = "Изменить помещение";
    addRoomModal.querySelector(".status").textContent = "Обновите информацию о комнате.";
    document.getElementById("add-room-submit").textContent = "Сохранить изменения";
    addRoomModal.showModal();
    roomNameInput.focus();
  }
  function saveLocalRoomOverride(room) {
    const overrides = readStoredObject(roomOverridesKey, {});
    overrides[room.id] = {
      name: room.name,
      area: room.area,
      icon: room.icon,
      description: room.description || "",
    };
    localStorage.setItem(roomOverridesKey, JSON.stringify(overrides));
  }
  async function deleteRoom(room) {
    if (!room || !confirm(`Удалить комнату «${room.name}» и все её материалы?`)) return;
    const password = prompt("Введите пароль для удаления комнаты:") || "";
    if (!password) return;
    try {
      const response = await fetch(`${API_URL}/api/rooms/${encodeURIComponent(room.id)}`, {
        method: "DELETE",
        headers: { "X-Upload-Password": passwordHeader(password) },
      });
      if (!response.ok && !(room.automatic && response.status === 404)) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Не удалось удалить комнату.");
      }
      if (room.automatic) {
        const deleted = new Set(readStoredObject(deletedRoomsKey, []));
        deleted.add(room.id);
        localStorage.setItem(deletedRoomsKey, JSON.stringify([...deleted]));
      }
      rooms = rooms.filter((item) => item.id !== room.id);
      delete manifests[room.id];
      indexRooms();
      if (selectedRoom?.id === room.id) closeRoom();
      else renderSidebar();
    } catch (error) {
      alert(error.message || "Не удалось удалить комнату.");
    }
  }
  document.getElementById("add-room-cancel").onclick = () => addRoomModal.close();
  addRoomForm.onsubmit = async (event) => {
    event.preventDefault();
    const name = document.getElementById("new-room-name").value.trim(),
      area = Number(document.getElementById("new-room-area").value),
      icon = document.getElementById("new-room-icon").value,
      description = document.getElementById("new-room-description").value.trim(),
      password = document.getElementById("new-room-password").value,
      state = document.getElementById("add-room-state"),
      submit = document.getElementById("add-room-submit");
    if (!name || !Number.isFinite(area) || area < 0)
      return (state.textContent = "Укажите название и корректную площадь.");
    submit.disabled = true;
    state.textContent = editingRoom ? "Сохраняем изменения…" : "Добавляем помещение…";
    try {
      const response = await fetch(
        editingRoom
          ? `${API_URL}/api/rooms/${encodeURIComponent(editingRoom.id)}`
          : `${API_URL}/api/rooms`,
        {
          method: editingRoom ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Upload-Password": passwordHeader(password),
          },
          body: JSON.stringify({ name, area, icon, description }),
        }
      );
      let room = await response.json().catch(() => ({}));
      if (!response.ok && !(editingRoom?.automatic && response.status === 404))
        throw new Error(room.error || "Не удалось сохранить помещение.");
      if (editingRoom?.automatic && response.status === 404) {
        room = { ...editingRoom, name, area, icon, description };
        saveLocalRoomOverride(room);
      }
      if (editingRoom) rooms = rooms.map((item) => (item.id === room.id ? room : item));
      else rooms.push(room);
      indexRooms();
      manifests[room.id] ||= { photos: [], renderUrls: [] };
      selectedRoom = selectedRoom?.id === room.id ? room : selectedRoom;
      addRoomModal.close();
      renderSidebar();
      if (editingRoom) {
        renderProjectCard(room);
        if (!room.automatic) renderRoom();
      } else openRoom(room);
    } catch (error) {
      state.textContent = error.message || "Потеря соединения.";
    } finally {
      submit.disabled = false;
    }
  };

  const modal = document.getElementById("photo-upload-modal"),
    filesInput = document.getElementById("photo-files"),
    drop = document.getElementById("photo-drop");
  const renderFilesInput = document.createElement("input");
  renderFilesInput.type = "file";
  renderFilesInput.accept = "image/jpeg,image/png,image/webp";
  renderFilesInput.multiple = true;
  renderFilesInput.hidden = true;
  document.body.append(renderFilesInput);
  const roomModelInput = document.createElement("input");
  roomModelInput.type = "file";
  roomModelInput.accept = ".glb,model/gltf-binary";
  roomModelInput.hidden = true;
  document.body.append(roomModelInput);
  const roomFloorplanInput = document.createElement("input");
  roomFloorplanInput.type = "file";
  roomFloorplanInput.accept = "image/jpeg,image/png,image/webp";
  roomFloorplanInput.hidden = true;
  document.body.append(roomFloorplanInput);
  roomFloorplanInput.onchange = async () => {
    const file = roomFloorplanInput.files[0];
    if (!file) return;
    const password = prompt("Введите пароль для загрузки планировки:") || "";
    if (!password) return;
    const data = new FormData();
    data.append("file", file);
    try {
      const response = await fetch(`${API_URL}/api/rooms/${selectedRoom.id}/assets/floorplan`, {
          method: "POST",
          headers: { "X-Upload-Password": passwordHeader(password) },
          body: data,
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить планировку.");
      manifests[selectedRoom.id] = result;
      renderRoom();
      showToast("Планировка комнаты сохранена");
    } catch (error) {
      alert(error.message || "Потеря соединения.");
    } finally {
      roomFloorplanInput.value = "";
    }
  };
  function openUpload() {
    selectedFiles = [];
    renderPreviews();
    document.getElementById("upload-room-label").textContent = `Помещение: ${selectedRoom.name}`;
    document.getElementById("photo-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("photo-upload-state").textContent = "";
    modal.showModal();
  }
  function addFiles(files) {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]),
      valid = [...files].filter((file) => allowed.has(file.type) && file.size <= 15 * 1024 * 1024);
    selectedFiles.push(...valid);
    document.getElementById("photo-upload-state").textContent =
      valid.length === files.length
        ? `Выбрано файлов: ${selectedFiles.length}`
        : "Некоторые файлы имеют неподдерживаемый формат или превышают 15 МБ.";
    renderPreviews();
  }
  function renderPreviews() {
    document.getElementById("photo-previews").innerHTML = selectedFiles
      .map(
        (file, index) =>
          `<div class="photo-preview"><img src="${URL.createObjectURL(file)}" alt="${esc(file.name)}"><button class="preview-remove" type="button" data-remove-preview="${index}">×</button></div>`
      )
      .join("");
  }
  drop.onclick = () => filesInput.click();
  filesInput.onchange = () => addFiles(filesInput.files);
  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("dragging");
    })
  );
  ["dragleave", "drop"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove("dragging");
    })
  );
  drop.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
  document.getElementById("photo-previews").onclick = (event) => {
    const button = event.target.closest("[data-remove-preview]");
    if (!button) return;
    selectedFiles.splice(Number(button.dataset.removePreview), 1);
    renderPreviews();
  };
  document.getElementById("photo-upload-cancel").onclick = () => modal.close();
  function uploadPhoto(data, password, index, total) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", `${API_URL}/api/rooms/${selectedRoom.id}/assets/photo`);
      request.setRequestHeader("X-Upload-Password", passwordHeader(password));
      request.upload.onprogress = (event) => {
        if (event.lengthComputable)
          document.getElementById("photo-upload-state").textContent =
            `Файл ${index + 1} из ${total}: ${Math.round((event.loaded / event.total) * 100)}%`;
      };
      request.onerror = () => reject(new Error("Потеря соединения."));
      request.onload = () => {
        let result;
        try {
          result = JSON.parse(request.responseText);
        } catch {
          return reject(new Error("Сервер вернул некорректный ответ."));
        }
        request.status >= 200 && request.status < 300
          ? resolve(result)
          : reject(new Error(result.error || "Ошибка загрузки."));
      };
      request.send(data);
    });
  }
  renderFilesInput.onchange = async () => {
    const files = [...renderFilesInput.files],
      allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!files.length) return;
    if (files.some((file) => !allowed.has(file.type) || file.size > 200 * 1024 * 1024)) {
      alert("Используйте JPG, PNG или WEBP размером до 200 МБ.");
      renderFilesInput.value = "";
      return;
    }
    const password = prompt("Введите пароль для загрузки рендеров:") || "";
    if (!password) {
      renderFilesInput.value = "";
      return;
    }
    try {
      for (let index = 0; index < files.length; index++) {
        const data = new FormData();
        data.append("file", files[index]);
        const response = await fetch(`${API_URL}/api/rooms/${selectedRoom.id}/assets/render`, {
          method: "POST",
          headers: { "X-Upload-Password": passwordHeader(password) },
          body: data,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Не удалось загрузить рендер.");
        manifests[selectedRoom.id] = result;
      }
      renderRoom();
      renderSidebar();
      showToast(`Загружено рендеров: ${files.length}`);
    } catch (error) {
      alert(error.message || "Потеря соединения.");
    } finally {
      renderFilesInput.value = "";
    }
  };
  roomModelInput.onchange = async () => {
    const file = roomModelInput.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".glb")) {
      alert("Для комнаты нужен файл GLB.");
      roomModelInput.value = "";
      return;
    }
    const password = prompt("Введите пароль для загрузки 3D-модели комнаты:") || "";
    if (!password) {
      roomModelInput.value = "";
      return;
    }
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch(`${API_URL}/api/rooms/${selectedRoom.id}/assets/model`, {
        method: "POST",
        headers: { "X-Upload-Password": passwordHeader(password) },
        body: data,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить модель.");
      manifests[selectedRoom.id] = result;
      renderRoom();
      showToast("3D-модель комнаты загружена");
    } catch (error) {
      alert(error.message || "Потеря соединения.");
    } finally {
      roomModelInput.value = "";
    }
  };
  document.getElementById("photo-upload-form").onsubmit = async (event) => {
    event.preventDefault();
    const state = document.getElementById("photo-upload-state"),
      submit = document.getElementById("photo-upload-submit");
    if (!selectedFiles.length) return (state.textContent = "Выберите хотя бы одно фото.");
    const password = prompt("Введите пароль для загрузки фотографий:") || "";
    if (!password) return (state.textContent = "Загрузка отменена: пароль не введён.");
    submit.disabled = true;
    try {
      for (let index = 0; index < selectedFiles.length; index++) {
        const data = new FormData();
        data.append("file", selectedFiles[index]);
        data.append("type", document.getElementById("photo-type").value);
        data.append("date", document.getElementById("photo-date").value);
        data.append("comment", document.getElementById("photo-comment").value);
        manifests[selectedRoom.id] = await uploadPhoto(data, password, index, selectedFiles.length);
      }
      modal.close();
      renderSidebar();
      renderRoom();
      showToast(`Загружено фото: ${selectedFiles.length}`);
    } catch (error) {
      state.textContent =
        error.message === "Неверный пароль для загрузки."
          ? "Неверный пароль."
          : error.message || "Потеря соединения.";
    } finally {
      submit.disabled = false;
    }
  };
  function showToast(text) {
    const toast = document.createElement("div");
    toast.textContent = text;
    Object.assign(toast.style, {
      position: "fixed",
      zIndex: 200,
      right: "20px",
      bottom: "20px",
      padding: "12px 16px",
      color: "var(--color-success)",
      background: "var(--color-success-soft)",
      border: "1px solid var(--color-success-border)",
      borderRadius: "12px",
      boxShadow: "var(--shadow-sm)",
    });
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2800);
  }
  try {
    window.top.addEventListener("popstate", () => {
      const route = currentRoute();
      if (route.startsWith("/rooms/")) openRoom(roomBySlug[route.split("/")[2]], false);
      else closeRoom(false);
    });
  } catch {}
  window.addEventListener("rooms-analyzed", (event) => {
    rooms = event.detail.rooms.map((room) => ({
      id: room.id,
      slug: room.id,
      name: room.name,
      area: Number(room.area.toFixed(1)),
      type: room.type,
      confidence: room.confidence,
      automatic: true,
    }));
    window.HOUSE_ROOMS = rooms;
    indexRooms();
    renderSidebar();
    window.dispatchEvent(new CustomEvent("room-catalog-changed", { detail: { rooms } }));
  });
  const route = currentRoute();
  if (route.startsWith("/rooms/")) selectedRoom = roomBySlug[route.split("/")[2]] || null;
  if (selectedRoom) openRoom(selectedRoom, false);
  loadData();
})();
