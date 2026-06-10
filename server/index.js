const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');

require('./db'); // ensure schema is created
const { seedIfEmpty } = require('./seed');
const { UPLOADS_DIR } = require('./uploads');

const apiRoutes = require('./routes/api');
const importRoutes = require('./routes/import');
const exportRoutes = require('./routes/export');

const PORT = process.env.PORT || 3001;
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Seed sample data on first run.
seedIfEmpty();

// Static: uploaded label photos.
app.use('/uploads', express.static(UPLOADS_DIR));

// API.
app.use('/api', apiRoutes);
app.use('/api', importRoutes);
app.use('/api', exportRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Multer / generic error handler for the API.
app.use('/api', (err, req, res, next) => {
  console.error('[api error]', err.message);
  res.status(400).json({ error: err.message });
});

// Serve the built frontend (after `npm run build`).
const DIST = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback for client-side routes.
  app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.send('<h1>Pantry Audit API</h1><p>Frontend not built. Run <code>npm run build</code>, or use <code>npm run dev</code> for the Vite dev server on port 5173.</p>'));
}

app.listen(PORT, () => {
  console.log(`\n  Pantry Audit server running:\n    Local:   http://localhost:${PORT}`);
  // Print LAN URLs so tablets/phones on the same Wi-Fi know where to point.
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) {
        console.log(`    Network: http://${i.address}:${PORT}`);
      }
    }
  }
  console.log('');
});
