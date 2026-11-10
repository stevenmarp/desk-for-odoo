import sys
import time
import urllib.request

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cdp import App

name, db = sys.argv[1], sys.argv[2]
demo = len(sys.argv) > 3 and sys.argv[3] == "demo"
shots = "/tmp/desk_shots"
a = App()


def pick(tab=None):
    a.eval(f"[...document.querySelectorAll('.inst-item')].find(b => b.innerText.includes({name!r})).click()")
    time.sleep(0.6)
    if tab:
        a.eval(f"document.querySelector('[data-tab={tab}]').click()")
        time.sleep(1)


def wait_tasks(limit=1800):
    end = time.time() + limit
    time.sleep(2)
    while time.time() < end:
        if not a.eval("[...document.querySelectorAll('.task')].some(t => !t.classList.contains('done') && !t.classList.contains('failed'))"):
            return a.eval("[...document.querySelectorAll('.task')].map(t => t.querySelector('.task-title').textContent + ' ' + t.className)")
        time.sleep(5)
    raise TimeoutError("task")


pick("overview")
port = a.eval("document.querySelector('.facts dd').textContent.split(':').pop()")
a.eval("document.querySelector('#start')?.click()")
a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 180)
print("running on", port, flush=True)
pick("logs")
time.sleep(1)
print("log lines", a.eval("document.querySelectorAll('#log span').length"), "tab", a.eval("document.querySelector('[data-tab=logs]').innerText"))
pick("databases")
a.until("!document.querySelector('#db-table')?.innerText.includes('Reading')", 60)
exists = a.eval(f"!!document.querySelector('tr[data-db=\"{db}\"]')")
if not exists:
    a.eval("document.querySelector('#db-new').click()")
    a.until("document.querySelector('#modal').open")
    a.eval(f"(() => {{ const f = document.querySelector('#modal-form'); f.name.value = {db!r}; f.demo.checked = {str(demo).lower()}; f.password.value = 'admin'; document.querySelector('#modal-submit').click(); }})()")
    start = time.time()
    while a.eval("document.querySelector('#modal').open"):
        err = a.eval("(() => { const e = document.querySelector('#modal-error'); return e && !e.hidden ? e.innerText : ''; })()")
        if err:
            raise SystemExit("create failed: " + err)
        time.sleep(5)
    print("created", db, int(time.time() - start), "s", flush=True)
    a.until(f"!!document.querySelector('tr[data-db=\"{db}\"]')", 60)
a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 180)
print("db row", a.eval(f"document.querySelector('tr[data-db=\"{db}\"]').innerText.replace(/\\s+/g, ' ')"))
import http.cookiejar
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
status = opener.open(f"http://localhost:{port}/web/login?db={db}", timeout=60).status
print("login page", status)
print("errors", a.errors)
