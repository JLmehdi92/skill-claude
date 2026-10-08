import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input, Textarea } from '../ui/kit.jsx';

function PromptBody({ label, value = '', placeholder, multiline, onDone, confirmLabel = 'OK' }) {
  const [v, setV] = useState(value);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select?.(); }, []);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onDone(v.trim() ? v : null); }}>
      <Field label={label}>
        {multiline ? <Textarea ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} rows={6} /> : <Input ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />}
      </Field>
      <div className="row end"><Button type="button" onClick={() => onDone(null)}>Cancel</Button><Button variant="primary" type="submit">{confirmLabel}</Button></div>
    </form>
  );
}

/** A styled replacement for window.prompt. Resolves to the text, or null. */
export function prompt(openModal, opts) {
  return new Promise((resolve) => {
    openModal({ title: opts.title, onClose: () => resolve(null), render: (close) => <PromptBody {...opts} onDone={(v) => { resolve(v); close(); }} /> });
  });
}

function ConfirmBody({ text, typeToConfirm, danger, confirmLabel, onDone }) {
  const [typed, setTyped] = useState('');
  return (
    <div>
      <p className="muted">{text}</p>
      {typeToConfirm ? <Field label={`Type ${typeToConfirm} to confirm`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></Field> : null}
      <div className="row end">
        <Button onClick={() => onDone(false)}>Cancel</Button>
        <Button variant={danger ? 'danger solid' : 'primary'} disabled={typeToConfirm && typed !== typeToConfirm} onClick={() => onDone(true)}>{confirmLabel || 'Confirm'}</Button>
      </div>
    </div>
  );
}

export function confirmDialog(openModal, opts) {
  return new Promise((resolve) => {
    openModal({ title: opts.title, onClose: () => resolve(false), render: (close) => <ConfirmBody {...opts} onDone={(v) => { resolve(v); close(); }} /> });
  });
}
