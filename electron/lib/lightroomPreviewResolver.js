import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const THUMB_RESOLVER_VERSION = 'lr-preview-v3'; // Increment version for fresh cache
const ENABLE_DIAGNOSTIC_GUESS_FALLBACK = false;

/**
 * Robust JPEG extraction from a buffer.
 * Scans for all SOI (FF D8) and EOI (FF D9) pairs and returns the largest valid JPEG.
 */
function extractJpegFromBuffer(buffer) {
    const candidates = [];
    
    for (let i = 0; i < buffer.length - 1; i++) {
        // Find SOI: 0xFF 0xD8
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
            const soiIndex = i;
            // Find EOI: 0xFF 0xD9
            for (let j = i + 2; j < buffer.length - 1; j++) {
                if (buffer[j] === 0xFF && buffer[j + 1] === 0xD9) {
                    const eoiIndex = j + 2; // inclusive of FF D9
                    const slice = buffer.slice(soiIndex, eoiIndex);
                    
                    if (slice.length > 100) {
                        candidates.push(slice);
                    }
                    // Continue searching for more EOIs for this SOI? 
                    // No, usually a JPEG ends at the first valid EOI for its segment.
                    // But we proceed to next SOI search.
                    break; 
                }
            }
        }
    }

    if (candidates.length === 0) return null;

    // Return the largest valid candidate
    candidates.sort((a, b) => b.length - a.length);
    console.log(`[LR-PREVIEW] Extracted ${candidates.length} JPEG candidates. Largest: ${candidates[0].length} bytes.`);
    return candidates[0];
}

/**
 * Validates that a file is a valid JPEG (starts FF D8, ends FF D9, size > 100).
 */
function validateCacheFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        const stats = fs.statSync(filePath);
        if (stats.size < 100) return false;

        const fd = fs.openSync(filePath, 'r');
        const startBuffer = Buffer.alloc(2);
        const endBuffer = Buffer.alloc(2);
        
        fs.readSync(fd, startBuffer, 0, 2, 0);
        fs.readSync(fd, endBuffer, 0, 2, stats.size - 2);
        fs.closeSync(fd);

        const isValid = startBuffer[0] === 0xFF && startBuffer[1] === 0xD8 &&
                       endBuffer[0] === 0xFF && endBuffer[1] === 0xD9;
        
        return isValid;
    } catch (err) {
        return false;
    }
}

/**
 * Introspects a database for its tables and column info.
 */
function inspectDatabaseSchema(dbPath) {
    if (!fs.existsSync(dbPath)) return { error: 'file-not-found' };
    try {
        const db = new Database(dbPath, { readonly: true });
        const tables = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all();
        const schema = {};
        
        for (const table of tables) {
            schema[table.name] = db.prepare(`PRAGMA table_info(${table.name})`).all();
        }
        db.close();
        return { tables, schema };
    } catch (err) {
        return { error: err.message };
    }
}

