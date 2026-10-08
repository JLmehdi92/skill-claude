import { useEffect, useLayoutEffect, useRef } from 'react';
import { useApp } from '../lib/store.jsx';
import { gsap, lockScroll } from '../lib/smooth.js';
import Icon from './icons.jsx';

function Modal({ m, top }) {
  const { closeModal } = useApp();
  const card = useRef(null);
  const back = useRef(null);
  const close = () => {
    gsap.to(card.current, { y: 16, scale: 0.97, opacity: 0, duration: 0.18, ease: 'power2.in' });
    gsap.to(back.current, { opacity: 0, duration: 0.2, onComplete: () => closeModal(m.id) });
    m.onClose?.();
  };
  useLayoutEffect(() => {
    gsap.fromTo(back.current, { opacity: 0 }, { opacity: 1, duration: 0.25 });
    gsap.fromTo(card.current, { y: 30, scale: 0.96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.45, ease: 'expo.out' });
  }, []);
  useEffect(() => {
    if (!top) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="modal-back" ref={back} onMouseDown={(e) => { if (e.target === back.current) close(); }}>
      <div className={`modal ${m.wide ? 'wide' : ''}`} ref={card} role="dialog" aria-label={m.title} data-lenis-prevent>
        <header className="modal-head">
          <h2>{m.title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="modal-body">{m.render(close)}</div>
      </div>
    </div>
  );
}

export function Modals() {
  const { modals } = useApp();
  const open = modals.length > 0;
  useEffect(() => { if (!open) return undefined; lockScroll(true); return () => lockScroll(false); }, [open]);
  return modals.map((m, i) => <Modal key={m.id} m={m} top={i === modals.length - 1} />);
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>{t.text}</div>)}
    </div>
  );
}
