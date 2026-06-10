import React from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './session.jsx';
import UnitSelect from './pages/UnitSelect.jsx';
import LocationDashboard from './pages/LocationDashboard.jsx';
import ItemList from './pages/ItemList.jsx';
import AuditForm from './pages/AuditForm.jsx';
import ComplianceDashboard from './pages/ComplianceDashboard.jsx';
import ImportScreen from './pages/Import.jsx';

function TopBar() {
  const { unit, reviewer, clear } = useSession();
  const loc = useLocation();
  if (loc.pathname === '/') return null;
  return (
    <header className="topbar">
      <Link to={unit ? '/locations' : '/'} className="brand">
        <span className="brand-mark">🍽️</span>
        <span>Pantry Audit</span>
      </Link>
      <nav className="topnav">
        <Link to="/locations">Locations</Link>
        <Link to="/import">Import</Link>
        <Link to="/compliance">Compliance</Link>
      </nav>
      <div className="topbar-right">
        {unit && <span className="chip chip-unit">{unit.unit_name}</span>}
        {reviewer && <span className="who">👤 {reviewer}</span>}
        <button className="btn btn-ghost" onClick={clear}>Switch unit</button>
      </div>
    </header>
  );
}

// Routes that need a selected unit redirect to the unit-select screen.
function RequireUnit({ children }) {
  const { unit } = useSession();
  if (!unit) return <Navigate to="/" replace />;
  return children;
}

function Shell() {
  return (
    <>
      <TopBar />
      <main className="container">
        <Routes>
          <Route path="/" element={<UnitSelect />} />
          <Route path="/locations" element={<RequireUnit><LocationDashboard /></RequireUnit>} />
          <Route path="/items" element={<RequireUnit><ItemList /></RequireUnit>} />
          <Route path="/audit/:id" element={<RequireUnit><AuditForm /></RequireUnit>} />
          <Route path="/import" element={<ImportScreen />} />
          <Route path="/compliance" element={<ComplianceDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
