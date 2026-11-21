(() => {
  try {
    const theme = localStorage.getItem("desk-theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  } catch (_) {
    // Storage can be unavailable in privacy modes; System remains the safe default.
  }
})();
