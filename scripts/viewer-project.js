(() => {
  const id = new URLSearchParams(location.search).get("project");
  if (!id) return;
  const API = window.HouseConfig?.apiBaseUrl || location.origin;
  fetch(`${API}/api/projects/${encodeURIComponent(id)}`, { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) return;
      const project = await response.json();
      document.title = `${project.name} — Roomark`;
      const headerName = document.querySelector("#header-project-name");
      if (headerName) headerName.textContent = project.name;
    })
    .catch(() => {});
})();
