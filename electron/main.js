import { app, BrowserWindow, ipcMain, protocol, dialog, net } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { resolveLightroomThumbnail } from './lib/lightroomPreviewResolver.js';

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
  protocol.handle('local-img', (request) => {
    // Only strip our exact explicit custom protocol flag
    if (request.url.startsWith('local-img://')) {
        const url = request.url.replace('local-img://', '');
        return net.fetch('file://' + decodeURIComponent(url));
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

ipcMain.handle('clear-thumbnail-cache', async () => {
  try {
    const thumbnailsDir = path.join(app.getPath('userData'), 'lr-thumbnails');
    if (!fs.existsSync(thumbnailsDir)) return 0;
    
    const files = fs.readdirSync(thumbnailsDir);
    let count = 0;
    for (const file of files) {
      if (file.endsWith('.jpg')) {
        fs.unlinkSync(path.join(thumbnailsDir, file));
        count++;
      }
    }
    return count;
  } catch (err) {
    console.error('Failed to clear cache:', err);
    return 0;
  }
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

ipcMain.handle('get-thumbnail', async (event, imageId) => {
    try {
        const settings = store.store;
        const catalogPath = settings.lrDbPath;
        if (!catalogPath) return { ok: false, cachedPath: null, sourceType: 'none', reason: 'No catalog configured' };

        const catalogDir = path.dirname(catalogPath);
        const catalogName = path.basename(catalogPath, '.lrcat');
        const previewsRootPath = path.join(catalogDir, `${catalogName} Previews.lrdata`);
        const thumbnailsDir = path.join(app.getPath('userData'), 'lr-thumbnails');
        if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });

        const result = await resolveLightroomThumbnail({
            imageId,
            catalogPath,
            previewsRootPath,
            thumbnailsDir
        });
        return result;
    } catch (err) {
        console.error('[LR-PREVIEW] fatal get-thumbnail error', err);
        return {
            ok: false,
            cachedPath: null,
            sourceType: 'none',
            reason: err?.message || 'unknown get-thumbnail error'
        };
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

        let limitClause = '';
        if (selectedFolderIds === null) {
            // Cap at 300 to prevent React VDOM from locking up on the global "Recent" load
            limitClause = 'LIMIT 300';
        }

        const query = `
            SELECT 
                img.id_local AS image_id,
                img.id_global AS uuid,
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
            ${limitClause}
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
