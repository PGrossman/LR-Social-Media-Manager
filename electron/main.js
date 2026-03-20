import { app, BrowserWindow, ipcMain, protocol, dialog, net } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
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

ipcMain.handle('get-thumbnail', async (event, imageId, _ignoredUuid) => {
    const dbPath = store.get('lrDbPath');
    if (!dbPath) return null;

    const thumbnailsDir = path.join(app.getPath('userData'), 'lr-thumbnails');
    if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });

    const cachedPath = path.join(thumbnailsDir, `${imageId}.jpg`);
    if (fs.existsSync(cachedPath)) return cachedPath;

    const catalogDir = path.dirname(dbPath);
    const catalogName = path.basename(dbPath, '.lrcat');
    const previewsDbPath = path.join(catalogDir, `${catalogName} Previews.lrdata`, 'previews.db');

    if (!fs.existsSync(previewsDbPath)) return null;

    let actualPreviewUuid = null;
    try {
        // We MUST query previews.db. The main catalog's id_global does NOT match the preview UUID.
        const previewDb = new Database(previewsDbPath, { readonly: true });
        const row = previewDb.prepare('SELECT uuid FROM ImageCacheEntry WHERE imageId = ?').get(imageId);
        previewDb.close();
        
        if (row && row.uuid) {
            actualPreviewUuid = row.uuid;
        }
    } catch (error) {
        console.error('Preview DB Read Error for imageId', imageId, ':', error);
        return null;
    }

    if (!actualPreviewUuid) return null;

    const level1 = actualPreviewUuid.charAt(0).toUpperCase();
    const level2 = actualPreviewUuid.substring(0, 4).toUpperCase();
    const previewBaseDir = path.join(catalogDir, `${catalogName} Previews.lrdata`, level1, level2);
    
    const possibleFilenames = [
        `${actualPreviewUuid}.lrprev`,
        `${actualPreviewUuid}-preview.lrprev`,
        `${actualPreviewUuid}.jpg`,
        `${actualPreviewUuid}-preview.jpg`
    ];

    for (const filename of possibleFilenames) {
        const lrPreviewPath = path.join(previewBaseDir, filename);
        if (fs.existsSync(lrPreviewPath)) {
            try {
                const fileData = fs.readFileSync(lrPreviewPath);
                // Strip the proprietary Adobe header to extract the pure JPEG
                const jpegStart = fileData.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]));
                
                if (jpegStart !== -1) {
                    fs.writeFileSync(cachedPath, fileData.slice(jpegStart));
                    return cachedPath;
                } else if (filename.toLowerCase().endsWith('.jpg')) {
                    fs.copyFileSync(lrPreviewPath, cachedPath);
                    return cachedPath;
                }
            } catch (err) {
                console.error('File read error:', err);
            }
        }
    }
    return null;
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
