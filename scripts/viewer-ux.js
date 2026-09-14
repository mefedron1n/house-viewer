(() => {
  if (new URLSearchParams(location.search).has("preview")) return;
  const $ = (id) => document.getElementById(id);
  const sidebar = $("rooms-sidebar");
  const links = $("room-links");
  const search = $("room-search-input");
  const empty = $("room-search-empty");
  const back = $("viewer-back-home");
  let filter = "all";

  const passwordKey = "roomark:action-password";
  const passwordControl = $("session-password-button")?.closest(".session-password-control");
  const passwordButton = $("session-password-button");
  const passwordPopover = $("session-password-popover");
  const passwordInput = $("session-password-input");
  const passwordStatus = $("session-password-status");
  const passwordSaveButton = $("session-password-save");
  const storedPassword = () => sessionStorage.getItem(passwordKey) || "";
  const passwordHeader = (value) => `roomark-uri:${encodeURIComponent(value)}`;
  const setPasswordState = (state, message) => {
    passwordControl?.classList.toggle("has-password", state === "valid");
    passwordControl?.classList.toggle("has-invalid-password", state === "invalid");
    passwordControl?.classList.toggle("is-checking-password", state === "checking");
    if (passwordStatus) {
      passwordStatus.dataset.state = state;
      passwordStatus.textContent = message;
    }
  };
  const syncPasswordInputs = (value) => {
    document.querySelectorAll('input[type="password"]:not(#session-password-input)').forEach((input) => {
      input.value = value;
    });
    passwordControl?.classList.toggle("has-password", Boolean(value));
  };
  window.RoomarkSessionPassword = {
    get: storedPassword,
    set(value) {
      const password = String(value || "");
      if (password) sessionStorage.setItem(passwordKey, password);
      else sessionStorage.removeItem(passwordKey);
      syncPasswordInputs(password);
    },
    clear() { this.set(""); },
  };
  syncPasswordInputs(storedPassword());
  passwordButton?.addEventListener("click", () => {
    const opening = passwordPopover.hidden;
    passwordPopover.hidden = !opening;
    passwordButton.setAttribute("aria-expanded", String(opening));
    if (opening) {
      passwordInput.readOnly = false;
      passwordInput.value = storedPassword();
      passwordStatus.textContent = storedPassword() ? "Пароль сохранён на текущую сессию." : "";
      requestAnimationFrame(() => passwordInput.focus());
    }
  });
  const saveSessionPassword = async () => {
    const value = passwordInput.value;
    if (!value) { setPasswordState("invalid", "Введите пароль."); return; }
    setPasswordState("checking", "Проверяем пароль…");
    passwordInput.disabled = true;
    passwordSaveButton.disabled = true;
    passwordPopover.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/upload-password/validate", {
        method: "POST",
        headers: { "X-Upload-Password": passwordHeader(value) },
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.RoomarkSessionPassword.clear();
          setPasswordState("invalid", "Неверный пароль.");
          return;
        }
        throw new Error(`Password validation failed: ${response.status}`);
      }
      window.RoomarkSessionPassword.set(value);
      setPasswordState("valid", "Пароль верный и сохранён для текущей сессии.");
    } catch (error) {
      console.error(error);
      setPasswordState("invalid", "Не удалось проверить пароль. Попробуйте ещё раз.");
    } finally {
      passwordInput.disabled = false;
      passwordSaveButton.disabled = false;
      passwordPopover.removeAttribute("aria-busy");
      passwordInput.focus();
    }
  };
  passwordSaveButton?.addEventListener("click", saveSessionPassword);
  passwordInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveSessionPassword();
  });
  $("session-password-clear")?.addEventListener("click", () => {
    passwordInput.value = "";
    window.RoomarkSessionPassword.clear();
    setPasswordState("empty", "Пароль удалён из сессии.");
  });
  passwordPopover?.querySelector("[data-close-session-password]")?.addEventListener("click", () => {
    passwordPopover.hidden = true;
    passwordButton.setAttribute("aria-expanded", "false");
  });

  // Password managers may ignore autocomplete="off". Keep the field locked until a real gesture.
  const clearRestoredSearch = () => {
    if (document.activeElement !== search) search.value = "";
  };
  clearRestoredSearch();
  [0, 100, 350, 1000, 2000].forEach((delay) => setTimeout(clearRestoredSearch, delay));
  const unlockSearch = () => {
    search.readOnly = false;
    search.value = "";
  };
  search.addEventListener("pointerdown", unlockSearch, { once: true });
  search.addEventListener("keydown", unlockSearch, { once: true });
  window.addEventListener("pageshow", () => {
    clearRestoredSearch();
    applyRoomFilters();
  });

  function applyRoomFilters() {
    const query = search.value.trim().toLocaleLowerCase("ru");
    let shown = 0;
    links.querySelectorAll(".room-link-row").forEach((row) => {
      const text = row.querySelector(".room-link-copy")?.textContent.toLocaleLowerCase("ru") || "";
      const notesText = row.querySelector("small")?.textContent || "";
      const notes = Number(notesText.match(/(\d+)\s+замеч/)?.[1] || 0);
      const visible = (!query || text.includes(query)) && (filter === "all" || notes > 0);
      row.hidden = !visible;
      if (visible) shown += 1;
    });
    empty.hidden = shown > 0;
  }

  new MutationObserver(applyRoomFilters).observe(links, { childList: true });
  search.addEventListener("input", applyRoomFilters);
  document.querySelectorAll("[data-room-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filter = button.dataset.roomFilter;
      document.querySelectorAll("[data-room-filter]").forEach((item) => item.classList.toggle("active", item === button));
      applyRoomFilters();
    });
  });

  const syncSelection = () => {
    const active = links.querySelector("[data-open-room].active");
    back.hidden = !active;
    document.documentElement.classList.toggle("no-room-selected", !active);
    $("rooms-total").textContent = `· ${links.querySelectorAll(".room-link-row").length}`;
  };
  new MutationObserver(syncSelection).observe(links, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  links.addEventListener("click", () => requestAnimationFrame(syncSelection));
  back.addEventListener("click", () => links.querySelector("[data-go-home]")?.click());

  const help = $("viewer-help-dialog");
  $("viewer-help-button").addEventListener("click", () => help.showModal());
  const controlsHelp = $("viewer-controls-help"),
    controlsHelpForever = $("viewer-controls-help-forever"),
    controlsHelpKey = "roomark:hide-viewer-controls-help";
  if (localStorage.getItem(controlsHelpKey) === "1") controlsHelp.hidden = true;
  $("viewer-controls-help-close")?.addEventListener("click", () => {
    if (controlsHelpForever.checked) localStorage.setItem(controlsHelpKey, "1");
    controlsHelp.hidden = true;
  });
  $("copy-room-link").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = "Ссылка скопирована";
    } catch {
      button.textContent = "Не удалось скопировать";
    }
    setTimeout(() => (button.textContent = "Скопировать ссылку"), 1800);
  });

  document.querySelectorAll(".tool").forEach((tool) => {
    tool.title = tool.dataset.label || tool.textContent.trim();
  });
  syncSelection();
})();
