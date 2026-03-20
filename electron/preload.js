import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    getCatalog: (excludedFolders) => ipcRenderer.invoke('get-catalog', excludedFolders),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    hideFolder: (folderId) => ipcRenderer.invoke('hide-folder', folderId)
});
