import { api } from '../lib/api.js';
import { prompt } from './Prompt.jsx';

export async function installFromLink(ctx, spaceId) {
  const link = await prompt(ctx.openModal, { title: 'Install from a share link', label: 'Share link (…/s/<token>) or template JSON URL', placeholder: 'http://127.0.0.1:4747/s/…' });
  if (!link) return;
  try {
    const t = await (await fetch(link)).json();
    const r = await api('install_template', { template: t, spaceId });
    await ctx.refresh();
    ctx.openAgent(r.installed[0].agentId);
  } catch (e) { ctx.toast(e.message, true); }
}
