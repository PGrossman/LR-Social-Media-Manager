import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const THUMB_RESOLVER_VERSION = 'lr-preview-v4';
const ENABLE_DIAGNOSTIC_GUESS_FALLBACK = false;

// ============================================================
// PART 5: JPEG EXTRACTION — SOI/EOI scanner, largest candidate
// ============================================================

function extractJpegFromBuffer(buffer) {
    const candidates = [];

    for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
            for (let j = i + 2; j < buffer.length - 1; j++) {
                if (buffer[j] === 0xFF && buffer[j + 1] === 0xD9) {
                    const slice = buffer.slice(i, j + 2);
                    if (slice.length > 100) {
                        candidates.push(slice);
                    }
                    break;
                }
            }
        }
    }

    if (candidates.length === 0) {
        return { jpeg: null, candidateCount: 0, reason: 'no SOI/EOI pair found in buffer' };
    }

    candidates.sort((a, b) => b.length - a.length);
    return {
        jpeg: candidates[0],
        candidateCount: candidates.length,
        selectedSize: candidates[0].length
    };
}

// ============================================================
// PART 6: CACHE VALIDATION — SOI + EOI + size > 100
// ============================================================

function validateCacheFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        const stats = fs.statSync(filePath);
        if (stats.size <= 100) return false;

        const fd = fs.openSync(filePath, 'r');
        const head = Buffer.alloc(2);
        const tail = Buffer.alloc(2);
        fs.readSync(fd, head, 0, 2, 0);
        fs.readSync(fd, tail, 0, 2, stats.size - 2);
        fs.closeSync(fd);

        return head[0] === 0xFF && head[1] === 0xD8 &&
               tail[0] === 0xFF && tail[1] === 0xD9;
    } catch {
        return false;
    }
}

// ============================================================
// PART 3 & 10: SCHEMA DISCOVERY + PLAN BUILDER
// ============================================================

function getSqliteTables(db) {
    return db.prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name"
    ).all();
}

function getTableColumns(db, tableName) {
    return db.prepare(`PRAGMA table_info("${tableName}")`).all();
}

function inspectDatabaseSchema(db) {
    const rawTables = getSqliteTables(db);
    const tables = rawTables.map(t => t.name);
    const columnsByTable = {};
    for (const name of tables) {
        columnsByTable[name] = getTableColumns(db, name).map(c => ({
            name: c.name,
            type: c.type,
            pk: c.pk
        }));
    }
    return { tables, columnsByTable };
}

const HINT_FIELDS = [
    'imageid', 'uuid', 'digest', 'pyramid', 'cache',
    'pixel', 'root', 'orientation', 'entry', 'level',
    'width', 'height'
];

function findCandidatePreviewTables(schema) {
    const candidates = [];
    for (const tableName of schema.tables) {
        const columns = schema.columnsByTable[tableName] || [];
        const colNamesLower = columns.map(c => c.name.toLowerCase());
        const matchedHints = HINT_FIELDS.filter(h =>
            colNamesLower.some(c => c.includes(h))
        );
        if (matchedHints.length > 0) {
            candidates.push({ table: tableName, columns, matchedHints });
        }
    }
    return candidates;
}

function findCandidateRootPixelTables(schema) {
    const candidates = [];
    for (const tableName of schema.tables) {
        const columns = schema.columnsByTable[tableName] || [];
        const colNamesLower = columns.map(c => c.name.toLowerCase());

        const hasId = colNamesLower.some(c =>
            c === 'imageid' || c === 'uuid' || c === 'image_id' || c === 'cacheid'
        );
        const hasBlob = columns.some(c =>
            (c.type || '').toUpperCase().includes('BLOB')
        );
        const hasBlobByName = colNamesLower.some(c =>
            c === 'data' || c === 'pixels' || c === 'jpeg' ||
            c === 'blob' || c === 'thumbnail' || c === 'image'
        );

        if (hasId && (hasBlob || hasBlobByName)) {
            candidates.push({
                table: tableName,
                columns,
                idColumns: columns.filter((col, i) =>
                    ['imageid', 'uuid', 'image_id', 'cacheid'].includes(colNamesLower[i])
                ),
                blobColumns: columns.filter((col, i) =>
                    (col.type || '').toUpperCase().includes('BLOB') ||
                    ['data', 'pixels', 'jpeg', 'blob', 'thumbnail', 'image'].includes(colNamesLower[i])
                )
            });
        }
    }
    return candidates;
}

