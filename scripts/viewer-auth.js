(() => {
  const host = document.querySelector("#viewer-profile-menu-host");
  if (!host || !window.createProfileMenu) return;

  const API = window.HouseConfig?.apiBaseUrl || location.origin;
  fetch(`${API}/api/auth/me`, { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) return;
      const { user } = await response.json();
      window.createProfileMenu(host, user, API);
      host.hidden = false;
    })
    .catch(() => {});
})();
