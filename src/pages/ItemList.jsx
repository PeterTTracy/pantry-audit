import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session.jsx';
import { ALLERGENS } from '../allergens';

const STATUS_LABEL = { pending: 'Pending', in_progress: 'In Progress', complete: 'Complete' };

export default function ItemList() {
  const { unit } = useSession();
  const [params] = useSearchParams();
  const location = params.get('location') || '';
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [allergen, setAllergen] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    api.products({ unit: unit.unit_name, location, search, allergen })
      .then(setItems)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 200); // debounce search
    return () => clearTimeout(t);
  }, [search, allergen]); // eslint-disable-line

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/locations" className="back">← Locations</Link>
          <h1>{location || 'All Items'}</h1>
          <p className="muted">{unit?.unit_name}</p>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search item, brand, or GTIN…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={allergen} onChange={(e) => setAllergen(e.target.value)}>
          <option value="">Filter: any allergen</option>
          {ALLERGENS.map((a) => (
            <option key={a.key} value={a.key}>Flagged: {a.label}</option>
          ))}
        </select>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {err && <div className="alert alert-error">{err}</div>}

      {!loading && items.length === 0 && (
        <div className="card empty">No items match.</div>
      )}

      <div className="item-list">
        {items.map((it) => (
          <button key={it.id} className="card item-row" onClick={() => nav(`/audit/${it.id}`)}>
            <div className="item-main">
              <div className="item-name">{it.item_description}</div>
              <div className="item-sub">
                {it.brand && <span>{it.brand}</span>}
                {it.gtin && <span className="mono">GTIN {it.gtin}</span>}
                {!it.gtin && <span className="muted">No GTIN</span>}
              </div>
            </div>
            <div className="item-flags">
              {it.has_prefill ? <span className="chip chip-prefill" title="Open Food Facts prefill available">OFF</span> : null}
              {it.ask_us_flag ? <span className="chip chip-askus">Ask Us</span> : null}
              <span className={`status status-${it.audit_status}`}>{STATUS_LABEL[it.audit_status]}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
