import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)],
  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const requestIdleCallback = window.requestIdleCallback?.bind(window);
const landing = $(".landing-hero");
const savedLandingTheme = localStorage.getItem("roomark:landing-theme");
const initialLightTheme =
  savedLandingTheme === "light" ||
  (!savedLandingTheme && matchMedia("(prefers-color-scheme: light)").matches);
document.body.classList.toggle("landing-light", initialLightTheme);
const landingThemeToggle = $(".landing-theme-toggle");
if (landingThemeToggle) {
  landingThemeToggle.textContent = initialLightTheme ? "☾" : "☼";
  landingThemeToggle.setAttribute("aria-pressed", String(initialLightTheme));
}
landing.dataset.view = "3d";
$$("[data-hero-view]").forEach((button) =>
  button.addEventListener("click", () => {
    $$("[data-hero-view]").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    landing.dataset.view = button.dataset.heroView;
  })
);
landingThemeToggle?.addEventListener("click", (event) => {
  const light = document.body.classList.toggle("landing-light");
  event.currentTarget.setAttribute("aria-pressed", String(light));
  event.currentTarget.textContent = light ? "☾" : "☼";
  localStorage.setItem("roomark:landing-theme", light ? "light" : "dark");
});
const tabs = $(".demo-tabs");
if (tabs?.textContent.includes("${"))
  tabs.innerHTML = ["3D", "План", "Фото", "Рендеры", "Заметки"]
    .map((x, i) => `<button role="tab" aria-selected="${i === 0}" data-demo="${i}">${x}</button>`)
    .join("");
const floor = $(".floor-plan");
if (floor?.textContent.includes("${"))
  floor.innerHTML = [
    ["kitchen", "Кухня-гостиная", "28,4 м²"],
    ["bedroom", "Спальня", "16,2 м²"],
    ["bathroom", "Санузел", "6,8 м²"],
    ["hall", "Прихожая", "10,5 м²"],
  ]
    .map(
      ([id, n, a]) =>
        `<button data-room="${id}" data-name="${n}" data-area="${a}"><span>${n}<small>${a}</small></span></button>`
    )
    .join("");
const story = $(".story-track");
if (story?.textContent.includes("${"))
  story.innerHTML = [
    ["Модель", "Единая пространственная основа"],
    ["План", "Понятная навигация по комнатам"],
    ["Рендер", "Образ будущего интерьера"],
    ["Стройка", "Фиксация хода работ"],
    ["Готовая комната", "Результат рядом с замыслом"],
  ]
    .map((x, i) => `<article><span>0${i + 1}</span><h3>${x[0]}</h3><p>${x[1]}</p></article>`)
    .join("");
let ticking = false;
const onScroll = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight,
      progress = max ? scrollY / max : 0;
    $(".scroll-progress span").style.transform = `scaleX(${progress})`;
    $(".roomark-header").classList.toggle("scrolled", scrollY > 70);
    const m = $("[data-highlight]");
    if (m) m.classList.toggle("active", m.getBoundingClientRect().top < innerHeight * 0.62);
    ticking = false;
  });
};
addEventListener("scroll", onScroll, { passive: true });
onScroll();
$(".header-menu")?.addEventListener("click", (e) => {
  const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
  e.currentTarget.setAttribute("aria-expanded", open);
  $("#landing-nav").classList.toggle("open", open);
});
$$(".feature-step").forEach((b) =>
  b.addEventListener("mouseenter", () => {
    $$(".feature-step").forEach((x) => x.classList.toggle("active", x === b));
    $$(".feature-screen").forEach((x) =>
      x.classList.toggle("active", x.dataset.screen === b.dataset.feature)
    );
  })
);
$$("[data-demo]").forEach((b) =>
  b.addEventListener("click", () => {
    $$("[data-demo]").forEach((x) => x.setAttribute("aria-selected", x === b));
    $$("[data-demo-content]").forEach((x) => (x.hidden = x.dataset.demoContent !== b.dataset.demo));
  })
);
const range = $(".compare input"),
  before = $(".compare-before"),
  line = $(".compare>span");
