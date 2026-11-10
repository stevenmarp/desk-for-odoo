import http.cookiejar
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cdp import App

name, db = sys.argv[1], sys.argv[2]
copy, restored = f"{db}_copy", f"{db}_restored"
a = App()
results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(("ok   " if ok else "FAIL ") + label + ("" if ok else f"  {detail}"), flush=True)


PG = json.load(open(os.path.join(os.environ["DESK_WORKSPACE"], "desk.json")))["settings"]["pg"]


def sql(database, query):
    out = subprocess.run(["psql", "-h", PG["host"], "-p", str(PG["port"]), "-U", PG["user"], "-d", database, "-tAc", query], capture_output=True, text=True, env={**os.environ, "PGPASSWORD": os.environ.get("PGPASSWORD", "odoo")})
    return out.stdout.strip()


def open_tab(tab):
    a.eval(f"[...document.querySelectorAll('.inst-item')].find(b => b.innerText.includes({name!r})).click()")
    time.sleep(0.6)
    a.eval(f"document.querySelector('[data-tab={tab}]').click()")
    time.sleep(1.5)


def row_action(target, act):
    a.until(f"!!document.querySelector('tr[data-db=\"{target}\"] [data-act={act}]')", 60)
    a.eval(f"document.querySelector('tr[data-db=\"{target}\"] [data-act={act}]').click()")


def submit(fill="", limit=900):
    a.until("document.querySelector('#modal').open", 20)
    if fill:
        a.eval(f"(() => {{ const f = document.querySelector('#modal-form'); {fill} }})()")
    a.eval("document.querySelector('#modal-submit').click()")
    end = time.time() + limit
    while time.time() < end and a.eval("document.querySelector('#modal').open"):
        err = a.eval("(() => { const e = document.querySelector('#modal-error'); return e && !e.hidden ? e.innerText : ''; })()")
        if err:
            return err
        time.sleep(3)
    return ""


def wait_idle(limit=900):
    end = time.time() + limit
    time.sleep(2)
    while time.time() < end and a.eval("[...document.querySelectorAll('.task')].some(t => !t.classList.contains('done') && !t.classList.contains('failed'))"):
        time.sleep(3)
    return a.eval("[...document.querySelectorAll('.task')].filter(t => t.classList.contains('failed')).map(t => t.innerText.slice(0, 300))")


def login(port, database, user, password):
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    body = json.dumps({"jsonrpc": "2.0", "params": {"db": database, "login": user, "password": password}}).encode()
    req = urllib.request.Request(f"http://localhost:{port}/web/session/authenticate", body, {"Content-Type": "application/json"})
    return json.load(opener.open(req, timeout=60)).get("result", {}).get("uid")


for target in (copy, restored):
    if sql("postgres", f"select 1 from pg_database where datname = '{target}'"):
        raise SystemExit(f"{target} exists already, delete it first")

open_tab("overview")
port = a.eval("document.querySelector('.facts dd').textContent.split(':').pop()")
open_tab("databases")

before = set(os.listdir(os.path.join(os.environ["DESK_WORKSPACE"], "backups"))) if os.path.isdir(os.path.join(os.environ["DESK_WORKSPACE"], "backups")) else set()
row_action(db, "backup")
failed = wait_idle()
files = set(os.listdir(os.path.join(os.environ["DESK_WORKSPACE"], "backups"))) - before
zip_file = os.path.join(os.environ["DESK_WORKSPACE"], "backups", sorted(files)[-1]) if files else ""
check("backup writes a zip with the dump and the filestore", zip_file.endswith(".zip") and os.path.getsize(zip_file) > 10000 and not failed, failed or files)
if zip_file:
    listing = subprocess.run(["unzip", "-l", zip_file], capture_output=True, text=True).stdout
    check("backup zip has dump.sql and filestore/", "dump.sql" in listing and "filestore/" in listing, listing[-300:])

row_action(db, "duplicate")
err = submit(f"f.target.value = {copy!r}; f.neutralize.checked = true;")
check("duplicate with neutralize", not err and sql(copy, "select 1 from ir_module_module where name = 'base'") == "1", err)
check("the copy is neutralized", sql(copy, "select value from ir_config_parameter where key = 'database.is_neutralized'").lower() == "true",
      sql(copy, "select value from ir_config_parameter where key = 'database.is_neutralized'"))

a.until(f"!!document.querySelector('tr[data-db=\"{copy}\"]')", 60)
row_action(copy, "reset")
err = submit("f.password.value = 'desk-test-123';")
a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 180)
check("admin password changed", not err and bool(login(port, copy, "admin", "desk-test-123")), err)

row_action(copy, "neutralize")
err = submit()
check("neutralize again on a neutralized copy", not err, err)
a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 180)

a.eval("document.querySelector('#db-restore').click()")
a.until("document.querySelector('#modal').open", 20)
err = submit(f"f.file.value = {zip_file!r}; f.db.value = {restored!r}; f.neutralize.checked = true;")
check("restore the backup under a new name", not err and sql(restored, "select 1 from ir_module_module where name = 'base'") == "1", err)
check("restored filestore folder exists", os.path.isdir(os.path.join(os.environ["DESK_WORKSPACE"], "instances", a.eval(f"[...document.querySelectorAll('.inst-item')].find(b => b.innerText.includes({name!r})).dataset.id"), "data", "filestore", restored)))

open_tab("modules")
a.eval(f"(() => {{ const s = document.querySelector('#mod-db'); s.value = {copy!r}; s.dispatchEvent(new Event('change')); }})()")
a.until("!!document.querySelector('.mod-check')", 60)
a.eval("(() => { const s = document.querySelector('#mod-search'); s.value = 'contacts'; s.dispatchEvent(new Event('input')); })()")
time.sleep(1)
a.eval("(() => { const c = document.querySelector('.mod-check[value=contacts]'); c.checked = true; c.dispatchEvent(new Event('change')); document.querySelector('#mod-install').click(); })()")
failed = wait_idle()
check("install a module", sql(copy, "select state from ir_module_module where name = 'contacts'") == "installed" and not failed, failed)
a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 180)
a.until("!!document.querySelector('.mod-check[value=contacts]')", 60)
a.eval("(() => { const c = document.querySelector('.mod-check[value=contacts]'); c.checked = true; c.dispatchEvent(new Event('change')); document.querySelector('#mod-upgrade').click(); })()")
failed = wait_idle()
check("upgrade a module", not failed, failed)
a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 180)

open_tab("databases")
for target in (copy, restored):
    row_action(target, "drop")
    err = submit("f.confirm.value = 'wrong name';", limit=10)
    check(f"delete refuses a wrong name ({target})", "does not match" in err, err)
    a.eval(f"(() => {{ const f = document.querySelector('#modal-form'); f.confirm.value = {target!r}; document.querySelector('#modal-submit').click(); }})()")
    end = time.time() + 300
    while time.time() < end and a.eval("document.querySelector('#modal').open"):
        time.sleep(3)
    a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 180)
    time.sleep(5)
    check(f"delete {target} and it stays deleted after the restart", sql("postgres", "select 1") == "1" and not sql("postgres", f"select 1 from pg_database where datname = '{target}'"))
    open_tab("databases")

print(f"{sum(results)}/{len(results)} passed", "errors", a.errors)
