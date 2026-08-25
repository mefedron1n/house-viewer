import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import RoomAnalyzer from "./room-analyzer/RoomAnalyzer.js";

const $ = (id) => document.getElementById(id);
const API_URL = window.HouseConfig?.apiBaseUrl || location.origin;
const passwordHeader = (value) => `roomark-uri:${encodeURIComponent(value)}`;
const viewer = $("viewer"),
  loadingScreen = $("loading-screen"),
  loadingText = $("loading-text"),
  errorMessage = $("error-message"),
  roomCard = $("room-card");
const pageParams = new URLSearchParams(location.search);
const projectId = pageParams.get("project");
const projectQuery = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
const ifcMetadataPromise = projectId
  ? fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}/metadata`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
  : Promise.resolve(null);
if (pageParams.has("preview")) document.documentElement.classList.add("preview");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f0e7);
scene.fog = new THREE.Fog(0xf5f0e7, 35, 100);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 500);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "default",
    failIfMajorPerformanceCaveat: false,
  });
} catch (error) {
  window.reportViewerBootError?.(`WebGL не запустился: ${error.message}`);
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewer.append(renderer.domElement);
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  window.reportViewerBootError?.(
    "Браузер потерял WebGL-контекст. Отключите аппаратное ускорение или обновите видеодрайвер."
  );
});
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = Math.PI / 2.02;
const hemisphere = new THREE.HemisphereLight(0xfff8eb, 0x77746a, 2.35);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xfff4df, 3);
sun.position.set(12, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffdfbd, 1.15);
fill.position.set(-10, 8, -10);
scene.add(fill);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0xf5f0e7, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(100, 100, 0x7b7569, 0x7b7569);
grid.position.y = 0.005;
grid.material.opacity = 0.075;
grid.material.transparent = true;
scene.add(grid);
function applyTheme(dark) {
  scene.background.set(dark ? 0x171a16 : 0xf5f0e7);
  scene.fog.color.set(dark ? 0x171a16 : 0xf5f0e7);
  ground.material.color.set(dark ? 0x1b1e19 : 0xf5f0e7);
  grid.material.color?.set(dark ? 0x77786d : 0x7b7569);
  grid.material.opacity = dark ? 0.1 : 0.075;
}
applyTheme(document.documentElement.classList.contains("dark"));
window.addEventListener("theme-changed", (event) => applyTheme(event.detail.dark));

let house,
  originalPosition = new THREE.Vector3(),
  originalTarget = new THREE.Vector3(),
  cameraAnimation,
  mixer,
  activeObjectUrl,
  activeUpload,
  roomsAnalysis,
  roomHighlight,
  roomHighlightFade;
let wallsVisible = true,
  roofVisible = true,
  pinsVisible = true,
  viewerActive = !(pageParams.get("route") || "").startsWith("/rooms/"),
  modelRequested = false,
  animationFrame;
const selectable = [],
  clock = new THREE.Clock(),
  raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
const manager = new THREE.LoadingManager();
const draco = new DRACOLoader(manager);
draco.setDecoderPath("./vendor/three/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader(manager);
loader.setDRACOLoader(draco);

function disposeModel(model) {
  if (!model) return;
  clearRoomClipping();
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      Object.values(material).forEach((value) => value?.isTexture && value.dispose());
      material.dispose();
    }
  });
  scene.remove(model);
  if (roomHighlight) {
    scene.remove(roomHighlight);
    roomHighlight.geometry?.dispose();
    roomHighlight.material?.dispose();
    roomHighlight = null;
  }
  roomHighlightFade = null;
  selectable.splice(0, selectable.length);
  mixer?.stopAllAction();
  mixer = null;
  roomsAnalysis = null;
}
function prepare(model) {
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = true;
    object.userData.roomAnalyzerVisible = object.visible;
    selectable.push(object);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material) {
        material.side = THREE.DoubleSide;
        if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
  });
}
function fit(model) {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3()),
    max = Math.max(size.x, size.y, size.z),
    distance = max * 1.08;
  model.position.set(-center.x, -box.min.y, -center.z);
  camera.near = Math.max(max / 1000, 0.01);
  camera.far = max * 100;
  camera.updateProjectionMatrix();
  camera.position.set(distance, distance * 0.78, distance);
  controls.target.set(0, size.y * (pageParams.has("preview") ? 0.58 : 0.32), 0);
  controls.minDistance = max * 0.15;
  controls.maxDistance = max * 8;
  controls.update();
  originalPosition.copy(camera.position);
  originalTarget.copy(controls.target);
}
function animate(position, target, duration = 900) {
  cameraAnimation = {
    start: performance.now(),
    duration,
    from: camera.position.clone(),
    to: position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
  };
}
function startCameraIntro() {
  if (pageParams.has("preview") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const destination = originalPosition.clone();
  camera.position.set(-destination.z * 1.18, destination.y * 1.12, destination.x * 1.18);
  controls.target.copy(originalTarget);
  controls.update();
  animate(destination, originalTarget, 2600);
}
function finishModel(model, animations, url) {
  clearTimeout(window.__viewerReadyTimer);
  disposeModel(house);
  if (activeObjectUrl && activeObjectUrl !== url) URL.revokeObjectURL(activeObjectUrl);
  house = model;
  prepare(model);
  fit(model);
  scene.add(model);
  if (animations.length) {
    mixer = new THREE.AnimationMixer(model);
    animations.forEach((clip) => mixer.clipAction(clip).play());
  }
  loadingScreen.classList.remove("has-error");
  loadingScreen.classList.add("hidden");
  startCameraIntro();
  setTimeout(() => analyzeRooms(model), 20);
}
async function analyzeRooms(model) {
  const ifcMetadata = await ifcMetadataPromise;
  if (ifcMetadata?.rooms?.length) {
    const elementRooms = new Map(),
      elementInfo = new Map();
    for (const room of ifcMetadata.spaces || ifcMetadata.rooms)
      for (const identity of [room.ifcGuid, ...(room.meshIds || [])])
        if (identity) {
          if (ifcMetadata.rooms.some((usableRoom) => usableRoom.id === room.id))
            elementRooms.set(identity, [room.id]);
          elementInfo.set(identity, {
            ifcType: "IfcSpace",
            resolvedType: "space",
            ifcGuid: room.ifcGuid,
          });
        }
    for (const element of ifcMetadata.elements || []) {
      for (const identity of [element.ifcGuid, ...(element.meshIds || [])])
        for (const roomId of element.adjacentRoomIds || [])
          elementRooms.set(identity, [...(elementRooms.get(identity) || []), roomId]);
      for (const identity of [element.ifcGuid, ...(element.meshIds || [])])
        if (identity)
          elementInfo.set(identity, {
            ifcType: element.ifcType,
            resolvedType: element.resolvedType,
            ifcGuid: element.ifcGuid,
            confidence: element.confidence,
          });
    }
    model.traverse((object) => {
      if (!object.isMesh) return;
      const searchable = `${object.name} ${JSON.stringify(object.userData)}`;
      const guid = [...elementRooms.keys()].find((candidate) => candidate && searchable.includes(candidate));
      if (guid) object.userData.roomIds = [...new Set(elementRooms.get(guid))];
      const identity = guid || [...elementInfo.keys()].find((candidate) => searchable.includes(candidate));
      if (identity) {
        Object.assign(object.userData, elementInfo.get(identity));
        if (object.userData.resolvedType === "space") {
          object.visible = false;
          object.userData.roomAnalyzerVisible = false;
        }
      }
    });
    for (const room of ifcMetadata.rooms) {
      const roomMesh = selectable.find((object) =>
        (room.meshIds || []).some((meshId) => object.name.includes(meshId))
      );
      if (roomMesh) {
        const actualBounds = new THREE.Box3().setFromObject(roomMesh);
        if (!actualBounds.isEmpty()) {
          const actualCenter = actualBounds.getCenter(new THREE.Vector3());
          room.viewerBounds = {
            min: [actualBounds.min.x, actualBounds.min.y, actualBounds.min.z],
            max: [actualBounds.max.x, actualBounds.max.y, actualBounds.max.z],
          };
          room.viewerCenter = [actualCenter.x, actualCenter.y, actualCenter.z];
          continue;
        }
      }
      if (room.bounds) {
        room.viewerBounds = {
          min: room.bounds.min.map((value, index) => value + [house.position.x, house.position.y, house.position.z][index]),
          max: room.bounds.max.map((value, index) => value + [house.position.x, house.position.y, house.position.z][index]),
        };
        room.viewerCenter = room.center?.map(
          (value, index) => value + [house.position.x, house.position.y, house.position.z][index]
        );
      }
    }
    wallsVisible = false;
    model.traverse((object) => {
      if (isWallMesh(object)) object.visible = false;
    });
    const wallsButton = $("walls-button");
    wallsButton.classList.add("active");
    wallsButton.setAttribute("aria-pressed", "true");
    wallsButton.dataset.label = "Показать стены";
    roomsAnalysis = {
      success: true,
      source: "ifc-space",
      storeys: ifcMetadata.storeys || [],
      connections: ifcMetadata.connections || [],
      rooms: ifcMetadata.rooms.map((room) => ({
        ...room,
        type: "ifc-space",
        automatic: true,
        objectIds: room.meshIds || [],
        floorY: (room.viewerBounds || room.bounds)?.min?.[1] ?? 0,
        ceilingY: (room.viewerBounds || room.bounds)?.max?.[1] ?? 2.7,
        center: room.viewerCenter || room.center,
        boundingBox: (room.viewerBounds || room.bounds)
          ? { min: { x: (room.viewerBounds || room.bounds).min[0], z: (room.viewerBounds || room.bounds).min[2] }, max: { x: (room.viewerBounds || room.bounds).max[0], z: (room.viewerBounds || room.bounds).max[2] } }
          : null,
      })),
    };
    publishRoomsAnalysis();
    return;
  }
  const analyzer = new RoomAnalyzer({
    mode: "fast",
    debugRooms: pageParams.get("debugRooms") === "true" || pageParams.get("debugRooms") === "1",
  });
  roomsAnalysis = analyzer.analyze(model);
  window.RoomarkRooms = roomsAnalysis;
  if (!roomsAnalysis.success) {
    console.info("RoomAnalyzer:", roomsAnalysis.reason);
    window.dispatchEvent(new CustomEvent("rooms-analysis-failed", { detail: roomsAnalysis }));
    return;
  }
  if (roomsAnalysis.debug?.group) scene.add(roomsAnalysis.debug.group);
  publishRoomsAnalysis();
}
function publishRoomsAnalysis() {
  window.AUTO_ROOMS = roomsAnalysis.rooms.map((room) => ({
    id: room.id,
    slug: room.id,
    name: room.name,
    area: Number(Number(room.area || 0).toFixed(1)),
    storeyId: room.storeyId,
    type: room.type,
    confidence: room.confidence,
    automatic: true,
  }));
  const spatialRooms = roomsAnalysis.rooms.filter((room) => room.boundingBox);
  if (spatialRooms.length) {
    const bounds = spatialRooms.reduce(
      (result, room) => ({
        min: {
          x: Math.min(result.min.x, room.boundingBox.min.x),
          z: Math.min(result.min.z, room.boundingBox.min.z),
        },
        max: {
          x: Math.max(result.max.x, room.boundingBox.max.x),
          z: Math.max(result.max.z, room.boundingBox.max.z),
        },
        floorY: Math.min(result.floorY, Number(room.floorY) || 0),
      }),
      { min: { x: Infinity, z: Infinity }, max: { x: -Infinity, z: -Infinity }, floorY: Infinity }
    );
    window.RoomarkSpatialContext = {
      version: 1,
      bounds,
      anchors: [
        { x: bounds.min.x, z: bounds.max.z },
        { x: bounds.max.x, z: bounds.max.z },
        { x: bounds.min.x, z: bounds.min.z },
      ],
      modelKey: initialModelUrl,
    };
    const width = bounds.max.x - bounds.min.x,
      depth = bounds.max.z - bounds.min.z,
      extent = Math.max(width, depth, 1),
      center = new THREE.Vector3(
        (bounds.min.x + bounds.max.x) / 2,
        bounds.floorY + extent * 0.16,
        (bounds.min.z + bounds.max.z) / 2
      ),
      position = new THREE.Vector3(center.x + extent * 1.08, center.y + extent * 0.78, center.z + extent * 1.08);
    camera.position.copy(position);
    controls.target.copy(center);
    controls.minDistance = extent * 0.15;
    controls.maxDistance = extent * 8;
    controls.update();
    originalPosition.copy(position);
    originalTarget.copy(center);
    window.dispatchEvent(new CustomEvent("spatial-context-ready", { detail: window.RoomarkSpatialContext }));
  }
  const metadata = { ...roomsAnalysis };
  delete metadata.debug;
  try {
    localStorage.setItem(`roomark:rooms:${initialModelUrl}`, JSON.stringify(metadata));
  } catch {}
  window.dispatchEvent(new CustomEvent("rooms-analyzed", { detail: roomsAnalysis }));
  console.table(
    roomsAnalysis.rooms.map(({ id, name, type, area, confidence, objectIds }) => ({
      id,
      name,
      type,
      area: Number(Number(area || 0).toFixed(2)),
      confidence,
      objects: objectIds.length,
    }))
  );
  if (pageParams.get("room")) {
    window.showRoom(pageParams.get("room"));
    window.focusRoom(pageParams.get("room"));
  }
}
window.getRoomsMetadata = () =>
  roomsAnalysis ? JSON.parse(JSON.stringify({ ...roomsAnalysis, debug: undefined })) : null;
window.exportRoomsMetadata = () => {
  const metadata = window.getRoomsMetadata();
  if (!metadata) return false;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" })
  );
  link.download = "rooms.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  return true;
};
function loadModel(url, label = "Загрузка проекта...") {
  loadingScreen.classList.remove("hidden", "has-error");
  loadingText.style.display = "block";
  document.querySelector(".loader").style.display = "block";
  errorMessage.style.display = "none";
  loadingText.textContent = label;
  loader.load(
    url,
    ({ scene: model, animations }) => {
      finishModel(model, animations, url);
      setUploadStatus("Модель открыта в просмотрщике.");
    },
    undefined,
    () => showError("Не удалось открыть модель. Проверьте, что файл GLB корректен.")
  );
}
function showError(message) {
  loadingScreen.classList.add("has-error");
  loadingText.style.display = "none";
  document.querySelector(".loader").style.display = "none";
  errorMessage.textContent = message;
  errorMessage.style.display = "block";
  setUploadStatus(message, true);
}
const initialModelUrl =
  pageParams.get("model") ||
  (projectId ? `${API_URL}/api/projects/${encodeURIComponent(projectId)}/model` : "./models/house.glb");
function requestInitialModel() {
  if (modelRequested) return;
  modelRequested = true;
  loader.load(
    initialModelUrl,
    ({ scene: model, animations }) => finishModel(model, animations, initialModelUrl),
    undefined,
    () =>
      showError(
        projectId
          ? "Модель этого проекта ещё не готова или недоступна. Вернитесь в проект и загрузите IFC."
          : pageParams.has("model")
            ? "Модель комнаты не загрузилась."
            : "Модель house.glb не найдена. Поместите её в папку models."
      )
  );
}
if (viewerActive) requestInitialModel();
else loadingScreen.classList.add("hidden");

$("home-button").onclick = () => animate(originalPosition, originalTarget);
$("top-button").onclick = () => {
  if (!house) return;
  const spatial = window.RoomarkSpatialContext?.bounds;
  if (spatial) {
    const centerX = (spatial.min.x + spatial.max.x) / 2,
      centerZ = (spatial.min.z + spatial.max.z) / 2,
      distance = Math.max(spatial.max.x - spatial.min.x, spatial.max.z - spatial.min.z, 1);
    animate(
      new THREE.Vector3(centerX + 0.001, spatial.floorY + distance * 1.7, centerZ + 0.001),
      new THREE.Vector3(centerX, spatial.floorY, centerZ)
    );
    return;
  }
  const size = new THREE.Box3().setFromObject(house).getSize(new THREE.Vector3()), distance = Math.max(size.x, size.z);
  animate(new THREE.Vector3(0.001, distance * 1.7, 0.001), new THREE.Vector3());
};
$("rotate-button").onclick = (event) => {
  controls.autoRotate = !controls.autoRotate;
  controls.autoRotateSpeed = 1;
  event.currentTarget.classList.toggle("active", controls.autoRotate);
};
$("walls-button").onclick = (event) => {
  wallsVisible = !wallsVisible;
  house?.traverse((object) => {
    if (isWallMesh(object)) object.visible = wallsVisible && roomAllowsMesh(object);
  });
  event.currentTarget.classList.toggle("active", !wallsVisible);
  event.currentTarget.setAttribute("aria-pressed", String(!wallsVisible));
  event.currentTarget.dataset.label = wallsVisible ? "Скрыть стены" : "Показать стены";
};
$("roof-button").onclick = (event) => {
  roofVisible = !roofVisible;
  house?.traverse((object) => {
    if (isRoofMesh(object)) object.visible = roofVisible && roomAllowsMesh(object);
  });
  event.currentTarget.classList.toggle("active", !roofVisible);
  event.currentTarget.setAttribute("aria-pressed", String(!roofVisible));
  event.currentTarget.dataset.label = roofVisible
    ? "Скрыть крышу и потолки"
    : "Показать крышу и потолки";
};
$("pins-button").onclick = (event) => {
  pinsVisible = !pinsVisible;
  noteLayer.hidden = !pinsVisible;
  event.currentTarget.classList.toggle("active", !pinsVisible);
};
$("screenshot-button").onclick = () => {
  renderer.render(scene, camera);
  const link = document.createElement("a");
  link.download = `roomark-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = renderer.domElement.toDataURL("image/png");
  link.click();
};

