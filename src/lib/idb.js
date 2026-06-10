// Minimal promise wrapper over IndexedDB. All app data lives on-device:
//   units    — dining units / houses (keyPath unit_name); lets a house exist
//              before its first import
//   products — inventory items (keyPath id, autoIncrement)
//   audits   — one audit record per product (keyPath product_id)
//   photos   — label photo blobs (keyPath product_id)
const DB_NAME = 'pantry_audit';
const DB_VERSION = 2;

let dbPromise = null;

// Shown when an older app window holds the database open, blocking our
// version upgrade. Without this the app would just hang on a blank screen.
function blockedBanner(show) {
  let el = document.getElementById('idb-blocked-banner');
  if (!show) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'idb-blocked-banner';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#1d3557;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:sans-serif;font-size:18px;line-height:1.5';
  el.textContent = 'Pantry Audit is updating its database, but another tab or window of the app is holding it open. Close every other Pantry Audit tab/window, then reload this one.';
  document.body.appendChild(el);
}

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      // An older window still has the DB open; tell the user instead of
      // hanging. The open completes automatically once that window closes.
      req.onblocked = () => blockedBanner(true);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          const products = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          products.createIndex('unit_name', 'unit_name');
          products.createIndex('unit_sku', ['unit_name', 'distributor_sku'], { unique: true });
          db.createObjectStore('audits', { keyPath: 'product_id' });
          db.createObjectStore('photos', { keyPath: 'product_id' });
        }
        if (e.oldVersion < 2) {
          const units = db.createObjectStore('units', { keyPath: 'unit_name' });
          if (e.oldVersion >= 1) {
            // Migrate units already implied by existing products.
            req.transaction.objectStore('products').getAll().onsuccess = (ev) => {
              const seen = new Set();
              for (const p of ev.target.result) {
                if (!seen.has(p.unit_name)) {
                  seen.add(p.unit_name);
                  units.put({ unit_name: p.unit_name, compass_id: p.compass_id || null });
                }
              }
            };
          }
        }
      };
      req.onsuccess = () => {
        blockedBanner(false);
        const db = req.result;
        // When a future update upgrades the schema in another window, release
        // our connection and reload so we don't block it (and pick up the new
        // code ourselves).
        db.onversionchange = () => {
          db.close();
          window.location.reload();
        };
        resolve(db);
      };
      req.onerror = () => { blockedBanner(false); reject(req.error); };
    });
  }
  return dbPromise;
}

export const reqp = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Run `fn(transaction)` and resolve with its result once the tx commits.
export async function tx(stores, mode, fn) {
  const db = await openDB();
  const t = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
  const result = await fn(t);
  await done;
  return result;
}
