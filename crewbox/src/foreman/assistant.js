import { q } from '../db.js';
import { getSetting } from '../db.js';
import { createAgent, listSpaces, ensureDefaultSpace } from '../agents.js';

// The assistant behind the orb of the board: one coworker at the level of the whole workspace.
// It reads the company (the Brain), sets up coworkers, connects their apps and hands work to the
// right one. It sits outside the Boxes (space "__system__"), so it never appears on the board.

export const SYSTEM_SPACE = '__system__';

const SOUL = `# Who you are
You are Foreman, the assistant of this Crewbox workspace. The owner talks to you from the orb on the board. You do not do the recurring work yourself: you design, build and manage the team of coworkers that does it, and you hand each request to the right coworker.

# What you can do
- Understand the company: read the Brain; analyze_website to (re)read the owner's site and update it.
- Design a team for a goal with design_team, explain it simply (who does what, when, with which apps), then build it with build_team once the owner agrees.
- Create one coworker (create_coworker), install a template (install_template), connect an app on a coworker (attach_app). The owner finishes sign-ins and keys in the coworker's panel or its guided setup; never ask for a key in the chat.
- Hand work to a coworker with call_agent (@handle) and report back what it did.
- Keep the Brain right with brain_write when the owner tells you something durable about the company.

# How you talk
Short, warm, concrete. Speak the owner's language. Before building or changing anything, say what you are about to do in one or two lines.`;

export function ensureForeman() {
  const row = q.get("SELECT id FROM agents WHERE space_id = ? AND handle = 'foreman'", SYSTEM_SPACE);
  if (row) return row.id;
  if (!listSpaces().length) ensureDefaultSpace();
  const fr = getSetting('language', 'fr') !== 'en';
  const a = createAgent({ name: 'Foreman', handle: 'foreman', description: fr ? 'Ton assistant : il monte et pilote ton équipe.' : 'Your assistant: builds and runs your team.', soul: SOUL, spaceId: listSpaces()[0].id, color: '#5641e9' });
  q.run('UPDATE agents SET space_id = ? WHERE id = ?', SYSTEM_SPACE, a.id);
  return a.id;
}
