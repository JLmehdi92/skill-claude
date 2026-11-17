# Higgsfield local

Next.js 16 (App Router) + SQLite intégré à Node (`node:sqlite`, Node >= 22.13 ; pas de better-sqlite3, il plante sous Windows), app locale branchée sur kie.ai. UI en français, pensée d'abord pour le téléphone.

- Modèles : un fichier par modèle dans `lib/models/`, inscrit dans `lib/models/registry.ts`. Le type `ModelDefinition` (`lib/models/types.ts`) pilote l'UI, la validation (partagée client/serveur) et le devis.
- Serveur : `lib/server/*` (`server-only`). Client kie réel `lib/kie/client.ts`, mock `lib/kie/mock.ts` (`KIE_MOCK=1`).
- Coûts : 1 crédit = 0,005 $ (`lib/costs.ts`), taux USD/EUR figé par génération. Ne jamais supprimer une ligne de `generations` : la suppression est logique (`deleted_at`) pour garder les dépenses justes.
- Téléphone en `http://192.168.x.x` = contexte non sécurisé : `lib/client/id.ts` au lieu de `crypto.randomUUID`, `lib/client/clipboard.ts` au lieu de `navigator.clipboard`.
- Design : toute décision visuelle passe par l'agent `design-director` (`.claude/agents/`), qui orchestre les skills de `.claude/skills/` (provenance : `.claude/SOURCES.md`). La DA de référence est `DESIGN.md`. Tokens dans `app/globals.css`, icônes Phosphor uniquement, pas de tiret cadratin dans les textes visibles.
- Code : skill `ponytail` (plus petit changement complet, réutiliser l'existant, ne jamais couper validation, sécurité, accessibilité). Relecture : `ponytail-review` puis les agents ECC `react-reviewer`, `typescript-reviewer`, `a11y-architect`.
- Vérifier : `npm run lint && npm run typecheck && npm test && npm run test:e2e`.
