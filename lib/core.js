const { spawn, execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { Client } = require("pg");

const WIN = process.platform === "win32";
const VERSIONS = { 18: "18.0", 19: "19.0", 20: "20.0" };
const MIN_POSTGRES = { 18: 12, 19: 13, 20: 16 };
const PYTHON_RANGE = { 18: [[3, 10], [3, 12]], 19: [[3, 10], [3, 13]], 20: [[3, 12], [3, 14]] };
const LOG_LINE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d+) (\d+) (DEBUG|INFO|WARNING|ERROR|CRITICAL) (\S+) ([\w.]+): (.*)$/;
const SAFE_DB = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
const SAFE_MODULE = /^[a-z0-9_]+$/;
const WHEEL_FRIENDLY = new Set(["gevent", "greenlet"]);

function friendlyRequirements(text) {
  return text.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*==\s*([^\s;#]+)(.*)$/);
    if (!match) return line;
    const name = match[1].toLowerCase();
    if (name === "psycopg2") return `psycopg2-binary>=${match[2]}${match[3]}`;
    if (WHEEL_FRIENDLY.has(name)) return `${match[1]}>=${match[2]}${match[3]}`;
    return line;
  }).join("\n");
}

class Core {
  constructor(workspace, emit) {
    this.workspace = workspace;
    this.emit = emit;
    this.file = path.join(workspace, "desk.json");
    this.servers = new Map();
    this.tasks = new Map();
    fs.mkdirSync(workspace, { recursive: true });
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : {};
    this.state.settings = { pg: { host: "localhost", port: 5432, user: "odoo", password: "" }, theme: "system", ...this.state.settings };
    this.state.instances = (this.state.instances || []).map((inst) => ({ databases: [], crons: false, ...inst }));
  }

