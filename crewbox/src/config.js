import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const HOME = path.resolve(process.env.CREWBOX_HOME || path.join(os.homedir(), '.crewbox'));
export const PORT = Number(process.env.CREWBOX_PORT || 4747);
export const HOST = process.env.CREWBOX_HOST || '127.0.0.1';
export const PUBLIC_URL = (process.env.CREWBOX_PUBLIC_URL || `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`).replace(/\/$/, '');

export const paths = {
  home: HOME,
  db: path.join(HOME, 'crewbox.db'),
  sharedDir: path.join(HOME, 'shared', 'files'),
  sharedDb: path.join(HOME, 'shared', 'shared.db'),
  agentsDir: path.join(HOME, 'agents'),
  agentDir: (id) => path.join(HOME, 'agents', id),
  agentWorkspace: (id) => path.join(HOME, 'agents', id, 'workspace'),
  agentSkills: (id) => path.join(HOME, 'agents', id, 'skills'),
  agentDb: (id) => path.join(HOME, 'agents', id, 'agent.db'),
};

export function ensureDirs() {
  for (const d of [HOME, paths.sharedDir, paths.agentsDir]) fs.mkdirSync(d, { recursive: true });
}

export function ensureAgentDirs(id) {
  fs.mkdirSync(paths.agentWorkspace(id), { recursive: true });
  fs.mkdirSync(paths.agentSkills(id), { recursive: true });
}
