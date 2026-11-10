import io
import os
import sys
import time

from PIL import Image

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from cdp import App
import base64

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "img")
os.makedirs(OUT, exist_ok=True)
a = App()
a.cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 800, "deviceScaleFactor": 2, "mobile": False})


def shot(name):
    time.sleep(1.2)
    data = base64.b64decode(a.cmd("Page.captureScreenshot", {"format": "png"})["data"])
    Image.open(io.BytesIO(data)).convert("RGB").save(os.path.join(OUT, f"{name}.webp"), "WEBP", quality=88, method=6)
    print("shot", name, flush=True)


def pick(name, tab=None):
    a.eval("document.querySelector('#modal').open && document.querySelector('#modal').close()")
    a.eval(f"[...document.querySelectorAll('.inst-item')].find(b => b.innerText.includes({name!r})).click()")
    time.sleep(0.8)
    if tab:
        a.eval(f"document.querySelector('[data-tab={tab}]').click()")
        time.sleep(1.5)


def running(name):
    pick(name, "overview")
    if not a.eval("document.querySelector('.status-line').innerText.includes('Running')"):
        a.eval("document.querySelector('#start').click()")
        a.until("document.querySelector('.status-line')?.innerText.includes('Running')", 240)


for name in ("Odoo 18 Community", "Odoo 18 Enterprise", "Odoo 19 Community", "Odoo 19 Enterprise", "Odoo 20 Community", "Odoo 20 Enterprise"):
    running(name)

pick("Odoo 20 Enterprise", "overview")
a.eval("document.querySelectorAll('.task.done').forEach(t => t.remove())")
a.cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 2, "mobile": False})
shot("hero")
a.cmd("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 800, "deviceScaleFactor": 2, "mobile": False})

pick("Odoo 20 Enterprise", "logs")
a.eval("document.querySelector('#log').scrollTop = 1e9")
shot("logs")

pick("Odoo 20 Community", "databases")
a.until("!!document.querySelector('tr[data-db]')", 60)
a.eval("document.querySelectorAll('details.others').forEach(d => d.open = false)")
shot("databases")

a.eval("document.querySelector('#db-new').click()")
a.until("document.querySelector('#modal').open", 10)
a.eval("(() => { const f = document.querySelector('#modal-form'); f.name.value = 'training_20'; f.demo.checked = true; })()")
shot("new-database")
a.eval("document.querySelector('#modal').close()")

a.eval("document.querySelector('#add-instance').click()")
a.until("document.querySelector('#modal').open", 10)
shot("add-instance")
a.eval("document.querySelector('#modal').close()")

pick("Odoo 20 Community", "modules")
a.until("!!document.querySelector('.mod-check')", 60)
a.eval("(() => { const s = document.querySelector('#mod-search'); s.value = 'crm'; s.dispatchEvent(new Event('input')); })()")
time.sleep(0.6)
a.eval("[...document.querySelectorAll('tr')].find(r => r.innerText.includes('Not installed') && r.querySelector('.mod-check:not([disabled])'))?.querySelector('.mod-check').click()")
shot("modules")
a.eval("document.querySelectorAll('.mod-check:checked').forEach(c => c.click())")

a.eval("document.querySelector('#open-store').click()")
a.until("document.querySelectorAll('.app-card img').length > 0", 40)
a.until("[...document.querySelectorAll('.app-card img')].slice(0, 8).every(i => i.complete && i.naturalWidth > 0)", 40)
shot("apps")

a.cmd("Emulation.clearDeviceMetricsOverride")
print("errors", a.errors)
