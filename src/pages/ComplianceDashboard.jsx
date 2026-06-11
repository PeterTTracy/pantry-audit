import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function ComplianceDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.compliance()
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading…</p>;
  if (err) return <div className="alert alert-error">{err}</div>;

  const { summary, overdue, askUs } = data;

  // Group ask-us items by unit.
  const askUsByUnit = askUs.reduce((acc, r) => {
    (acc[r.unit_name] = acc[r.unit_name] || []).push(r);
    return acc;
  }, {});

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/locations" className="back">← Locations</Link>
          <h1>Compliance Dashboard</h1>
          <p className="muted">Audit progress across all dining units</p>
        </div>
        <button className="btn btn-primary" onClick={() => api.exportXlsx().catch((e) => setErr(e.message))}>
          ⬇ Export .xlsx
        </button>
      </div>

      <div className="card">
        <h3>Unit Summary</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th className="num">Audit-Scope Items</th>
                <th className="num">Complete</th>
                <th className="num">Pending</th>
                <th className="num">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.unit_name}>
                  <td>{s.unit_name}{s.compass_id ? <span className="muted"> · {s.compass_id}</span> : null}</td>
                  <td className="num">{s.total}</td>
                  <td className="num">{s.complete}</td>
                  <td className="num">{s.pending}</td>
                  <td className="num">
                    <div className="pct-cell">
                      <div className="pct-bar"><div className="pct-fill" style={{ width: `${s.pct_complete}%` }} /></div>
                      <span>{s.pct_complete}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {summary.length === 0 && <tr><td colSpan={5} className="muted">No data.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Overdue for Review <span className="count-pill count-red">{overdue.length}</span></h3>
        {overdue.length === 0 ? (
          <p className="muted">Nothing overdue. 🎉</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Unit</th><th>Location</th><th>Item</th><th>Brand</th><th>Review Due</th><th>Reviewed By</th></tr>
              </thead>
              <tbody>
                {overdue.map((r, i) => (
                  <tr key={i}>
                    <td>{r.unit_name}</td>
                    <td>{r.storage_location}</td>
                    <td>{r.item_description}</td>
                    <td>{r.brand}</td>
                    <td className="overdue-date">{r.review_due}</td>
                    <td>{r.reviewed_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>“Ask Us” Items <span className="count-pill count-amber">{askUs.length}</span></h3>
        {askUs.length === 0 ? (
          <p className="muted">No items flagged.</p>
        ) : (
          Object.entries(askUsByUnit).map(([unitName, rows]) => (
            <div key={unitName} className="askus-group">
              <h4>{unitName}</h4>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Location</th><th>Item</th><th>Brand</th><th>Vendor Type</th><th>Review Due</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.storage_location}</td>
                        <td>{r.item_description}</td>
                        <td>{r.brand}</td>
                        <td>{r.vendor_type || '—'}</td>
                        <td>{r.review_due || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
