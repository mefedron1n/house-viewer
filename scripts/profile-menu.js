window.createProfileMenu = (container, user, apiBase) => {
  const firstName = user.name.trim().split(/\s+/)[0];
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  container.classList.add("profile-menu-host");
  container.innerHTML = `<button class="profile-trigger" type="button" aria-expanded="false" aria-haspopup="menu"><span>${firstName}</span><strong>${initials}</strong></button><div class="profile-menu" role="menu" hidden><div class="profile-menu-user"><strong>${user.name}</strong><span>${user.email}</span></div><a role="menuitem" href="./studio.html"><span>⌂</span>Личный кабинет</a><a role="menuitem" href="./studio.html?view=projects"><span>□</span>Проекты</a><a role="menuitem" href="./studio.html?view=billing"><span>₽</span>Оплата</a><button role="menuitem" type="button" data-profile-logout><span>↪</span>Выйти из аккаунта</button></div>`;
  const trigger = container.querySelector(".profile-trigger"), menu = container.querySelector(".profile-menu");
  const close = () => { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
  trigger.addEventListener("click", (event) => { event.stopPropagation(); const opening = menu.hidden; menu.hidden = !opening; trigger.setAttribute("aria-expanded", String(opening)); });
  document.addEventListener("click", (event) => { if (!container.contains(event.target)) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); trigger.focus(); } });
  container.querySelector("[data-profile-logout]").addEventListener("click", async () => { try { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }); } finally { localStorage.removeItem("houseReviewerUser"); location.href = "./"; } });
};
