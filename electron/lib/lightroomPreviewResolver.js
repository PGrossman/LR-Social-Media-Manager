import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const THUMB_RESOLVER_VERSION = 'lr-preview-v2';

// Helper to reliably extract JPEG from Adobe .lrprev wrapper
function extractJpegFromLrprev(buffer) {
    const jpegStart = buffer.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]));
    if (jpegStart !== -1) {
        return buffer.slice(jpegStart);
    }
    return null;
}

export async function resolveLightroomThumbnail({ imageId, catalogPath, previewsRootPath, thumbnailsDir }) {
    if (!catalogPath || !fs.existsSync(catalogPath)) {
        return { ok: false, cachedPath: null, sourceType: 'none', reason: 'catalog-missing' };
    }
    
    // 1. Build cache key
    const catalogHash = crypto.createHash('md5').update(catalogPath).digest('hex').substring(0, 8);
    const cacheFilename = `${THUMB_RESOLVER_VERSION}-${catalogHash}-${imageId}.jpg`;
    const cachedPath = path.join(thumbnailsDir, cacheFilename);

    // If cache exists, return it instantly
    if (fs.existsSync(cachedPath)) {
        return { ok: true, cachedPath, sourceType: 'cache', debug: { msg: 'Cache hit' } };
    }

    const previewsDbPath = path.join(previewsRootPath, 'previews.db');
    if (!fs.existsSync(previewsDbPath)) {
        return { ok: false, cachedPath: null, sourceType: 'none', reason: 'previews.db not found at ' + previewsDbPath };
    }

    let resolvedAssetPath = null;
    let sourceType = 'none';

    try {
        const db = new Database(previewsDbPath, { readonly: true });
        
        // Introspect exactly what columns exist in ImageCacheEntry
        const tableInfo = db.prepare(`PRAGMA table_info(ImageCacheEntry)`).all();
        const columns = tableInfo.map(col => col.name);
        
        console.log(`[LR-DB] ImageCacheEntry columns for imageId ${imageId}:`, columns);
        
        const row = db.prepare('SELECT * FROM ImageCacheEntry WHERE imageId = ?').get(imageId);
        db.close();

        if (!row) {
            return { ok: false, cachedPath: null, sourceType: 'none', reason: 'no preview metadata for imageId' };
        }

        const uuid = row.uuid;
        const digest = row.digest; // Found the missing link!

        if (!uuid) {
            return { ok: false, cachedPath: null, sourceType: 'none', reason: 'uuid missing in ImageCacheEntry row' };
        }

        const level1 = uuid.charAt(0).toUpperCase();
        const level2 = uuid.substring(0, 4).toUpperCase();
        const previewBaseDir = path.join(previewsRootPath, level1, level2);
        
        // Use digest to form the exact .lrprev filename without guessing!
        let targetFilename = `${uuid}.lrprev`;
        if (digest) {
            targetFilename = `${uuid}-${digest}.lrprev`;
        }
        
        const lrPreviewPath = path.join(previewBaseDir, targetFilename);
        
        if (fs.existsSync(lrPreviewPath)) {
            resolvedAssetPath = lrPreviewPath;
            sourceType = 'lrprev';
        } else {
            // Fallback: check standard uuid just in case digest is ignored by LR version
            const fallbackPath = path.join(previewBaseDir, `${uuid}.lrprev`);
            if (fs.existsSync(fallbackPath)) {
                resolvedAssetPath = fallbackPath;
                sourceType = 'lrprev';
            }
        }

    } catch (err) {
        console.error('[LR-DB] SQLite access error:', err);
        return { ok: false, cachedPath: null, sourceType: 'none', reason: 'SQLite error interpreting previews.db' };
    }

    if (!resolvedAssetPath) {
        return { ok: false, cachedPath: null, sourceType: 'none', reason: 'preview metadata found but asset missing on disk' };
    }

    // 2. Extract JPEG payload
    try {
        const fileData = fs.readFileSync(resolvedAssetPath);
        const jpegBuffer = extractJpegFromLrprev(fileData);
        
        if (jpegBuffer) {
            fs.writeFileSync(cachedPath, jpegBuffer);
            return { ok: true, cachedPath, sourceType, debug: { resolvedAssetPath } };
        } else {
            return { ok: false, cachedPath: null, sourceType, reason: 'lrprev found but no jpeg payload extracted' };
        }
    } catch (err) {
        console.error('[LR-CACHE] Buffer slice failure:', err);
        return { ok: false, cachedPath: null, sourceType, reason: 'Failed to read asset from disk' };
    }
}
