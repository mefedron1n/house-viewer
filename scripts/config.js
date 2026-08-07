(() => {
  // For a separate production API, define window.HOUSE_REVIEWER_API_URL before this script.
  // Empty means same-origin, which is ideal for local Nginx and reverse-proxy deployments.
  const configured = String(window.HOUSE_REVIEWER_API_URL || "").replace(/\/$/, "");
  const brand = Object.freeze({ name: "House Reviewer", logoText: "H", accentColor: "#EFA321", defaultTheme: "light" });
  window.HouseConfig = Object.freeze({ apiBaseUrl: configured || location.origin, brand });
})();
