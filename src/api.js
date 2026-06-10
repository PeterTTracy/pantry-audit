// Thin fetch wrapper. In dev, Vite proxies /api -> :3001; in prod it's same-origin.
async function jget(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

async function jpost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

async function jpostForm(url, formData) {
  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

export const api = {
  units: () => jget('/api/units'),
  locations: (unit) => jget(`/api/locations?unit=${encodeURIComponent(unit)}`),
  products: ({ unit, location, search, allergen }) => {
    const qs = new URLSearchParams({ unit });
    if (location) qs.set('location', location);
    if (search) qs.set('search', search);
    if (allergen) qs.set('allergen', allergen);
    return jget(`/api/products?${qs.toString()}`);
  },
  product: (id) => jget(`/api/products/${id}`),
  saveAudit: (id, formData) => jpostForm(`/api/products/${id}/audit`, formData),
  importFile: (formData) => jpostForm('/api/import', formData),
  compliance: () => jget('/api/compliance'),
  exportUrl: () => '/api/export',
};