const fileInput = $("model-file-input"),
  dropzone = $("upload-dropzone"),
  progress = $("upload-progress"),
  progressBar = progress.firstElementChild;
const setUploadStatus = (text, error = false) => {
  $("upload-status").textContent = text;
  $("upload-status").style.color = error ? "var(--color-danger)" : "";
};
const showProgress = (value, indeterminate = false) => {
  progress.hidden = false;
  progress.classList.toggle("indeterminate", indeterminate);
  progressBar.style.width = `${value}%`;
};
function describe(file) {
  return `${file.name} — ${(file.size / 1024 / 1024).toFixed(1)} МБ`;
}
async function selectModel(file) {
  if (!file) return;
  const extension = file.name.split(".").pop().toLowerCase();
  $("upload-file-info").textContent = describe(file);
  if (["pla", "pln"].includes(extension))
    return setUploadStatus(
      "Экспортируйте проект из Archicad в IFC, затем загрузите IFC на сайт.",
      true
    );
  if (!["ifc", "glb", "gltf"].includes(extension))
    return setUploadStatus("Выберите файл IFC, GLB или GLTF.", true);
  if (extension === "gltf")
    return setUploadStatus("Для модели с отдельными ресурсами используйте единый файл GLB.", true);
  if (extension === "glb") {
    activeObjectUrl = URL.createObjectURL(file);
    window.showApartment?.();
    window.setViewerActive?.(true);
    loadModel(activeObjectUrl);
    return;
  }
  uploadIfc(file);
}
function uploadIfc(file) {
  const password = $("upload-password").value;
  if (!password) return setUploadStatus("Введите пароль для загрузки.", true);
  activeUpload = new XMLHttpRequest();
  showProgress(0);
  $("upload-cancel").hidden = false;
  setUploadStatus("Загрузка файла");
  activeUpload.open("POST", `${API_URL}/api/models`);
  activeUpload.setRequestHeader("X-Upload-Password", passwordHeader(password));
  activeUpload.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      const percent = Math.round((event.loaded / event.total) * 100);
      showProgress(percent);
      setUploadStatus(`Загрузка файла: ${percent}%`);
    }
  };
  activeUpload.onerror = () => finishUpload("Не удалось связаться с сервером конвертации.", true);
  activeUpload.onabort = () => finishUpload("Загрузка отменена.", true);
  activeUpload.onload = () => {
    if (activeUpload.status >= 200 && activeUpload.status < 300) {
      try {
        pollJob(JSON.parse(activeUpload.responseText).jobId);
      } catch {
        finishUpload("Сервер вернул некорректный ответ.", true);
      }
    } else {
      try {
        finishUpload(
          JSON.parse(activeUpload.responseText).error || "Не удалось загрузить IFC.",
          true
        );
      } catch {
        finishUpload("Не удалось загрузить IFC.", true);
      }
    }
  };
  const data = new FormData();
  data.append("model", file);
  activeUpload.send(data);
}
async function pollJob(jobId) {
  showProgress(0, true);
  const timer = setInterval(async () => {
    try {
      const response = await fetch(`${API_URL}/api/models/${encodeURIComponent(jobId)}/status`);
      const job = await response.json();
      setUploadStatus(job.stage || "Обработка IFC");
      if (job.status === "ready") {
        clearInterval(timer);
        progress.hidden = true;
        $("upload-cancel").hidden = true;
        window.showApartment?.();
        window.setViewerActive?.(true);
        loadModel(`${API_URL}${job.modelUrl}`);
      } else if (job.status === "failed") {
        clearInterval(timer);
        finishUpload(job.error || "Не удалось преобразовать IFC.", true);
      }
    } catch {
      clearInterval(timer);
      finishUpload("Не удалось получить статус обработки.", true);
    }
  }, 1000);
}
function finishUpload(message, error) {
  progress.hidden = true;
  $("upload-cancel").hidden = true;
  activeUpload = null;
  setUploadStatus(message, error);
}
$("upload-button").onclick = () => {
  fileInput.accept = ".ifc,.glb,.gltf,.pla,.pln";
  fileInput.value = "";
  fileInput.click();
};
fileInput.onchange = () => selectModel(fileInput.files[0]);
$("upload-cancel").onclick = () => activeUpload?.abort();
["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  })
);
dropzone.addEventListener("drop", (event) => selectModel(event.dataTransfer.files[0]));
$("document-glb-upload").onclick = () => {
  fileInput.accept = ".glb,model/gltf-binary";
  fileInput.value = "";
  fileInput.click();
};
$("document-ifc-upload").onclick = () => {
  fileInput.accept = ".ifc,application/octet-stream";
  fileInput.value = "";
  fileInput.click();
};