function buildPreviewResolutionPlan(schema) {
    const candidates = findCandidatePreviewTables(schema);
    const plan = {
        entryTable: null,
        entryIdColumn: null,
        entryUuidColumn: null,
        relationTables: [],
        assetKeyColumns: {},
        confidence: 0,
        candidateSummary: candidates.map(c => ({
            table: c.table,
            columns: c.columns.map(col => col.name),
            matchedHints: c.matchedHints
        }))
    };

    for (const c of candidates) {
        const colNamesLower = c.columns.map(col => col.name.toLowerCase());
        const imageIdIdx = colNamesLower.findIndex(n => n === 'imageid');
        if (imageIdIdx !== -1) {
            plan.entryTable = c.table;
            plan.entryIdColumn = c.columns[imageIdIdx].name;

            const uuidIdx = colNamesLower.findIndex(n => n === 'uuid');
            if (uuidIdx !== -1) {
                plan.entryUuidColumn = c.columns[uuidIdx].name;
                plan.confidence += 1;
            }

            const digestIdx = colNamesLower.findIndex(n => n === 'digest');
            if (digestIdx !== -1) {
                plan.assetKeyColumns.entryDigest = c.columns[digestIdx].name;
                plan.confidence += 1;
            }

            plan.confidence += 1;
            break;
        }
    }

    if (plan.entryUuidColumn) {
        for (const c of candidates) {
            if (c.table === plan.entryTable) continue;
            const colNamesLower = c.columns.map(col => col.name.toLowerCase());
            const uuidIdx = colNamesLower.findIndex(n => n === 'uuid');
            if (uuidIdx !== -1) {
                plan.relationTables.push({
                    table: c.table,
                    joinColumn: c.columns[uuidIdx].name,
                    columns: c.columns.map(col => col.name),
                    hasDigest: colNamesLower.includes('digest'),
                    hasLevel: colNamesLower.includes('level'),
                    hasWidth: colNamesLower.includes('width'),
                    hasHeight: colNamesLower.includes('height')
                });
                plan.confidence += 1;
            }
        }
    }

    return plan;
}

// ============================================================
// PART 2: FILESYSTEM SEARCH — no uppercase assumptions
// ============================================================

function findPreviewFilesOnDisk(previewsRootPath, uuid, debug) {
    const found = [];
    if (!uuid || !fs.existsSync(previewsRootPath)) return found;

    const uuidLower = uuid.toLowerCase();
    const char1 = uuidLower.charAt(0);
    const prefix4 = uuidLower.substring(0, 4);

    try {
        const topEntries = fs.readdirSync(previewsRootPath);
        for (const topEntry of topEntries) {
            if (topEntry.toLowerCase() !== char1) continue;
            const topPath = path.join(previewsRootPath, topEntry);
            try { if (!fs.statSync(topPath).isDirectory()) continue; } catch { continue; }

            const secondEntries = fs.readdirSync(topPath);
            for (const secondEntry of secondEntries) {
                if (secondEntry.toLowerCase() !== prefix4) continue;
                const secondPath = path.join(topPath, secondEntry);
                try { if (!fs.statSync(secondPath).isDirectory()) continue; } catch { continue; }

                const files = fs.readdirSync(secondPath);
                for (const file of files) {
                    if (file.toLowerCase().startsWith(uuidLower)) {
                        found.push({ fullPath: path.join(secondPath, file), fileName: file });
                    }
                }
            }
        }
    } catch (err) {
        debug.resolutionSteps.push(`Filesystem scan error: ${err.message}`);
    }

    return found;
}

// ============================================================
// PART 1 & 10: RESOLVE CANDIDATES FROM PLAN (DB-driven)
// ============================================================

