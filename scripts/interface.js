(() => {
  const API_URL = window.HouseConfig?.apiBaseUrl || location.origin;
  const projectId = new URLSearchParams(location.search).get("project");
  const projectQuery = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const passwordHeader = (value) => `roomark-uri:${encodeURIComponent(value)}`;
  const roomNames = Object.fromEntries(window.HOUSE_ROOMS.map(({ id, name }) => [id, name]));
  const placeholder = "./images/room-placeholder.svg";
  let roomData = {},
    notes = [],
    activeNoteId = null,
    projectFloorplanUrl = null,
    projectFloorplanAspect = null,
    floorplanCalibration = null,
    calibrationImagePoints = [],
    draftPlanPoint = null;
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
    if (window.openSelectedRoomSection?.(mode)) {
      document
        .querySelectorAll("[data-mode]")
        .forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
      document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.remove("active"));
      document.querySelector(".project-card").hidden = true;
      document.querySelector(".tools").hidden = true;
      return;
    }
    document
      .querySelectorAll("[data-mode]")
      .forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    document
      .querySelectorAll("[data-panel]")
      .forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === mode));
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
    return `<button class="room-tile" data-room-focus="${key}" type="button"><span class="room-visual">${image ? `<img src="${image}" alt="Планировка: ${roomNames[key]}">` : `<img class="room-type-icon" src="${roomIconUrl(key)}" alt="">`}</span><span class="room-copy"><strong>${roomNames[key]}</strong><small>Открыть страницу помещения</small></span></button>`;
  }
  function renderPlan() {
    document.getElementById("plan-rooms").innerHTML = Object.entries(roomNames)
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
    const view = document.getElementById("project-floorplan-view"),
      board = document.getElementById("pin-board");
    if (projectFloorplanUrl) {
      view.className = "";
      const image = document.createElement("img");
      image.src = projectFloorplanUrl;
      image.alt = "Планировка всего проекта";
      view.replaceChildren(image);
      board.style.backgroundImage = `url("${projectFloorplanUrl}")`;
      board.classList.add("has-floorplan");
      const dimensions = new Image();
      dimensions.onload = () => {
        if (!dimensions.naturalWidth || !dimensions.naturalHeight) return;
        projectFloorplanAspect = dimensions.naturalWidth / dimensions.naturalHeight;
        renderPins();
      };
      dimensions.src = projectFloorplanUrl;
      calibrationState(
        floorplanCalibration
          ? "готова — метки используют координаты модели."
          : "не выполнена. Перед добавлением меток привяжите план."
      );
    } else {
      view.className = "project-floorplan-empty";
      view.textContent = "Общая планировка ещё не загружена.";
      board.style.backgroundImage = "";
      projectFloorplanAspect = null;
      board.classList.remove("has-floorplan");
      floorplanCalibration = null;
      calibrationState("сначала загрузите планировку.");
    }
  }
  async function loadProjectFloorplan() {
    try {
      const response = await fetch(`${API_URL}/api/project${projectQuery}`, { cache: "no-store" });
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
    const password = prompt("Введите пароль для загрузки общей планировки:") || "";
    if (!password) return;
    status.textContent = "Загрузка…";
    const data = new FormData();
    data.append("file", file);
    try {
      const response = await fetch(`${API_URL}/api/project/floorplan${projectQuery}`, {
          method: "POST",
          headers: { "X-Upload-Password": passwordHeader(password) },
          body: data,
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить планировку.");
      applyProjectFloorplan(result.floorplanUrl, null);
      status.textContent = "Планировка сохранена. Теперь привяжите её к 3D по трём точкам.";
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
    return `<button class="room-tile" data-room-focus="${key}" data-room-tab-target="${kind}" type="button"><span class="room-visual">${image ? `<img src="${image}" alt="${kind === "photos" ? "Фото" : "Рендер"}: ${roomNames[key]}">` : `<img class="room-type-icon" src="${roomIconUrl(key)}" alt="">`}</span><span class="room-copy"><strong>${roomNames[key]}</strong><small>Открыть ${kind === "photos" ? "фотографии" : "рендеры"} комнаты</small></span></button>`;
  }
  function galleryMarkup(kind) {
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
  function renderGalleries() {
    document.getElementById("photos-content").innerHTML = galleryMarkup("photos");
    document.getElementById("renders-content").innerHTML = galleryMarkup("renders");
  }
  async function loadRooms() {
    const entries = await Promise.all(
      Object.keys(roomNames).map(async (key) => {
        try {
          const response = await fetch(`${API_URL}/api/rooms/${key}`, { cache: "no-store" });
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
  document.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-room-focus]");
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
      const response = await fetch(`${API_URL}/api/notes${projectQuery}`, { cache: "no-store" });
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
      const response = await fetch(`${API_URL}/api/project/floorplan-calibration${projectQuery}`, {
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
          const migration = await fetch(`${API_URL}/api/notes/${note.id}${projectQuery}`, {
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
        const response = await fetch(`${API_URL}/api/notes/${remove.dataset.deleteNote}${projectQuery}`, {
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
      const response = await fetch(`${API_URL}/api/notes/${pin.dataset.noteId}${projectQuery}`, {
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
      const response = await fetch(`${API_URL}/api/notes${projectQuery}`, {
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
  function noteDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ru");
  }
  function renderNotesList() {
    const list = document.getElementById("notes-list");
    if (!list) return;
    list.innerHTML = notes.length
      ? notes.map((note, index) => {
          const resolved = note.status === "resolved";
          return `<label class="notes-list-item ${resolved ? "resolved" : ""}"><input type="checkbox" data-note-status="${note.id}" ${resolved ? "checked" : ""}><span><p>${escapeHtml(note.text)}</p><small>Пин ${index + 1} · ${noteDate(note.createdAt)}</small></span><small>${resolved ? "Выполнено" : "Открыто"}</small></label>`;
        }).join("")
      : `<div class="notes-list-empty">Заметок пока нет. Добавьте пин двойным кликом по модели в режиме 3D.</div>`;
  }
  async function loadNotesList() {
    try {
      const response = await fetch(`${API_URL}/api/notes${projectQuery}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      notes = await response.json();
      renderNotesList();
    } catch {
      document.getElementById("notes-status").textContent = "Не удалось загрузить заметки.";
    }
  }
  document.getElementById("notes-list")?.addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-note-status]");
    if (!checkbox) return;
    const passwordInput = document.getElementById("notes-password"),
      password = passwordInput.value || prompt("Введите пароль, чтобы изменить статус заметки:") || "",
      status = document.getElementById("notes-status");
    if (!password) {
      checkbox.checked = !checkbox.checked;
      return;
    }
    checkbox.disabled = true;
    try {
      const response = await fetch(`${API_URL}/api/notes/${checkbox.dataset.noteStatus}${projectQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
        body: JSON.stringify({ status: checkbox.checked ? "resolved" : "new" }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Не удалось изменить статус заметки.");
      notes = notes.map((note) => note.id === updated.id ? updated : note);
      passwordInput.value ||= password;
      renderNotesList();
      window.dispatchEvent(new Event("notes-changed"));
      status.textContent = checkbox.checked ? "Пин выполнен и скрыт в 3D." : "Пин снова открыт и показан в 3D.";
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      status.textContent = error.message;
    }
  });
  loadRooms();
  loadNotesList();
  window.addEventListener("notes-changed", loadNotesList);
  loadProjectFloorplan();
})();
