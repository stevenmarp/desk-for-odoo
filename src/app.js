const api = window.desk;
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const size = (bytes) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
const STATUS = { running: "Running", starting: "Starting", stopping: "Stopping", stopped: "Stopped" };
const TABS = ["overview", "logs", "databases", "modules", "settings"];

const state = { view: "instance", storeSeries: "19", instances: [], current: null, tab: "overview", logs: {}, logFilter: "all", logSearch: "", follow: true, dbs: {}, modules: {}, moduleDb: {}, moduleFilter: "all", moduleSearch: "", settings: null };

function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  $("#toasts").append(node);
  setTimeout(() => node.remove(), kind === "err" ? 9000 : 4500);
}

async function run(work, success) {
  try {
    const value = await work();
    if (success) toast(typeof success === "function" ? success(value) : success);
    return value;
  } catch (error) {
    toast(error.message, "err");
    return undefined;
  }
}

function current() {
  return state.instances.find((inst) => inst.id === state.current);
}

function editionLabel(inst) {
  return inst.edition === "enterprise" ? "Enterprise" : "Community";
}

function renderSidebar() {
  const list = $("#instance-list");
  if (!state.instances.length) {
    list.innerHTML = `<p class="muted" style="padding:8px 10px">No instance yet.</p>`;
    return;
  }
  list.innerHTML = state.instances.map((inst) => `
    <button class="inst-item" data-id="${esc(inst.id)}" aria-current="${state.view === "instance" && inst.id === state.current}">
      <span class="dot ${esc(inst.status)}" aria-hidden="true"></span>
      <span><span class="inst-name">${esc(inst.name)}</span><span class="inst-sub">${esc(STATUS[inst.status])}${inst.status === "running" ? ` on ${inst.port}` : ""}</span></span>
      <span class="badge ${inst.edition === "enterprise" ? "ee" : ""}">${esc(inst.version)}</span>
    </button>`).join("");
}

function renderWelcome() {
  $("#main").innerHTML = `
    <div class="welcome">
      <h1>Run Odoo on this computer</h1>
      <p>Add Odoo 18, 19 or 20, Community or Enterprise. Desk for Odoo downloads the source, prepares Python, and gives you the server, its logs, your databases and modules in one window.</p>
      <button class="btn primary" id="welcome-add">${icon("plus")} Add an Odoo instance</button>
    </div>`;
  $("#welcome-add").onclick = () => addInstanceDialog();
}

function renderMain() {
  $("#open-store").setAttribute("aria-current", state.view === "store");
  if (state.view === "store") return renderStore();
  const inst = current();
  if (!inst) return renderWelcome();
  const running = inst.status === "running" || inst.status === "starting";
  const busy = inst.status === "starting" || inst.status === "stopping";
  const counts = inst.counts || { WARNING: 0, ERROR: 0 };
  const logCount = logBadge(counts);
  $("#main").innerHTML = `
    <header class="head">
      <div class="head-row">
        <div>
          <h1>${esc(inst.name)} <span class="badge">Odoo ${esc(inst.version)}</span> <span class="badge ${inst.edition === "enterprise" ? "ee" : ""}">${editionLabel(inst)}</span></h1>
          <div class="status-line"><span class="dot ${esc(inst.status)}" aria-hidden="true"></span>${esc(STATUS[inst.status])}${running ? ` on <span class="mono">localhost:${inst.port}</span>` : ""}</div>
        </div>
        <div class="actions">
          <button class="btn" id="open-browser" ${inst.status === "running" ? "" : "disabled"}>${icon("external")} Open in browser</button>
          ${running ? `<button class="btn danger" id="stop" ${busy && inst.status === "stopping" ? "disabled" : ""}>${icon("stop")} Stop</button>`
            : `<button class="btn primary" id="start" ${busy ? "disabled" : ""}>${icon("play")} Start</button>`}
        </div>
      </div>
      <div class="tabs" role="tablist" aria-label="Instance">
        ${TABS.map((tab) => `<button class="tab" role="tab" id="tab-${tab}" aria-selected="${state.tab === tab}" tabindex="${state.tab === tab ? 0 : -1}" data-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}${tab === "logs" ? logCount : ""}</button>`).join("")}
      </div>
    </header>
    <section class="body" role="tabpanel" aria-labelledby="tab-${state.tab}" id="panel"></section>`;
  $("#start") && ($("#start").onclick = () => run(() => api.call("server:start", inst.id)).then(refresh));
  $("#stop") && ($("#stop").onclick = () => run(() => api.call("server:stop", inst.id)).then(refresh));
  $("#open-browser").onclick = () => api.call("server:open", { id: inst.id });
  document.querySelectorAll(".tab").forEach((button) => {
    button.onclick = () => selectTab(button.dataset.tab);
    button.onkeydown = (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = TABS[(TABS.indexOf(state.tab) + step + TABS.length) % TABS.length];
      selectTab(next);
      $(`#tab-${next}`).focus();
    };
  });
  renderPanel();
}

function logBadge(counts) {
  if (counts.ERROR) return `<span class="count err" title="${counts.ERROR} errors">${counts.ERROR}</span>`;
  if (counts.WARNING) return `<span class="count warn" title="${counts.WARNING} warnings">${counts.WARNING}</span>`;
  return "";
}

function selectTab(tab) {
  state.tab = tab;
  renderMain();
}

function renderPanel() {
  const inst = current();
  const panel = $("#panel");
  if (!inst || !panel) return;
  ({ overview: renderOverview, logs: renderLogs, databases: renderDatabases, modules: renderModules, settings: renderInstanceSettings })[state.tab](inst, panel);
}

function shortPath(file) {
  const ws = state.settings.workspace;
  return file && ws && file.startsWith(ws) && file.length > ws.length ? file.slice(ws.length + 1) : file;
}

function pathButton(file, folder = false) {
  return `<button class="path-btn" data-path="${esc(file)}" data-folder="${folder}" title="${esc(file)}">${esc(shortPath(file))}</button>`;
}

function bindPaths(root) {
  root.querySelectorAll(".path-btn").forEach((button) => {
    button.onclick = () => api.call(button.dataset.folder === "true" ? "shell:openFolder" : "shell:showItem", button.dataset.path);
  });
}