export async function resolveLightroomThumbnail({ imageId, catalogPath, previewsRootPath, thumbnailsDir }) {
    const debug = {
        previewsDbSchema: null,
        rootPixelsDbSchema: null,
        resolutionSteps: [],
    };

    if (!catalogPath || !fs.existsSync(catalogPath)) {
        return { ok: false, cachedPath: null, sourceType: 'none', reason: 'catalog-missing', debug };
    }

    // 1. Check/Validate Cache
    const catalogHash = crypto.createHash('md5').update(catalogPath).digest('hex').substring(0, 8);
    const cacheFilename = `${THUMB_RESOLVER_VERSION}-${catalogHash}-${imageId}.jpg`;
    const cachedPath = path.join(thumbnailsDir, cacheFilename);

    if (validateCacheFile(cachedPath)) {
        return { ok: true, cachedPath, sourceType: 'cache', debug: { msg: 'Valid cache hit' } };
    } else if (fs.existsSync(cachedPath)) {
        console.log(`[LR-CACHE] Invalid cache file detected for image ${imageId}. Deleting and regenerating.`);
        fs.unlinkSync(cachedPath);
    }

    // 2. Resolve via previews.db
    const previewsDbPath = path.join(previewsRootPath, 'previews.db');
    if (fs.existsSync(previewsDbPath)) {
        debug.previewsDbSchema = inspectDatabaseSchema(previewsDbPath);
        debug.resolutionSteps.push('Inspected previews.db');

        try {
            const db = new Database(previewsDbPath, { readonly: true });
            
            // Look for mappings. We prefer tables that link imageId to a specific cache record.
            // ImageCacheEntry is the standard Lightroom 10+ location.
            const row = db.prepare('SELECT * FROM ImageCacheEntry WHERE imageId = ?').get(imageId);
            
            if (row) {
                debug.resolutionSteps.push(`Found entry in ImageCacheEntry: uuid=${row.uuid}, digest=${row.digest}`);
                const uuid = row.uuid;
                const digest = row.digest;
                
                if (uuid) {
                    const level1 = uuid.charAt(0).toUpperCase();
                    const level2 = uuid.substring(0, 4).toUpperCase();
                    const previewBaseDir = path.join(previewsRootPath, level1, level2);
                    
                    // DETERMINISTIC PATH: uuid + digest if present
                    const assetFilename = digest ? `${uuid}-${digest}.lrprev` : `${uuid}.lrprev`;
                    const assetPath = path.join(previewBaseDir, assetFilename);
                    
                    if (fs.existsSync(assetPath)) {
                        debug.resolutionSteps.push(`Found asset: ${assetPath}`);
                        const fileData = fs.readFileSync(assetPath);
                        const jpegBuffer = extractJpegFromBuffer(fileData);
                        
                        if (jpegBuffer) {
                            fs.writeFileSync(cachedPath, jpegBuffer);
                            db.close();
                            return { ok: true, cachedPath, sourceType: 'lrprev', debug };
                        }
                    } else {
                        debug.resolutionSteps.push(`Asset missing on disk: ${assetPath}`);
                    }
                }
            }
            db.close();
        } catch (err) {
            debug.resolutionSteps.push(`previews.db error: ${err.message}`);
        }
    } else {
        debug.resolutionSteps.push('previews.db missing');
    }

    // 3. Fallback to root-pixels.db
    const rootPixelsDbPath = path.join(previewsRootPath, 'root-pixels.db');
    if (fs.existsSync(rootPixelsDbPath)) {
        debug.rootPixelsDbSchema = inspectDatabaseSchema(rootPixelsDbPath);
        debug.resolutionSteps.push('Inspected root-pixels.db');

        try {
            const db = new Database(rootPixelsDbPath, { readonly: true });
            // RootPixels often uses 'hash' or 'uuid' linked to imageId
            // We search for a blob in tables like 'rootPixels' or 'thumbnails'
            // NOTE: This schema varies wildly. We check for 'adobe_image_id' or 'imageId'
            const candidateTables = debug.rootPixelsDbSchema.tables.filter(t => t.name.toLowerCase().includes('pixel') || t.name.toLowerCase().includes('thumb'));
            
            for (const table of candidateTables) {
                const cols = debug.rootPixelsDbSchema.schema[table.name].map(c => c.name.toLowerCase());
                const idCol = cols.find(c => c === 'imageid' || c === 'adobe_image_id');
                const blobCol = cols.find(c => c === 'pixels' || c === 'jpeg' || c === 'blob' || c === 'data');
                
                if (idCol && blobCol) {
                    const row = db.prepare(`SELECT ${blobCol} as data FROM ${table.name} WHERE ${idCol} = ?`).get(imageId);
                    if (row && row.data) {
                        debug.resolutionSteps.push(`Found blob in root-pixels.db [${table.name}]`);
                        const jpegBuffer = extractJpegFromBuffer(Buffer.from(row.data));
                        if (jpegBuffer) {
                            fs.writeFileSync(cachedPath, jpegBuffer);
                            db.close();
                            return { ok: true, cachedPath, sourceType: 'root-pixels', debug };
                        }
                    }
                }
            }
            db.close();
        } catch (err) {
            debug.resolutionSteps.push(`root-pixels.db error: ${err.message}`);
        }
    }

    // 4. Diagnostic Guess Fallback (Disabled by default)
    if (ENABLE_DIAGNOSTIC_GUESS_FALLBACK) {
        // Implementation omitted to satisfy "No Primary-Path Filename Guessing" requirement.
        // If needed for emergency debug, add uuid-based prefix looping here.
    }

    return { ok: false, cachedPath: null, sourceType: 'none', reason: 'No preview asset found after full DB scan', debug };
}
