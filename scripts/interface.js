(() => {
  const API_URL = window.MODEL_API_URL || "http://localhost:3001";
  const roomNames = Object.fromEntries(window.HOUSE_ROOMS.map(({ id, name }) => [id, name]));
  const placeholder = "./images/room-placeholder.svg";
  let roomData = {}, notes = [], activeNoteId = null, projectFloorplanUrl = null;
  const absoluteUrl = (url) => url ? `${API_URL}${url}` : null;

  function setMode(mode) {
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === mode));
    document.querySelector(".project-card").hidden = mode !== "3d";
    document.querySelector(".tools").hidden = mode !== "3d";
    if (mode === "3d") window.dispatchEvent(new Event("resize"));
  }
  window.showApartment = () => setMode("3d");
  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-mode]");
    if (modeButton) setMode(modeButton.dataset.mode);
  });

  document.querySelectorAll(".settings-toggle").forEach((button) => button.addEventListener("click", () => document.getElementById("settings-drawer").classList.toggle("open")));
  const themeButton = document.getElementById("theme-button");
  function setTheme(dark) { document.documentElement.classList.toggle("dark", dark); themeButton.classList.toggle("active", dark); themeButton.setAttribute("aria-pressed", dark); themeButton.title = dark ? "Светлая тема" : "Тёмная тема"; localStorage.setItem("theme", dark ? "dark" : "light"); window.dispatchEvent(new CustomEvent("theme-changed", { detail:{ dark } })); }
  setTheme(localStorage.getItem("theme") === "dark" || (!localStorage.getItem("theme") && matchMedia("(prefers-color-scheme:dark)").matches)); themeButton.onclick = () => setTheme(!document.documentElement.classList.contains("dark"));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { document.getElementById("settings-drawer").classList.remove("open"); activeNoteId = null; renderPins(); } });

  function roomTile(key, room) {
    const image = absoluteUrl(room.floorplanUrl || room.renderUrls?.[0]);
    return `<button class="room-tile" data-room-focus="${key}" type="button"><span class="room-visual">${image ? `<img src="${image}" alt="Планировка: ${roomNames[key]}">` : `<svg class="icon"><path d="M4 4h16v16H4zM9 4v7h11M9 11v9"/></svg>`}</span><span class="room-copy"><strong>${roomNames[key]}</strong><small>Открыть страницу помещения</small></span></button>`;
  }
  function renderPlan() {
    document.getElementById("plan-rooms").innerHTML = Object.entries(roomNames).map(([key]) => roomTile(key, roomData[key] || {})).join("");
  }
  function applyProjectFloorplan(url) { projectFloorplanUrl = absoluteUrl(url); const view=document.getElementById("project-floorplan-view"), board=document.getElementById("pin-board"); if(projectFloorplanUrl) { view.className=""; const image=document.createElement("img"); image.src=projectFloorplanUrl; image.alt="Планировка всего проекта"; view.replaceChildren(image); board.style.backgroundImage=`url("${projectFloorplanUrl}")`; board.classList.add("has-floorplan"); } else { view.className="project-floorplan-empty"; view.textContent="Общая планировка ещё не загружена."; board.style.backgroundImage=""; board.classList.remove("has-floorplan"); } }
  async function loadProjectFloorplan() { try { const response=await fetch(`${API_URL}/api/project`,{cache:"no-store"}); if(response.ok) applyProjectFloorplan((await response.json()).floorplanUrl); } catch {} }
  const projectFloorplanInput=document.createElement("input"); projectFloorplanInput.type="file"; projectFloorplanInput.accept="image/jpeg,image/png,image/webp"; projectFloorplanInput.hidden=true; document.body.append(projectFloorplanInput); document.getElementById("project-floorplan-upload").onclick=()=>projectFloorplanInput.click(); projectFloorplanInput.onchange=async()=>{ const file=projectFloorplanInput.files[0], status=document.getElementById("project-floorplan-status"); if(!file)return; const password=prompt("Введите пароль для загрузки общей планировки:")||""; if(!password)return; status.textContent="Загрузка…"; const data=new FormData(); data.append("file",file); try { const response=await fetch(`${API_URL}/api/project/floorplan`,{method:"POST",headers:{"X-Upload-Password":password},body:data}), result=await response.json(); if(!response.ok)throw new Error(result.error||"Не удалось загрузить планировку."); applyProjectFloorplan(result.floorplanUrl); status.textContent="Общая планировка сохранена и установлена фоном для пинов."; }catch(error){status.textContent=error.message;}finally{projectFloorplanInput.value="";} };
  const galleryIndexes = { photos:0, renders:0 };
  function galleryItems(kind) { return Object.entries(roomNames).flatMap(([key,title]) => { const room=roomData[key]||{}; if(kind==="photos") return (room.photos||[]).map((photo,index)=>({ url:absoluteUrl(photo.url), title, caption:`${title} · фото ${index+1}` })); return (room.renderUrls||[]).map((url,index)=>({ url:absoluteUrl(url), title, caption:`${title} · рендер ${index+1}` })); }); }
  function mediaRoomTile(key, kind) { const room=roomData[key]||{}, photo=room.photos?.[0]?.url, render=room.renderUrls?.[0], image=absoluteUrl(kind==="photos" ? photo : render); return `<button class="room-tile" data-room-focus="${key}" data-room-tab-target="${kind}" type="button"><span class="room-visual">${image ? `<img src="${image}" alt="${kind==="photos" ? "Фото" : "Рендер"}: ${roomNames[key]}">` : `<svg class="icon"><path d="M4 4h16v16H4zM9 4v7h11M9 11v9"/></svg>`}</span><span class="room-copy"><strong>${roomNames[key]}</strong><small>Открыть ${kind==="photos" ? "фотографии" : "рендеры"} комнаты</small></span></button>`; }
  function galleryMarkup(kind) { const items=galleryItems(kind), index=items.length ? galleryIndexes[kind]%items.length : 0, item=items[index]; if(!item) return `<div class="empty-state">Материалы ещё не загружены. Добавить их можно на странице соответствующей комнаты.</div><h3 class="gallery-room-title">Выбрать комнату</h3><div class="room-grid">${Object.keys(roomNames).map((key)=>mediaRoomTile(key,kind)).join("")}</div>`; return `<section class="media-showcase" data-gallery-kind="${kind}"><div class="media-stage"><button class="media-arrow previous" type="button" data-gallery-step="-1" aria-label="Предыдущее изображение">‹</button><button class="media-main" type="button" data-image="${item.url}" data-caption="${item.caption}"><img src="${item.url}" alt="${item.caption}"><span>${item.caption}</span></button><button class="media-arrow next" type="button" data-gallery-step="1" aria-label="Следующее изображение">›</button></div><div class="media-counter">${index+1} / ${items.length}</div><div class="media-thumbnails">${items.map((entry,itemIndex)=>`<button class="media-thumbnail ${itemIndex===index?"active":""}" type="button" data-gallery-index="${itemIndex}" aria-label="${entry.caption}"><img src="${entry.url}" alt="" loading="lazy"></button>`).join("")}</div></section><h3 class="gallery-room-title">Выбрать комнату</h3><div class="room-grid">${Object.keys(roomNames).map((key)=>mediaRoomTile(key,kind)).join("")}</div>`; }
  function renderGalleries() {
    document.getElementById("photos-content").innerHTML = galleryMarkup("photos");
    document.getElementById("renders-content").innerHTML = galleryMarkup("renders");
  }
  async function loadRooms() {
    const entries = await Promise.all(Object.keys(roomNames).map(async (key) => {
      try { const response = await fetch(`${API_URL}/api/rooms/${key}`, { cache: "no-store" }); return [key, response.ok ? await response.json() : {}]; }
      catch { return [key, {}]; }
    }));
    roomData = Object.fromEntries(entries); renderPlan(); renderGalleries();
  }
  document.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-room-focus]");
    if (tile) return window.openHouseRoom?.(tile.dataset.roomFocus, tile.dataset.roomTabTarget);
    const gallery=event.target.closest("[data-gallery-kind]"); if(!gallery)return; const kind=gallery.dataset.galleryKind, total=galleryItems(kind).length, step=event.target.closest("[data-gallery-step]"), selected=event.target.closest("[data-gallery-index]"); if(step&&total) galleryIndexes[kind]=(galleryIndexes[kind]+Number(step.dataset.galleryStep)+total)%total; else if(selected) galleryIndexes[kind]=Number(selected.dataset.galleryIndex); else return; document.getElementById(`${kind}-content`).innerHTML=galleryMarkup(kind);
  });

  const lightbox = document.getElementById("lightbox"), lightboxImage = lightbox.querySelector(".lightbox-image"); let lightboxItems = [], lightboxIndex = 0, touchStartX = 0;
  function showLightboxItem(index) { if (!lightboxItems.length) return; lightboxIndex = (index + lightboxItems.length) % lightboxItems.length; const item = lightboxItems[lightboxIndex]; lightboxImage.src = item.dataset.image; lightboxImage.alt = item.dataset.caption; document.getElementById("lightbox-caption").textContent = item.dataset.caption; document.getElementById("lightbox-counter").textContent = `${lightboxIndex + 1} / ${lightboxItems.length}`; }
  document.addEventListener("click", (event) => {
    const imageButton = event.target.closest("[data-image]");
    if (!imageButton) return;
    lightboxItems = [...document.querySelectorAll("[data-image]")].filter((item) => item.offsetParent !== null); lightboxIndex = lightboxItems.indexOf(imageButton); showLightboxItem(lightboxIndex);
    lightbox.showModal();
  });
  document.getElementById("lightbox-close").addEventListener("click", () => lightbox.close());
  document.getElementById("lightbox-prev").addEventListener("click", () => showLightboxItem(lightboxIndex - 1)); document.getElementById("lightbox-next").addEventListener("click", () => showLightboxItem(lightboxIndex + 1));
  lightbox.addEventListener("click", (event) => { if (event.target === lightbox) lightbox.close(); });
  lightboxImage.addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0].clientX; }, { passive:true }); lightboxImage.addEventListener("touchend", (event) => { const distance = event.changedTouches[0].clientX - touchStartX; if (Math.abs(distance) > 45) showLightboxItem(lightboxIndex + (distance < 0 ? 1 : -1)); }, { passive:true });
  document.addEventListener("keydown", (event) => { if (!lightbox.open) return; if (event.key === "ArrowLeft") showLightboxItem(lightboxIndex - 1); if (event.key === "ArrowRight") showLightboxItem(lightboxIndex + 1); });

  function numberFromId(id, offset) {
    const fragment = id.slice(offset, offset + 6) || "1";
    return Number.parseInt(fragment, 16) || 1;
  }
  function pinPosition(note) {
    if (Number.isFinite(note.position?.x) && Number.isFinite(note.position?.y)) return { left:note.position.x * 100, top:note.position.y * 100 };
    return { left: 8 + numberFromId(note.id, 0) % 78, top: 12 + numberFromId(note.id, 6) % 70 };
  }
  function noteDate(value) {
    try { return new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return ""; }
  }
  function renderPins() {
    const board = document.getElementById("pin-board");
    board.innerHTML = notes.map((note, index) => {
      const position = pinPosition(note);
      return `<button class="note-pin ${activeNoteId === note.id ? "active" : ""}" type="button" data-note-id="${note.id}" style="left:${position.left}%;top:${position.top}%" aria-label="Открыть замечание ${index + 1}"><span>${index + 1}</span></button>`;
    }).join("");
    const note = notes.find(({ id }) => id === activeNoteId);
    if (!note) return;
    const position = pinPosition(note), popover = document.createElement("article");
    popover.className = "note-popover";
    popover.style.left = `clamp(14px, ${Math.min(position.left, 68)}%, calc(100% - 304px))`;
    popover.style.top = `clamp(14px, ${Math.min(position.top + 9, 72)}%, calc(100% - 150px))`;
    const text = document.createElement("p"), footer = document.createElement("footer"), date = document.createElement("span"), remove = document.createElement("button");
    text.textContent = note.text; date.textContent = noteDate(note.createdAt); remove.type = "button"; remove.className = "note-delete"; remove.dataset.deleteNote = note.id; remove.textContent = "Удалить";
    footer.append(date, remove); popover.append(text, footer); board.append(popover);
  }
  async function loadNotes() {
    const status = document.getElementById("notes-status");
    try { const response = await fetch(`${API_URL}/api/notes`, { cache: "no-store" }); if (!response.ok) throw new Error(); notes = await response.json(); renderPins(); }
    catch { status.textContent = "Не удалось загрузить общие замечания."; }
  }
  document.getElementById("pin-board").addEventListener("click", async (event) => {
    const pin = event.target.closest("[data-note-id]");
    if (pin) { activeNoteId = activeNoteId === pin.dataset.noteId ? null : pin.dataset.noteId; renderPins(); return; }
    const remove = event.target.closest("[data-delete-note]");
    if (!remove) return;
    const passwordInput = document.getElementById("notes-password");
    const password = passwordInput.value || window.prompt("Введите пароль, чтобы удалить замечание:") || "";
    if (!password) return;
    try {
      const response = await fetch(`${API_URL}/api/notes/${remove.dataset.deleteNote}`, { method: "DELETE", headers: { "X-Upload-Password": password } });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Не удалось удалить замечание.");
      notes = result; activeNoteId = null; renderPins(); window.dispatchEvent(new Event("notes-changed")); document.getElementById("notes-status").textContent = "Замечание удалено.";
    } catch (error) { document.getElementById("notes-status").textContent = error.message; }
  });
  let draggedPin = null, dragMoved = false;
  const board = document.getElementById("pin-board");
  board.addEventListener("pointerdown", (event) => { const pin = event.target.closest("[data-note-id]"); if (!pin) return; draggedPin = pin; dragMoved = false; pin.setPointerCapture(event.pointerId); event.preventDefault(); });
  board.addEventListener("pointermove", (event) => { if (!draggedPin) return; const bounds = board.getBoundingClientRect(), x = Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)), y = Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height)); draggedPin.style.left = `${x*100}%`; draggedPin.style.top = `${y*100}%`; draggedPin.dataset.x = x; draggedPin.dataset.y = y; dragMoved = true; });
  board.addEventListener("pointerup", async () => { if (!draggedPin) return; const pin = draggedPin; draggedPin = null; if (!dragMoved) return; const password = document.getElementById("notes-password").value || window.prompt("Введите пароль, чтобы сохранить положение пина:") || ""; if (!password) return renderPins(); const note = notes.find((item) => item.id === pin.dataset.noteId), position = { x:Number(pin.dataset.x), y:Number(pin.dataset.y), z:note?.position?.z ?? .5 }; try { const response = await fetch(`${API_URL}/api/notes/${pin.dataset.noteId}`, { method:"PATCH", headers:{ "Content-Type":"application/json", "X-Upload-Password":password }, body:JSON.stringify({ position }) }); const updated = await response.json(); if (!response.ok) throw new Error(updated.error || "Не удалось переместить пин."); notes = notes.map((item) => item.id === updated.id ? updated : item); activeNoteId = updated.id; renderPins(); window.dispatchEvent(new Event("notes-changed")); document.getElementById("notes-status").textContent = "Положение пина сохранено."; } catch(error) { renderPins(); document.getElementById("notes-status").textContent = error.message; } });
  document.getElementById("notes-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = document.getElementById("note-text"), password = document.getElementById("notes-password"), submit = document.getElementById("note-submit"), status = document.getElementById("notes-status");
    submit.disabled = true; status.textContent = "Сохраняем замечание…";
    try {
      const response = await fetch(`${API_URL}/api/notes`, { method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Password": password.value }, body: JSON.stringify({ text: text.value, roomId: window.NOTE_ROOM_ID || null }) });
      const note = await response.json(); if (!response.ok) throw new Error(note.error || "Не удалось добавить замечание.");
      notes.push(note); text.value = ""; activeNoteId = note.id; renderPins(); window.dispatchEvent(new Event("notes-changed")); status.textContent = "Пин добавлен и виден всем пользователям.";
    } catch (error) { status.textContent = error.message; } finally { submit.disabled = false; }
  });

  loadRooms(); loadNotes(); loadProjectFloorplan();
})();
