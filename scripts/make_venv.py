import sys, time
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cdp import App
name, base = sys.argv[1], sys.argv[2]
a = App()
a.eval("document.querySelector(\"[data-tab=overview]\")?.click()")
time.sleep(2)
a.until("document.querySelectorAll('.inst-item').length > 0", 30)
a.eval(f"[...document.querySelectorAll('.inst-item')].find(b => b.innerText.includes({name!r})).click()")
a.until("!!document.querySelector('#make-venv')", 30)
a.eval("document.querySelector('#make-venv').click()")
a.until("document.querySelector('#modal').open && document.querySelector('#f-base')", 20)
a.eval(f"(() => {{ const s = document.querySelector('#f-base'); if (![...s.options].some(o => o.value === {base!r})) s.insertAdjacentHTML('afterbegin', `<option value={base!r}>x</option>`); s.value = {base!r}; document.querySelector('#modal-submit').click(); }})()")
start = time.time()
time.sleep(3)
while a.eval("[...document.querySelectorAll('.task')].some(t => !t.classList.contains('done') && !t.classList.contains('failed'))"):
    print(int(time.time() - start), "s", a.eval("(() => { const t = [...document.querySelectorAll('.task')].pop(); return t ? t.querySelector('.task-title').textContent + ': ' + t.querySelector('pre').textContent.trim().split('\\n').pop().slice(0, 140) : ''; })()"), flush=True)
    time.sleep(20)
print("result", a.eval("[...document.querySelectorAll('.task')].map(t => t.querySelector('.task-title').textContent + ' ' + t.className + ' :: ' + t.querySelector('pre').textContent.trim().split('\\n').slice(-4).join(' | '))"))
print("toasts", a.eval("[...document.querySelectorAll('.toast')].map(t => t.textContent)"))
print("errors", a.errors)
