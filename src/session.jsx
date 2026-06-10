import React, { createContext, useContext, useState } from 'react';

const SessionContext = createContext(null);

const load = (k, d) => {
  try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; }
};

export function SessionProvider({ children }) {
  const [unit, setUnitState] = useState(() => load('pa_unit', null));
  const [reviewer, setReviewerState] = useState(() => load('pa_reviewer', ''));

  const setUnit = (u) => {
    setUnitState(u);
    sessionStorage.setItem('pa_unit', JSON.stringify(u));
  };
  const setReviewer = (r) => {
    setReviewerState(r);
    sessionStorage.setItem('pa_reviewer', JSON.stringify(r));
  };
  const clear = () => {
    setUnitState(null); setReviewerState('');
    sessionStorage.removeItem('pa_unit');
    sessionStorage.removeItem('pa_reviewer');
  };

  return (
    <SessionContext.Provider value={{ unit, reviewer, setUnit, setReviewer, clear }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
