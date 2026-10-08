import { useState } from 'react';
import { Segmented } from '../ui/kit.jsx';
import { DbBrowser, FileBrowser } from '../panel/browsers.jsx';
import { t } from '../lib/i18n.js';

function KnowledgeBody() {
  const [tab, setTab] = useState('files');
  return (
    <div className="stack">
      <p className="muted">{t('Shared by every coworker of the workspace, whichever Box they sit in.')}</p>
      <Segmented value={tab} onChange={setTab} options={[['files', t('Shared folder')], ['db', t('Shared database')]]} />
      {tab === 'files' ? <FileBrowser /> : <DbBrowser />}
    </div>
  );
}

export const openKnowledge = (ctx) => ctx.openModal({ title: t('Knowledge base'), wide: true, render: () => <KnowledgeBody /> });
