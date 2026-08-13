(() => {
  const id = new URLSearchParams(location.search).get("project");
  if (!id) return;
  const API = window.HouseConfig?.apiBaseUrl || location.origin;
  fetch(`${API}/api/projects/${encodeURIComponent(id)}`, { credentials: "include" }).then(async (response) => {
    if (!response.ok) return;
    const project = await response.json(), card = document.querySelector(".project-card");
    document.title = `${project.name} — Roomark`;
    const headerName = document.querySelector("#header-project-name"); if (headerName) headerName.textContent = project.name;
    card.querySelector("small").textContent = "Проект Roomark";
    card.querySelector("h1").textContent = project.name;
    card.querySelector(".project-meta").innerHTML = `<span>${project.area} м²</span><span>${project.rooms} помещений</span>`;
    card.querySelector(".updated").textContent = `Обновлено ${new Date(project.updatedAt).toLocaleDateString("ru")}`;
  }).catch(() => {});
})();
