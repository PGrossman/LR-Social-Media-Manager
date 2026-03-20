import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export async function resolveLightroomThumbnail({ imageId, catalogPath, previewsRootPath, minSize = 256 }) {
    const debug = { steps: [] };

    try {
        const previewsDbPath = path.join(previewsRootPath, 'previews.db');
        if (!fs.existsSync(previewsDbPath)) {
            return { ok: false, sourcePath: null, sourceType: 'none', reason: 'previews.db not found' };
        }

        const db = new Database(previewsDbPath, { readonly: true });
        
        // 1. Get UUID and orientation from ImageCacheEntry
        let uuid = null;
        let digest = null;
        let orientation = null;

        try {
            const row = db.prepare('SELECT uuid, digest, orientation FROM ImageCacheEntry WHERE imageId = ?').get(imageId);
            if (row) {
                uuid = row.uuid;
                digest = row.digest;
                orientation = row.orientation;
            }
        } catch (e) {
            debug.steps.push('ImageCacheEntry table missing');
        }

        if (!uuid) {
            db.close();
            return { ok: false, sourcePath: null, sourceType: 'none', reason: 'No UUID found for imageId' };
        }

        // 2. Get FULL Digest and Dimension from PyramidLevel
        let fullDigest = null;
        let longDimension = null;
        
        try {
            const levels = db.prepare('SELECT digest, longDimension FROM PyramidLevel WHERE uuid = ? ORDER BY longDimension ASC').all(uuid);
            
            if (levels && levels.length > 0) {
                const targetLevel = levels.find(l => l.longDimension >= minSize) || levels[levels.length - 1];
                fullDigest = targetLevel.digest;
                longDimension = targetLevel.longDimension;
            }
        } catch (e) {
            debug.steps.push('PyramidLevel query failed');
        }

        // 3. Resolve the physical file
        if (fullDigest && longDimension) {
            const level1 = uuid.charAt(0).toUpperCase();
            const level2 = uuid.substring(0, 4).toUpperCase();
            
            const filename = `${uuid}-${fullDigest}_${longDimension}`;
            const lrPrevPath = path.join(previewsRootPath, level1, level2, filename);
            
            if (fs.existsSync(lrPrevPath)) {
                db.close();
                return { ok: true, sourcePath: lrPrevPath, sourceType: 'lrprev', orientation, debug };
            }
        }

        // 4. FALLBACK: root-pixels.db
        const rootPixelsDbPath = path.join(previewsRootPath, 'root-pixels.db');
        if (fs.existsSync(rootPixelsDbPath)) {
            const rpDb = new Database(rootPixelsDbPath, { readonly: true });
            try {
                const rpRow = rpDb.prepare('SELECT jpegData FROM RootPixels WHERE uuid = ?').get(uuid);
                if (rpRow && rpRow.jpegData) {
                    rpDb.close();
                    db.close();
                    return { 
                        ok: true, 
                        sourcePath: `data:image/jpeg;base64,${rpRow.jpegData.toString('base64')}`, 
                        sourceType: 'base64', 
                        orientation,
                        debug 
                    };
                }
            } catch (e) { /* Ignore */ }
            rpDb.close();
        }

        db.close();
        return { ok: false, sourcePath: null, sourceType: 'none', reason: 'preview asset missing', debug };

    } catch (err) {
        console.error('[LR-PREVIEW] resolver error:', err);
        return { ok: false, sourcePath: null, sourceType: 'none', reason: err.message, debug };
    }
}
