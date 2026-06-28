// main/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orvianConfig', {
    get:              (key)        => ipcRenderer.invoke('config:get', key),
    set:              (key, value) => ipcRenderer.invoke('config:set', key, value),
    verifyPin:        (pin, hash)  => ipcRenderer.invoke('pin:verify', pin, hash),
    getResourcesPath: ()           => ipcRenderer.invoke('get:resources-path'), // ← nuevo
});