async function renderOverview(inst, panel) {
  const ws = state.settings.workspace;
  const sep = ws.includes("\\") ? "\\" : "/";
  const base = [ws, "instances", inst.id].join(sep);
  panel.innerHTML = `
    <div class="grid">
      <div class="card">
        <h2>Server</h2>
        <dl class="facts">
          <dt>Address</dt><dd class="mono">http://localhost:${inst.port}</dd>
          <dt>Status</dt><dd>${esc(STATUS[inst.status])}</dd>
          <dt>Warnings</dt><dd>${inst.counts.WARNING}</dd>
          <dt>Errors</dt><dd>${inst.counts.ERROR}</dd>
          <dt>Master password</dt><dd><span class="mono" id="master" data-value="${esc(inst.masterPassword)}">••••••••••••</span> <button class="btn small" id="show-master">Show</button></dd>
        </dl>
      </div>
      <div class="card">
        <h2>Source</h2>
        <dl class="facts">
          <dt>Odoo</dt><dd>${pathButton(inst.odooPath, true)}</dd>
          ${inst.edition === "enterprise" ? `<dt>Enterprise</dt><dd>${pathButton(inst.enterprisePath, true)}</dd>` : ""}
          ${inst.addons.map((dir) => `<dt>Addons</dt><dd>${pathButton(dir, true)}</dd>`).join("")}
          <dt>Python</dt><dd class="mono" title="${esc(inst.python)}">${esc(shortPath(inst.python))}</dd>
        </dl>
        <div id="python-check"></div>
      </div>
      <div class="card">
        <h2>Files on disk</h2>
        <dl class="facts">
          <dt>Configuration</dt><dd>${pathButton(base + sep + "odoo.conf")}</dd>
          <dt>Filestore</dt><dd>${pathButton(base + sep + "data", true)}</dd>
          <dt>Log file</dt><dd>${pathButton(base + sep + "odoo.log")}</dd>
          <dt>Backups</dt><dd>${pathButton(ws + sep + "backups", true)}</dd>
        </dl>
      </div>
    </div>`;
  bindPaths(panel);
  $("#show-master").onclick = (event) => {
    const node = $("#master");
    const shown = node.textContent !== "••••••••••••";
    node.textContent = shown ? "••••••••••••" : node.dataset.value;
    event.target.textContent = shown ? "Show" : "Hide";
  };
  const missing = await api.call("instances:pythonMissing", inst.python).catch(() => null);
  const box = $("#python-check");
  if (!box) return;
  if (missing === null) box.innerHTML = `<div class="note err">${icon("alert")} This Python cannot be started. Choose another one in Settings.</div>`;
  else if (missing.length) {
    box.innerHTML = `<div class="note">${icon("alert")}<div>Missing Python packages: <span class="mono">${esc(missing.join(", "))}</span>.<br><button class="btn small" id="make-venv" style="margin-top:8px">Create a Python environment with the Odoo requirements</button></div></div>`;
    $("#make-venv").onclick = () => venvDialog(inst);
  } else {
    box.innerHTML = `<p class="muted" style="margin:14px 0 8px">${icon("check")} The Python packages Odoo needs are installed.</p><button class="btn small" id="make-venv">New Python environment</button>`;
    $("#make-venv").onclick = () => venvDialog(inst);
  }
}

function logLine(entry) {
  const level = entry.level || (entry.line.startsWith("Desk:") ? "desk" : "");
  return `<span class="l-${esc(level)}">${esc(entry.line)}</span>`;
}

function logVisible(entry) {
  if (state.logFilter === "warnings" && !["WARNING", "ERROR", "CRITICAL"].includes(entry.level)) return false;
  if (state.logFilter === "errors" && !["ERROR", "CRITICAL"].includes(entry.level)) return false;
  return !state.logSearch || entry.line.toLowerCase().includes(state.logSearch);
}