renderer.domElement.addEventListener("pointerdown", (event) => {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    (-(event.clientY - bounds.top) / bounds.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(selectable, false)[0];
  if (!hit) return roomCard.classList.remove("visible");
  const data = hit.object.userData;
  if (data.ifcType !== "IfcSpace" && !data.title && !data.area)
    return roomCard.classList.remove("visible");
  $("room-name").textContent = data.name || data.title || hit.object.name || "Помещение";
  $("room-description").textContent = [data.area && `Площадь: ${data.area} м²`, data.ifcType]
    .filter(Boolean)
    .join(". ");
  roomCard.style.left = `${event.clientX}px`;
  roomCard.style.top = `${event.clientY}px`;
  roomCard.classList.add("visible");
});
const noteLayer = document.createElement("div");
noteLayer.className = "model-note-layer";
noteLayer.hidden = pageParams.has("preview");
viewer.append(noteLayer);
let modelNotes = [];
let activeModelNoteId = null,
  draggedModelPin = null,
  draggedModelNote = null,
  draggedModelPosition = null,
  modelPinDragMoved = false;
function renderModelNotes() {
  noteLayer.innerHTML = modelNotes
    .map(
      (note, index) =>
        `<button class="model-note-pin" type="button" data-model-note="${note.id}" aria-label="Открыть замечание ${index + 1}"><span>${index + 1}</span></button>`
    )
    .join("");
  const note = modelNotes.find(({ id }) => id === activeModelNoteId);
  if (note) {
    const card = document.createElement("article"),
      text = document.createElement("p"),
      footer = document.createElement("footer"),
      date = document.createElement("small"),
      remove = document.createElement("button");
    card.className = "model-note-popover";
    text.textContent = note.text;
    date.textContent = new Date(note.createdAt).toLocaleString("ru");
    remove.type = "button";
    remove.className = "model-note-delete";
    remove.dataset.deleteModelNote = note.id;
    remove.textContent = "Удалить";
    footer.append(date, remove);
    card.append(text, footer);
    noteLayer.append(card);
  }
}
async function loadModelNotes() {
  try {
    const response = await fetch(`${API_URL}/api/notes${projectQuery}`, { cache: "no-store" });
    modelNotes = response.ok ? (await response.json()).filter((note) => note.status !== "resolved") : [];
    if (!modelNotes.some((note) => note.id === activeModelNoteId)) activeModelNoteId = null;
    renderModelNotes();
  } catch {
    modelNotes = [];
    renderModelNotes();
  }
}
noteLayer.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-delete-model-note]");
  if (remove) {
    event.stopPropagation();
    openDeletePinModal(remove.dataset.deleteModelNote);
    return;
  }
  const pin = event.target.closest("[data-model-note]");
  if (!pin) return;
  event.stopPropagation();
  if (modelPinDragMoved) {
    modelPinDragMoved = false;
    return;
  }
  activeModelNoteId = activeModelNoteId === pin.dataset.modelNote ? null : pin.dataset.modelNote;
  renderModelNotes();
  positionModelNotes();
});
noteLayer.addEventListener("pointerdown", (event) => {
  const pin = event.target.closest("[data-model-note]");
  if (!pin || event.button !== 0) return;
  draggedModelPin = pin;
  draggedModelNote = modelNotes.find((note) => note.id === pin.dataset.modelNote) || null;
  draggedModelPosition = null;
  modelPinDragMoved = false;
  pin.classList.add("dragging");
  document.body.classList.add("dragging-model-pin");
  event.preventDefault();
  event.stopPropagation();
});
document.addEventListener(
  "pointermove",
  (event) => {
    if (!draggedModelPin || !house) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(selectable.filter((object) => object.visible), false)[0];
    if (!hit) return;
    draggedModelPosition = {
      x: hit.point.x,
      y: hit.point.y,
      z: hit.point.z,
    };
    const projected = hit.point.clone().project(camera);
    draggedModelPin.style.left = `${(projected.x + 1) * 50}%`;
    draggedModelPin.style.top = `${(1 - projected.y) * 50}%`;
    modelPinDragMoved = true;
    event.preventDefault();
  },
  { passive: false }
);
document.addEventListener("pointerup", async () => {
  if (!draggedModelPin) return;
  const pin = draggedModelPin,
    note = draggedModelNote,
    position = draggedModelPosition;
  pin.classList.remove("dragging");
  document.body.classList.remove("dragging-model-pin");
  draggedModelPin = null;
  draggedModelNote = null;
  draggedModelPosition = null;
  if (!modelPinDragMoved || !note || !position) return;
  const password =
    $("pin-password").value ||
    document.getElementById("notes-password")?.value ||
    window.prompt("Введите пароль, чтобы сохранить новое положение пина:") ||
    "";
  if (!password) {
    renderModelNotes();
    return;
  }
  try {
    const response = await fetch(`${API_URL}/api/notes/${note.id}${projectQuery}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
      body: JSON.stringify({ position, coordinateSpace: "model-world-v1" }),
    });
    const updated = await response.json();
    if (!response.ok) throw new Error(updated.error || "Не удалось переместить пин.");
    modelNotes = modelNotes.map((item) => (item.id === updated.id ? updated : item));
    activeModelNoteId = updated.id;
    renderModelNotes();
    positionModelNotes();
    window.dispatchEvent(new Event("notes-changed"));
  } catch (error) {
    renderModelNotes();
    positionModelNotes();
    window.alert(error.message);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!activeModelNoteId || event.target.closest(".model-note-pin, .model-note-popover")) return;
  activeModelNoteId = null;
  renderModelNotes();
});
if (!pageParams.has("preview")) {
  loadModelNotes();
  window.addEventListener("notes-changed", loadModelNotes);
}
const pinModal = $("pin-modal"),
  pinForm = $("pin-form"),
  pinNameInput = $("pin-name"),
  pinNameField = $("pin-name-field"),
  pinPasswordInput = $("pin-password"),
  pinModalStatus = $("pin-modal-status"),
  pinSubmit = $("pin-submit"),
  pinModalTitle = $("pin-modal-title"),
  pinModalDescription = $("pin-modal-description");
let pendingPinPosition = null,
  pendingPinRoomId = null,
  pendingPinDeleteId = null;
const closePinModal = () => {
  pinModal.close();
  pendingPinPosition = null;
  pendingPinRoomId = null;
  pendingPinDeleteId = null;
  pinModalStatus.textContent = "";
};
const openDeletePinModal = (noteId) => {
  pendingPinDeleteId = noteId;
  pendingPinPosition = null;
  pinForm.reset();
  pinModalTitle.textContent = "Удалить пин?";
  pinModalDescription.textContent = "Пин и связанное с ним замечание будут удалены безвозвратно.";
  pinNameField.hidden = true;
  pinNameInput.required = false;
  pinSubmit.textContent = "Удалить пин";
  pinPasswordInput.value = document.getElementById("notes-password")?.value || "";
  pinModalStatus.textContent = "";
  pinModal.showModal();
  requestAnimationFrame(() => pinPasswordInput.focus());
};
pinModal.querySelectorAll("[data-close-pin-modal]").forEach((button) => {
  button.addEventListener("click", closePinModal);
});
pinModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closePinModal();
});
renderer.domElement.addEventListener("dblclick", async (event) => {
  if (!house || pageParams.has("preview")) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    (-(event.clientY - bounds.top) / bounds.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const isolatedRoom = isolatedRoomId ? resolveRoom(isolatedRoomId) : null,
    isolatedBounds = isolatedRoom?.boundingBox,
    hit = raycaster
      .intersectObjects(
        selectable.filter((object) => object.visible),
        false
      )
      .find(
        ({ point }) =>
          !isolatedBounds ||
          (point.x >= isolatedBounds.min.x - 0.08 &&
            point.x <= isolatedBounds.max.x + 0.08 &&
            point.z >= isolatedBounds.min.z - 0.08 &&
            point.z <= isolatedBounds.max.z + 0.08)
      );
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();

  const position = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
  pendingPinPosition = position;
  pendingPinRoomId = selectedRoomId || window.NOTE_ROOM_ID || null;
  pendingPinDeleteId = null;
  pinForm.reset();
  pinModalTitle.textContent = "Новый пин";
  pinModalDescription.textContent =
    "Добавьте название, чтобы участники проекта понимали, на что обратить внимание.";
  pinNameField.hidden = false;
  pinNameInput.required = true;
  pinSubmit.textContent = "Добавить пин";
  pinPasswordInput.value = document.getElementById("notes-password")?.value || "";
  pinModalStatus.textContent = "";
  pinModal.showModal();
  requestAnimationFrame(() => pinNameInput.focus());
});
pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if ((!pendingPinPosition && !pendingPinDeleteId) || pinSubmit.disabled) return;
  const text = pinNameInput.value.trim(),
    password = pinPasswordInput.value;
  if ((!pendingPinDeleteId && !text) || !password) {
    pinModalStatus.textContent = pendingPinDeleteId
      ? "Введите пароль."
      : "Заполните название и пароль.";
    return;
  }
  pinSubmit.disabled = true;
  pinSubmit.textContent = pendingPinDeleteId ? "Удаляем…" : "Добавляем…";
  pinModalStatus.textContent = "";
  try {
    if (pendingPinDeleteId) {
      const deletedId = pendingPinDeleteId,
        response = await fetch(`${API_URL}/api/notes/${deletedId}${projectQuery}`, {
          method: "DELETE",
          headers: { "X-Upload-Password": passwordHeader(password) },
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось удалить пин.");
      modelNotes = modelNotes.filter((note) => note.id !== deletedId);
      activeModelNoteId = null;
      renderModelNotes();
      window.dispatchEvent(new Event("notes-changed"));
      closePinModal();
      return;
    }
    const response = await fetch(`${API_URL}/api/notes${projectQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Upload-Password": passwordHeader(password) },
      body: JSON.stringify({
        text,
        roomId: pendingPinRoomId,
        position: pendingPinPosition,
        coordinateSpace: "model-world-v1",
      }),
    });
    const note = await response.json();
    if (!response.ok) throw new Error(note.error || "Не удалось добавить пин.");
    const passwordInput = document.getElementById("notes-password");
    if (passwordInput && !passwordInput.value) passwordInput.value = password;
    modelNotes.push(note);
    activeModelNoteId = note.id;
    pinsVisible = true;
    noteLayer.hidden = false;
    $("pins-button").classList.remove("active");
    renderModelNotes();
    positionModelNotes();
    window.dispatchEvent(new Event("notes-changed"));
    closePinModal();
  } catch (error) {
    pinModalStatus.textContent = error.message;
    pinPasswordInput.select();
  } finally {
    pinSubmit.disabled = false;
    if (pinModal.open)
      pinSubmit.textContent = pendingPinDeleteId ? "Удалить пин" : "Добавить пин";
  }
});
function resolveRoom(roomKey) {
  if (!roomsAnalysis?.success) return null;
  const key = String(roomKey || "").toLowerCase(),
    aliases = {
      kitchen: /kitchen|living|кух|гостин/i,
      bedroom: /bed|спаль/i,
      bathroom: /bath|wc|сануз|ванн/i,
      hall: /hall|corridor|прихож|коридор/i,
      terrace: /terrace|balcony|террас|балкон/i,
    };
  return (
    roomsAnalysis.rooms.find(
      (room) => room.id === roomKey || room.type === roomKey || room.name.toLowerCase() === key
    ) || roomsAnalysis.rooms.find((room) => aliases[key]?.test(`${room.type} ${room.name}`))
  );
}
let selectedRoomId = null,
  isolatedRoomId = null;
