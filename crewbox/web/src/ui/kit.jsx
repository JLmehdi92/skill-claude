import { forwardRef, useState } from 'react';
import Icon from './icons.jsx';
import { t } from '../lib/i18n.js';
import { hueOf, initials, STATUS } from '../lib/format.js';

export function Button({ variant = '', size = '', icon, children, className = '', busy, ...rest }) {
  return (
    <button className={`btn ${variant} ${size} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children != null ? <span>{busy ? t('Working…') : children}</span> : null}
    </button>
  );
}

/** Button whose async onClick shows a busy state. */
export function AsyncButton({ onClick, ...rest }) {
  const [busy, setBusy] = useState(false);
  return <Button {...rest} busy={busy} onClick={async (e) => { setBusy(true); try { await onClick?.(e); } finally { setBusy(false); } }} />;
}

export function Avatar({ agent, size = 44, ring }) {
  const h = hueOf(agent.handle || agent.name);
  return (
    <div className={`orb ${ring ? `ring-${ring}` : ''}`} style={{ '--h': h, width: size, height: size, fontSize: size * 0.36 }}>
      <span>{initials(agent.name)}</span>
    </div>
  );
}

export const StatusBadge = ({ status }) => (
  <span className={`status status-${status}`}><i />{t(STATUS[status] || status)}</span>
);

export const Pill = ({ tone = '', children, ...rest }) => <span className={`pill ${tone}`} {...rest}>{children}</span>;

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint ? <em> · {hint}</em> : null}</span>
      {children}
    </label>
  );
}

export const Input = forwardRef(({ className = '', ...props }, ref) => <input ref={ref} className={`input ${className.replace(/\binput\b/, '')}`} {...props} />);
export const Textarea = forwardRef(({ code, ...props }, ref) => <textarea ref={ref} className={`input ${code ? 'code' : ''}`} {...props} />);
export const Select = ({ children, className = '', ...props }) => <select className={`input ${className}`} {...props}>{children}</select>;

export function Toggle({ checked, onChange, label }) {
  return (
    <label className={`toggle ${checked ? 'on' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} aria-checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="knob" />
      <span>{label}</span>
    </label>
  );
}

export function SectionHead({ title, sub, children }) {
  return (
    <div className="section-head">
      <div><h3>{title}</h3>{sub ? <p className="muted">{sub}</p> : null}</div>
      <div className="row">{children}</div>
    </div>
  );
}

export const Empty = ({ icon = 'sparkles', children }) => (
  <div className="empty"><Icon name={icon} size={22} /><p>{children}</p></div>
);

export function Segmented({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}
