import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session.jsx';

export default function Settings() {
  const { unit, clear } = useSession();
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // Add-house form
  const [name, setName] = useState('');
  const [compass, setCompass] = useState('');

  // Two-step delete: unit name currently armed for deletion.
  const [confirming, setConfirming] = useState(null);
  const confirmTimer = useRef(null);

  const load = () => {
    api.unitStats()
      .then(setStats)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); return () => clearTimeout(confirmTimer.current); }, []);

  const flash = (m) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 4000); };

  const onAdd = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await api.addUnit(name, compass);
      setName(''); setCompass('');
      flash(`Added "${r.unit_name}".`);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const armDelete = (unitName) => {
    setConfirming(unitName);
    clearTimeout(confirmTimer.current);
    // Disarm automatically so a stale confirm button can't linger.
    confirmTimer.current = setTimeout(() => setConfirming(null), 6000);
  };

  const onDelete = async (unitName) => {
    clearTimeout(confirmTimer.current);
    setConfirming(null);
    setErr('');
    try {
      const r = await api.deleteUnit(unitName);
      if (unit?.unit_name === unitName) clear();
      flash(`Deleted "${unitName}" (${r.deleted_products} products).`);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const onRestore = async (unitName) => {
    setErr('');
    try {
      const r = await api.restoreRemoved(unitName);
      flash(`Restored ${r.restored} removed item${r.restored === 1 ? '' : 's'} in "${unitName}".`);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/locations" className="back">← Locations</Link>
          <h1>Settings</h1>
          <p className="muted">Manage houses (dining units) on this device</p>
        </div>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="card">
        <h3>Houses</h3>
        {loading ? <p className="muted">Loading…</p> : stats.length === 0 ? (
          <p className="muted">No houses yet. Add one below or import an inventory file.</p>
        ) : (
          <div className="unit-list">
            {stats.map((u) => (
              <div key={u.unit_name} className="unit-row">
                <div className="unit-row-main">
                  <div className="unit-row-name">
                    {u.unit_name}
                    {u.compass_id && <span className="muted small"> · {u.compass_id}</span>}
                  </div>
                  <div className="muted small">
                    {u.total_products} items · {u.in_scope} in audit scope · {u.complete} complete
                    {u.removed > 0 && <> · {u.removed} removed</>}
                  </div>
                </div>
                <div className="unit-row-actions">
                  {u.removed > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onRestore(u.unit_name)}>
                      Restore {u.removed}
                    </button>
                  )}
                  {confirming === u.unit_name ? (
                    <button className="btn btn-danger btn-sm" onClick={() => onDelete(u.unit_name)}>
                      ⚠ Tap again to delete everything
                    </button>
                  ) : (
                    <button className="btn btn-danger-ghost btn-sm" onClick={() => armDelete(u.unit_name)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="muted small">
          Deleting a house permanently erases its products, audit records, and label photos
          from this device. Download a backup first if in doubt.
        </p>
      </div>

      <div className="card">
        <h3>Add a House</h3>
        <form onSubmit={onAdd} className="add-unit-form">
          <label className="field">
            <span>House Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. MIT New Vassar" />
          </label>
          <label className="field">
            <span>COMPASS ID <span className="muted">(optional)</span></span>
            <input type="text" value={compass} onChange={(e) => setCompass(e.target.value)}
              placeholder="e.g. 55692" />
          </label>
          <button className="btn btn-primary" type="submit">Add House</button>
        </form>
        <p className="muted small">
          Importing an inventory file also creates its house automatically.
        </p>
      </div>
    </div>
  );
}
