import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { initSync } from './lib/sync';
import './styles.css';

// Ask the browser not to evict our IndexedDB data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

// Real inventory lives in the cloud (Supabase) and is the source of truth, so
// we no longer seed demo sample data on first run — a fresh or cleared device
// populates IndexedDB purely from initSync -> pullAll. (The demo seed in
// ./lib/seed.js is retained for local dev but intentionally not invoked.)
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);

// Kick off background sync after render — never blocks the UI.
initSync().catch((e) => console.warn('[sync]', e?.message));
