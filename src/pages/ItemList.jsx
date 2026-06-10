import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session.jsx';
import { ALLERGENS } from '../allergens';

const STATUS_LABEL = { pending: 'Pending', in_progress: 'In Progress', complete: 'Complete' };
const REMOVE_THRESHOLD = 110; // px of leftward swipe that triggers removal

// Row that can be swiped left to remove the item from the audit list.
// Pointer events cover both touch and mouse; vertical movement cancels the
// swipe so the list still scrolls naturally.
function SwipeableRow({ item, onOpen, onRemove }) {
  const [dx, setDx] = useState(0);
  const [releasing, setReleasing] = useState(false);
  // Gesture state lives in a ref: pointer events can outpace renders, so the
  // handlers must never depend on (possibly stale) state.
  const drag = useRef({ tracking: false, swiping: false, moved: false, startX: 0, startY: 0, dx: 0 });

  const onPointerDown = (e) => {
    drag.current = { tracking: true, swiping: false, moved: false, startX: e.clientX, startY: e.clientY, dx: 0 };
  };

  const onPointerMove = (e) => {
    const g = drag.current;
    if (!g.tracking) return;
    const ddx = e.clientX - g.startX;
    const ddy = e.clientY - g.startY;
    if (!g.swiping) {
      if (Math.abs(ddx) < 8) return;
      // Mostly-vertical movement = scroll, not swipe.
      if (Math.abs(ddy) > Math.abs(ddx)) { g.tracking = false; return; }
      g.swiping = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    }
    g.moved = true;
    g.dx = Math.min(0, ddx);
    setDx(g.dx);
  };

  const endGesture = () => {
    const g = drag.current;
    if (!g.tracking) return;
    g.tracking = false;
    if (g.dx <= -REMOVE_THRESHOLD) {
      setReleasing(true);
      setDx(-500);
      setTimeout(() => onRemove(item), 180);
    } else {
      setReleasing(true);
      setDx(0);
      setTimeout(() => setReleasing(false), 200);
    }
  };

  const onClick = (e) => {
    // A swipe (even a partial one) shouldn't open the item.
    if (drag.current.moved) { drag.current.moved = false; e.preventDefault(); return; }
    onOpen(item);
  };

  return (
    <div className="swipe-wrap">
      <div className={`swipe-action ${dx <= -REMOVE_THRESHOLD ? 'armed' : ''}`} aria-hidden="true">
        Remove
      </div>
      <button
        className="card item-row"
        style={{
          transform: `translateX(${dx}px)`,
          transition: releasing ? 'transform .18s ease-out' : 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onClick={onClick}
      >
        <div className="item-main">
          <div className="item-name">{item.item_description}</div>
          <div className="item-sub">
            {item.brand && <span>{item.brand}</span>}
            {item.gtin && <span className="mono">GTIN {item.gtin}</span>}
            {!item.gtin && <span className="muted">No GTIN</span>}
          </div>
        </div>
        <div className="item-flags">
          {item.has_prefill ? <span className="chip chip-prefill" title="Open Food Facts prefill available">OFF</span> : null}
          {item.ask_us_flag ? <span className="chip chip-askus">Ask Us</span> : null}
          <span className={`status status-${item.audit_status}`}>{STATUS_LABEL[item.audit_status]}</span>
        </div>
      </button>
    </div>
  );
}

export default function ItemList() {
  const { unit } = useSession();
  const [params] = useSearchParams();
  const location = params.get('location') || '';
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [allergen, setAllergen] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [undo, setUndo] = useState(null); // { id, name }
  const undoTimer = useRef(null);
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

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const removeItem = async (item) => {
    try {
      await api.removeFromAudit(item.id);
      setItems((list) => list.filter((i) => i.id !== item.id));
      setUndo({ id: item.id, name: item.item_description });
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 6000);
    } catch (e) { setErr(e.message); }
  };

  const undoRemove = async () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    try {
      await api.restoreProduct(undo.id);
      setUndo(null);
      load();
    } catch (e) { setErr(e.message); }
  };

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

      <p className="muted small swipe-hint">Swipe an item left to remove it from the audit list.</p>

      {loading && <p className="muted">Loading…</p>}
      {err && <div className="alert alert-error">{err}</div>}

      {!loading && items.length === 0 && (
        <div className="card empty">No items match.</div>
      )}

      <div className="item-list">
        {items.map((it) => (
          <SwipeableRow
            key={it.id}
            item={it}
            onOpen={(item) => nav(`/audit/${item.id}`)}
            onRemove={removeItem}
          />
        ))}
      </div>

      {undo && (
        <div className="toast">
          <span>Removed “{undo.name}”</span>
          <button className="toast-undo" onClick={undoRemove}>Undo</button>
        </div>
      )}
    </div>
  );
}
