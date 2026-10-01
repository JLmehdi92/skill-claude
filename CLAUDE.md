# Higgsfield local

Next.js 16 (App Router) + SQLite intégré à Node (`node:sqlite`, Node >= 22.13 ; pas de better-sqlite3, il plante sous Windows), app locale branchée sur kie.ai. UI en français.

- Modèles : un fichier par modèle dans `lib/models/`, inscrit dans `lib/models/registry.ts`. Le type `ModelDefinition` (`lib/models/types.ts`) pilote l'UI, la validation (partagée client/serveur) et le devis.
- Serveur : `lib/server/*` (`server-only`). Client kie réel `lib/kie/client.ts`, mock `lib/kie/mock.ts` (`KIE_MOCK=1`).
- Coûts : 1 crédit = 0,005 $ (`lib/costs.ts`), taux USD/EUR figé par génération. Ne jamais supprimer une ligne de `generations` : la suppression est logique (`deleted_at`) pour garder les dépenses justes.
- Design : lire `.claude/skills/emil-design-eng` et `.claude/skills/design-taste-frontend` avant toute UI. Tokens dans `app/globals.css`, icônes Phosphor uniquement, pas de tiret cadratin dans les textes visibles.
- Vérifier : `npm run lint && npm run typecheck && npm test && npm run test:e2e`. Le MCP Playwright (`.mcp.json`) sert aux revues visuelles.
