(() => {
  const API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin : (window.HOUSE_REVIEWER_API || "https://house-viewer-api.onrender.com");
  fetch(`${API}/api/auth/me`, { credentials: "include" }).then(async (response) => {
    if (!response.ok) return;
    const { user } = await response.json();
    const actions = document.querySelector(".header-actions");
    window.createProfileMenu(actions, user, API);
    document.querySelectorAll('a[href="./auth.html?mode=register"]').forEach((link) => { link.href = "./studio.html?view=new"; });
  }).catch(() => {});
})();
