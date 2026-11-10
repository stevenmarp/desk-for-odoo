const { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } = require("electron");
const path = require("node:path");
const { Core } = require("./lib/core");

const workspace = process.env.DESK_WORKSPACE || path.join(app.getPath("userData"), "workspace");
if (process.env.DESK_WORKSPACE) app.setPath("userData", path.join(workspace, ".electron"));

const STORE = "https://apps.odoo.com/apps/modules/browse?order=Purchases&repo_maintainer_id=512936";
const LINKS = {
  store: "https://apps.odoo.com/apps/modules/browse?order=Newest&repo_maintainer_id=512936",
  saweria: "https://saweria.co/Stevenmarp",
  repo: "https://github.com/stevenmarp/desk-for-odoo",
};
const OPEN_ALLOWED = [/^https:\/\/apps\.odoo\.com\//, /^https:\/\/github\.com\//, /^https:\/\/saweria\.co\//];
const storeCache = new Map();

let win;
let core;

const decode = (text) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function storeApps(series) {
  const key = String(series);
  const cached = storeCache.get(key);
  if (cached && Date.now() - cached.at < 3600000) return cached.apps;
  const response = await fetch(`${STORE}&series=${encodeURIComponent(key)}.0`, { headers: { "User-Agent": "Desk for Odoo" } });
  if (!response.ok) throw new Error(`The Odoo Apps store answered ${response.status}`);
  const html = await response.text();
  const apps = html.split("loempia_app_card").slice(1).map((card) => {
    const pick = (re) => ((card.match(re) || [])[1] || "").trim();
    const href = pick(/<a href="(\/apps\/(?:modules|themes)\/[^"]+)"/);
    const sold = card.match(/Total Purchases: (\d+), Last month: (\d+)/);
    return {
      url: href ? `https://apps.odoo.com${href}` : "",
      name: decode(pick(/<h5 title="([^"]*)"/)),
      summary: decode(pick(/loempia_panel_summary">([^<]*)</)),
      image: pick(/background-image: url\((\/\/apps\.odoocdn\.com\/[^)]+)\)/).replace(/^\/\//, "https://"),
      price: pick(/oe_currency_value">([\d.,]+)</),
      purchases: sold ? Number(sold[1]) : 0,
    };
  }).filter((item) => item.url && item.name);
  storeCache.set(key, { at: Date.now(), apps });
  return apps;
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function pgSettings() {
  const pg = { ...core.state.settings.pg };
  if (pg.passwordEnc && safeStorage.isEncryptionAvailable()) {
    pg.password = safeStorage.decryptString(Buffer.from(pg.passwordEnc, "base64"));
  }
  delete pg.passwordEnc;
  return pg;
}

function publicSettings() {
  const { pg, theme } = core.state.settings;
  return { theme, workspace, pg: { host: pg.host, port: pg.port, user: pg.user, hasPassword: Boolean(pg.password || pg.passwordEnc) } };
}

function saveSettings(data) {
  const settings = core.state.settings;
  if (data.theme) settings.theme = data.theme;
  if (data.pg) {
    settings.pg.host = data.pg.host || "localhost";
    settings.pg.port = Number(data.pg.port) || 5432;
    settings.pg.user = data.pg.user || "odoo";
    if (typeof data.pg.password === "string" && data.pg.password !== "") {
      if (safeStorage.isEncryptionAvailable()) {
        settings.pg.passwordEnc = safeStorage.encryptString(data.pg.password).toString("base64");
        settings.pg.password = "";
      } else {
        settings.pg.password = data.pg.password;
      }
    }
  }
  core.save();
  nativeTheme.themeSource = settings.theme;
  return publicSettings();
}

const handlers = {
  "settings:get": () => publicSettings(),
  "settings:save": (data) => saveSettings(data),
  "settings:testPostgres": (data) => core.testPostgres({ ...pgSettings(), ...(data || {}), password: (data && data.password) || pgSettings().password }),
  "instances:list": () => core.list(),
  "instances:add": (data) => core.addInstance(data),
  "instances:update": ({ id, data }) => core.updateInstance(id, data),
  "instances:remove": (id) => core.removeInstance(id),
  "instances:detectSource": (folder) => core.detectSource(folder),
  "instances:pythons": () => core.detectPythons(),
  "instances:pythonMissing": (python) => core.pythonMissing(python),
  "instances:createVenv": ({ id, python }) => core.createVenv(id, python),
  "instances:download": ({ version, enterprise, token }) => {
    const run = core.download(version, { enterprise, token });
    return run.done.then(() => run.folder);
  },
  "server:start": (id) => core.start(id, pgSettings()),
  "server:stop": (id) => core.stop(id).then(() => core.view(core.instance(id))),
  "server:logs": (id) => core.logs(id),
  "server:open": ({ id, db }) => {
    const inst = core.instance(id);
    return shell.openExternal(`http://localhost:${inst.port}/web${db ? `?db=${encodeURIComponent(db)}` : ""}`);
  },
  "db:list": (id) => core.databases(pgSettings(), core.instance(id).version, core.instance(id).databases),
  "db:attach": ({ id, db, on }) => core.attach(id, pgSettings(), db, on !== false),
  "db:create": ({ id, data }) => core.createDb(id, pgSettings(), data),
  "db:reset": ({ id, db, password, login }) => core.resetAdmin(id, pgSettings(), db, password, login),
  "db:action": ({ id, action, data }) => core.dbCommand(id, pgSettings(), action, data),
  "modules:list": ({ id, db }) => core.modules(id, pgSettings(), db),
  "modules:action": ({ id, db, action, names }) => core.moduleAction(id, pgSettings(), db, action, names),
  "task:cancel": (taskId) => core.cancelTask(taskId),
  "dialog:folder": async (title) => {
    const result = await dialog.showOpenDialog(win, { title, properties: ["openDirectory"] });
    return result.canceled ? "" : result.filePaths[0];
  },
  "dialog:file": async (title) => {
    const result = await dialog.showOpenDialog(win, { title, properties: ["openFile"], filters: [{ name: "Odoo backup", extensions: ["zip", "dump", "sql"] }, { name: "Python", extensions: ["*"] }] });
    return result.canceled ? "" : result.filePaths[0];
  },
  "store:apps": (series) => storeApps(series),
  "store:links": () => LINKS,
  "shell:openUrl": (url) => {
    if (!OPEN_ALLOWED.some((re) => re.test(url))) throw new Error("This link is not allowed");
    return shell.openExternal(url);
  },
  "shell:showItem": (file) => shell.showItemInFolder(file),
  "shell:openFolder": (folder) => shell.openPath(folder),
};

for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, value: await handler(payload) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "Desk for Odoo",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#10151f" : "#f5f7fa",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, "src", "index.html"));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => app.quit());

app.whenReady().then(() => {
  core = new Core(workspace, send);
  nativeTheme.themeSource = core.state.settings.theme;
  createWindow();
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !core || !core.servers.size) return;
  event.preventDefault();
  quitting = true;
  core.stopAll().finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());
