# Pantry Audit App

Allergen compliance auditing tool for **MIT Dining / Bon Appétit Management Company**.
Dining staff audit multi-ingredient products across dining unit locations, recording
ingredients, allergen flags, and vendor information for compliance reporting.

**Fully client-side PWA** — no server, no PC required. All data lives on the
device in the browser's IndexedDB. Install it to an Android/iOS home screen and
it runs offline like a native app.

- **Frontend:** React + Vite (phone/tablet-first)
- **Storage:** IndexedDB on the device (products, audit records, label photos)
- **Import/Export:** SheetJS in the browser (`.csv`/`.xlsx` in, `.xlsx` report out)
- **Enrichment:** Open Food Facts API, fetched directly from the browser (optional; the app works offline)
- **No authentication** — the auditor picks a unit and enters their name on the login screen.

## Quick start (development)

```bash
npm install
npm run dev      # Vite dev server on :5173
```

`npm start` builds and serves the production bundle locally (`vite preview --host`),
reachable from other devices on the same Wi-Fi for testing.

On first run the app seeds sample data for *Forbes Family Cafe (COMPASS-44873)*
so every screen is immediately functional.

## Deploying / installing on a phone

The build output (`npm run build` → `dist/`) is plain static files. Host them on
any static host (GitHub Pages, Netlify, Cloudflare Pages — all free):

1. Serve `dist/` over **HTTPS** (required for PWA install + offline).
2. On the phone, open the URL in Chrome and choose **Add to Home screen**.
3. After that the app runs entirely on the device — network is only used for
   optional Open Food Facts lookups.

> **Data lives on the device.** Each phone/tablet has its own independent
> database. Use **Import → Download backup** regularly; clearing browser data
> for the site erases everything. Backups (JSON) include products and audit
> records; label photos stay on the device.

## Screens

1. **Unit Select** — choose a dining unit + enter your name.
2. **Location Dashboard** — storage locations with `X / Y reviewed` completion badges (red/amber/green).
3. **Item List** — audit-scope items, sorted pending → in-progress → complete; text search + allergen filter.
   Swipe an item left to remove it from the audit list (undo toast; restorable in Settings;
   re-imports don't resurrect removed items).
4. **Audit Form** — vendor type, ingredients, voluntary disclaimers, allergen checkboxes,
   Ask-Us flag (auto-set for House-Made / Local Artisan / Imported Non-English), label photo, notes.
   **Save Progress** keeps the item in-progress; **Complete Audit** requires vendor type +
   ingredients and stamps the review-due date (+90 days).
5. **Compliance Dashboard** — per-unit completion table, overdue items, Ask-Us items grouped by unit, and `.xlsx` export.
6. **Import** — MyOrders inventory loads + JSON backup/restore.
7. **Settings** — add/remove houses (dining units). Deleting a house requires a second
   confirmation tap and erases all of its data; restore swiped-away items per house.

## Import flow

Use the **Import** screen to load a MyOrders inventory export (`.csv` or `.xlsx`).
A sample file is provided at [`samples/sample_myorders_export.csv`](samples/sample_myorders_export.csv).

- Unit name + COMPASS ID are read from the file header (e.g. `MIT Forbes Family Cafe (COMPASS-44873)`).
- Products are upserted on **unit + distributor SKU**; existing audit records are never overwritten.
- GTINs are normalized (leading zeros restored if a spreadsheet stripped them).
- Non-food classifications (`DO NOT INVENTORY`, `Paper Goods`, `Paper Room`, `Chemical Room`,
  `Cleaning`) and single-ingredient produce (`Produce Walk-in`) are marked out of audit scope.
- After import, pending items with a GTIN are enriched in the background from the
  [Open Food Facts API](https://world.openfoodfacts.org). The fetched ingredients,
  allergens, and traces are stored as advisory pre-fill — they populate the audit form
  but are **not** written to audit records until staff confirm.

## Tests

```bash
npm test
```

Unit tests (Node's built-in runner) cover the pure logic shared with the app:
import parsing, GTIN normalization, compliance aggregation, export row building,
and allergen tag mapping.

## Project layout

```
src/
  lib/
    idb.js          IndexedDB promise wrapper (products / audits / photos stores)
    data.js         on-device data layer (the old REST API, reimplemented locally)
    importParse.js  MyOrders sheet parsing (pure, unit-tested)
    compliance.js   compliance aggregation (pure, unit-tested)
    exportRows.js   xlsx export row building (pure, unit-tested)
    off.js          Open Food Facts client
    seed.js         first-run sample data
  pages/            React screens
  api.js            thin façade over lib/data.js
samples/            example MyOrders export
test/               node:test suite for the pure modules
```
