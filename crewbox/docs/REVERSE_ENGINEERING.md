# Rapport de reverse engineering : Rerun → Crewbox

Objectif : reproduire en local le produit [rerun.build](https://rerun.build) (« des coworkers IA qui font votre travail récurrent, même pendant que vous dormez »), en s'aidant de [REA](https://github.com/morluto/rea).

## Sources et méthode

Seules des sources **publiques** ont été utilisées. L'application (`app.rerun.build`) est derrière une authentification (réponse `307` vers la connexion) : aucun compte n'a été créé, aucun backend privé n'a été sondé, aucun code ni asset de Rerun n'a été copié. Crewbox est une réimplémentation indépendante, sous un autre nom.

| Source | Ce qu'elle a apporté |
| - | - |
| **REA 6.0** (`rea analyze-web-bundle` sur `https://rerun.build/` via Chromium/CDP) | Analyse statique des 248 scripts du front (0 échec de parsing, 985 581 nœuds AST visités). Empreinte **Next.js + React** (confiance haute), routes `/_next/image`, paramètres de tracking d'affiliation (`affonso`, `via`, `ref`…), filtres `connector` / `q` de la galerie de templates. Aucune déclaration WebMCP. Preuve : `ev_eb2cd2b82d976c120d297641249f849f5a3033eb0a812f63ea712b82d9b53fd6`. |
| **Page d'accueil** | Positionnement, parcours (décrire le job → connecter ses outils → ça tourne sur planning ou déclencheur), cartes d'approbation (*Allow once / This session / Always / Deny*), questions à choix, mémoire par client, « skills » de procédure, Boxes, 200+ apps, comparatif avec Claude Cowork. Les icônes d'apps sont servies depuis un stockage **Supabase**. |
| **Documentation publique** (`docs.rerun.build/llms.txt`, 30 pages) | Le vrai cahier des charges : concepts, capacités, skills (3 niveaux de chargement, limites 200 fichiers / 10 Mo / 50 Mo, pages de 100 000 caractères), mémoire qui s'efface, automatisations, humain dans la boucle (4 pauses, garantie sur les secrets), données (SQLite privée + partagée, publication de fichiers), et la **spécification complète de l'API** : endpoint MCP JSON-RPC sans état, 50 outils, `confirm: true`, `isError`, contrat HTTP des webhooks (202/204/404/405/413, filtrage des aperçus de liens, payload échappé et tronqué à 64 Ko). |
| **Galerie de templates** | 94 templates publics, utilisés seulement pour identifier les catégories de besoins (finance, ventes, support, marketing, recherche, opérations). Les 6 templates de Crewbox sont écrits de zéro. |

Pourquoi REA n'a pas « tout » révélé : le front public est un site marketing Next.js ; la logique métier (orchestration des agents, machine cloud par espace de travail) est côté serveur. REA le dit lui-même dans ses limites : *« server-side behavior may remain unknown »*. La documentation publique de l'API a donc servi de spécification, et les tests de Crewbox vérifient ce contrat.

## Architecture déduite de Rerun

- Front : Next.js / React. Stockage d'assets : Supabase.
- Un **espace de travail = une machine cloud privée** qui héberge tous les coworkers, leurs fichiers, bases SQLite et secrets.
- Les **Boxes** sont purement visuelles (le « board » isométrique).
- Les **apps** sont des serveurs MCP + un skill en lecture seule ; les secrets restent sur la machine, référencés par `${VARIABLE}`.
- Une seule API publique : un **serveur MCP JSON-RPC sans état** (`POST /api/mcp/account`) + des **URL de webhooks** dont le jeton est la seule authentification.
- Un **run** enregistre étapes, appels d'outils, tokens et coût ; les runs automatiques ouvrent leur propre session.

## Correspondance Rerun → Crewbox

| Rerun | Crewbox | Statut |
| - | - | - |
| Machine cloud privée par workspace | Votre machine (`~/.crewbox`) | ✅ (par construction) |
| Boxes / board | Plateaux isométriques, Boxes renommables, déplacement de coworker | ✅ |
| Coworker : nom, handle, soul, modèle, verbosité, capacités, auto-amélioration, activé | Identique | ✅ |
| 20 familles de capacités | 19 implémentées (`browser` passe par l'app « Headless browser » MCP) | ✅ / ⚠️ |
| Skills (SKILL.md + références, index seul en contexte, lecture paginée, écriture atomique, skills d'app en lecture seule) | Identique, mêmes limites | ✅ |
| Mémoire qui s'efface, rappel qui prolonge, `autoMemory` | Identique (rappel par mots-clés, pas d'embeddings) | ✅ |
| Apps (catalogue 200+, OAuth géré) | Les 207 apps du catalogue Rerun : OAuth sur les serveurs MCP distants officiels (DCR, jetons locaux), clé API (MCP officiel ou API REST décrite), commande `npx`, ou app OAuth du propriétaire (Google, Microsoft, LinkedIn, Reddit) ; + n'importe quel serveur MCP | ✅ (6 services sans intégration publique) |
| Statuts `active` / `needs_auth` / `needs_config` | Identique | ✅ |
| Tâches planifiées (cron + fuseau, one-off, modèle propre, Run now) | Identique (croner) | ✅ |
| Triggers webhook (contrat HTTP complet) | Identique, testé | ✅ |
| 4 pauses + notifications (`info/progress/done/error`) | Identique, carte unique groupée, réponse libre possible | ✅ |
| Approbations *Allow once / This session / Always / Deny* | Identique, sur les outils d'apps en écriture, le shell, la publication | ✅ |
| SQLite privée + partagée, propriétaire de table, navigateur de tables, export CSV/JSON | Identique | ✅ |
| Fichiers privés + dossier partagé + publication `/p/<slug>` | Identique (CSP sandbox) | ✅ |
| Délégation (4 sous-coworkers) et `@handle` | Identique | ✅ |
| Board isométrique (Boxes en plateaux, coworkers en blocs à yeux, HUD) | Reproduit d'après une capture de l'app (le code du board n'est servi qu'aux comptes connectés) : mêmes proportions, couleurs et HUD ; états et animations reconstitués | ✅ |
| Foreman : site analysé → Brain → objectif → carte du plan → équipe construite + configuration guidée ; assistant derrière l'orbe | Identique dans l'esprit (crawl local jusqu'à 18 pages, détection des outils, plan par le modèle ou par recettes éprouvées sans modèle) | ✅ |
| Brain (pages entreprise lues par tous, propositions des coworkers) | Identique | ✅ |
| Autopilot (règles en langage naturel qui répondent aux pauses, journal) | Identique ; identifiants et connexions d'apps toujours laissés au propriétaire | ✅ |
| Humeurs du board (au travail ambre, t'attend cyan, erreur rouge, éteint endormi, ligne d'état) | Identique (d'après le changelog du 7 oct.) ; « verrouillé » = apps à connecter | ✅ |
| Créer un coworker en décrivant le job | « Describe the job » : un appel au modèle rédige soul, skills, planning et apps | ✅ |
| Templates, export, liens de partage | Identique (marketplace locale, sans paiement) ; les 94 templates publics de rerun.build importés, corps des skills reconstitués depuis les descriptions publiques | ✅ |
| API MCP (50 outils) | 39 outils publics aux mêmes noms et formes (+ outils locaux pour l'UI) | ✅ hors outils d'auteur de templates |
| Modèles : Rerun hébergé, abonnement Claude/ChatGPT, clés API, OpenRouter | Abonnement Claude (jeton `claude setup-token`, Claude Agent SDK) + clés API (Anthropic, OpenAI, OpenRouter, Gemini) + modèles locaux | ✅ hors abonnement ChatGPT |

## Non reproduit (volontairement ou faute d'information publique)

- Comptes multiples, sièges, rôles, facturation, crédits de modèle, marketplace payante, programme d'experts.
- Notifications par e-mail (tout arrive dans l'application).
- Proxy d'appels hébergé pour les apps : les connexions OAuth se font depuis votre machine (redirection `http://127.0.0.1:4747/oauth/callback`) ; certains éditeurs n'acceptent pas une redirection locale, il faut alors passer par la clé API ou la commande locale.
- Autodesk, CrowdStrike, Expedia, Moonbundle, Replit, Vocci : pas d'intégration publique trouvée (serveur MCP personnalisé possible).
