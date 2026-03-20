import { app, BrowserWindow, ipcMain, protocol, dialog } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store({
  defaults: {
    lrDbPath: '',
    geminiApiToken: '',
    theme: 'dark',
    thumbnailSize: 200,
    excludedFolders: [],
    excludedFolderPaths: []
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  // Register a custom protocol to safely load local files for images
  protocol.registerFileProtocol('local-img', (request, callback) => {
    const url = request.url.replace('local-img://', '');
    try {
      return callback({ path: decodeURIComponent(url) });
    } catch (error) {
       console.error(error);
       return callback({ statusCode: 404 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// IPC Handlers
ipcMain.handle('get-settings', () => store.store);

ipcMain.handle('save-settings', (event, newSettings) => {
  store.set(newSettings);
  return store.store;
});

ipcMain.handle('set-folder-visibility', (event, folderPath, visible) => {
  let excludedFolderPaths = store.get('excludedFolderPaths') || [];
  if (!visible) {
    if (!excludedFolderPaths.includes(folderPath)) {
      excludedFolderPaths.push(folderPath);
    }
  } else {
    excludedFolderPaths = excludedFolderPaths.filter(p => p !== folderPath);
  }
  store.set('excludedFolderPaths', excludedFolderPaths);
  return excludedFolderPaths;
});

ipcMain.handle('select-lrcat-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Lightroom Catalogs', extensions: ['lrcat'] }
    ]
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('get-folders', async (event, excludedFolderPaths = []) => {
    const dbPath = store.get('lrDbPath'); 
    if (!dbPath) return [];

    try {
        const db = new Database(dbPath, { readonly: true });
        
        let whereClause = '';
        if (excludedFolderPaths.length > 0) {
            const conditions = excludedFolderPaths.map(() => `pathFromRoot NOT LIKE ?`).join(' AND ');
            whereClause = `WHERE ` + conditions;
        }

        const query = `
            SELECT pathFromRoot, id_local 
            FROM AgLibraryFolder
            ${whereClause}
            ORDER BY pathFromRoot ASC;
        `;

        const params = excludedFolderPaths.map(p => p + '%');
        const rows = excludedFolderPaths.length > 0 
            ? db.prepare(query).all(...params) 
            : db.prepare(query).all();

        db.close();
        return rows;
    } catch (error) {
        console.error("Database Error (Folders):", error);
        return [];
    }
});

ipcMain.handle('get-catalog', async (event, excludedFolderPaths = [], selectedFolderIds = null) => {
    const dbPath = store.get('lrDbPath'); 
    if (!dbPath) return [];

    try {
        const db = new Database(dbPath, { readonly: true });
        
        let whereClause = 'WHERE 1=1';
        if (excludedFolderPaths.length > 0) {
            const conditions = excludedFolderPaths.map(() => `folder.pathFromRoot NOT LIKE ?`).join(' AND ');
            whereClause += ` AND ` + conditions;
        }
        
        if (selectedFolderIds !== null) {
            if (selectedFolderIds.length > 0) {
                const placeholders = selectedFolderIds.map(() => '?').join(',');
                whereClause += ` AND folder.id_local IN (${placeholders})`;
            } else {
                db.close();
                return []; // completely empty mid-level folder selection
            }
        }

        const query = `
            SELECT 
                img.id_local AS image_id,
                root.absolutePath AS root_path,
                folder.pathFromRoot AS folder_path,
                file.baseName || '.' || file.extension AS file_name,
                folder.id_local AS folder_id
            FROM Adobe_images img
            JOIN AgLibraryFile file ON img.rootFile = file.id_local
            JOIN AgLibraryFolder folder ON file.folder = folder.id_local
            JOIN AgLibraryRootFolder root ON folder.rootFolder = root.id_local
            ${whereClause}
            ORDER BY img.captureTime DESC
            LIMIT 100;
        `;

        const params = excludedFolderPaths.map(p => p + '%');
        if (selectedFolderIds !== null && selectedFolderIds.length > 0) {
            params.push(...selectedFolderIds);
        }

        const rows = db.prepare(query).all(...params);

        db.close();

        return rows.map(row => ({
            ...row,
            full_file_path: path.join(row.root_path, row.folder_path, row.file_name)
        }));

    } catch (error) {
        console.error("Database Error:", error);
        return [];
    }
});