const roomIsolationMaterials = new Set();
renderer.localClippingEnabled = true;
const clearRoomClipping = () => {
  roomIsolationMaterials.forEach((material) => {
    material.clippingPlanes = null;
    material.clipShadows = false;
    material.needsUpdate = true;
  });
  roomIsolationMaterials.clear();
};
const applyRoomClipping = (room) => {
  if (!room.boundingBox) return false;
  const padding = 0.08,
    { min, max } = room.boundingBox,
    planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -min.x + padding),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), max.x + padding),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -min.z + padding),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), max.z + padding),
    ];
  house.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      material.clippingPlanes = planes;
      material.clipShadows = true;
      material.needsUpdate = true;
      roomIsolationMaterials.add(material);
    }
  });
  return true;
};
const syncIsolateButton = () => {
  const button = $("isolate-button");
  if (!button) return;
  const active = Boolean(selectedRoomId && isolatedRoomId === selectedRoomId);
  button.disabled = !selectedRoomId;
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  button.dataset.label = active ? "Показать все комнаты" : "Оставить выбранную комнату";
  button.setAttribute(
    "aria-label",
    active ? "Показать все комнаты" : "Скрыть все комнаты, кроме выбранной"
  );
};
const isWallMesh = (object) =>
  Boolean(
    object?.isMesh &&
      (object.userData.resolvedType === "wall" ||
        object.userData.ifcType === "IfcWall" ||
        object.userData.ifcType === "IfcWallStandardCase" ||
        /wall|стена|перегород/i.test(object.name) ||
        isVerticalOccluder(object))
  );