function resolvePreviewCandidatesFromPlan(db, imageId, plan, previewsRootPath, debug) {
    if (!plan.entryTable || !plan.entryIdColumn) {
        debug.resolutionSteps.push('No entry table with imageId found in resolution plan');
        return [];
    }

    let entryRows;
    try {
        entryRows = db.prepare(
            `SELECT * FROM "${plan.entryTable}" WHERE "${plan.entryIdColumn}" = ?`
        ).all(imageId);
    } catch (err) {
        debug.resolutionSteps.push(`Entry table query failed: ${err.message}`);
        return [];
    }

    debug.resolutionSteps.push(
        `Queried ${plan.entryTable}.${plan.entryIdColumn}=${imageId}: ${entryRows.length} row(s)`
    );
    if (entryRows.length === 0) return [];

    const assetCandidates = [];

    for (const entryRow of entryRows) {
        const uuid = plan.entryUuidColumn ? entryRow[plan.entryUuidColumn] : null;
        const entryDigest = plan.assetKeyColumns.entryDigest
            ? entryRow[plan.assetKeyColumns.entryDigest]
            : null;

        debug.resolutionSteps.push(
            `Entry row data: uuid=${uuid}, digest=${entryDigest}, ` +
            `allColumns=${JSON.stringify(Object.keys(entryRow))}`
        );

        // STEP D: follow relations to gather more metadata
        const relationDigests = [];
        const relationDetails = [];

        if (uuid && plan.relationTables.length > 0) {
            for (const rel of plan.relationTables) {
                try {
                    const relRows = db.prepare(
                        `SELECT * FROM "${rel.table}" WHERE "${rel.joinColumn}" = ?`
                    ).all(uuid);
                    debug.resolutionSteps.push(
                        `Followed relation -> ${rel.table} via ${rel.joinColumn}="${uuid}": ${relRows.length} row(s)`
                    );
                    for (const relRow of relRows) {
                        relationDetails.push({ table: rel.table, data: relRow });
                        if (rel.hasDigest && relRow.digest) {
                            relationDigests.push(relRow.digest);
                        }
                    }
                } catch (err) {
                    debug.resolutionSteps.push(
                        `Relation query on ${rel.table} failed: ${err.message}`
                    );
                }
            }
        }

        // STEP E: find actual files on disk matching this uuid
        const diskFiles = findPreviewFilesOnDisk(previewsRootPath, uuid, debug);
        debug.resolutionSteps.push(
            `Disk scan for uuid "${uuid}": ${diskFiles.length} file(s)` +
            (diskFiles.length > 0
                ? ' -> ' + diskFiles.map(f => f.fileName).join(', ')
                : '')
        );

        // Rank disk files by DB evidence
        for (const diskFile of diskFiles) {
            const fileNameLower = diskFile.fileName.toLowerCase();
            let matchScore = 1;
            let matchReason = 'uuid-prefix-match';

            if (entryDigest && fileNameLower.includes(entryDigest.toLowerCase())) {
                matchScore += 3;
                matchReason = 'entry-digest-match';
            }

            for (const rd of relationDigests) {
                if (rd && fileNameLower.includes(rd.toLowerCase())) {
                    matchScore += 2;
                    matchReason = 'relation-digest-match';
                }
            }

            assetCandidates.push({
                uuid,
                entryDigest,
                relationDigests,
                diskPath: diskFile.fullPath,
                fileName: diskFile.fileName,
                matchScore,
                matchReason,
                relationTablesUsed: relationDetails.map(r => r.table)
            });
        }
    }

    assetCandidates.sort((a, b) => b.matchScore - a.matchScore);
    return assetCandidates;
}

// ============================================================
// PART 4: ROOT-PIXELS RESOLUTION — schema-driven blob search
// ============================================================

