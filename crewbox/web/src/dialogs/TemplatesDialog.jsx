import { api } from '../lib/api.js';
import { prompt } from './Prompt.jsx';
import { t } from '../lib/i18n.js';

export async function installFromLink(ctx, spaceId) {
  const link = await prompt(ctx.openModal, { title: t('Install from a share link'), label: t('Share link (…/s/<token>) or template JSON URL'), placeholder: t('http://127.0.0.1:4747/s/…') });
  if (!link) return;
  try {
    const tpl = await (await fetch(link)).json();
    const r = await api('install_template', { template: tpl, spaceId });
    await ctx.refresh();
    ctx.openAgent(r.installed[0].agentId);
  } catch (e) { ctx.toast(e.message, true); }
}