async function renderLogs(inst, panel) {
  if (!state.logs[inst.id]) state.logs[inst.id] = await api.call("server:logs", inst.id);
  panel.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Level">
        ${[["all", "All"], ["warnings", "Warnings and errors"], ["errors", "Errors"]].map(([key, label]) => `<button data-filter="${key}" aria-pressed="${state.logFilter === key}">${label}</button>`).join("")}
      </div>
      <input class="input grow" id="log-search" type="search" placeholder="Search the log" aria-label="Search the log" value="${esc(state.logSearch)}">
      <label class="check"><input type="checkbox" id="log-follow" ${state.follow ? "checked" : ""}> Follow</label>
      <button class="btn small" id="log-clear">Clear view</button>
    </div>
    <pre class="log" id="log" tabindex="0" aria-label="Server log"></pre>`;
  const lines = state.logs[inst.id].filter(logVisible).slice(-3000);
  $("#log").innerHTML = lines.length ? lines.map(logLine).join("") : `<span class="l-desk">No log yet. Start the server to see it here.</span>`;
  if (state.follow) $("#log").scrollTop = $("#log").scrollHeight;
  panel.querySelectorAll("[data-filter]").forEach((button) => {
    button.onclick = () => { state.logFilter = button.dataset.filter; renderLogs(inst, panel); };
  });
  $("#log-search").oninput = (event) => {
    state.logSearch = event.target.value.toLowerCase();
    const filtered = state.logs[inst.id].filter(logVisible).slice(-3000);
    $("#log").innerHTML = filtered.map(logLine).join("");
  };
  $("#log-follow").onchange = (event) => { state.follow = event.target.checked; };
  $("#log-clear").onclick = () => { state.logs[inst.id] = []; $("#log").innerHTML = ""; };
}

function appendLog(entry) {
  const list = (state.logs[entry.id] = state.logs[entry.id] || []);
  list.push(entry);
  if (list.length > 5000) list.splice(0, list.length - 5000);
  const inst = state.instances.find((item) => item.id === entry.id);
  if (inst) inst.counts = entry.counts;
  if (entry.id === state.current && state.view === "instance" && (entry.level === "WARNING" || entry.level === "ERROR" || entry.level === "CRITICAL")) {
    const tab = $("#tab-logs");
    if (tab) tab.innerHTML = `Logs${logBadge(entry.counts)}`;
  }
  if (entry.id !== state.current || state.tab !== "logs" || !logVisible(entry)) return;
  const node = $("#log");
  if (!node) return;
  node.insertAdjacentHTML("beforeend", logLine(entry));
  while (node.childElementCount > 3000) node.firstElementChild.remove();
  if (state.follow) node.scrollTop = node.scrollHeight;
}

async function loadDbs(inst) {
  state.dbs[inst.id] = await api.call("db:list", inst.id);
}

async function renderDatabases(inst, panel) {
  panel.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="db-new">${icon("plus")} New database</button>
      <button class="btn" id="db-restore">${icon("upload")} Restore a backup</button>
      <span class="grow"></span>
      <button class="btn" id="db-refresh">${icon("refresh")} Refresh</button>
    </div>
    <div id="db-table"><p class="muted">Reading databases…</p></div>`;
  $("#db-new").onclick = () => createDbDialog(inst);
  $("#db-restore").onclick = () => restoreDialog(inst);
  $("#db-refresh").onclick = async () => { await run(() => loadDbs(inst)); renderDatabases(inst, panel); };
  if (!state.dbs[inst.id]) {
    const ok = await run(() => loadDbs(inst));
    if (ok === undefined && !state.dbs[inst.id]) {
      $("#db-table").innerHTML = `<div class="note err">${icon("alert")} Cannot reach PostgreSQL. Check the connection in Settings.</div>`;
      return;
    }
  }
  if (state.current !== inst.id || state.tab !== "databases") return;
  const all = state.dbs[inst.id];
  const dbs = all.filter((db) => db.attached);
  const others = all.filter((db) => !db.attached);
  $("#db-table").innerHTML = (!dbs.length ? `<div class="card empty">No database in this instance yet: create one, restore a backup or attach one below.</div>` : `
    <table class="list">
      <thead><tr><th>Database</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${dbs.map((db) => `
        <tr data-db="${esc(db.name)}">
          <td><strong>${esc(db.name)}</strong>
            <div class="db-meta">${db.enterprise ? `<span class="badge ee">Enterprise</span>` : `<span class="badge">Community</span>`}${db.neutralized ? `<span class="badge ok" title="Outgoing mail servers, crons and payment providers are off">Neutralized</span>` : ""}<span class="mono">${esc(db.odoo)}</span><span>${size(db.size)}</span></div></td>
          <td><div class="row-actions">
            <button class="btn small" data-act="open" ${inst.status === "running" ? "" : "disabled"} title="Open in the browser">${icon("external", 14)} Open</button>
            <button class="btn small" data-act="backup" title="Download a zip with the database and its filestore">${icon("download", 14)} Back up</button>
            <button class="btn small" data-act="duplicate">${icon("copy", 14)} Duplicate</button>
            <button class="btn small" data-act="neutralize" title="Turn off outgoing mail servers, crons and payment providers">${icon("shield", 14)} Neutralize</button>
            <button class="btn small" data-act="reset">${icon("key", 14)} Admin password</button>
            <button class="btn small" data-act="detach" title="This instance stops using it; the database stays">Detach</button>
            <button class="btn small danger" data-act="drop" aria-label="Delete ${esc(db.name)}">${icon("trash", 14)}</button>
          </div></td>
        </tr>`).join("")}</tbody>
    </table>`) + (others.length ? `
    <details class="others"${state.showOthers ? " open" : ""}>
      <summary>Other Odoo ${esc(inst.version)} databases on this server (${others.length})</summary>
      <p class="muted">This instance only runs on the databases above. Attach one to open it, back it up or install modules in it.</p>
      <table class="list"><tbody>${others.map((db) => `
        <tr><td><strong>${esc(db.name)}</strong></td><td>${db.enterprise ? `<span class="badge ee">Enterprise</span>` : `<span class="badge">Community</span>`}</td>
        <td class="num">${size(db.size)}</td><td><div class="row-actions"><button class="btn small" data-attach="${esc(db.name)}">Attach</button></div></td></tr>`).join("")}
      </tbody></table>
    </details>` : "");
  const details = panel.querySelector("details.others");
  if (details) details.ontoggle = () => { state.showOthers = details.open; };
  panel.querySelectorAll("[data-attach]").forEach((button) => {
    button.onclick = async () => {
      await run(() => api.call("db:attach", { id: inst.id, db: button.dataset.attach }), `${button.dataset.attach} attached`);
      await refresh();
      await run(() => loadDbs(inst));
      renderPanel();
    };
  });
  panel.querySelectorAll("[data-act]").forEach((button) => {
    const db = button.closest("tr").dataset.db;
    button.onclick = () => dbAction(inst, button.dataset.act, db);
  });
}

