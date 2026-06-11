import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session.jsx';

function pctClass(reviewed, total) {
  if (total === 0) return 'badge-gray';
  if (reviewed === 0) return 'badge-red';
  if (reviewed >= total) return 'badge-green';
  return 'badge-amber';
}

export default function LocationDashboard() {
  const { unit } = useSession();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    if (!unit) return;
    api.locations(unit.unit_name)
      .then(setLocations)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [unit]);

  const totals = locations.reduce(
    (acc, l) => ({ reviewed: acc.reviewed + l.reviewed, total: acc.total + l.total }),
    { reviewed: 0, total: 0 }
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/" className="back">← Switch Unit</Link>
          <h1>Storage Locations</h1>
          <p className="muted">{unit?.unit_name}{unit?.compass_id ? ` · ${unit.compass_id}` : ''}</p>
        </div>
        <span className={`badge ${pctClass(totals.reviewed, totals.total)}`}>
          {totals.reviewed} / {totals.total} reviewed
        </span>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {err && <div className="alert alert-error">{err}</div>}

      {!loading && locations.length === 0 && (
        <div className="card empty">No audit-scope items for this unit yet.</div>
      )}

      <div className="loc-grid">
        {locations.map((l) => (
          <button
            key={l.storage_location}
            className="card loc-card"
            onClick={() => nav(`/items?location=${encodeURIComponent(l.storage_location)}`)}
          >
            <div className="loc-name">{l.storage_location}</div>
            <div className="loc-foot">
              <span className={`badge ${pctClass(l.reviewed, l.total)}`}>
                {l.reviewed} / {l.total} reviewed
              </span>
              <span className="loc-arrow">→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
