(() => {
  const API = window.HouseConfig?.apiBaseUrl || location.origin;
  const request = async (path, options = {}) => { const response = await fetch(`${API}${path}`, { ...options, credentials: "include", headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) } }); const body = response.status === 204 ? null : await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || "Не удалось выполнить запрос."); return body; };
  document.querySelector("#studio-main").setAttribute("aria-busy", "true");
  request("/api/auth/me").then(({ user }) => {
    window.studioContext = { API, request, user };
    const profileHost = document.querySelector("#profile-menu-host"); if (profileHost) window.createProfileMenu(profileHost, user, API);
    document.querySelectorAll('[aria-disabled="true"]').forEach((link) => link.addEventListener("click", (event) => event.preventDefault()));
    document.querySelector("[data-account-logout]")?.addEventListener("click", async () => { try { await request("/api/auth/logout", { method:"POST" }); } finally { location.href = "./"; } });
    document.querySelector("[data-account-theme]")?.addEventListener("click", (event) => { const dimmed = document.documentElement.classList.toggle("account-dimmed"); event.currentTarget.textContent = dimmed ? "☾" : "☼"; });
    const script = document.createElement("script"); script.src = "./scripts/studio.js?v=2"; script.onload = () => document.querySelector("#studio-main").removeAttribute("aria-busy"); document.body.append(script);
  }).catch(() => { location.replace("./auth.html"); });
})();