  save() {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.state, null, 2));
    fs.renameSync(this.file + ".tmp", this.file);
  }

  dir(...parts) {
    const target = path.join(this.workspace, ...parts);
    fs.mkdirSync(path.extname(target) ? path.dirname(target) : target, { recursive: true });
    return target;
  }

  instance(id) {
    const found = this.state.instances.find((inst) => inst.id === id);
    if (!found) throw new Error("Unknown instance");
    return found;
  }

  view(inst) {
    const server = this.servers.get(inst.id);
    return { ...inst, status: server ? server.status : "stopped", counts: server ? server.counts : { WARNING: 0, ERROR: 0 } };
  }

  list() {
    return this.state.instances.map((inst) => this.view(inst));
  }

  detectSource(folder) {
    const release = path.join(folder, "odoo", "release.py");
    if (!fs.existsSync(release)) throw new Error("No Odoo source in this folder: odoo/release.py is missing");
    const match = fs.readFileSync(release, "utf8").match(/version_info\s*=\s*\(\s*(?:'saas~)?(\d+)/);
    const version = match && match[1];
    if (!VERSIONS[version]) throw new Error(`Odoo ${version || "?"} is not supported, only 18, 19 and 20`);
    const bin = ["odoo-bin", "odoo-server"].map((name) => path.join(folder, name)).find((file) => fs.existsSync(file));
    if (!bin) throw new Error("No odoo-bin in this folder");
    const addons = [path.join(folder, "addons"), path.join(folder, "odoo", "addons")].filter((dir) => fs.existsSync(path.join(dir, "web")));
    return { version, bin, addons };
  }

  checkEnterprise(folder) {
    if (!folder || !fs.existsSync(path.join(folder, "web_enterprise", "__manifest__.py"))) {
      throw new Error("No Odoo Enterprise in this folder: web_enterprise is missing");
    }
  }

  async pythonInfo(python) {
    const out = await this.capture(python, ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"]);
    const [major, minor] = out.trim().split(".").map(Number);
    return { python, version: out.trim(), major, minor };
  }

  async detectPythons() {
    const names = WIN ? ["py", "python"] : ["python3.14", "python3.13", "python3.12", "python3.11", "python3.10", "python3"];
    const found = [];
    for (const name of names) {
      try {
        const where = await this.capture(WIN ? "where" : "which", [name]);
        const file = where.split(/\r?\n/)[0].trim();
        if (file && !found.some((item) => item.python === file)) found.push(await this.pythonInfo(file));
      } catch {
        continue;
      }
    }
    for (const inst of this.state.instances) {
      if (inst.python && !found.some((item) => item.python === inst.python)) {
        try { found.push(await this.pythonInfo(inst.python)); } catch { continue; }
      }
    }
    return found;
  }

  pythonFits(version, info) {
    const [low, high] = PYTHON_RANGE[version];
    const value = info.major * 100 + info.minor;
    return value >= low[0] * 100 + low[1] && value <= high[0] * 100 + high[1];
  }

  async pythonMissing(python) {
    const probe = "import importlib.util as u; print(','.join(m for m in ['psycopg2', 'lxml', 'werkzeug', 'babel', 'PIL', 'passlib', 'reportlab'] if not u.find_spec(m)))";
    return (await this.capture(python, ["-c", probe])).trim().split(",").filter(Boolean);
  }

  async addInstance(data) {
    const source = this.detectSource(data.odooPath);
    if (data.edition === "enterprise") this.checkEnterprise(data.enterprisePath);
    const info = await this.pythonInfo(data.python);
    if (!this.pythonFits(source.version, info)) {
      const [low, high] = PYTHON_RANGE[source.version];
      throw new Error(`Odoo ${source.version} needs Python ${low.join(".")} to ${high.join(".")}, this one is ${info.version}`);
    }
    const id = crypto.randomUUID().slice(0, 8);
    const inst = {
      id,
      name: data.name || `Odoo ${source.version} ${data.edition === "enterprise" ? "Enterprise" : "Community"}`,
      version: source.version,
      edition: data.edition === "enterprise" ? "enterprise" : "community",
      odooPath: data.odooPath,
      enterprisePath: data.edition === "enterprise" ? data.enterprisePath : "",
      python: data.python,
      addons: (data.addons || []).filter(Boolean),
      databases: [],
      crons: false,
      port: await this.freePort(Number(source.version) * 1000 + 69),
      masterPassword: crypto.randomBytes(12).toString("hex"),
      created: new Date().toISOString(),
    };
    this.state.instances.push(inst);
    this.save();
    return this.view(inst);
  }

  updateInstance(id, data) {
    const inst = this.instance(id);
    if (this.servers.has(id)) throw new Error("Stop the server before changing its settings");
    if (data.edition === "enterprise") this.checkEnterprise(data.enterprisePath);
    Object.assign(inst, {
      name: data.name || inst.name,
      edition: data.edition === "enterprise" ? "enterprise" : "community",
      enterprisePath: data.edition === "enterprise" ? data.enterprisePath : "",
      python: data.python || inst.python,
      addons: (data.addons || []).filter(Boolean),
      port: Number(data.port) || inst.port,
      crons: Boolean(data.crons),
    });
    this.save();
    return this.view(inst);
  }

  removeInstance(id) {
    if (this.servers.has(id)) throw new Error("Stop the server first");
    this.state.instances = this.state.instances.filter((inst) => inst.id !== id);
    this.save();
  }

  addonsPath(inst) {
    const source = this.detectSource(inst.odooPath);
    return [inst.enterprisePath, ...inst.addons, ...source.addons].filter(Boolean);
  }

  writeConf(inst, pg) {
    const conf = this.dir("instances", inst.id, "odoo.conf");
    const lines = [
      "[options]",
      `addons_path = ${this.addonsPath(inst).join(",")}`,
      `data_dir = ${this.dir("instances", inst.id, "data")}`,
      `db_host = ${pg.host}`,
      `db_port = ${pg.port}`,
      `db_user = ${pg.user}`,
      `db_password = ${pg.password || "False"}`,
      "http_interface = 127.0.0.1",
      `http_port = ${inst.port}`,
      `admin_passwd = ${inst.masterPassword}`,
      "list_db = True",
      `max_cron_threads = ${inst.crons && inst.databases.length ? 1 : 0}`,
      inst.databases.length ? `db_name = ${inst.databases.join(",")}` : "dbfilter = ^$",
    ];
    fs.writeFileSync(conf, lines.join("\n") + "\n");
    return conf;
  }

  odooArgs(inst, pg, args) {
    const source = this.detectSource(inst.odooPath);
    return [source.bin, ...(args[0] && !args[0].startsWith("-") ? [args[0], "-c", this.writeConf(inst, pg), ...args.slice(1)] : ["-c", this.writeConf(inst, pg), ...args])];
  }

  async start(id, pg) {
    const inst = this.instance(id);
    if (this.servers.has(id)) return this.view(inst);
    if (!(await this.portFree(inst.port))) throw new Error(`Port ${inst.port} is already used by another program`);
    await this.checkPostgres(inst, pg);
    if (inst.databases.length) {
      const rows = await this.pg(pg, "postgres", async (client) => (await client.query("select datname from pg_database where datname = any($1)", [inst.databases])).rows);
      const existing = new Set(rows.map((row) => row.datname));
      if (existing.size !== inst.databases.length) {
        inst.databases = inst.databases.filter((name) => existing.has(name));
        this.save();
      }
    }
    const args = this.odooArgs(inst, pg, []);
    const logFile = fs.createWriteStream(this.dir("instances", inst.id, "odoo.log"), { flags: "a" });
    const child = spawn(inst.python, args, { cwd: inst.odooPath, env: { ...process.env, PYTHONUNBUFFERED: "1" }, windowsHide: true });
    const server = { child, status: "starting", counts: { WARNING: 0, ERROR: 0 }, lines: [], logFile };
    this.servers.set(id, server);
    this.emit("status", this.view(inst));
    const onLine = (line) => {
      const parsed = LOG_LINE.exec(line);
      const level = parsed ? parsed[3] : null;
      if (level === "WARNING") server.counts.WARNING += 1;
      if (level === "ERROR" || level === "CRITICAL") server.counts.ERROR += 1;
      const entry = { line, level };
      server.lines.push(entry);
      if (server.lines.length > 5000) server.lines.splice(0, server.lines.length - 5000);
      logFile.write(line + "\n");
      if (server.status === "starting" && /HTTP service (\(werkzeug\) )?running on/.test(line)) {
        server.status = "running";
        this.emit("status", this.view(inst));
      }
      this.emit("log", { id, ...entry, counts: server.counts });
    };
    this.lineReader(child.stdout, onLine);
    this.lineReader(child.stderr, onLine);
    child.on("error", (error) => onLine(`Desk: ${error.message}`));
    child.on("exit", (code, signal) => {
      onLine(`Desk: server stopped (${signal || `exit code ${code}`})`);
      logFile.end();
      this.servers.delete(id);
      this.emit("status", { ...this.view(inst), exitCode: code });
    });
    return this.view(inst);
  }

  stop(id) {
    const server = this.servers.get(id);
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => server.child.kill("SIGKILL"), 10000);
      server.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      server.status = "stopping";
      this.emit("status", this.view(this.instance(id)));
      server.child.kill(WIN ? undefined : "SIGTERM");
    });
  }

  async stopAll() {
    await Promise.all([...this.servers.keys()].map((id) => this.stop(id)));
  }

  logs(id) {
    const server = this.servers.get(id);
    if (server) return server.lines;
    const file = path.join(this.workspace, "instances", id, "odoo.log");
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(-2000);
    return text.filter(Boolean).map((line) => ({ line, level: (LOG_LINE.exec(line) || [])[3] || null }));
  }

  lineReader(stream, onLine) {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const parts = (rest + chunk).split(/\r\n|\r|\n/);
      rest = parts.pop();
      parts.forEach(onLine);
    });
    stream.on("end", () => rest && onLine(rest));
  }

  capture(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim().split("\n").slice(-3).join("\n")));
        else resolve(stdout);
      });
    });
  }

  task(title, command, args, options = {}) {
    const taskId = crypto.randomUUID().slice(0, 8);
    const child = spawn(command, args, { windowsHide: true, ...options, env: { ...process.env, PYTHONUNBUFFERED: "1", ...(options.env || {}) } });
    this.tasks.set(taskId, child);
    this.emit("task", { taskId, title, state: "running" });
    const tail = [];
    const onLine = (line) => {
      tail.push(line);
      if (tail.length > 40) tail.shift();
      this.emit("task", { taskId, line });
    };
    this.lineReader(child.stdout, onLine);
    this.lineReader(child.stderr, onLine);
    if (options.input !== undefined) child.stdin.end(options.input);
    const done = new Promise((resolve, reject) => {
      child.on("error", (error) => {
        this.tasks.delete(taskId);
        this.emit("task", { taskId, state: "failed", line: error.message });
        reject(error);
      });
      child.on("exit", (code) => {
        this.tasks.delete(taskId);
        const ok = code === 0;
        this.emit("task", { taskId, state: ok ? "done" : "failed", code });
        if (ok) resolve(tail);
        else reject(new Error(`${title} failed (exit code ${code}): ${tail.slice(-3).join(" ")}`));
      });
    });
    return { taskId, done };
  }

  cancelTask(taskId) {
    const child = this.tasks.get(taskId);
    if (child) child.kill();
  }

  odooTask(inst, pg, title, args, options = {}) {
    return this.task(title, inst.python, this.odooArgs(inst, pg, args), { cwd: inst.odooPath, ...options });
  }

  async withServerStopped(inst, pg, work) {
    const wasRunning = this.servers.has(inst.id);
    if (wasRunning) await this.stop(inst.id);
    try {
      return await work();
    } finally {
      if (wasRunning) await this.start(inst.id, pg);
    }
  }

  async attach(id, pg, db, on = true) {
    const inst = this.instance(id);
    this.checkDb(db);
    inst.databases = on ? [...new Set([...inst.databases, db])].sort() : inst.databases.filter((name) => name !== db);
    this.save();
    if (this.servers.has(id)) {
      await this.stop(id);
      await this.start(id, pg);
    }
    return this.view(inst);
  }

  mine(inst, db) {
    this.checkDb(db);
    if (!inst.databases.includes(db)) throw new Error(`Attach ${db} to this instance first`);
    return db;
  }

  checkDb(name) {
    if (!SAFE_DB.test(name || "")) throw new Error("Database names use letters, digits, _ . - and start with a letter or digit");
    return name;
  }

  async pg(pg, database, work) {
    const client = new Client({ host: pg.host, port: Number(pg.port), user: pg.user, password: pg.password || undefined, database, connectionTimeoutMillis: 4000 });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  async checkPostgres(inst, pg) {
    const num = Number(await this.pg(pg, "postgres", async (client) => (await client.query("show server_version_num")).rows[0].server_version_num));
    const need = MIN_POSTGRES[inst.version];
    if (Math.floor(num / 10000) < need) {
      throw new Error(`Odoo ${inst.version} needs PostgreSQL ${need} or later, the server in Settings runs PostgreSQL ${Math.floor(num / 10000)}. Install a newer PostgreSQL and point Settings to it.`);
    }
  }

  async testPostgres(pg) {
    return this.pg(pg, "postgres", async (client) => (await client.query("select version()")).rows[0].version);
  }

  async databases(pg, version, attached = []) {
    const rows = await this.pg(pg, "postgres", async (client) => (await client.query(
      "select datname, pg_database_size(datname) as size from pg_database where not datistemplate and datname <> 'postgres' and has_database_privilege(datname, 'CONNECT') order by datname",
    )).rows);
    const out = [];
    let index = 0;
    const worker = async () => {
      while (index < rows.length) {
        const row = rows[index++];
        try {
          const info = await this.pg(pg, row.datname, async (client) => {
            const base = await client.query("select latest_version from ir_module_module where name = 'base' and state = 'installed'");
            const ent = await client.query("select 1 from ir_module_module where name = 'web_enterprise' and state = 'installed'");
            const neutral = await client.query("select value from ir_config_parameter where key = 'database.is_neutralized'");
            return { odoo: base.rows[0] && base.rows[0].latest_version, enterprise: ent.rowCount > 0, neutralized: neutral.rowCount > 0 && String(neutral.rows[0].value).toLowerCase() === "true" };
          });
          if (info.odoo && (!version || info.odoo.startsWith(`${version}.`))) out.push({ name: row.datname, size: Number(row.size), ...info, attached: attached.includes(row.datname) });
        } catch {
          continue;
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async createDb(id, pg, data) {
    const inst = this.instance(id);
    const name = this.checkDb(data.name);
    await this.checkPostgres(inst, pg);
    const modules = ["base", ...(inst.edition === "enterprise" ? ["web_enterprise"] : []), ...(data.modules || []).filter((m) => SAFE_MODULE.test(m))];
    const demo = inst.version === "18" ? (data.demo ? [] : ["--without-demo=all"]) : (data.demo ? ["--with-demo"] : []);
    const run = this.odooTask(inst, pg, `Create database ${name}`, ["-d", name, "-i", [...new Set(modules)].join(","), ...demo, "--stop-after-init", "--no-http"]);
    await run.done;
    await this.attach(id, pg, name);
    if (data.password && data.password !== "admin") await this.resetAdmin(id, pg, name, data.password, data.login);
    return name;
  }

  async resetAdmin(id, pg, db, password, login) {
    const inst = this.instance(id);
    this.mine(inst, db);
    const script = [
      "import json",
      `data = json.loads(${JSON.stringify(JSON.stringify({ password, login: login || "" }))})`,
      "user = env.ref('base.user_admin')",
      "values = {'password': data['password']}",
      "if data['login']: values['login'] = data['login']",
      "user.write(values)",
      "env.cr.commit()",
      "print('admin password set for', user.login)",
    ].join("\n");
    const run = this.odooTask(inst, pg, `Reset admin password on ${db}`, ["shell", "-d", db, "--no-http"], { input: script + "\n" });
    await run.done;
  }

  async dbCommand(id, pg, action, data) {
    const inst = this.instance(id);
    const db = action === "restore" ? this.checkDb(data.db) : this.mine(inst, data.db);
    if (!["backup", "drop"].includes(action)) await this.checkPostgres(inst, pg);
    if (action === "backup") {
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const file = this.dir("backups", `${db}-${stamp}.zip`);
      await this.odooTask(inst, pg, `Back up ${db}`, ["db", "dump", db, file]).done;
      return file;
    }
    if (action === "restore") {
      if (!data.file || !fs.existsSync(data.file)) throw new Error("Choose a backup file");
      await this.odooTask(inst, pg, `Restore ${db}`, ["db", "load", ...(data.neutralize ? ["-n"] : []), db, data.file]).done;
      await this.attach(id, pg, db);
      return db;
    }
    if (action === "duplicate") {
      const target = this.checkDb(data.target);
      await this.odooTask(inst, pg, `Duplicate ${db} as ${target}`, ["db", "duplicate", ...(data.neutralize ? ["-n"] : []), db, target]).done;
      await this.attach(id, pg, target);
      return target;
    }
    if (action === "neutralize") {
      await this.withServerStopped(inst, pg, () => this.odooTask(inst, pg, `Neutralize ${db}`, ["neutralize", "-d", db]).done);
      return db;
    }
    if (action === "drop") {
      if (data.confirm !== db) throw new Error("Type the database name to delete it");
      await this.withServerStopped(inst, pg, async () => {
        await this.odooTask(inst, pg, `Delete ${db}`, ["db", "drop", db]).done;
        inst.databases = inst.databases.filter((name) => name !== db);
        this.save();
      });
      return db;
    }
    throw new Error("Unknown action");
  }

  scanModules(inst) {
    const modules = new Map();
    for (const dir of this.addonsPath(inst)) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        const manifest = path.join(dir, name, "__manifest__.py");
        if (modules.has(name) || !SAFE_MODULE.test(name) || !fs.existsSync(manifest)) continue;
        const text = fs.readFileSync(manifest, "utf8");
        const field = (key) => ((text.match(new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]*)['"]`)) || [])[1] || "");
        modules.set(name, { name, title: field("name") || name, version: field("version"), path: dir, installable: !/['"]installable['"]\s*:\s*False/.test(text) });
      }
    }
    return [...modules.values()];
  }

  async modules(id, pg, db) {
    const inst = this.instance(id);
    const found = this.scanModules(inst);
    let states = {};
    if (db) {
      this.mine(inst, db);
      states = await this.pg(pg, db, async (client) => Object.fromEntries(
        (await client.query("select name, state, latest_version from ir_module_module")).rows.map((row) => [row.name, row]),
      ));
    }
    return found.map((mod) => ({ ...mod, state: (states[mod.name] || {}).state || "uninstalled" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async moduleAction(id, pg, db, action, names) {
    const inst = this.instance(id);
    this.mine(inst, db);
    await this.checkPostgres(inst, pg);
    const list = names.filter((name) => SAFE_MODULE.test(name));
    if (!list.length) throw new Error("Choose at least one module");
    const flag = action === "upgrade" ? "-u" : "-i";
    const title = `${action === "upgrade" ? "Upgrade" : "Install"} ${list.join(", ")} on ${db}`;
    await this.withServerStopped(inst, pg, () => this.odooTask(inst, pg, title, ["-d", db, flag, list.join(","), "--stop-after-init", "--no-http"]).done);
  }

  download(version, options = {}) {
    const branch = VERSIONS[version];
    if (!branch) throw new Error("Choose 18, 19 or 20");
    const enterprise = Boolean(options.enterprise);
    const folder = this.dir("sources", `${enterprise ? "enterprise" : "odoo"}-${branch}`);
    const marker = enterprise ? path.join(folder, "web_enterprise", "__manifest__.py") : path.join(folder, "odoo", "release.py");
    if (fs.existsSync(marker)) return { folder, done: Promise.resolve() };
    const env = { GIT_TERMINAL_PROMPT: "0" };
    if (options.token) {
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${options.token}`).toString("base64")}`;
    }
    const url = enterprise ? "https://github.com/odoo/enterprise.git" : "https://github.com/odoo/odoo.git";
    const title = `Download Odoo ${branch} ${enterprise ? "Enterprise" : "Community"}`;
    const run = this.task(title, "git", ["clone", "--depth", "1", "--branch", branch, "--progress", url, folder], { env });
    const done = run.done.catch((error) => {
      fs.rmSync(folder, { recursive: true, force: true });
      if (enterprise && /not found|Authentication failed|could not read Username|403/i.test(error.message)) {
        throw new Error("This GitHub account has no access to odoo/enterprise. Only Odoo partners and Enterprise customers get it: use a folder with your own copy instead.");
      }
      throw error;
    });
    return { folder, taskId: run.taskId, done };
  }

  createVenv(id, basePython) {
    const inst = this.instance(id);
    const venv = this.dir("instances", inst.id, "venv");
    const python = WIN ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
    const requirements = path.join(venv, "requirements-desk.txt");
    fs.writeFileSync(requirements, friendlyRequirements(fs.readFileSync(path.join(inst.odooPath, "requirements.txt"), "utf8")) + "\nmarkdown2\n");
    const steps = async () => {
      await this.task(`Create Python environment for ${inst.name}`, basePython, ["-m", "venv", "--copies", venv]).done;
      await this.task("Update pip", python, ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"]).done;
      await this.task(`Install Odoo ${inst.version} requirements`, python, ["-m", "pip", "install", "--prefer-binary", "--progress-bar", "off", "-r", requirements]).done;
      inst.python = python;
      this.save();
      return python;
    };
    return steps();
  }

  portFree(port) {
    return new Promise((resolve) => {
      const probe = net.createServer().once("error", () => resolve(false)).once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "0.0.0.0");
    });
  }

  async freePort(start) {
    const taken = new Set(this.state.instances.map((inst) => inst.port));
    for (let port = start; port < start + 50; port += 1) {
      if (!taken.has(port) && (await this.portFree(port))) return port;
    }
    throw new Error("No free port found");
  }
}

module.exports = { Core, VERSIONS, PYTHON_RANGE, LOG_LINE, friendlyRequirements };
