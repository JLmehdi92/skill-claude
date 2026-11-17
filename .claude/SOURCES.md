# Outillage design : provenance

Copies figées (vendored) pour que chaque session cloud ait le même outillage sans installation.
Choisis d'après le tweet de @BenjaminUIX « 10 skills that kill AI slop » (« installe-en 2 ou 3, pas les 10 ») :
on garde ceux qui servent une **app** (mode Operate), on écarte ceux qui visent les pages vitrines ou les illustrations.

| Copie | Source | Commit | Contenu repris |
|---|---|---|---|
| `skills/design-taste-frontend` | github.com/Leonxlnx/taste-skill `skills/taste-skill` | f6b7657 | SKILL.md, references, library (sans assets 38 Mo ni scripts de pages vitrines) |
| `skills/emil-design-eng` | github.com/emilkowalski/skills | 64eb3de | complet |
| `skills/impeccable` | github.com/pbakaus/impeccable `.claude/skills/impeccable` | d41d986 | SKILL.md, reference (sans le lanceur : il télécharge un binaire à l'exécution) |
| `skills/make-interfaces-feel-better` | github.com/jakubkrehel/make-interfaces-feel-better | 1a2aa96 | complet |
| `skills/web-design-guidelines` | github.com/vercel-labs/agent-skills | 1a2c79d | complet |
| `skills/frontend-design` | github.com/anthropics/skills | e4bb5d9 | complet |
| `skills/ponytail`, `skills/ponytail-review` | github.com/dietrichgebert/ponytail | 96608e0 | SKILL.md (sans hooks ni bandeau) |
| `skills/frontend-design-direction`, `design-system`, `frontend-a11y`, `frontend-patterns`, `nextjs-turbopack`, `e2e-testing` | github.com/affaan-m/ecc | 3f14a10 | complet |
| `agents/react-reviewer.md`, `typescript-reviewer.md`, `a11y-architect.md`, `e2e-runner.md` | github.com/affaan-m/ecc `agents/` | 3f14a10 | complet |
| `agents/design-director.md` | écrit pour ce projet au format des agents ECC | | |

Écartés volontairement : Hallmark (pages neuves uniquement, « never on an existing design »), Stageshow (illustrations de faux produits), UI UX Pro Max (base de recherche Python qui recouvre les autres), Anti UI Slop (site, pas de skill installable).

Mettre à jour : recloner le repo source au commit voulu et recopier les mêmes chemins.
