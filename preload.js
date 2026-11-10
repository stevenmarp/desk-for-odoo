const { contextBridge, ipcRenderer } = require("electron");

const call = async (channel, payload) => {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

contextBridge.exposeInMainWorld("desk", {
  call,
  on: (channel, listener) => {
    if (!["log", "status", "task"].includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => listener(payload));
  },
});
