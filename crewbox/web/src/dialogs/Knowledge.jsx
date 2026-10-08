import { useState } from 'react';
import { Segmented } from '../ui/kit.jsx';
import { DbBrowser, FileBrowser } from '../panel/browsers.jsx';

function KnowledgeBody() {
  const [tab, setTab] = useState('files');
  return (
    <div className="stack">
      <p className="muted">Shared by every coworker of the workspace, whichever Box they sit in.</p>
      <Segmented value={tab} onChange={setTab} options={[['files', 'Shared folder'], ['db', 'Shared database']]} />
      {tab === 'files' ? <FileBrowser /> : <DbBrowser />}
    </div>
  );
}

export const openKnowledge = (ctx) => ctx.openModal({ title: 'Knowledge base', wide: true, render: () => <KnowledgeBody /> });
