# Lightroom Preview Database Schema (Previews.lrdata)

This document describes the internal structure of Lightroom Classic's preview cache, based on direct inspection of a real catalog's `Previews.lrdata` directory.

## Directory Structure

```
{CatalogName} Previews.lrdata/
├── previews.db              ← SQLite DB mapping images to preview assets
├── root-pixels.db           ← SQLite DB with small embedded JPEG thumbnails
├── 0/                       ← First hex char of UUID (uppercase)
│   └── 0A3B/               ← First 4 hex chars of UUID (uppercase)
│       └── 0A3B1234-...-{digest}_{size}   ← Preview file (NO extension)
├── 1/
├── ...
├── 9/
├── A/
├── B/
├── ...
└── F/
```

---

## previews.db

### Tables

| Table | Purpose |
|-------|---------|
| `ImageCacheEntry` | Entry point: maps `imageId` → `uuid` |
| `Pyramid` | Preview file metadata (quality, dimensions) |
| `PyramidLevel` | Individual resolution levels within a preview |
| `FacePreviewCacheEntry` | Maps face previews to images |
| `FacePreview` | Face preview file metadata |
| `MotionPreviewCacheEntry` | Maps motion (video) previews |
| `MotionPreview` | Motion preview file metadata |
| `DeletedPyramid` | Garbage collection for deleted previews |
| `DeletedFacePreview` | Garbage collection for deleted face previews |
| `DeletedMotionPreview` | Garbage collection for deleted motion previews |
| `StoreInfo` | Schema version |

### ImageCacheEntry

The entry point for all preview lookups. Maps the catalog's `image_id` to a preview `uuid`.

```sql
CREATE TABLE ImageCacheEntry (
    imageId NOT NULL,           -- FK → Adobe_images.id_local (from .lrcat)
    uuid NOT NULL,              -- Preview UUID (used in filenames)
    digest NOT NULL,            -- TRUNCATED digest (first 16 hex chars)
    orientation                 -- EXIF orientation
);
```

> **IMPORTANT:** The `digest` in this table is **truncated to 16 hex characters**. The full 32-character digest is in the `Pyramid` and `PyramidLevel` tables. **Do NOT use this digest for filename construction.**

### Pyramid

One row per preview set. Contains the full digest and quality metadata.

```sql
CREATE TABLE Pyramid (
    uuid NOT NULL,              -- Matches ImageCacheEntry.uuid
    digest NOT NULL,            -- FULL 32-char hex digest (used in filenames)
    colorProfile NOT NULL,
    fileTimeStamp,
    quality NOT NULL,           -- e.g. 1.0
    croppedWidth NOT NULL,
    croppedHeight NOT NULL,
    pyramidFileTimeStamp,
    fingerprint,
    fromProxy
);
```

### PyramidLevel

One row per resolution level. A single preview typically has 6 levels (64px to 2048px).

```sql
CREATE TABLE PyramidLevel (
    uuid NOT NULL,              -- Matches ImageCacheEntry.uuid
    digest NOT NULL,            -- FULL 32-char hex digest
    level NOT NULL,             -- 1=smallest, 6=largest
    longDimension NOT NULL,     -- Long edge in pixels (64, 128, 256, 512, 1024, 2048)
    lastAccess NOT NULL,
    width NOT NULL,
    height NOT NULL,
    fileSize                    -- Size of the preview file in bytes
);
CREATE UNIQUE INDEX index_uuid_digest_level ON PyramidLevel(uuid, digest, level);
```

---

## Filename Construction (Proven)

Preview files on disk follow this exact naming convention:

```
{uuid}-{full_32char_digest}_{longDimension}
```

**There is NO file extension.** The files are raw JPEG data with an Adobe header prepended.

### Example

For `imageId = 2072914`:

| Step | Source | Value |
|------|--------|-------|
| 1. Query `ImageCacheEntry` | `uuid` | `5D06293B-28EE-4A09-A872-FA43DD2C5E7C` |
| 2. Query `PyramidLevel` | `digest` | `69a3bce92b8a7c577c317413b8148255` |
| 3. Pick level | `longDimension` | `2048` |
| 4. Construct filename | | `5D06293B-28EE-4A09-A872-FA43DD2C5E7C-69a3bce92b8a7c577c317413b8148255_2048` |
| 5. Directory | | `Previews.lrdata/5/5D06/` |

### Available Levels (typical)

| Level | longDimension | Typical fileSize |
|-------|--------------|-----------------|
| 1 | 64 | ~1.5 KB |
| 2 | 128 | ~3 KB |
| 3 | 256 | ~10 KB |
| 4 | 512 | ~35 KB |
| 5 | 1024 | ~150 KB |
| 6 | 2048 | ~414 KB |

---

## JPEG Extraction

The preview files are **NOT pure JPEG**. They contain an Adobe-proprietary header followed by embedded JPEG data. To extract a usable JPEG:

1. Scan the file buffer for the JPEG SOI marker: `FF D8`
2. From that SOI, scan forward for the JPEG EOI marker: `FF D9`
3. Slice from SOI to EOI (inclusive)
4. The result is a valid JPEG image

If multiple SOI/EOI pairs exist, the largest valid candidate is the correct one.

---

## root-pixels.db

A companion database containing very small embedded JPEG thumbnails. Used as a fallback when no `PyramidLevel` files exist on disk.

```sql
CREATE TABLE RootPixels (
    uuid NOT NULL,              -- Matches ImageCacheEntry.uuid
    digest NOT NULL,            -- Full 32-char digest
    colorProfile NOT NULL,
    croppedWidth NOT NULL,
    croppedHeight NOT NULL,
    quality NOT NULL,
    jpegData NOT NULL           -- BLOB: actual JPEG image data (small, ~1-3 KB)
);

CREATE TABLE StoreInfo (
    version NOT NULL
);
```

### Usage

```sql
-- Get the thumbnail JPEG blob for an image
SELECT jpegData FROM RootPixels WHERE uuid = ?;
```

The `jpegData` column contains a ready-to-use JPEG blob. No SOI/EOI extraction needed — just write directly to a file.

---

## Complete Resolution Chain

```
1. catalog.lrcat → Adobe_images.id_local (imageId)
                                ↓
2. previews.db → ImageCacheEntry WHERE imageId = ? → uuid
                                ↓
3. previews.db → PyramidLevel WHERE uuid = ? ORDER BY longDimension DESC
                                ↓
4. Construct: {uuid}-{digest}_{longDimension}
   Directory: Previews.lrdata/{uuid[0]}/{uuid[0:4]}/
                                ↓
5. Read file → scan for JPEG SOI/EOI → extract → cache
                                ↓
   FALLBACK: root-pixels.db → RootPixels WHERE uuid = ? → jpegData blob
```
