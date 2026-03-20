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
    excludedFolderPaths: [],
    lastSelectedFolderPath: null,
    lastSelectedFolderIds: null,
    lastSelectedPhoto: null
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
  protocol.handle('lr-media', async (request) => {
    if (request.url.startsWith('lr-media://')) {
        const filePath = decodeURIComponent(request.url.replace('lr-media://', ''));
        try {
            const buffer = fs.readFileSync(filePath);
            let finalBuffer = buffer;

            // Extract pure JPEG from Adobe's wrapper (SOI to EOI)
            const soi = Buffer.from([0xFF, 0xD8]);
            const eoi = Buffer.from([0xFF, 0xD9]);
            
            const soiIndex = buffer.indexOf(soi);
            if (soiIndex !== -1) {
                const eoiIndex = buffer.indexOf(eoi, soiIndex);
                if (eoiIndex !== -1) {
                    // Include the 2 bytes of the EOI marker
                    finalBuffer = buffer.slice(soiIndex, eoiIndex + 2);
                } else {
                    finalBuffer = buffer.slice(soiIndex);
                }
            }

            return new Response(finalBuffer, {
                headers: { 'Content-Type': 'image/jpeg' }
            });
        } catch (e) {
            console.error('[PROTOCOL] Failed to read in-memory:', filePath);
            return new Response(null, { status: 404 });
        }
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

ipcMain.handle('get-thumbnail', async (event, imageId, size = 256) => {
    try {
        const dbPath = store.get('lrDbPath');
        if (!dbPath) return { ok: false, sourcePath: null, reason: 'No DB Path' };

        const catalogDir = path.dirname(dbPath);
        const catalogName = path.basename(dbPath, '.lrcat');
        const previewsRootPath = path.join(catalogDir, `${catalogName} Previews.lrdata`);

        return await resolveLightroomThumbnail({
            imageId,
            catalogPath: dbPath,
            previewsRootPath,
            minSize: size
        });
    } catch (err) {
        return { ok: false, sourcePath: null, reason: err.message };
    }
});

ipcMain.handle('get-photo-metadata', async (event, imageId) => {
    const dbPath = store.get('lrDbPath');
    if (!dbPath) return null;

    try {
        const db = new Database(dbPath, { readonly: true });
        
        // XMP helper functions
        let xmp = '';
        try {
            const xmpRow = db.prepare('SELECT xmp FROM Adobe_AdditionalMetadata WHERE image = ?').get(imageId);
            if (xmpRow && xmpRow.xmp) xmp = xmpRow.xmp;
        } catch (e) { /* XMP not available */ }

        const getXmpTag = (tag) => {
            // Match attribute style: tag="value"
            const attrMatch = xmp.match(new RegExp(`${tag}="([^"]+)"`));
            if (attrMatch) return attrMatch[1];
            // Match element style: <tag>value</tag>
            const elemMatch = xmp.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
            if (elemMatch) return elemMatch[1];
            return '';
        };

        const getXmpLangTag = (tag) => {
            // Match: <tag><rdf:Alt><rdf:li xml:lang="...">value</rdf:li></rdf:Alt></tag>
            const match = xmp.match(new RegExp(`<${tag}>[\\s\\S]*?<rdf:li[^>]*>([^<]+)</rdf:li>`));
            return match ? match[1] : '';
        };

        // 1. Get Caption/Description from AgLibraryIPTC (fallback)
        const iptcRow = db.prepare('SELECT caption FROM AgLibraryIPTC WHERE image = ?').get(imageId) || {};
        
        // 2. Get Location via DB JOINs (fallback for when XMP is empty)
        const locationRow = db.prepare(`
            SELECT 
                loc.value AS location,
                city.value AS city,
                st.value AS state,
                country.value AS country
            FROM AgHarvestedIptcMetadata him
            LEFT JOIN AgInternedIptcLocation loc ON him.locationRef = loc.id_local
            LEFT JOIN AgInternedIptcCity city ON him.cityRef = city.id_local
            LEFT JOIN AgInternedIptcState st ON him.stateRef = st.id_local
            LEFT JOIN AgInternedIptcCountry country ON him.countryRef = country.id_local
            WHERE him.image = ?
        `).get(imageId) || {};

        // 3. Get EXIF (GPS, Camera, Lens, Settings)
        const exifQuery = `
            SELECT 
                e.aperture, 
                e.shutterSpeed, 
                e.isoSpeedRating, 
                e.focalLength,
                e.gpsLatitude, 
                e.gpsLongitude,
                c.value AS cameraModel,
                l.value AS lens
            FROM AgHarvestedExifMetadata e
            LEFT JOIN AgInternedExifCameraModel c ON e.cameraModelRef = c.id_local
            LEFT JOIN AgInternedExifLens l ON e.lensRef = l.id_local
            WHERE e.image = ?
        `;
        const exif = db.prepare(exifQuery).get(imageId) || {};
        
        // 4. Get Keywords
        const keywords = db.prepare(`
            SELECT kw.name 
            FROM AgLibraryKeyword kw
            JOIN AgLibraryKeywordImage ki ON kw.id_local = ki.tag
            WHERE ki.image = ?
        `).all(imageId).map(k => k.name);

        db.close();

        return {
            title: getXmpLangTag('dc:title'),
            caption: getXmpTag('photoshop:Headline'),
            description: getXmpLangTag('dc:description') || iptcRow.caption || '',
            location: getXmpTag('Iptc4xmpCore:Location') || locationRow.location || '',
            city: getXmpTag('photoshop:City') || locationRow.city || '',
            state: getXmpTag('photoshop:State') || locationRow.state || '',
            country: getXmpTag('photoshop:Country') || locationRow.country || '',
            gps: (exif.gpsLatitude && exif.gpsLongitude) ? `${exif.gpsLatitude.toFixed(6)}, ${exif.gpsLongitude.toFixed(6)}` : '',
            keywords: keywords,
            camera: exif.cameraModel || '',
            lens: exif.lens || '',
            focalLength: exif.focalLength ? `${exif.focalLength}mm` : '',
            iso: exif.isoSpeedRating ? `ISO ${exif.isoSpeedRating}` : '',
            aperture: exif.aperture ? `f/${exif.aperture}` : '',
            shutter: exif.shutterSpeed ? `${exif.shutterSpeed}` : ''
        };
    } catch (error) {
        console.error("Metadata Error:", error);
        return null;
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
