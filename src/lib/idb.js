// Minimal promise wrapper over IndexedDB. All app data lives on-device:
//   products — inventory items (keyPath id, autoIncrement)
//   audits   — one audit record per product (keyPath product_id)
//   photos   — label photo blobs (keyPath product_id)
const DB_NAME = 'pantry_audit';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const products = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        products.createIndex('unit_name', 'unit_name');
        products.createIndex('unit_sku', ['unit_name', 'distributor_sku'], { unique: true });
        db.createObjectStore('audits', { keyPath: 'product_id' });
        db.createObjectStore('photos', { keyPath: 'product_id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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
