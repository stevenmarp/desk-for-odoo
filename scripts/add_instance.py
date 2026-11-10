import json
import sys
import time

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cdp import App

version, edition, python, venv = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "venv"
source = sys.argv[5] if len(sys.argv) > 5 else ""
enterprise = sys.argv[6] if len(sys.argv) > 6 else ""

a = App()
a.until("document.querySelectorAll('.inst-item').length > 0 || !!document.querySelector('#welcome-add')", 30)
a.eval("document.querySelector('#modal').open && document.querySelector('#modal').close()")
a.eval("document.querySelector('#add-instance').click()")
a.until("document.querySelector('#modal').open && document.querySelector('#modal-form').python.options.length > 0", 20)
setup = {"version": version, "edition": edition, "python": python, "venv": venv, "source": source, "enterprise": enterprise}
a.eval("""(() => { const s = %s; const f = document.querySelector('#modal-form');
  f.querySelector(`input[name=version][value="${s.version}"]`).click();
  f.querySelector(`input[name=edition][value="${s.edition}"]`).click();
  f.querySelector(`input[name=source][value="${s.source ? 'folder' : 'download'}"]`).click();
  if (s.source) f.odooPath.value = s.source;
  if (s.enterprise) f.enterprisePath.value = s.enterprise;
  if (![...f.python.options].some(o => o.value === s.python)) f.python.insertAdjacentHTML('afterbegin', `<option value="${s.python}">${s.python}</option>`);
  f.python.value = s.python;
  f.venv.checked = s.venv; })()""" % json.dumps(setup))
time.sleep(0.5)
a.shot(f"/tmp/desk_add_{version}_{edition}.png")
a.eval("document.querySelector('#modal-submit').click()")
start = time.time()
while a.eval("document.querySelector('#modal').open"):
    err = a.eval("(() => { const e = document.querySelector('#modal-error'); return e && !e.hidden ? e.innerText : ''; })()")
    if err:
        raise SystemExit(f"add failed: {err}")
    tasks = a.eval("[...document.querySelectorAll('.task')].map(t => t.querySelector('.task-title').textContent + ': ' + (t.querySelector('pre').textContent.trim().split('\\n').pop() || ''))")
    print(int(time.time() - start), "s", tasks[-1] if tasks else "", flush=True)
    time.sleep(15)
print("added", a.eval("document.querySelector('.head h1')?.innerText"), flush=True)
while venv and a.eval("[...document.querySelectorAll('.task')].some(t => !t.classList.contains('done') && !t.classList.contains('failed'))"):
    tasks = a.eval("[...document.querySelectorAll('.task')].map(t => t.querySelector('.task-title').textContent + ': ' + (t.querySelector('pre').textContent.trim().split('\\n').pop() || '').slice(0, 120))")
    print(int(time.time() - start), "s", tasks[-1] if tasks else "", flush=True)
    time.sleep(20)
print("tasks", a.eval("[...document.querySelectorAll('.task')].map(t => t.querySelector('.task-title').textContent + ' ' + t.className)"))
print("errors", a.errors)
