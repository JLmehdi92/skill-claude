import { useState } from 'react';
import { Segmented } from '../ui/kit.jsx';
import { DbBrowser, FileBrowser } from '../panel/browsers.jsx';
import { t } from '../lib/i18n.js';
import { BrainPanel } from './Brain.jsx';

function KnowledgeBody({ initial }) {
  const [tab, setTab] = useState(initial || 'brain');
  return (
    <div className="stack">
      <Segmented value={tab} onChange={setTab} options={[['brain', t('Company pages')], ['files', t('Shared folder')], ['db', t('Shared database')]]} />
      {tab === 'brain' ? <BrainPanel /> : (
        <>
          <p className="muted">{t('Shared by every coworker of the workspace, whichever Box they sit in.')}</p>
          {tab === 'files' ? <FileBrowser /> : <DbBrowser />}
        </>
      )}
    </div>
  );
}

/** The Brain: company pages, shared files and the shared database every coworker reads. */
export const openKnowledge = (ctx, tab) => ctx.openModal({ title: t('Brain'), wide: true, render: () => <KnowledgeBody initial={tab} /> });
