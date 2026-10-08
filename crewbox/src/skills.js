import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { slugify, safeJoin } from './util.js';

// A skill is a folder: SKILL.md (frontmatter name/description + body) plus reference files.
// App-installed skills carry a .crewbox.json marker and are read-only everywhere.

const PAGE = 100_000;
const MAX_FILES = 200;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 50 * 1024 * 1024;
const META = '.crewbox.json';

export function parseSkillMd(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { name: '', description: '', body: text.trim() };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { name: fm.name || '', description: fm.description || '', body: m[2].trim() };
}

const yamlLine = (s) => (/[:#\n"']/.test(s) ? JSON.stringify(s) : s);

export const renderSkillMd = ({ name, description, body }) =>
  `---\nname: ${yamlLine(name)}\ndescription: ${yamlLine(description || '')}\n---\n\n${(body || '').trim()}\n`;

function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.name !== 'SKILL.md' && e.name !== META) out.push({ path: path.relative(base, p).split(path.sep).join('/'), bytes: fs.statSync(p).size });
  }
  return out;
}

const meta = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8')); } catch { return {}; } };

export function listSkills(agentId) {
  const root = paths.agentSkills(agentId);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    const dir = path.join(root, e.name);
    const md = fs.existsSync(path.join(dir, 'SKILL.md')) ? parseSkillMd(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')) : { name: e.name, description: '' };
    const m = meta(dir);
    return { slug: e.name, name: md.name || e.name, description: md.description, files: walk(dir), ...(m.connector ? { connector: m.connector, readOnly: true } : {}) };
  }).sort((a, b) => a.slug.localeCompare(b.slug));
}

function skillDir(agentId, slug) {
  const dir = safeJoin(paths.agentSkills(agentId), slugify(slug));
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`Skill not found: ${slug}`);
  return dir;
}

export function getSkill(agentId, slug) {
  const dir = skillDir(agentId, slug);
  const md = parseSkillMd(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
  const m = meta(dir);
  return { slug: path.basename(dir), ...md, files: walk(dir), ...(m.connector ? { connector: m.connector, readOnly: true } : {}) };
}

export function readSkillFile(agentId, slug, rel, offset = 0) {
  if (rel === 'SKILL.md') throw new Error('SKILL.md is the skill body: read it with get_skill.');
  const dir = skillDir(agentId, slug);
  const text = fs.readFileSync(safeJoin(dir, rel), 'utf8');
  const start = Math.max(0, Number(offset) || 0);
  const content = text.slice(start, start + PAGE);
  const next = start + PAGE < text.length ? start + PAGE : null;
  return { slug, path: rel, content, offset: start, nextOffset: next, totalChars: text.length, truncated: next !== null };
}

/** Create or replace a skill atomically (written to a temp folder, then swapped in). */
export function upsertSkill(agentId, { name, description = '', body, slug, files = [], removeFiles = [] }, { allowReadOnly = false, connector = null } = {}) {
  if (!name || body == null) throw new Error('name and body are required.');
  const root = paths.agentSkills(agentId);
  fs.mkdirSync(root, { recursive: true });
  const targetSlug = slugify(slug || name);
  const target = safeJoin(root, targetSlug);
  const exists = fs.existsSync(target);
  if (exists && meta(target).connector && !allowReadOnly) throw new Error(`Skill "${targetSlug}" belongs to the app "${meta(target).connector}" and is read-only. Write a skill of your own next to it.`);
  const overlap = files.map((f) => f.path).filter((p) => removeFiles.includes(p));
  if (overlap.length) throw new Error(`A path cannot be in both files and removeFiles: ${overlap.join(', ')}`);
  if (files.some((f) => f.path === 'SKILL.md')) throw new Error('SKILL.md is written through body, not files.');

  const tmp = path.join(root, `.tmp-${targetSlug}-${Date.now()}`);
  if (exists) fs.cpSync(target, tmp, { recursive: true }); else fs.mkdirSync(tmp);
  try {
    fs.writeFileSync(path.join(tmp, 'SKILL.md'), renderSkillMd({ name, description, body }));
    for (const f of files) {
      if (Buffer.byteLength(f.content ?? '') > MAX_FILE) throw new Error(`${f.path} is over 10 MB.`);
      const p = safeJoin(tmp, f.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.content ?? '');
    }
    const all = walk(tmp);
    if (all.length > MAX_FILES) throw new Error(`A skill lists up to ${MAX_FILES} files.`);
    if (all.reduce((n, f) => n + f.bytes, 0) > MAX_TOTAL) throw new Error('A skill is limited to 50 MB in total.');
    if (connector) fs.writeFileSync(path.join(tmp, META), JSON.stringify({ connector }));
    if (exists) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  // A renamed skill (slug given + new name) keeps its folder under the given slug.
  for (const rel of removeFiles) {
    try { fs.rmSync(safeJoin(target, rel), { force: true }); } catch { /* left in place */ }
  }
  return getSkill(agentId, targetSlug);
}

export function deleteSkill(agentId, slug, { allowReadOnly = false } = {}) {
  const dir = skillDir(agentId, slug);
  if (meta(dir).connector && !allowReadOnly) throw new Error(`Skill "${slug}" was installed by the app "${meta(dir).connector}". Detach that app to remove it.`);
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleted: slug };
}

export function skillIndex(agentId) {
  return listSkills(agentId).map((s) => `- ${s.name} (\`${s.slug}\`): ${s.description || 'no description'}`).join('\n');
}
