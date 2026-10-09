import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useServerEvents } from '../lib/store.jsx';
import { t } from '../lib/i18n.js';
import { Button, Field, Input, Textarea, Empty, Pill, SectionHead } from '../ui/kit.jsx';
import { openOnboarding } from '../foreman/Onboarding.jsx';

/** The Brain: company pages every coworker reads, and the updates coworkers propose. */
export function BrainPanel() {
  const { safe, toast, closeModal, modals } = useApp();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const load = useCallback(() => api('list_brain').then((d) => { setData(d); setSel((s) => s ?? d.pages[0]?.slug ?? null); }), []);
  useEffect(() => { load(); }, [load]);
  useServerEvents((ev) => { if (ev.type === 'brain') load(); });
  if (!data) return null;
  const page = data.pages.find((p) => p.slug === sel);
  const edit = (p) => setDraft({ slug: p?.slug, title: p?.title || '', body: p?.body || '' });
  return (
    <div className="stack" data-testid="brain">
      <p className="muted">{t('Where your company lives: every coworker reads these pages before it works. When one learns something worth keeping, it proposes a change; nothing moves until you accept it.')}</p>
      {data.proposals.length ? (
        <>
          <SectionHead title={t('Proposals')} sub={t('{n} waiting for you', { n: data.proposals.length })} />
          {data.proposals.map((p) => (
            <div className="brain-proposal" key={p.id} data-testid="brain-proposal">
              <div className="row between wrap"><strong>{p.title}</strong><span className="muted small">{p.agent_name ? t('by {who}', { who: p.agent_name }) : ''}</span></div>
              {p.reason ? <p className="small">{p.reason}</p> : null}
              <pre>{p.body}</pre>
              <div className="row end">
                <Button size="sm" onClick={safe(async () => { await api('decide_brain_proposal', { proposalId: p.id, accept: false }); load(); })}>{t('Reject')}</Button>
                <Button size="sm" variant="primary" icon="check" onClick={safe(async () => { await api('decide_brain_proposal', { proposalId: p.id, accept: true }); toast(t('Brain updated')); load(); })}>{t('Accept')}</Button>
              </div>
            </div>
          ))}
        </>
      ) : null}
      {!data.pages.length && !draft ? (
        <Empty icon="brain">
          {t('The Brain is empty. Let Foreman read your website, or write the first page.')}
          <div className="row center-row" style={{ marginTop: 12 }}>
            <Button variant="primary" icon="sparkles" onClick={() => { modals.forEach((m) => closeModal(m.id)); openOnboarding(); }}>{t('Read my website')}</Button>
            <Button icon="plus" onClick={() => edit(null)}>{t('New page')}</Button>
          </div>
        </Empty>
      ) : (
        <div className="brain-grid">
          <nav className="brain-list" aria-label={t('Brain pages')}>
            {data.pages.map((p) => <button key={p.slug} className={p.slug === sel && !draft ? 'on' : ''} onClick={() => { setSel(p.slug); setDraft(null); }}>{p.title}<small>{p.source === 'website' ? t('from your website') : p.source?.startsWith('agent:') ? t('proposed by a coworker') : t('written by you')}</small></button>)}
            <Button size="sm" icon="plus" onClick={() => edit(null)}>{t('New page')}</Button>
          </nav>
          {draft ? (
            <div className="stack">
              <Field label={t('Title')}><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
              <Field label={t('Content')} hint={t('markdown')}><Textarea rows={14} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
              <div className="row end">
                <Button onClick={() => setDraft(null)}>{t('Cancel')}</Button>
                <Button variant="primary" icon="check" onClick={safe(async () => { const p = await api('upsert_brain_page', draft); setDraft(null); setSel(p.slug); toast(t('Saved')); load(); })}>{t('Save')}</Button>
              </div>
            </div>
          ) : page ? (
            <article className="stack">
              <div className="row between wrap"><h3>{page.title}</h3><div className="row"><Pill>{page.source === 'website' ? t('website') : t('owner')}</Pill><Button size="sm" icon="edit" onClick={() => edit(page)}>{t('Edit')}</Button><Button size="sm" variant="danger" icon="trash" aria-label={t('Delete')} onClick={safe(async () => { await api('delete_brain_page', { slug: page.slug }); setSel(null); load(); })} /></div></div>
              <div className="brain-body">{page.body.split('\n').map((l, i) => (l.trim() ? <p key={i}>{l.replace(/\*\*/g, '')}</p> : <br key={i} />))}</div>
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const openBrain = (ctx) => ctx.openModal({ title: t('Brain'), wide: true, render: () => <BrainPanel /> });
