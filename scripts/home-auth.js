(() => {
  const API = window.HouseConfig?.apiBaseUrl || location.origin;
  fetch(`${API}/api/auth/me`, { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) return;
      const { user } = await response.json();
      const actions = document.querySelector(".roomark-header-actions, .header-actions");
      const themeToggle = actions.querySelector(".landing-theme-toggle");
      window.createProfileMenu(actions, user, API);
      if (themeToggle) actions.append(themeToggle);
      document.querySelectorAll('a[href="./auth.html?mode=register"]').forEach((link) => {
        link.href = "./studio.html?view=new";
      });
      document.querySelectorAll(".header-login").forEach((link) => {
        link.textContent = "Мои проекты";
        link.href = "./studio.html?view=projects";
      });
    })
    .catch(() => {});
  const menuButton = document.querySelector(".site-menu-toggle"),
    navigation = document.querySelector("#site-navigation");
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    navigation.classList.toggle("open", open);
  });
  navigation?.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "false");
    navigation.classList.remove("open");
  });
})();