range?.addEventListener("input", () => {
  before.style.width = `${range.value}%`;
  line.style.left = `${range.value}%`;
  range.setAttribute("aria-valuenow", range.value);
});
$$(".floor-plan button").forEach((b, i) => {
  if (!i) b.classList.add("active");
  const select = () => {
    $$(".floor-plan button").forEach((x) => x.classList.toggle("active", x === b));
    const a = $(".plan-demo aside");
    $("h3", a).textContent = b.dataset.name;
    $(":scope>span", a).textContent = b.dataset.area;
  };
  b.addEventListener("mouseenter", select);
  b.addEventListener("click", select);
});
if (!reduced && matchMedia("(hover:hover) and (pointer:fine)").matches) {
  const cursor = $(".context-cursor");
  $$("[data-cursor]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      cursor.textContent = el.dataset.cursor;
      cursor.style.opacity = 1;
      cursor.style.transform = "translate(-50%,-50%) scale(1)";
    });
    el.addEventListener("mousemove", (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    });
    el.addEventListener("mouseleave", () => (cursor.style.opacity = 0));
  });
  const hero = $(".hero-demo");
  hero.addEventListener("mousemove", (e) => {
    const r = hero.getBoundingClientRect(),
      x = (e.clientX - r.left) / r.width - 0.5,
      y = (e.clientY - r.top) / r.height - 0.5;
    hero.style.transform = `translate(${x * 6}px,${y * 6}px)`;
  });
  hero.addEventListener("mouseleave", () => (hero.style.transform = ""));
}
$$(".magnetic-cta").forEach((a) => {
  a.addEventListener("mousemove", (e) => {
    if (reduced) return;
    const r = a.getBoundingClientRect();
    $("span", a).style.transform =
      `translate(${((e.clientX - r.left) / r.width - 0.5) * 4}px,${((e.clientY - r.top) / r.height - 0.5) * 4}px)`;
  });
  a.addEventListener("mouseleave", () => {
    $("span", a).style.transform = "";
  });
});
$$(".hero-hotspot").forEach((hotspot) =>
  hotspot.addEventListener("click", (event) =>
    event.currentTarget.setAttribute(
      "aria-expanded",
      event.currentTarget.getAttribute("aria-expanded") !== "true"
    )
  )
);
async function initModel() {
  const host = $("#hero-model");
  if (!host) return;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  camera.position.set(8, 6, 10);
  scene.add(new THREE.HemisphereLight(0xfff1d2, 0x293026, 2.4));
  const key = new THREE.DirectionalLight(0xffcf83, 3);
  key.position.set(6, 10, 8);
  scene.add(key);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.35;
  controls.target.set(0, 0, 0);
  $$("[data-hero-view]").forEach((button) =>
    button.addEventListener("click", () => {
      controls.autoRotate = button.dataset.heroView === "3d" && !reduced;
      if (button.dataset.heroView === "plan") camera.position.set(0.01, 15, 0.01);
      if (button.dataset.heroView === "3d") camera.position.set(8, 6, 10);
      controls.update();
    })
  );
  let timer;
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    clearTimeout(timer);
  });
  controls.addEventListener("end", () => {
    if (!reduced) timer = setTimeout(() => (controls.autoRotate = true), 5000);
  });
  const resize = () => {
    const r = host.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();
  try {
    const gltf = await new GLTFLoader().loadAsync("./models/house.glb"),
      box = new THREE.Box3().setFromObject(gltf.scene),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    gltf.scene.position.sub(center);
    const scale = 7 / Math.max(size.x, size.y, size.z);
    gltf.scene.scale.setScalar(scale);
    scene.add(gltf.scene);
    $(".hero-model-status").hidden = true;
  } catch {
    $(".hero-model-status").textContent = "3D-пример временно недоступен";
  }
  let active = true;
  new IntersectionObserver(([e]) => (active = e.isIntersecting), { threshold: 0.05 }).observe(host);
  const loop = () => {
    requestAnimationFrame(loop);
    if (!active) return;
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
}
requestIdleCallback
  ? requestIdleCallback(initModel, { timeout: 1200 })
  : setTimeout(initModel, 250);
