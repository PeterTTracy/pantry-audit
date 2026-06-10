import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session.jsx';
import { ALLERGENS, VENDOR_TYPES, ASK_US_VENDOR_TYPES, tagsToFlags, tagsToText } from '../allergens';

const emptyFlags = () => Object.fromEntries(ALLERGENS.map((a) => [a.key, false]));

export default function AuditForm() {
  const { id } = useParams();
  const { unit, reviewer } = useSession();
  const nav = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // form state
  const [vendorType, setVendorType] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [disclaimers, setDisclaimers] = useState('');
  const [flags, setFlags] = useState(emptyFlags());
  const [otherAllergens, setOtherAllergens] = useState('');
  const [askUs, setAskUs] = useState(false);
  const [askUsTouched, setAskUsTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState(null);
  const [hadPrefill, setHadPrefill] = useState(false);

  useEffect(() => {
    api.product(id)
      .then((d) => {
        setData(d);
        const { audit, prefill } = d;
        setHadPrefill(!!prefill);

        if (audit) {
          // Existing record wins.
          setVendorType(audit.vendor_type || '');
          setIngredients(audit.ingredients || '');
          setDisclaimers(audit.voluntary_disclaimers || '');
          setFlags(Object.fromEntries(ALLERGENS.map((a) => [a.key, !!audit[`allergen_${a.key}`]])));
          setOtherAllergens(audit.allergen_other || '');
          setAskUs(!!audit.ask_us_flag);
          setAskUsTouched(true); // preserve saved value
          setNotes(audit.notes || '');
        } else if (prefill) {
          // Pre-fill from Open Food Facts (advisory only).
          setIngredients(prefill.ingredients_text || '');
          setDisclaimers(tagsToText(prefill.traces_tags));
          setFlags({ ...emptyFlags(), ...tagsToFlags(prefill.allergens_tags) });
        }
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Vendor type drives ask_us unless staff overrode it.
  const onVendorType = (val) => {
    setVendorType(val);
    if (!askUsTouched) setAskUs(ASK_US_VENDOR_TYPES.has(val));
  };

  const toggleFlag = (key) => setFlags((f) => ({ ...f, [key]: !f[key] }));

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const fd = new FormData();
      fd.set('unit_name', unit.unit_name);
      fd.set('vendor_type', vendorType);
      fd.set('ingredients', ingredients);
      fd.set('voluntary_disclaimers', disclaimers);
      ALLERGENS.forEach((a) => fd.set(`allergen_${a.key}`, flags[a.key] ? '1' : '0'));
      fd.set('allergen_other', otherAllergens);
      fd.set('ask_us_flag', askUs ? '1' : '0');
      fd.set('reviewed_by', reviewer || '');
      fd.set('notes', notes);
      fd.set('gtin_prefill_used', hadPrefill ? '1' : '0');
      if (photo) fd.set('label_photo', photo);

      await api.saveAudit(id, fd);
      setSaved(true);
      setTimeout(() => nav(-1), 700);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Loading…</p>;
  if (err && !data) return <div className="alert alert-error">{err}</div>;

  const p = data.product;
  const existingPhoto = data.audit?.label_photo_path;

  return (
    <form onSubmit={submit} className="audit-form">
      <div className="page-head">
        <div>
          <button type="button" className="back" onClick={() => nav(-1)}>← Back</button>
          <h1>{p.item_description}</h1>
        </div>
        <span className={`status status-${p.audit_status}`}>{p.audit_status.replace('_', ' ')}</span>
      </div>

      {/* Read-only header */}
      <div className="card readonly-head">
        <div><label>Item Description</label><div>{p.item_description}</div></div>
        <div><label>Brand</label><div>{p.brand || '—'}</div></div>
        <div><label>GTIN</label><div className="mono">{p.gtin || '—'}</div></div>
        <div><label>Distributor SKU</label><div className="mono">{p.distributor_sku || '—'}</div></div>
        <div><label>Storage Location</label><div>{p.storage_location || '—'}</div></div>
      </div>

      {hadPrefill && (
        <div className="alert alert-warning">
          ⚠️ Data pre-filled from Open Food Facts. <strong>Verify against the physical label before saving.</strong>
        </div>
      )}

      <div className="card form-section">
        <label className="field">
          <span>Vendor Type</span>
          <select value={vendorType} onChange={(e) => onVendorType(e.target.value)}>
            <option value="">— Select —</option>
            {VENDOR_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Ingredients</span>
          <textarea rows={4} value={ingredients} onChange={(e) => setIngredients(e.target.value)}
            placeholder="Full ingredient statement from the label…" />
        </label>

        <label className="field">
          <span>Voluntary Disclaimers</span>
          <textarea rows={2} value={disclaimers} onChange={(e) => setDisclaimers(e.target.value)}
            placeholder='e.g. "May contain tree nuts."' />
        </label>
      </div>

      <div className="card form-section">
        <h3>Allergens Present</h3>
        <div className="allergen-grid">
          {ALLERGENS.map((a) => (
            <label key={a.key} className={`allergen-chk ${flags[a.key] ? 'on' : ''}`}>
              <input type="checkbox" checked={flags[a.key]} onChange={() => toggleFlag(a.key)} />
              <span>{a.label}</span>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Other Allergens</span>
          <input type="text" value={otherAllergens} onChange={(e) => setOtherAllergens(e.target.value)}
            placeholder="e.g. mustard, celery, sulphites…" />
        </label>
      </div>

      <div className="card form-section">
        <label className={`toggle-row ${askUs ? 'on' : ''}`}>
          <input type="checkbox" checked={askUs}
            onChange={(e) => { setAskUs(e.target.checked); setAskUsTouched(true); }} />
          <span>
            <strong>Ask Us Flag</strong>
            <small className="muted"> — auto-set for House-Made, Local Artisan, and Imported (Non-English Label). Override as needed.</small>
          </span>
        </label>
      </div>

      <div className="card form-section">
        <h3>Label Photo</h3>
        {existingPhoto && (
          <div className="photo-existing">
            <img src={existingPhoto} alt="Current label" />
            <span className="muted small">Current photo. Uploading a new one replaces it.</span>
          </div>
        )}
        <input type="file" accept="image/jpeg,image/png" onChange={(e) => setPhoto(e.target.files[0] || null)} />
        {photo && <p className="muted small">Selected: {photo.name}</p>}
      </div>

      <div className="card form-section">
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <div className="form-actions">
        <span className="muted small">Reviewing as <strong>{reviewer || '—'}</strong> · saving sets review due +90 days</span>
        <div>
          <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || saved}>
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Audit'}
          </button>
        </div>
      </div>
    </form>
  );
}
