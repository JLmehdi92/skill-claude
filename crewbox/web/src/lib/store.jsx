import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onServerEvent } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

/** Run fn when a server event arrives, with the latest closure. */
export function useServerEvents(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onServerEvent((ev) => ref.current(ev)), []);
}

let toastId = 0;
let modalId = 0;

export function AppProvider({ children }) {
  const [overview, setOverview] = useState(null);
  const [agentId, setAgentId] = useState(null);
  const [tab, setTab] = useState('chat');
  const [toasts, setToasts] = useState([]);
  const [modals, setModals] = useState([]);
  const timer = useRef();

  const refresh = useCallback(async () => {
    try { setOverview(await api('overview')); } catch (e) { toast(e.message, true); }
  }, []);
  const refreshSoon = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(refresh, 250); }, [refresh]);

  const toast = useCallback((text, error = false) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3200);
  }, []);

  /** openModal({ title, wide, render: (close) => JSX }) */
  const openModal = useCallback((m) => {
    const id = ++modalId;
    setModals((list) => [...list, { ...m, id }]);
    return () => setModals((list) => list.filter((x) => x.id !== id));
  }, []);
  const closeModal = useCallback((id) => setModals((list) => list.filter((x) => x.id !== id)), []);

  const openAgent = useCallback((id, t) => { setAgentId(id); setTab(t || 'chat'); }, []);
  const closeAgent = useCallback(() => setAgentId(null), []);

  /** Wrap an async handler: errors become toasts. */
  const safe = useCallback((fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);
  useServerEvents((ev) => { if (['agents', 'spaces', 'notification', 'pause', 'run'].includes(ev.type)) refreshSoon(); });

  const value = useMemo(() => ({
    overview, refresh, refreshSoon, agentId, tab, setTab, openAgent, closeAgent, toast, safe, toasts, modals, openModal, closeModal,
  }), [overview, refresh, refreshSoon, agentId, tab, openAgent, closeAgent, toast, safe, toasts, modals, openModal, closeModal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
