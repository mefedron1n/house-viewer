const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hero = $(".landing-hero");

const savedTheme = localStorage.getItem("roomark:landing-theme");
const useLight = savedTheme !== "dark";
document.body.classList.toggle("landing-light", useLight);
const themeButtons = $$('[data-landing-theme]');
const renderThemeButton = () => {
  const isLight = document.body.classList.contains("landing-light");
  themeButtons.forEach(button => button.setAttribute("aria-pressed", String((button.dataset.landingTheme === "light") === isLight)));
  $('meta[name="theme-color"]')?.setAttribute("content", isLight ? "#f5f1e9" : "#101510");
};
renderThemeButton();
themeButtons.forEach(button => button.addEventListener("click", () => {
  document.body.classList.toggle("landing-light", button.dataset.landingTheme === "light");
  localStorage.setItem(
    "roomark:landing-theme",
    document.body.classList.contains("landing-light") ? "light" : "dark"
  );
  renderThemeButton();
}));

const heroTabs = $$('[data-hero-view]');
const selectHeroView = (button) => {
    heroTabs.forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    hero.dataset.view = button.dataset.heroView;
    $('#hero-view-panel').setAttribute('aria-labelledby', button.id);
    $('.hero-art').hidden = button.dataset.heroView !== '3d';
    $('.hero-hotspots').hidden = button.dataset.heroView !== '3d';
    $('.hero-plan-image').hidden = button.dataset.heroView !== 'plan';
    $('.hero-photo').hidden = button.dataset.heroView !== 'photo';
};
heroTabs.forEach((button, index) => {
  button.addEventListener('click', () => selectHeroView(button));
  button.addEventListener('keydown', event => {
    const next = { ArrowRight: (index + 1) % heroTabs.length, ArrowLeft: (index + heroTabs.length - 1) % heroTabs.length, Home: 0, End: heroTabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectHeroView(heroTabs[next]);
    heroTabs[next].focus();
  });
});

$$('.hero-hotspot').forEach((pin) =>
  pin.addEventListener("click", () => {
    const expanded = pin.getAttribute("aria-expanded") === "true";
    $$('.hero-hotspot').forEach((item) => item.setAttribute("aria-expanded", "false"));
    pin.setAttribute("aria-expanded", String(!expanded));
  })
);

const navButton = $(".header-menu");
navButton?.addEventListener("click", () => {
  const open = navButton.getAttribute("aria-expanded") !== "true";
  navButton.setAttribute("aria-expanded", String(open));
  $("#landing-nav").classList.toggle("open", open);
});

$$('[data-image-comparison]').forEach((comparison) => {
  const input = $('input[type="range"]', comparison);
  const updateComparison = () => {
    const value = Math.max(0, Math.min(100, Number(input.value)));
    comparison.style.setProperty('--comparison', `${value}%`);
    input.setAttribute('aria-valuetext', `Рендер ${value}%, реальность ${100 - value}%`);
  };
  input.addEventListener('input', updateComparison);
  updateComparison();
});

const contextRooms = {
  kitchen: { name: "Кухня-гостиная", area: "28,4 м²", photo: "./img/2.jpg", origin: "49% 40%", note: "Уточнить расположение розеток над рабочей поверхностью." },
  bedroom: { name: "Спальня", area: "16,2 м²", origin: "76% 65%", note: "Согласовать высоту прикроватных светильников." },
  hall: { name: "Прихожая", area: "10,5 м²", origin: "65% 26%", note: "Проверить глубину встроенного шкафа у входа." },
  bathroom: { name: "Санузел", area: "6,8 м²", origin: "82% 32%", note: "Уточнить раскладку плитки в зоне умывальника." },
};
const contextRoomButtons = $$('[data-context-room]');
const contextViewButtons = $$('[data-context-view]');
let contextRoom = "kitchen", contextView = "3d";
const renderRoomContext = () => {
  const room = contextRooms[contextRoom];
  const stage = $('.context-preview-stage');
  const image = $('#context-preview-image');
  const empty = contextView === 'photos' && !room.photo;
  const model = contextRoom !== 'kitchen' && ['3d', 'renders'].includes(contextView);
  stage.dataset.room = contextRoom;
  stage.dataset.view = contextView;
  stage.classList.toggle('model-room', model);
  stage.style.setProperty('--room-origin', room.origin);
  image.hidden = empty || contextView === 'notes';
  $('#context-preview-empty').hidden = !empty;
  $('#context-preview-notes').hidden = contextView !== 'notes';
  if (!image.hidden) {
    image.src = contextView === 'plan' ? './images/context-floorplan.svg' : model ? './images/roomark-hero-apartment.png' : room.photo;
    image.alt = contextView === 'plan' ? `План квартиры: ${room.name}, ${room.area}` : `${contextView === 'photos' ? 'Фото' : 'Визуализация'}: ${room.name}`;
  }
  $('#context-room-name').textContent = room.name;
  $('#context-room-area').textContent = room.area;
  $('#context-note-text').textContent = room.note;
  contextRoomButtons.forEach(button => {
    const selected = button.dataset.contextRoom === contextRoom;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  contextViewButtons.forEach(button => {
    const selected = button.dataset.contextView === contextView;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected) $('#context-room-panel').setAttribute('aria-labelledby', button.id);
  });
};
contextRoomButtons.forEach(button => button.addEventListener('click', () => {
  contextRoom = button.dataset.contextRoom;
  renderRoomContext();
}));
contextViewButtons.forEach((button, index) => {
  button.addEventListener('click', () => {
    contextView = button.dataset.contextView;
    renderRoomContext();
  });
  button.addEventListener('keydown', event => {
    const next = { ArrowRight: (index + 1) % contextViewButtons.length, ArrowLeft: (index + contextViewButtons.length - 1) % contextViewButtons.length, Home: 0, End: contextViewButtons.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    contextView = contextViewButtons[next].dataset.contextView;
    renderRoomContext();
    contextViewButtons[next].focus();
  });
});
if (contextRoomButtons.length) renderRoomContext();

const updateScroll = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  $(".scroll-progress span").style.transform = `scaleX(${max ? scrollY / max : 0})`;
  $(".roomark-header").classList.toggle("scrolled", scrollY > 18);
};
addEventListener("scroll", updateScroll, { passive: true });
updateScroll();

if (!reducedMotion && matchMedia("(hover: hover) and (pointer: fine)").matches) {
  const art = $(".hero-model-scene");
  $(".hero-demo")?.addEventListener("mousemove", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    art.style.translate = `${x * 7}px ${y * 5}px`;
  });
  $(".hero-demo")?.addEventListener("mouseleave", () => (art.style.translate = ""));
}