async function dbAction(inst, action, db) {
  const reload = async () => { await run(() => loadDbs(inst)); renderPanel(); };
  if (action === "open") return api.call("server:open", { id: inst.id, db });
  if (action === "detach") {
    await run(() => api.call("db:attach", { id: inst.id, db, on: false }), `${db} detached`);
    await refresh();
    return reload();
  }
  if (action === "backup") {
    const file = await run(() => api.call("db:action", { id: inst.id, action: "backup", data: { db } }), "Backup saved");
    if (file) api.call("shell:showItem", file);
    return;
  }
  if (action === "duplicate") {
    return dialog({
      title: `Duplicate ${db}`,
      body: `${field("target", "New database name", `<input class="input" name="target" required value="${esc(db)}_copy">`)}
        <label class="check"><input type="checkbox" name="neutralize" checked> Neutralize the copy (no outgoing mail, crons or payments)</label>`,
      submit: "Duplicate",
      onSubmit: async (data) => {
        await api.call("db:action", { id: inst.id, action: "duplicate", data: { db, target: data.target, neutralize: data.neutralize === "on" } });
        toast(`${data.target} created`);
        reload();
      },
    });
  }
  if (action === "neutralize") {
    return dialog({
      title: `Neutralize ${db}`,
      body: `<p>Outgoing mail servers, scheduled actions, payment providers and other connections to the outside world are switched off in <strong>${esc(db)}</strong>. Use it on a copy of a production database. The server restarts if it is running.</p>`,
      submit: "Neutralize",
      onSubmit: async () => {
        await api.call("db:action", { id: inst.id, action: "neutralize", data: { db } });
        toast(`${db} neutralized`);
        refresh();
      },
    });
  }
  if (action === "reset") {
    return dialog({
      title: `Admin password of ${db}`,
      body: `${field("login", "Login", `<input class="input" name="login" placeholder="Keep the current login">`)}
        ${field("password", "New password", `<input class="input" name="password" type="password" required minlength="4" autocomplete="new-password">`)}`,
      submit: "Set password",
      onSubmit: async (data) => {
        await api.call("db:reset", { id: inst.id, db, password: data.password, login: data.login });
        toast("Admin password changed");
      },
    });
  }
  if (action === "drop") {
    return dialog({
      title: `Delete ${db}`,
      danger: true,
      body: `<p>The database and its filestore are deleted for good. Back it up first if you may need it.</p>
        ${field("confirm", `Type <strong>${esc(db)}</strong> to confirm`, `<input class="input" name="confirm" required autocomplete="off">`)}`,
      submit: "Delete database",
      onSubmit: async (data) => {
        if (data.confirm !== db) throw new Error("The name does not match");
        await api.call("db:action", { id: inst.id, action: "drop", data: { db, confirm: data.confirm } });
        toast(`${db} deleted`);
        refresh();
        reload();
      },
    });
  }
}

