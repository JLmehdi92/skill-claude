// Starts Crewbox on a fresh, throwaway data folder for the end-to-end tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CREWBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crewbox-e2e-'));
process.env.CREWBOX_PORT = process.env.E2E_PORT || '4810';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
await import('./ensure-ui.js');
const { start } = await import('../src/cli.js');
await start();
