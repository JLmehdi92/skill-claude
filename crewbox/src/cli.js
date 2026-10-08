#!/usr/bin/env node
import { openDb, closeDb } from './db.js';
import { PORT, HOST, PUBLIC_URL, paths } from './config.js';
import { ensureDefaultSpace } from './agents.js';
import { listConnections, createConnection } from './providers/index.js';
import { startScheduler, stopScheduler } from './automations.js';
import { recoverRuns } from './runtime/runner.js';
import { sweepMemories } from './memory.js';
import { closeAll as closeMcp } from './mcp.js';
import { closeAllFileDbs } from './sqlite-tools.js';
import { createServer, UI_TOKEN } from './server.js';

export function boot() {
  openDb();
  ensureDefaultSpace();
  if (!listConnections().length) {
    if (process.env.ANTHROPIC_API_KEY) createConnection({ name: 'Claude', provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY });
    else createConnection({ name: 'Offline demo', provider: 'mock' });
  }
  recoverRuns();
  sweepMemories();
  startScheduler();
}

export async function start() {
  boot();
  const server = createServer();
  await new Promise((r) => server.listen(PORT, HOST, r));
  console.log(`\n  Crewbox is running → ${PUBLIC_URL}/\n  Data: ${paths.home}\n  Account MCP endpoint: ${PUBLIC_URL}/api/mcp/account (create a key under Settings → API)\n`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log(`  UI token (needed when opening from another machine): ${UI_TOKEN}\n`);
  const stop = async () => {
    stopScheduler();
    server.close();
    await closeMcp();
    closeAllFileDbs();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(sweepMemories, 6 * 3600_000).unref();
  return server;
}

const cmd = process.argv[2] || 'start';
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js')) {
  if (cmd === 'start') start();
  else { console.log('Usage: crewbox start   (env: CREWBOX_HOME, CREWBOX_PORT, CREWBOX_HOST, CREWBOX_PUBLIC_URL, ANTHROPIC_API_KEY)'); process.exit(cmd === 'help' ? 0 : 1); }
}