function createDbDialog(inst) {
  dialog({
    title: `New Odoo ${inst.version} database`,
    body: `${field("name", "Database name", `<input class="input" name="name" required pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]*" placeholder="my_company">`, "Letters, digits, _ . and -")}
      <label class="check" style="margin-bottom:14px"><input type="checkbox" name="demo"> Load demo data</label>
      ${field("login", "Admin login", `<input class="input" name="login" value="admin">`)}
      ${field("password", "Admin password", `<input class="input" name="password" type="password" value="admin" autocomplete="new-password">`)}
      ${field("modules", "Also install", `<input class="input" name="modules" placeholder="sale_management, stock, website">`, "Technical names, separated by commas")}
      ${inst.edition === "enterprise" ? `<p class="muted">Enterprise is installed with the database.</p>` : ""}`,
    submit: "Create database",
    onSubmit: async (data) => {
      const modules = data.modules.split(",").map((m) => m.trim()).filter(Boolean);
      await api.call("db:create", { id: inst.id, data: { name: data.name, demo: data.demo === "on", login: data.login === "admin" ? "" : data.login, password: data.password, modules } });
      toast(`${data.name} is ready`);
      await run(() => loadDbs(inst));
      renderPanel();
    },
  });
}

function restoreDialog(inst) {
  dialog({
    title: "Restore a backup",
    body: `${field("file", "Backup file", `<div class="row"><input class="input" name="file" required readonly placeholder="A .zip from Odoo or Desk for Odoo"><button type="button" class="btn" data-browse="file">Browse</button></div>`)}
      ${field("db", "Database name", `<input class="input" name="db" required>`)}
      <label class="check"><input type="checkbox" name="neutralize" checked> Neutralize after restoring</label>`,
    submit: "Restore",
    onOpen: (form) => {
      form.querySelector("[data-browse=file]").onclick = async () => {
        const file = await api.call("dialog:file", "Choose a backup");
        if (!file) return;
        form.file.value = file;
        if (!form.db.value) form.db.value = file.split(/[\\/]/).pop().replace(/(-\d{4}-\d\d-\d\d.*)?\.(zip|dump|sql)$/, "");
      };
    },
    onSubmit: async (data) => {
      await api.call("db:action", { id: inst.id, action: "restore", data: { db: data.db, file: data.file, neutralize: data.neutralize === "on" } });
      toast(`${data.db} restored`);
      await run(() => loadDbs(inst));
      renderPanel();
    },
  });
}

async function renderModules(inst, panel) {
  if (state.pickedFor !== inst.id) {
    picked.clear();
    state.pickedFor = inst.id;
  }
  if (!state.dbs[inst.id]) await run(() => loadDbs(inst));
  const dbs = (state.dbs[inst.id] || []).filter((item) => item.attached);
  const db = dbs.some((item) => item.name === state.moduleDb[inst.id]) ? state.moduleDb[inst.id] : ((dbs[0] && dbs[0].name) || "");
  state.moduleDb[inst.id] = db;
  panel.innerHTML = `
    <div class="toolbar">
      <select class="input" id="mod-db" aria-label="Database">${dbs.map((item) => `<option ${item.name === db ? "selected" : ""}>${esc(item.name)}</option>`).join("") || "<option value=''>No database</option>"}</select>
      <div class="seg" role="group" aria-label="Show">
        ${[["all", "All"], ["installed", "Installed"], ["uninstalled", "Not installed"]].map(([key, label]) => `<button data-mf="${key}" aria-pressed="${state.moduleFilter === key}">${label}</button>`).join("")}
      </div>
      <input class="input grow" id="mod-search" type="search" placeholder="Search technical name or title" aria-label="Search modules" value="${esc(state.moduleSearch)}">
      <button class="btn" id="mod-store" title="Modules for Odoo ${esc(inst.version)} by stevenmarp">${icon("store")} Find more modules</button>
      <button class="btn" id="mod-install" disabled>Install</button>
      <button class="btn" id="mod-upgrade" disabled>Upgrade</button>
    </div>
    <div id="mod-table"><p class="muted">Reading modules…</p></div>`;
  $("#mod-db").onchange = (event) => { state.moduleDb[inst.id] = event.target.value; state.modules[inst.id] = null; picked.clear(); renderModules(inst, panel); };
  panel.querySelectorAll("[data-mf]").forEach((button) => {
    button.onclick = () => { state.moduleFilter = button.dataset.mf; drawModules(inst); };
  });
  $("#mod-search").oninput = (event) => { state.moduleSearch = event.target.value.toLowerCase(); drawModules(inst); };
  const act = (action) => async () => {
    const states = new Map((state.modules[inst.id] || []).map((mod) => [mod.name, mod.state]));
    const names = [...picked].filter((name) => (states.get(name) === "installed") === (action === "upgrade"));
    names.forEach((name) => picked.delete(name));
    await run(() => api.call("modules:action", { id: inst.id, db: state.moduleDb[inst.id], action, names }), `${names.length} module${names.length > 1 ? "s" : ""} ${action === "upgrade" ? "upgraded" : "installed"}`);
    state.modules[inst.id] = null;
    refresh();
    renderModules(inst, panel);
  };
  $("#mod-store").onclick = () => openStore(inst.version);
  $("#mod-install").onclick = act("install");
  $("#mod-upgrade").onclick = act("upgrade");
  if (!state.modules[inst.id]) state.modules[inst.id] = await run(() => api.call("modules:list", { id: inst.id, db })) || [];
  drawModules(inst);
}

const picked = new Set();

function drawModules(inst) {
  const box = $("#mod-table");
  if (!box) return;
  document.querySelectorAll("[data-mf]").forEach((button) => button.setAttribute("aria-pressed", state.moduleFilter === button.dataset.mf));
  const rows = (state.modules[inst.id] || []).filter((mod) => {
    if (state.moduleFilter === "installed" && mod.state !== "installed") return false;
    if (state.moduleFilter === "uninstalled" && mod.state === "installed") return false;
    return !state.moduleSearch || mod.name.includes(state.moduleSearch) || mod.title.toLowerCase().includes(state.moduleSearch);
  });
  const shown = rows.slice(0, 400);
  box.innerHTML = !rows.length ? `<div class="card empty">No module matches.</div>` : `
    <table class="list">
      <thead><tr><th style="width:36px"><span class="muted" aria-hidden="true">✓</span></th><th>Technical name</th><th>Title</th><th>Version</th><th>State</th></tr></thead>
      <tbody>${shown.map((mod) => `
        <tr>
          <td><input type="checkbox" class="mod-check" value="${esc(mod.name)}" aria-label="Select ${esc(mod.name)}" ${mod.installable ? "" : "disabled"} ${picked.has(mod.name) ? "checked" : ""}></td>
          <td class="mono">${esc(mod.name)}</td>
          <td>${esc(mod.title)}</td>
          <td class="mono muted">${esc(mod.version)}</td>
          <td class="nowrap">${mod.state === "installed" ? `<span class="badge ok">Installed</span>` : mod.installable ? `<span class="badge">${esc(mod.state.replace("uninstalled", "Not installed").replace(/^to /, "To "))}</span>` : `<span class="badge warn">Not installable</span>`}</td>
        </tr>`).join("")}</tbody>
    </table>${rows.length > shown.length ? `<p class="muted">${rows.length - shown.length} more, refine the search.</p>` : ""}`;
  const update = () => {
    const states = new Map((state.modules[inst.id] || []).map((mod) => [mod.name, mod.state]));
    const upgrade = [...picked].filter((name) => states.get(name) === "installed").length;
    const install = picked.size - upgrade;
    $("#mod-install").disabled = !install || !state.moduleDb[inst.id];
    $("#mod-upgrade").disabled = !upgrade || !state.moduleDb[inst.id];
    $("#mod-install").textContent = install ? `Install (${install})` : "Install";
    $("#mod-upgrade").textContent = upgrade ? `Upgrade (${upgrade})` : "Upgrade";
  };
  box.querySelectorAll(".mod-check").forEach((check) => {
    check.onchange = () => {
      if (check.checked) picked.add(check.value);
      else picked.delete(check.value);
      update();
    };
  });
  update();
}

function renderInstanceSettings(inst, panel) {
  const locked = inst.status !== "stopped";
  panel.innerHTML = `
    <form class="card" id="inst-form" style="max-width:760px">
      <h2>Instance settings</h2>
      ${locked ? `<div class="note">${icon("alert")} Stop the server to change these settings.</div><br>` : ""}
      ${field("name", "Name", `<input class="input" name="name" value="${esc(inst.name)}" ${locked ? "disabled" : ""}>`)}
      ${field("port", "Port", `<input class="input" name="port" type="number" min="1024" max="65535" value="${inst.port}" ${locked ? "disabled" : ""}>`)}
      <div class="field"><span class="label">Edition</span><div class="choices">
        <label class="choice"><input type="radio" name="edition" value="community" ${inst.edition === "community" ? "checked" : ""} ${locked ? "disabled" : ""}> Community</label>
        <label class="choice"><input type="radio" name="edition" value="enterprise" ${inst.edition === "enterprise" ? "checked" : ""} ${locked ? "disabled" : ""}> Enterprise</label>
      </div></div>
      ${field("enterprisePath", "Enterprise folder", `<div class="row"><input class="input" name="enterprisePath" value="${esc(inst.enterprisePath)}" ${locked ? "disabled" : ""}><button type="button" class="btn" data-browse="enterprisePath" ${locked ? "disabled" : ""}>Browse</button></div>`)}
      ${field("python", "Python", `<div class="row"><input class="input mono" name="python" value="${esc(inst.python)}" ${locked ? "disabled" : ""}><button type="button" class="btn" data-browse-file="python" ${locked ? "disabled" : ""}>Browse</button></div>`)}
      <label class="check" style="margin-bottom:14px"><input type="checkbox" name="crons" ${inst.crons ? "checked" : ""} ${locked ? "disabled" : ""}> <span>Run scheduled actions (crons) on this instance's databases<br><span class="muted">Off by default: emails, synchronisations and other jobs stay quiet while you work.</span></span></label>
      ${field("addons", "Extra addons folders", `<textarea class="input mono" name="addons" rows="4" style="height:auto;padding:8px 10px" ${locked ? "disabled" : ""}>${esc(inst.addons.join("\n"))}</textarea>`, "One folder per line. They come before the Odoo addons.")}
      <div class="row" style="justify-content:space-between">
        <button type="button" class="btn danger" id="inst-remove" ${locked ? "disabled" : ""}>${icon("trash")} Remove from Desk</button>
        <button class="btn primary" ${locked ? "disabled" : ""}>Save</button>
      </div>
    </form>`;
  const form = $("#inst-form");
  form.querySelector("[data-browse=enterprisePath]").onclick = async () => {
    const folder = await api.call("dialog:folder", "Odoo Enterprise folder");
    if (folder) form.enterprisePath.value = folder;
  };
  form.querySelector("[data-browse-file=python]").onclick = async () => {
    const file = await api.call("dialog:file", "Python interpreter");
    if (file) form.python.value = file;
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.addons = data.addons.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    data.crons = data.crons === "on";
    await run(() => api.call("instances:update", { id: inst.id, data }), "Saved");
    refresh();
  };
  $("#inst-remove").onclick = () => dialog({
    title: `Remove ${inst.name}`,
    danger: true,
    body: `<p>Desk for Odoo forgets this instance. Its source, databases and files stay on disk.</p>`,
    submit: "Remove",
    onSubmit: async () => {
      await api.call("instances:remove", inst.id);
      state.current = null;
      refresh();
    },
  });
}

async function renderStore() {
  const series = state.storeSeries;
  $("#main").innerHTML = `
    <header class="head">
      <div class="head-row">
        <div>
          <h1>Apps by stevenmarp</h1>
          <div class="status-line">Modules and themes for Odoo ${esc(series)}, most bought first. They open on the Odoo Apps store.</div>
        </div>
        <div class="actions">
          <div class="seg" role="group" aria-label="Odoo version">${["18", "19", "20"].map((v) => `<button data-series="${v}" aria-pressed="${v === series}">Odoo ${v}</button>`).join("")}</div>
          <button class="btn" id="store-all">${icon("external")} All apps on the store</button>
        </div>
      </div>
      <div style="height:14px"></div>
    </header>
    <section class="body"><div id="store-grid" class="store-grid"><p class="muted">Loading the store…</p></div></section>`;
  document.querySelectorAll("[data-series]").forEach((button) => {
    button.onclick = () => { state.storeSeries = button.dataset.series; renderStore(); };
  });
  const links = await api.call("store:links");
  $("#store-all").onclick = () => api.call("shell:openUrl", links.store);
  let apps;
  try {
    apps = await api.call("store:apps", series);
  } catch (error) {
    if ($("#store-grid")) $("#store-grid").innerHTML = `<div class="note err">${icon("alert")} ${esc(error.message)}. Check the internet connection.</div>`;
    return;
  }
  if (state.view !== "store" || state.storeSeries !== series || !$("#store-grid")) return;
  $("#store-grid").innerHTML = apps.map((app) => `
    <button class="app-card" data-url="${esc(app.url)}" aria-label="${esc(app.name)}, ${app.price ? `$${esc(app.price)}` : "free"}">
      ${app.image ? `<img src="${esc(app.image)}" alt="" loading="lazy">` : ""}
      <span class="app-body">
        <span class="app-name">${esc(app.name)}</span>
        <span class="app-sum">${esc(app.summary)}</span>
        <span class="app-price">${app.price ? `$${esc(app.price)}` : "Free"}</span>
      </span>
    </button>`).join("") || `<div class="card empty">No app for Odoo ${esc(series)} yet.</div>`;
  document.querySelectorAll(".app-card").forEach((card) => { card.onclick = () => api.call("shell:openUrl", card.dataset.url); });
}

async function supportDialog() {
  const links = await api.call("store:links");
  dialog({
    title: "Support Desk for Odoo",
    body: `<p>Desk for Odoo is free and open source. You keep it alive by:</p>
      <ul style="padding-left:18px;line-height:1.8">
        <li>buying a module you need from <strong>Apps by stevenmarp</strong>,</li>
        <li>a coffee on Saweria,</li>
        <li>giving the repository a star and reporting bugs.</li>
      </ul>
      <div class="row" style="flex-wrap:wrap">
        <button type="button" class="btn" data-link="saweria">${icon("heart")} Saweria</button>
        <button type="button" class="btn" data-link="repo">${icon("external")} Repository</button>
        <button type="button" class="btn" data-store>${icon("store")} Apps by stevenmarp</button>
      </div>`,
    submit: "Close",
    onOpen: (form) => {
      form.querySelectorAll("[data-link]").forEach((button) => { button.onclick = () => api.call("shell:openUrl", links[button.dataset.link]); });
      form.querySelector("[data-store]").onclick = () => { $("#modal").close(); openStore(); };
    },
    onSubmit: async () => {},
  });
}

function openStore(series) {
  state.view = "store";
  const inst = current();
  state.storeSeries = series || (inst && inst.version) || state.storeSeries;
  renderSidebar();
  renderMain();
}

function field(name, label, control, help = "") {
  return `<div class="field"><label for="f-${name}">${label}</label>${control.replace(`name="${name}"`, `name="${name}" id="f-${name}"`)}${help ? `<span class="help">${help}</span>` : ""}<span class="error" data-error="${name}"></span></div>`;
}

function dialog({ title, body, submit, danger, onSubmit, onOpen }) {
  const modal = $("#modal");
  const form = $("#modal-form");
  form.innerHTML = `
    <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon("close")}</button></header>
    <div class="content">${body}<div class="note err" id="modal-error" hidden></div></div>
    <footer><button type="button" class="btn" data-close>Cancel</button><button class="btn ${danger ? "danger solid" : "primary"}" id="modal-submit">${esc(submit)}</button></footer>`;
  form.querySelectorAll("[data-close]").forEach((button) => { button.onclick = () => modal.close(); });
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#modal-submit");
    const error = $("#modal-error");
    error.hidden = true;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${esc(submit)}`;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), form);
      modal.close();
    } catch (failure) {
      error.hidden = false;
      error.innerHTML = `${icon("alert")} ${esc(failure.message)}`;
      button.disabled = false;
      button.textContent = submit;
    }
  };
  modal.showModal();
  if (onOpen) onOpen(form);
  const first = form.querySelector(".content input:not([readonly]), .content select, .content textarea");
  if (first) first.focus();
}

