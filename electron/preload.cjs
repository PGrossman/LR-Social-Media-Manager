const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getCatalog: (excludedFolders, selectedFolderId) => ipcRenderer.invoke('get-catalog', excludedFolders, selectedFolderId),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    hideFolder: (folderId) => ipcRenderer.invoke('hide-folder', folderId),
    getFolderTree: (excludedFolders) => ipcRenderer.invoke('get-folders', excludedFolders),
    selectLrcatFile: () => ipcRenderer.invoke('select-lrcat-file')
});
