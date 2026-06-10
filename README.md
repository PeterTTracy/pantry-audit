# Pantry Audit App

Allergen compliance auditing tool for **MIT Dining / Bon Appétit Management Company**.
Dining staff audit multi-ingredient products across dining unit locations, recording
ingredients, allergen flags, and vendor information for compliance reporting.

- **Frontend:** React + Vite (tablet-friendly)
- **Backend:** Node.js + Express
- **Database:** SQLite (`./data/pantry_audit.db` — a single portable file)
- **No authentication** — the auditor picks a unit and enters their name on the login screen.

## Quick start

```bash
npm install
npm start
```

`npm start` builds the React frontend and serves both the API and the app from
**http://localhost:3001**. On first run the database is created at
`./data/pantry_audit.db` and seeded with sample data for *Forbes Family Cafe
(COMPASS-44873)* so every screen is immediately functional.

### Development (hot reload)

```bash
npm run dev
```

Runs the API on `:3001` and the Vite dev server on `:5173` (which proxies `/api`
and `/uploads` to the backend).

## Screens

1. **Unit Select** — choose a dining unit + enter your name.
2. **Location Dashboard** — storage locations with `X / Y reviewed` completion badges (red/amber/green).
3. **Item List** — audit-scope items, sorted pending → in-progress → complete; text search + allergen filter.
4. **Audit Form** — vendor type, ingredients, voluntary disclaimers, allergen checkboxes,
   Ask-Us flag (auto-set for House-Made / Local Artisan / Imported Non-English), label photo upload, notes.
5. **Compliance Dashboard** — per-unit completion table, overdue items, Ask-Us items grouped by unit, and `.xlsx` export.

## Import flow

Use the **Import** screen to upload a MyOrders inventory export (`.csv` or `.xlsx`).
A sample file is provided at [`samples/sample_myorders_export.csv`](samples/sample_myorders_export.csv).

- Unit name + COMPASS ID are read from the file header (e.g. `MIT Forbes Family Cafe (COMPASS-44873)`).
- Products are upserted on **unit + distributor SKU**; existing audit records are never overwritten.
- Non-food classifications (`DO NOT INVENTORY`, `Paper Goods`, `Paper Room`, `Chemical Room`,
  `Cleaning`) and single-ingredient produce (`Produce Walk-in`) are marked out of audit scope.
- After import, pending items with a GTIN are enriched in the background from the
  [Open Food Facts API](https://world.openfoodfacts.org). The fetched ingredients,
  allergens, and traces are stored as advisory pre-fill — they populate the audit form
  but are **not** written to audit records until staff confirm.

## Data & files

- Database: `./data/pantry_audit.db` (delete it to reset; replace it per deployment).
- Label photos: `./uploads/{unit}/{product_id}/`.
- Export: one worksheet per unit, all audit records joined to products.

## Project layout

```
server/            Express API
  db.js            SQLite schema
  seed.js          first-run sample data
  openfoodfacts.js GTIN prefill client
  routes/          api.js, import.js, export.js
src/               React app (pages/, allergens.js, api.js, session.jsx)
samples/           example MyOrders export
```
