import { useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadUrl } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { ago } from '../lib/format.js';
import { Button, Input, Select, Empty } from '../ui/kit.jsx';
import Icon from '../ui/icons.jsx';
import { confirmDialog } from '../dialogs/Prompt.jsx';
import { t } from '../lib/i18n.js';

/** Tables of a coworker database (agentId) or of the shared database. */
export function DbBrowser({ agentId }) {
  const { safe, openModal, overview } = useApp();
  const [tables, setTables] = useState(null);
  const [table, setTable] = useState('');
  const [q, setQ] = useState({ offset: 0, sort: null, desc: false, search: '' });
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(new Set());

  const loadTables = useCallback(async () => {
    const r = agentId ? await api('list_tables', { agentId }) : await api('shared_tables');
    setTables(r.tables);
    setTable((cur) => (r.tables.some((x) => x.name === cur) ? cur : r.tables[0]?.name || ''));
  }, [agentId]);
  useEffect(() => { loadTables().catch(() => setTables([])); }, [loadTables]);
  const load = useCallback(async () => {
    if (!table) return;
    setData(await api('browse_table', { agentId, table, limit: 50, ...q }));
    setPicked(new Set());
  }, [agentId, table, q]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  if (!tables) return null;
  if (!tables.length) return <Empty icon="db">{t('No table yet. Coworkers create tables as they work: leads, invoices, tickets…')}</Empty>;
  const cols = data?.table.columns.map((c) => c.name) || [];
  const owner = (id) => (id?.startsWith('agt_') ? overview?.agents.find((a) => a.id === id)?.name || 'a coworker' : id);
  const exportRows = (fmt) => {
    const body = fmt === 'json' ? JSON.stringify(data.rows.map(({ _rowid, ...r }) => r), null, 2)
      : [cols.join(','), ...data.rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: fmt === 'json' ? 'application/json' : 'text/csv' }));
    a.download = `${table}.${fmt}`;
    a.click();
  };

  return (
    <div className="stack">
      <div className="row wrap">
        <div className="grow"><Select value={table} onChange={(e) => { setTable(e.target.value); setQ({ offset: 0, sort: null, desc: false, search: '' }); }}>
          {tables.map((tb) => <option key={tb.name} value={tb.name}>{tb.name} ({tb.rows}){tb.createdBy ? ` · ${t('by {who}', { who: owner(tb.createdBy) })}` : ''}</option>)}
        </Select></div>
        <div style={{ width: 220 }}><Input placeholder={t('Search…')} value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value, offset: 0 })} /></div>
      </div>
      <div className="table-wrap" data-lenis-prevent>
        <table className="data">
          <thead><tr><th />{cols.map((c) => <th key={c} onClick={() => setQ({ ...q, sort: c, desc: q.sort === c ? !q.desc : false })}>{c}{q.sort === c ? (q.desc ? ' ↓' : ' ↑') : ''}</th>)}</tr></thead>
          <tbody>{data?.rows.map((row) => (
            <tr key={row._rowid}>
              <td><input type="checkbox" checked={picked.has(row._rowid)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(row._rowid) : n.delete(row._rowid); setPicked(n); }} /></td>
              {cols.map((c) => <td key={c} title={String(row[c] ?? '')}>{String(row[c] ?? '')}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="row wrap">
        <span className="muted grow">{t('{n} rows', { n: data?.total ?? 0 })}</span>
        <Button size="sm" disabled={!q.offset} onClick={() => setQ({ ...q, offset: Math.max(0, q.offset - 50) })}>‹ Prev</Button>
        <Button size="sm" disabled={!data || q.offset + 50 >= data.total} onClick={() => setQ({ ...q, offset: q.offset + 50 })}>Next ›</Button>
        <Button size="sm" onClick={() => exportRows('csv')}>{t('CSV')}</Button>
        <Button size="sm" onClick={() => exportRows('json')}>{t('JSON')}</Button>
        <Button size="sm" variant="danger" disabled={!picked.size} onClick={safe(async () => { if (await confirmDialog(openModal, { title: t('Delete rows'), text: t('Delete {n} selected rows?', { n: picked.size }), danger: true, confirmLabel: t('Delete') })) { await api('drop_rows', { agentId, table, rowids: [...picked] }); load(); } })}>{t('Delete selected')}</Button>
        <Button size="sm" variant="danger" onClick={safe(async () => { if (await confirmDialog(openModal, { title: t('Drop {name}', { name: table }), text: t('The whole table and its rows will be deleted.'), danger: true, typeToConfirm: table, confirmLabel: t('Drop table') })) { await api('drop_rows', { agentId, table, dropTable: true }); loadTables(); } })}>{t('Drop table')}</Button>
      </div>
    </div>
  );
}

/** Files of a coworker workspace (agentId) or of the shared folder. */
export function FileBrowser({ agentId }) {
  const { safe, toast, openModal } = useApp();
  const [dir, setDir] = useState('');
  const [files, setFiles] = useState(null);
  const input = useRef(null);
  const load = useCallback(async () => setFiles((await api('list_files', { agentId, path: dir || '.' })).files), [agentId, dir]);
  useEffect(() => { load().catch(() => setFiles([])); }, [load]);

  const upload = safe(async (list) => {
    for (const f of list) {
      const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
      await api('write_file', { agentId, path: `${dir ? `${dir}/` : ''}${f.name}`, content: b64, encoding: 'base64' });
    }
    toast(t('Uploaded')); load();
  });
  const crumbs = ['', ...dir.split('/').filter(Boolean)];

  return (
    <div className="stack" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload([...e.dataTransfer.files]); }}>
      <div className="row wrap">
        <div className="crumbs grow">
          {crumbs.map((c, i) => <button key={i} className="link-btn" onClick={() => setDir(crumbs.slice(1, i + 1).join('/'))}>{i === 0 ? (agentId ? t('workspace') : t('shared')) : c} /</button>)}
        </div>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload([...e.target.files])} />
        <Button size="sm" variant="primary" icon="upload" onClick={() => input.current.click()}>{t('Upload')}</Button>
      </div>
      <p className="fine">{agentId ? t('Drop files here to give the coworker something to work on. Its deliverables land here too.') : t('Every coworker reads and writes this folder: it is how they hand files to each other.')}</p>
      {files && !files.length ? <Empty icon="folder">{t('Empty folder.')}</Empty> : null}
      <div className="file-list">
        {files?.map((f) => (
          <div className="file-row" key={f.path}>
            <Icon name={f.dir ? 'folder' : 'book'} size={16} />
            {f.dir ? <button className="link-btn grow left" onClick={() => setDir(f.path)}>{f.name}</button> : <a className="grow" href={downloadUrl(f.path, agentId, true)} target="_blank" rel="noreferrer">{f.name}</a>}
            {f.published ? <a className="pill ok" href={`/p/${f.published}`} target="_blank" rel="noreferrer">public link</a> : null}
            {f.dir ? null : <span className="muted small">{(f.size / 1024).toFixed(1)} KB · {ago(f.modified)}</span>}
            {f.dir ? null : <a className="icon-btn" href={downloadUrl(f.path, agentId)} aria-label={t('Download')}><Icon name="upload" size={15} style={{ transform: 'rotate(180deg)' }} /></a>}
            <button className="icon-btn" aria-label={t('Delete')} onClick={safe(async () => { if (await confirmDialog(openModal, { title: t('Delete'), text: t('Delete {name}?', { name: f.name }), danger: true, confirmLabel: t('Delete') })) { await api('delete_file', { agentId, path: f.path }); load(); } })}><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
