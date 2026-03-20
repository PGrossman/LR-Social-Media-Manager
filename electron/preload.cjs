const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getCatalog: (excludedFolderPaths, selectedFolderIds) => ipcRenderer.invoke('get-catalog', excludedFolderPaths, selectedFolderIds),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    setFolderVisibility: (folderPath, visible) => ipcRenderer.invoke('set-folder-visibility', folderPath, visible),
    getFolderTree: (excludedFolderPaths) => ipcRenderer.invoke('get-folders', excludedFolderPaths),
    selectLrcatFile: () => ipcRenderer.invoke('select-lrcat-file'),
    getThumbnail: (imageId, size) => ipcRenderer.invoke('get-thumbnail', imageId, size),
    clearThumbnailCache: () => ipcRenderer.invoke('clear-thumbnail-cache'),
    getPhotoMetadata: (imageId) => ipcRenderer.invoke('get-photo-metadata', imageId)
});