async function addInstanceDialog() {
  const pythons = await api.call("instances:pythons").catch(() => []);
  dialog({
    title: "Add an Odoo instance",
    body: `
      <div class="field"><span class="label">Odoo version</span><div class="choices">
        ${["18", "19", "20"].map((v) => `<label class="choice"><input type="radio" name="version" value="${v}" ${v === "19" ? "checked" : ""}> Odoo ${v}</label>`).join("")}
      </div></div>
      <div class="field"><span class="label">Edition</span><div class="choices">
        <label class="choice"><input type="radio" name="edition" value="community" checked> Community</label>
        <label class="choice"><input type="radio" name="edition" value="enterprise"> Enterprise</label>
      </div></div>
      <div class="field"><span class="label">Odoo source</span><div class="choices">
        <label class="choice"><input type="radio" name="source" value="download" checked> Download from GitHub</label>
        <label class="choice"><input type="radio" name="source" value="folder"> Use a folder on this computer</label>
      </div>
      <div class="row" id="source-row" hidden><input class="input" name="odooPath" placeholder="Folder with odoo-bin"><button type="button" class="btn" data-browse="odooPath">Browse</button></div>
      <span class="help" id="source-help">About 1.4 GB, saved in the Desk workspace.</span></div>
      <div class="field" id="ee-row" hidden><span class="label">Enterprise source</span><div class="choices">
        <label class="choice"><input type="radio" name="eeSource" value="folder" checked> Use a folder on this computer</label>
        <label class="choice"><input type="radio" name="eeSource" value="download"> Download from GitHub</label>
      </div>
      <div class="row" id="ee-folder"><input class="input" name="enterprisePath" id="f-enterprisePath" placeholder="Folder with web_enterprise" aria-label="Enterprise folder"><button type="button" class="btn" data-browse="enterprisePath">Browse</button></div>
      <div id="ee-token" hidden><input class="input" name="eeToken" type="password" autocomplete="off" placeholder="GitHub token with access to odoo/enterprise" aria-label="GitHub token" style="width:100%"></div>
      <span class="help" id="ee-help">Enterprise is not public: point to your own copy from odoo.com or your Odoo partner.</span></div>
      <div class="field"><label for="f-python">Python</label><div class="row"><select class="input mono" name="python" id="f-python"></select><button type="button" class="btn" data-browse-file="python">Browse</button></div><span class="help" id="python-help"></span></div>
      <label class="check" style="margin-bottom:22px"><input type="checkbox" name="venv"> Create a separate Python environment and install the Odoo requirements</label>
      ${field("name", "Name", `<input class="input" name="name" placeholder="Odoo 19 Community">`)}`,
    submit: "Add instance",
    onOpen: (form) => {
      const update = () => {
        const version = form.version.value;
        const fits = pythons.filter((p) => fitsPython(version, p));
        form.python.innerHTML = (fits.length ? fits : pythons).map((p) => `<option value="${esc(p.python)}">${esc(p.python)} (${esc(p.version)})</option>`).join("") || `<option value="">No Python found</option>`;
        $("#python-help").textContent = fits.length ? `Odoo ${version} runs on Python ${PY_RANGE[version]}.` : `Odoo ${version} needs Python ${PY_RANGE[version]}. Install it, then choose it here.`;
        form.name.placeholder = `Odoo ${version} ${form.edition.value === "enterprise" ? "Enterprise" : "Community"}`;
        $("#ee-row").hidden = form.edition.value !== "enterprise";
        $("#ee-folder").hidden = form.eeSource.value !== "folder";
        $("#ee-token").hidden = form.eeSource.value !== "download";
        $("#ee-help").textContent = form.eeSource.value === "download"
          ? "For Odoo partners and Enterprise customers with access to github.com/odoo/enterprise. The token is used for this download only and is not saved."
          : "Enterprise is not public: point to your own copy from odoo.com or your Odoo partner.";
        $("#source-row").hidden = form.source.value !== "folder";
        $("#source-help").textContent = form.source.value === "folder" ? "Odoo 18, 19 or 20: the version is read from the folder." : "About 1.4 GB, saved in the Desk workspace.";
      };
      form.querySelectorAll("input[type=radio]").forEach((radio) => { radio.onchange = update; });
      form.querySelectorAll("[data-browse]").forEach((button) => {
        button.onclick = async () => {
          const folder = await api.call("dialog:folder", button.dataset.browse === "odooPath" ? "Odoo source folder" : "Odoo Enterprise folder");
          if (!folder) return;
          form[button.dataset.browse].value = folder;
          if (button.dataset.browse === "odooPath") {
            const found = await api.call("instances:detectSource", folder).catch((error) => { toast(error.message, "err"); return null; });
            if (found) { form.version.value = found.version; update(); }
          }
        };
      });
      form.querySelector("[data-browse-file=python]").onclick = async () => {
        const file = await api.call("dialog:file", "Python interpreter");
        if (!file) return;
        form.python.insertAdjacentHTML("afterbegin", `<option value="${esc(file)}">${esc(file)}</option>`);
        form.python.value = file;
      };
      update();
    },
    onSubmit: async (data) => {
      let odooPath = data.odooPath;
      if (data.source === "download") odooPath = await api.call("instances:download", { version: data.version });
      if (!odooPath) throw new Error("Choose the Odoo source folder");
      let enterprisePath = data.enterprisePath;
      if (data.edition === "enterprise" && data.eeSource === "download") {
        if (!data.eeToken) throw new Error("Paste a GitHub token with access to odoo/enterprise");
        enterprisePath = await api.call("instances:download", { version: data.version, enterprise: true, token: data.eeToken });
      }
      if (!data.python) throw new Error("Choose a Python interpreter");
      const inst = await api.call("instances:add", { name: data.name, edition: data.edition, odooPath, enterprisePath, python: data.python });
      state.current = inst.id;
      state.view = "instance";
      state.tab = "overview";
      await refresh();
      toast(`${inst.name} added`);
      if (data.venv === "on") run(() => api.call("instances:createVenv", { id: inst.id, python: data.python }), "Python environment ready").then(refresh);
    },
  });
}

