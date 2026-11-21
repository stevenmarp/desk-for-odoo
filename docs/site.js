(() => {
  const themes = ["system", "light", "dark"];
  const themeButton = document.getElementById("theme-toggle");
  const readTheme = () => {
    try {
      const saved = localStorage.getItem("desk-theme");
      return themes.includes(saved) ? saved : "system";
    } catch (_) { return "system"; }
  };
  const applyTheme = (theme) => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("desk-theme", theme); } catch (_) { /* System fallback still works. */ }
    const label = theme[0].toUpperCase() + theme.slice(1);
    themeButton.querySelector("[data-theme-label]").textContent = label;
    themeButton.setAttribute("aria-label", `Appearance: ${label}`);
    themeButton.title = `Appearance: ${label}`;
  };
  applyTheme(readTheme());
  themeButton.addEventListener("click", () => {
    const current = readTheme();
    applyTheme(themes[(themes.indexOf(current) + 1) % themes.length]);
  });

  const platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent).toLowerCase();
  const os = platform.includes("win") ? ".exe" : platform.includes("mac") ? ".dmg" : platform.includes("linux") && !/android/.test(navigator.userAgent.toLowerCase()) ? ".AppImage" : "";
  const names = { ".exe": "Windows", ".dmg": "macOS", ".AppImage": "Linux" };
  const cta = document.getElementById("cta-download");
  const cards = [...document.querySelectorAll("[data-asset]")];
  const mine = cards.find((card) => card.dataset.asset === os);
  if (mine) {
    mine.classList.add("mine");
    cta.textContent = `Download for ${names[os]}`;
  }
  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  fetch("https://api.github.com/repos/stevenmarp/desk-for-odoo/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((release) => {
      document.querySelectorAll("[data-version]").forEach((node) => { node.textContent = release.tag_name.replace(/^v/, ""); });
      for (const card of cards) {
        const asset = release.assets.find((item) => item.name.endsWith(card.dataset.asset));
        if (!asset) continue;
        card.href = asset.browser_download_url;
        card.querySelector("[data-file]").textContent = `${asset.name}, ${mb(asset.size)}`;
        if (card === mine) cta.href = asset.browser_download_url;
      }
    })
    .catch(() => {});
})();
