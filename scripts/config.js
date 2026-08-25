(() => {
  // For a separate production API, define window.ROOMARK_API_URL before this script.
  // Empty means same-origin, which is ideal for local Nginx and reverse-proxy deployments.
  const configured = String(window.ROOMARK_API_URL || window.HOUSE_REVIEWER_API_URL || "").replace(
    /\/$/,
    ""
  );
  const brand = Object.freeze({
    name: "Roomark",
    logoText: "R",
    logoUrl: "./images/roomark-logo.png",
    accentColor: "#EFA321",
    defaultTheme: "light",
  });
  window.HouseConfig = Object.freeze({ apiBaseUrl: configured || location.origin, brand });
})();