const PY_RANGE = { 18: "3.10 to 3.12", 19: "3.10 to 3.13", 20: "3.12 to 3.14" };
function fitsPython(version, p) {
  const value = p.major * 100 + p.minor;
  return { 18: [310, 312], 19: [310, 313], 20: [312, 314] }[version].every((limit, i) => (i ? value <= limit : value >= limit));
}

function venvDialog(inst) {
  api.call("instances:pythons").then((pythons) => {
    const fits = pythons.filter((p) => fitsPython(inst.version, p) && !p.python.includes(`${inst.id}`));
    dialog({
      title: "Create a Python environment",
      body: `<p>A new environment is made in the Desk workspace and the packages from <span class="mono">requirements.txt</span> are installed into it. It can take several minutes.</p>
        <div class="field"><label for="f-base">Base Python</label><select class="input mono" name="base" id="f-base">${fits.map((p) => `<option value="${esc(p.python)}">${esc(p.python)} (${esc(p.version)})</option>`).join("")}</select></div>`,
      submit: "Create",
      onSubmit: async (data) => {
        run(() => api.call("instances:createVenv", { id: inst.id, python: data.base }), "Python environment ready").then(refresh);
      },
    });
  });
}

function settingsDialog() {
  const s = state.settings;
  dialog({
    title: "Settings",
    body: `
      <h3 style="margin:4px 0 12px;font-size:14px">PostgreSQL</h3>
      <div class="row" style="align-items:flex-start">
        ${field("host", "Host", `<input class="input" name="host" value="${esc(s.pg.host)}">`)}
        ${field("port", "Port", `<input class="input" name="port" type="number" value="${esc(s.pg.port)}" style="width:110px">`)}
      </div>
      ${field("user", "User", `<input class="input" name="user" value="${esc(s.pg.user)}">`)}
      ${field("password", "Password", `<input class="input" name="password" type="password" placeholder="${s.pg.hasPassword ? "Saved, leave empty to keep it" : ""}" autocomplete="off">`, "Stored encrypted with your system keychain when available.")}
      <div class="row" style="margin-bottom:16px"><button type="button" class="btn" id="pg-test">Test connection</button><span id="pg-result" class="muted"></span></div>
      <div class="field"><span class="label">Appearance</span><div class="choices">
        ${[["system", "Like the system"], ["light", "Light"], ["dark", "Dark"]].map(([key, label]) => `<label class="choice"><input type="radio" name="theme" value="${key}" ${s.theme === key ? "checked" : ""}> ${label}</label>`).join("")}
      </div></div>
      <div class="field"><span class="label">Workspace</span>${pathButton(s.workspace, true)}<span class="help">Sources, Python environments, filestores, logs and backups live here.</span></div>`,
    submit: "Save",
    onOpen: (form) => {
      bindPaths(form);
      $("#pg-test").onclick = async () => {
        $("#pg-result").textContent = "Connecting…";
        try {
          const version = await api.call("settings:testPostgres", { host: form.host.value, port: form.port.value, user: form.user.value, password: form.password.value });
          $("#pg-result").textContent = version.split(" ").slice(0, 2).join(" ") + " connected";
        } catch (error) {
          $("#pg-result").textContent = error.message;
        }
      };
    },
    onSubmit: async (data) => {
      state.settings = await api.call("settings:save", { theme: data.theme, pg: { host: data.host, port: data.port, user: data.user, password: data.password } });
      state.dbs = {};
      toast("Settings saved");
    },
  });
}