function resolveRootPixelCandidatesFromPlan(
    rootPixelsDbPath, imageId, previewContext, debug
) {
    if (!fs.existsSync(rootPixelsDbPath)) {
        debug.resolutionSteps.push('root-pixels.db not found');
        return [];
    }

    let db;
    try {
        db = new Database(rootPixelsDbPath, { readonly: true });
    } catch (err) {
        debug.resolutionSteps.push(`root-pixels.db open error: ${err.message}`);
        return [];
    }

    const rpSchema = inspectDatabaseSchema(db);
    debug.rootPixelsDbSchema = rpSchema;
    debug.resolutionSteps.push(
        `root-pixels.db schema: tables=[${rpSchema.tables.join(', ')}]`
    );

    // Build plan from actual schema
    const rpPlan = buildPreviewResolutionPlan(rpSchema);
    debug.resolutionSteps.push(
        `root-pixels plan: entryTable=${rpPlan.entryTable}, ` +
        `relations=[${rpPlan.relationTables.map(r => r.table).join(', ')}], ` +
        `confidence=${rpPlan.confidence}`
    );

    // Also find blob-bearing tables
    const blobTables = findCandidateRootPixelTables(rpSchema);
    debug.resolutionSteps.push(
        `root-pixels blob tables: [${blobTables.map(t => t.table).join(', ')}]`
    );

    const candidates = [];

    // Approach 1: if entry table exists, query by imageId
    if (rpPlan.entryTable && rpPlan.entryIdColumn) {
        try {
            const rows = db.prepare(
                `SELECT * FROM "${rpPlan.entryTable}" WHERE "${rpPlan.entryIdColumn}" = ?`
            ).all(imageId);
            debug.resolutionSteps.push(
                `root-pixels ${rpPlan.entryTable} query by imageId=${imageId}: ${rows.length} row(s)`
            );
            for (const row of rows) {
                for (const [key, value] of Object.entries(row)) {
                    if (Buffer.isBuffer(value) && value.length > 100) {
                        candidates.push({
                            source: rpPlan.entryTable,
                            column: key,
                            data: value,
                            size: value.length,
                            matchedVia: 'imageId'
                        });
                    }
                }
            }
        } catch (err) {
            debug.resolutionSteps.push(
                `root-pixels entry query error: ${err.message}`
            );
        }
    }

    // Approach 2: query blob tables by uuid from preview context
    if (previewContext?.uuid) {
        for (const bt of blobTables) {
            const uuidCol = bt.idColumns.find(
                c => c.name.toLowerCase() === 'uuid'
            );
            if (!uuidCol) continue;
            if (bt.table === rpPlan.entryTable) continue;

            try {
                const rows = db.prepare(
                    `SELECT * FROM "${bt.table}" WHERE "${uuidCol.name}" = ?`
                ).all(previewContext.uuid);
                for (const row of rows) {
                    for (const bc of bt.blobColumns) {
                        const value = row[bc.name];
                        if (Buffer.isBuffer(value) && value.length > 100) {
                            candidates.push({
                                source: bt.table,
                                column: bc.name,
                                data: value,
                                size: value.length,
                                matchedVia: `uuid:${previewContext.uuid}`
                            });
                        }
                    }
                }
            } catch (err) {
                debug.resolutionSteps.push(
                    `root-pixels ${bt.table} uuid query error: ${err.message}`
                );
            }
        }
    }

    db.close();
    candidates.sort((a, b) => b.size - a.size);
    return candidates;
}

// ============================================================
// MAIN RESOLVER
// ============================================================

