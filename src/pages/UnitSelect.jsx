import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session.jsx';

export default function UnitSelect() {
  const [units, setUnits] = useState([]);
  const [unitName, setUnitName] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const { setUnit, setReviewer, reviewer } = useSession();
  const nav = useNavigate();

  useEffect(() => {
    setName(reviewer || '');
    api.units()
      .then((u) => { setUnits(u); if (u.length === 1) setUnitName(u[0].unit_name); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (!unitName) return setErr('Please select a dining unit.');
    if (!name.trim()) return setErr('Please enter your name (used as reviewer on audits).');
    const u = units.find((x) => x.unit_name === unitName);
    setUnit(u);
    setReviewer(name.trim());
    nav('/locations');
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="login-head">
          <div className="login-logo">🍽️</div>
          <h1>Pantry Audit</h1>
          <p className="muted">MIT Dining · Bon Appétit Management Company</p>
          <p className="muted small">Allergen compliance auditing</p>
        </div>

        {loading ? (
          <p className="muted">Loading units…</p>
        ) : (
          <form onSubmit={submit} className="login-form">
            <label className="field">
              <span>Dining Unit</span>
              <select value={unitName} onChange={(e) => setUnitName(e.target.value)}>
                <option value="">— Select a unit —</option>
                {units.map((u) => (
                  <option key={u.unit_name} value={u.unit_name}>
                    {u.unit_name}{u.compass_id ? ` (${u.compass_id})` : ''} · {u.total_products} items
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Your Name</span>
              <input
                type="text"
                placeholder="e.g. Dana Whitfield"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            {err && <div className="alert alert-error">{err}</div>}

            <button type="submit" className="btn btn-primary btn-block">Start Auditing →</button>

            {units.length === 0 && (
              <p className="muted small">
                No units found. Use the <a href="/import">Import</a> screen to upload a MyOrders export.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
