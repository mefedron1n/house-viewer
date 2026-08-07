(() => {
  const API = window.HouseConfig?.apiBaseUrl || location.origin;
  const request = async (path, options = {}) => { const response = await fetch(`${API}${path}`, { ...options, credentials: "include", headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) } }); const body = response.status === 204 ? null : await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || "Не удалось выполнить запрос."); return body; };
  document.querySelector("#studio-main").setAttribute("aria-busy", "true");
  request("/api/auth/me").then(({ user }) => {
    window.studioContext = { API, request, user };
    window.createProfileMenu(document.querySelector("#profile-menu-host"), user, API);
    document.querySelector("[data-mobile-profile]")?.addEventListener("click", () => document.querySelector(".profile-trigger")?.click());
    const script = document.createElement("script"); script.src = "./scripts/studio.js?v=1"; script.onload = () => document.querySelector("#studio-main").removeAttribute("aria-busy"); document.body.append(script);
  }).catch(() => { location.replace("./auth.html"); });
})();