export async function resolveLightroomThumbnail({
    imageId, catalogPath, previewsRootPath, thumbnailsDir
}) {
    const debug = {
        previewsDbSchema: null,
        rootPixelsDbSchema: null,
        resolutionPlan: null,
        resolutionSteps: []
    };

    if (!catalogPath || !fs.existsSync(catalogPath)) {
        return {
            ok: false, cachedPath: null, sourceType: 'none',
            reason: 'catalog-missing', debug
        };
    }

    // Cache key
    const catalogHash = crypto.createHash('md5')
        .update(catalogPath).digest('hex').substring(0, 8);
    const cacheFilename =
        `${THUMB_RESOLVER_VERSION}-${catalogHash}-${imageId}.jpg`;
    const cachedPath = path.join(thumbnailsDir, cacheFilename);

    // Part 6: validate cache before returning
    if (validateCacheFile(cachedPath)) {
        return {
            ok: true, cachedPath, sourceType: 'cache',
            debug: { msg: 'Valid cache hit' }
        };
    } else if (fs.existsSync(cachedPath)) {
        fs.unlinkSync(cachedPath);
        debug.resolutionSteps.push('Invalid cache file deleted');
    }

    // === PREVIEWS.DB RESOLUTION ===
    const previewsDbPath = path.join(previewsRootPath, 'previews.db');
    let previewContext = null;

    if (fs.existsSync(previewsDbPath)) {
        let db;
        try {
            db = new Database(previewsDbPath, { readonly: true });
        } catch (err) {
            debug.resolutionSteps.push(`previews.db open error: ${err.message}`);
            return {
                ok: false, cachedPath: null, sourceType: 'none',
                reason: 'previews.db open error', debug
            };
        }

        const schema = inspectDatabaseSchema(db);
        debug.previewsDbSchema = schema;
        debug.resolutionSteps.push(
            `previews.db tables: [${schema.tables.join(', ')}]`
        );

        const plan = buildPreviewResolutionPlan(schema);
        debug.resolutionPlan = plan;
        debug.resolutionSteps.push(
            `Plan: entry=${plan.entryTable}, ` +
            `relations=[${plan.relationTables.map(r => r.table).join(', ')}], ` +
            `confidence=${plan.confidence}`
        );

        const candidates = resolvePreviewCandidatesFromPlan(
            db, imageId, plan, previewsRootPath, debug
        );
        db.close();

        for (const candidate of candidates) {
            debug.resolutionSteps.push(
                `Trying candidate: ${candidate.fileName} ` +
                `(score=${candidate.matchScore}, reason=${candidate.matchReason})`
            );
            try {
                const fileData = fs.readFileSync(candidate.diskPath);
                const extraction = extractJpegFromBuffer(fileData);

                if (extraction.jpeg) {
                    fs.writeFileSync(cachedPath, extraction.jpeg);
                    debug.resolutionSteps.push(
                        `JPEG extracted: ${extraction.selectedSize} bytes ` +
                        `from ${extraction.candidateCount} candidate(s). ` +
                        `Tables used: ${candidate.relationTablesUsed.join(', ') || 'entry only'}`
                    );
                    return { ok: true, cachedPath, sourceType: 'lrprev', debug };
                } else {
                    debug.resolutionSteps.push(
                        `No valid JPEG in ${candidate.fileName}: ${extraction.reason}`
                    );
                }
            } catch (err) {
                debug.resolutionSteps.push(
                    `File read error for ${candidate.fileName}: ${err.message}`
                );
            }
        }

        if (candidates.length > 0) {
            previewContext = { uuid: candidates[0].uuid };
        }
    } else {
        debug.resolutionSteps.push('previews.db not found');
    }

    // === ROOT-PIXELS.DB FALLBACK ===
    const rootPixelsDbPath = path.join(previewsRootPath, 'root-pixels.db');
    const rpCandidates = resolveRootPixelCandidatesFromPlan(
        rootPixelsDbPath, imageId, previewContext, debug
    );

    for (const rpc of rpCandidates) {
        const extraction = extractJpegFromBuffer(rpc.data);
        if (extraction.jpeg) {
            fs.writeFileSync(cachedPath, extraction.jpeg);
            debug.resolutionSteps.push(
                `root-pixels JPEG: ${extraction.selectedSize} bytes ` +
                `from ${rpc.source}.${rpc.column} via ${rpc.matchedVia}`
            );
            return { ok: true, cachedPath, sourceType: 'root-pixels', debug };
        } else {
            debug.resolutionSteps.push(
                `root-pixels blob ${rpc.source}.${rpc.column} not valid JPEG: ` +
                `${extraction.reason}`
            );
        }
    }

    // === DIAGNOSTIC GUESS FALLBACK (DISABLED) ===
    if (ENABLE_DIAGNOSTIC_GUESS_FALLBACK) {
        debug.resolutionSteps.push(
            '[DIAGNOSTIC] Guess fallback enabled but not implemented'
        );
    }

    // Part 8: honest failure reasons
    let reason;
    if (!fs.existsSync(previewsDbPath)) {
        reason = 'previews.db not found';
    } else if (!debug.resolutionPlan?.entryTable) {
        reason = 'no entry table with imageId found in previews.db schema';
    } else {
        const steps = debug.resolutionSteps;
        const hasEntryRows = steps.some(s => s.includes(' row(s)') && !s.includes('0 row(s)'));
        const hasDiskFiles = steps.some(s => s.includes('file(s)') && !s.includes('0 file(s)'));

        if (!hasEntryRows) {
            reason = `no preview metadata for imageId ${imageId} in ${debug.resolutionPlan.entryTable}`;
        } else if (!hasDiskFiles) {
            reason = 'preview entry found but no matching asset files on disk';
        } else {
            reason = 'asset files found but no valid JPEG payload extracted';
        }
    }

    return { ok: false, cachedPath: null, sourceType: 'none', reason, debug };
}
