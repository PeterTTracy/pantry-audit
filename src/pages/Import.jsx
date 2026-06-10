import React, { useState } from 'react';
import { api } from '../api';

export default function ImportScreen() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setResult(null);
    if (!file) return setErr('Choose a CSV or Excel file to upload.');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const r = await api.importFile(fd);
      setResult(r);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Import Inventory</h1>
          <p className="muted">Upload a MyOrders inventory export (.csv or .xlsx)</p>
        </div>
      </div>

      <div className="card">
        <p className="muted">
          The unit name and COMPASS ID are read from the file header (e.g.
          <code> MIT Forbes Family Cafe (COMPASS-44873)</code>). Products are matched on
          unit&nbsp;+&nbsp;distributor SKU — existing audit records are never overwritten.
          Non-food rooms (Paper, Chemical, Cleaning, DO NOT INVENTORY) and single-ingredient
          produce are automatically marked out of audit scope.
        </p>

        <form onSubmit={submit} className="import-form">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Importing…' : 'Upload & Import'}
          </button>
        </form>

        {busy && <p className="muted small">Parsing file and queuing Open Food Facts prefill in the background…</p>}
        {err && <div className="alert alert-error">{err}</div>}

        {result && (
          <div className="alert alert-success">
            <strong>Import complete — {result.unit_name} ({result.compass_id})</strong>
            <ul className="result-list">
              <li>{result.inserted} new products added</li>
              <li>{result.updated} existing products updated</li>
              <li>{result.out_of_scope} marked out of audit scope</li>
              {result.skipped > 0 && <li>{result.skipped} rows skipped (no item description)</li>}
            </ul>
            <p className="muted small">
              GTIN prefill from Open Food Facts is running in the background for pending items.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
