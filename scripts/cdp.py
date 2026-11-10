import base64
import json
import sys
import time
import urllib.request

import websocket


class App:
    def __init__(self, port=9555):
        for _ in range(60):
            try:
                pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                page = next(p for p in pages if p.get("type") == "page")
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise SystemExit("Desk for Odoo is not reachable on the debug port")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=600, suppress_origin=True)
        self.n = 0
        self.errors = []
        self.cmd("Runtime.enable")
        self.cmd("Log.enable")

    def cmd(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                self.errors.append(msg["params"]["exceptionDetails"].get("exception", {}).get("description", "exception"))
            if msg.get("method") == "Runtime.consoleAPICalled" and msg["params"]["type"] == "error":
                self.errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in msg["params"]["args"]))
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def eval(self, expression, wait=True):
        result = self.cmd("Runtime.evaluate", {"expression": expression, "awaitPromise": wait, "returnByValue": True})
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("exception", {}).get("description", result["exceptionDetails"]))
        return result.get("result", {}).get("value")

    def until(self, expression, timeout=60, step=0.5):
        end = time.time() + timeout
        while time.time() < end:
            if self.eval(expression):
                return True
            time.sleep(step)
        raise TimeoutError(expression)

    def shot(self, path):
        data = self.cmd("Page.captureScreenshot", {"format": "png"})["data"]
        open(path, "wb").write(base64.b64decode(data))


if __name__ == "__main__":
    app = App()
    print(app.eval(sys.argv[1]))
