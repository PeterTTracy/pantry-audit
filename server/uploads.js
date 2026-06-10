const path = require('path');
const fs = require('fs');
const multer = require('multer');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Make a string safe to use as a folder/file name.
function safe(s) {
  return String(s || '').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

// Label photos: ./uploads/{unit}/{product_id}/<timestamp>-<original>
const labelStorage = multer.diskStorage({
  destination(req, file, cb) {
    const unit = safe(req.body.unit_name || req.query.unit || 'unit');
    const productId = safe(req.params.id || 'product');
    const dir = path.join(UPLOADS_DIR, unit, productId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const stamp = Date.now();
    cb(null, `${stamp}-${safe(file.originalname)}`);
  },
});

const photoUpload = multer({
  storage: labelStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/image\/(jpe?g|png)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG and PNG images are accepted.'));
  },
});

// Import files held in memory (parsed, not persisted).
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Convert an absolute on-disk path to a web path under /uploads.
function toWebPath(absPath) {
  if (!absPath) return null;
  const rel = path.relative(UPLOADS_DIR, absPath).split(path.sep).join('/');
  return `/uploads/${rel}`;
}

module.exports = { UPLOADS_DIR, photoUpload, importUpload, toWebPath, safe };