const taskNodes = {};
function onTask(event) {
  let node = taskNodes[event.taskId];
  if (!node) {
    node = document.createElement("div");
    node.className = "task";
    node.innerHTML = `<div class="task-head"><span class="spinner" aria-hidden="true"></span><span class="task-title"></span><span class="task-state muted">Running</span><button class="icon-btn" aria-label="Stop this task" data-cancel>${icon("close")}</button></div><pre></pre>`;
    node.querySelector("[data-cancel]").onclick = () => {
      if (node.classList.contains("done") || node.classList.contains("failed")) node.remove();
      else api.call("task:cancel", event.taskId);
    };
    $("#tasks").append(node);
    taskNodes[event.taskId] = node;
  }
  if (event.title) node.querySelector(".task-title").textContent = event.title;
  if (event.line) {
    const pre = node.querySelector("pre");
    pre.textContent = (pre.textContent + event.line + "\n").split("\n").slice(-60).join("\n");
    pre.scrollTop = pre.scrollHeight;
  }
  if (event.state === "done" || event.state === "failed") {
    node.classList.add(event.state);
    node.querySelector(".spinner").remove();
    node.querySelector(".task-state").textContent = event.state === "done" ? "Done" : "Failed";
    node.querySelector("[data-cancel]").setAttribute("aria-label", "Dismiss");
    if (event.state === "done") setTimeout(() => node.remove(), 6000);
  }
}

async function refresh() {
  state.instances = await api.call("instances:list");
  if (!state.current && state.instances.length) state.current = state.instances[0].id;
  renderSidebar();
  renderMain();
}

function onStatus(view) {
  const index = state.instances.findIndex((inst) => inst.id === view.id);
  if (index < 0) return;
  const before = state.instances[index].status;
  state.instances[index] = view;
  renderSidebar();
  if (view.id === state.current) {
    if (state.tab === "logs" && before !== "stopped") {
      const status = $(".status-line");
      if (status) { renderMain(); return; }
    }
    renderMain();
  }
  if (view.status === "stopped" && before !== "stopping" && view.exitCode) toast(`${view.name} stopped with exit code ${view.exitCode}. Check the log.`, "err");
}

async function boot() {
  document.querySelectorAll("[data-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
  document.querySelectorAll("[data-icon-left]").forEach((node) => { node.innerHTML = icon(node.dataset.iconLeft) + node.innerHTML; });
  $("#add-instance").onclick = () => addInstanceDialog();
  $("#open-settings").onclick = () => settingsDialog();
  $("#instance-list").onclick = (event) => {
    const item = event.target.closest(".inst-item");
    if (!item) return;
    state.current = item.dataset.id;
    state.view = "instance";
    renderSidebar();
    renderMain();
  };
  $("#open-store").onclick = () => openStore();
  $("#open-support").onclick = () => supportDialog();
  api.on("log", appendLog);
  api.on("status", onStatus);
  api.on("task", onTask);
  state.settings = await api.call("settings:get");
  await refresh();
}

boot();