const isRoofMesh = (object) => {
  if (!object?.isMesh) return false;
  if (object.userData.roomarkRoof !== undefined) return object.userData.roomarkRoof;
  const metadataMatch =
    object.userData.resolvedType === "roof" ||
    object.userData.resolvedType === "ceiling" ||
    object.userData.ifcType === "IfcRoof" ||
    /roof|ceiling|крыш|кровл|потол/i.test(object.name);
  if (metadataMatch) return (object.userData.roomarkRoof = true);
  if (!house || !["floor", "ceiling", "other"].includes(object.userData.resolvedType))
    return (object.userData.roomarkRoof = false);
  object.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(object),
    modelBox = new THREE.Box3().setFromObject(house);
  if (box.isEmpty() || modelBox.isEmpty()) return (object.userData.roomarkRoof = false);
  const size = box.getSize(new THREE.Vector3()),
    modelSize = modelBox.getSize(new THREE.Vector3());
  return (object.userData.roomarkRoof =
    size.y <= 1 &&
    box.max.y >= modelBox.max.y - Math.max(0.15, modelSize.y * 0.04) &&
    size.x >= Math.max(2, modelSize.x * 0.35) &&
    size.z >= Math.max(2, modelSize.z * 0.35));
};
function isVerticalOccluder(object) {
  if (object.userData.roomarkVerticalOccluder !== undefined)
    return object.userData.roomarkVerticalOccluder;
  if (["door", "window", "space"].includes(object.userData.resolvedType))
    return (object.userData.roomarkVerticalOccluder = false);
  object.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return (object.userData.roomarkVerticalOccluder = false);
  const size = box.getSize(new THREE.Vector3()),
    horizontal = [size.x, size.z].sort((a, b) => a - b),
    thickness = horizontal[0],
    length = horizontal[1];
  return (object.userData.roomarkVerticalOccluder =
    size.y >= 1.7 && thickness <= 0.85 && length >= 1.5);
}
window.getWallMeshDebug = () => {
  const result = [];
  house?.traverse((object) => {
    if (!isWallMesh(object)) return;
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    result.push({
      name: object.name,
      resolvedType: object.userData.resolvedType,
      size: [size.x, size.y, size.z].map((value) => Number(value.toFixed(2))),
      visible: object.visible,
    });
  });
  return result;
};
const roomAllowsMesh = () => true;
window.showAllRooms = () => {
  if (!house) return;
  clearRoomClipping();
  isolatedRoomId = null;
  selectedRoomId = null;
  house.traverse((object) => {
    if (object.isMesh)
      object.visible =
        object.userData.roomAnalyzerVisible !== false &&
        (wallsVisible || !isWallMesh(object)) &&
        (roofVisible || !isRoofMesh(object));
  });
  if (roomHighlight) roomHighlight.visible = false;
  roomHighlightFade = null;
  syncIsolateButton();
};
window.showRoom = (roomKey) => {
  const room = resolveRoom(roomKey);
  if (!house || !room) return false;
  clearRoomClipping();
  isolatedRoomId = null;
  selectedRoomId = room.id;
  house.traverse((object) => {
    if (!object.isMesh) return;
    if (object.userData.roomAnalyzerVisible === undefined)
      object.userData.roomAnalyzerVisible = object.visible;
    object.visible =
      object.userData.resolvedType !== "space" &&
      object.userData.roomAnalyzerVisible !== false &&
      (wallsVisible || !isWallMesh(object)) &&
      (roofVisible || !isRoofMesh(object));
  });
  window.highlightRoom(room.id);
  syncIsolateButton();
  return true;
};
window.isolateRoom = (roomKey) => {
  const room = resolveRoom(roomKey);
  if (!house || !room) return false;
  isolatedRoomId = room.id;
  selectedRoomId = room.id;
  clearRoomClipping();
  house.traverse((object) => {
    if (!object.isMesh) return;
    object.visible =
      object.userData.resolvedType !== "space" &&
      object.userData.roomAnalyzerVisible !== false &&
      (wallsVisible || !isWallMesh(object)) &&
      (roofVisible || !isRoofMesh(object));
  });
  if (!applyRoomClipping(room)) return false;
  window.highlightRoom(room.id);
  syncIsolateButton();
  return true;
};
$("isolate-button").onclick = () => {
  if (!selectedRoomId) return;
  if (isolatedRoomId === selectedRoomId) window.showRoom(selectedRoomId);
  else window.isolateRoom(selectedRoomId);
};
window.focusRoom = (roomKey) => {
  const room = resolveRoom(roomKey);
  if (!house) return;
  if (!room) return animate(originalPosition, originalTarget);
  if (!room.boundingBox) return animate(originalPosition, originalTarget);
  const min = new THREE.Vector3(room.boundingBox.min.x, room.floorY, room.boundingBox.min.z),
    max = new THREE.Vector3(room.boundingBox.max.x, room.ceilingY, room.boundingBox.max.z),
    box = new THREE.Box3(min, max),
    size = box.getSize(new THREE.Vector3()),
    target = box.getCenter(new THREE.Vector3()),
    fov = THREE.MathUtils.degToRad(camera.fov),
    fitHeight = size.y / (2 * Math.tan(fov / 2)),
    fitWidth = size.x / (2 * Math.tan(fov / 2) * camera.aspect),
    distance = Math.max(fitHeight, fitWidth, size.z) * 1.45,
    direction = new THREE.Vector3(1, 0, 1).normalize(),
    position = target.clone().addScaledVector(direction, distance);
  target.y = min.y + Math.min(0.65, size.y * 0.24);
  position.y = min.y + Math.min(1.35, size.y * 0.5);
  animate(position, target, 1300);
};
window.highlightRoom = (roomKey) => {
  const room = resolveRoom(roomKey);
  if (!room) return false;
  if (roomHighlight) {
    scene.remove(roomHighlight);
    roomHighlight.geometry.dispose();
    roomHighlight.material.dispose();
  }
  if (!room.polygon && !room.boundingBox) return false;
  const points = room.polygon || [
    [room.boundingBox.min.x, room.boundingBox.min.z],
    [room.boundingBox.max.x, room.boundingBox.min.z],
    [room.boundingBox.max.x, room.boundingBox.max.z],
    [room.boundingBox.min.x, room.boundingBox.max.z],
  ];
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  roomHighlight = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: 0xf2a31b,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  roomHighlight.rotation.x = Math.PI / 2;
  roomHighlight.position.y = room.floorY + 0.025;
  roomHighlight.name = `RoomHighlight_${room.id}`;
  scene.add(roomHighlight);
  roomHighlightFade = {
    start: performance.now() + 450,
    duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400,
    opacity: roomHighlight.material.opacity,
  };
  return true;
};
addEventListener("resize", () => {
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight, false);
});
function positionModelNotes() {
  if (!house || !pinsVisible) return;
  const card = noteLayer.querySelector(".model-note-popover"),
    box = new THREE.Box3().setFromObject(house),
    size = box.getSize(new THREE.Vector3());
  [...noteLayer.querySelectorAll("[data-model-note]")].forEach((pin, index) => {
    const note = modelNotes[index],
      position = note?.position || { x: 0.5, y: 0.55, z: 0.5 },
      point = (note?.coordinateSpace === "model-world-v1"
        ? new THREE.Vector3(position.x, position.y, position.z)
        : new THREE.Vector3(
            box.min.x + size.x * position.x,
            box.min.y + size.y * position.y,
            box.min.z + size.z * position.z
          )
      ).project(camera);
    const visible = point.z > -1 && point.z < 1;
    pin.hidden = !visible;
    pin.style.left = `${(point.x + 1) * 50}%`;
    pin.style.top = `${(1 - point.y) * 50}%`;
    if (card && note.id === activeModelNoteId) {
      card.hidden = !visible;
      card.style.left = pin.style.left;
      card.style.top = pin.style.top;
    }
  });
}
function render() {
  if (!viewerActive) return;
  animationFrame = requestAnimationFrame(render);
  if (mixer) mixer.update(clock.getDelta());
  if (cameraAnimation) {
    const progress = Math.min(
        (performance.now() - cameraAnimation.start) / cameraAnimation.duration,
        1
      ),
      eased = 1 - (1 - progress) ** 3;
    camera.position.lerpVectors(cameraAnimation.from, cameraAnimation.to, eased);
    controls.target.lerpVectors(cameraAnimation.fromTarget, cameraAnimation.toTarget, eased);
    if (progress === 1) cameraAnimation = null;
  }
  if (roomHighlight?.visible && roomHighlightFade) {
    const elapsed = performance.now() - roomHighlightFade.start;
    if (elapsed >= 0) {
      const progress = roomHighlightFade.duration
        ? Math.min(elapsed / roomHighlightFade.duration, 1)
        : 1;
      roomHighlight.material.opacity = roomHighlightFade.opacity * (1 - progress) ** 2;
      if (progress === 1) {
        roomHighlight.visible = false;
        roomHighlightFade = null;
      }
    }
  }
  controls.update();
  renderer.render(scene, camera);
  positionModelNotes();
}
window.setViewerActive = (active) => {
  if (viewerActive === active) return;
  viewerActive = active;
  if (!active) {
    cancelAnimationFrame(animationFrame);
    controls.autoRotate = false;
    clock.stop();
    return;
  }
  requestInitialModel();
  clock.start();
  window.dispatchEvent(new Event("resize"));
  render();
};
if (viewerActive) render();
