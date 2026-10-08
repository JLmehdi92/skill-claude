# Crewbox — des coworkers IA autonomes, en local

Crewbox est un clone local et auto-hébergé de [Rerun](https://rerun.build) : des **coworkers IA** qui font votre travail récurrent (relances de factures, prospection, tri du support, rapports…), sur un **cron** ou un **webhook**, avec leurs **skills**, leur **mémoire**, leurs **bases SQLite**, leurs **apps (MCP)**, et qui **s'arrêtent pour vous demander** avant toute action risquée.

Tout tourne sur votre machine : une seule commande Node, aucune base externe, aucun build front, données dans `~/.crewbox`.

> Comment ce clone a été obtenu (REA + documentation publique), et ce qui diffère de l'original : voir [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md).

## Démarrage

Prérequis : **Node.js ≥ 22.13** (SQLite est intégré à Node, pas de dépendance native).

```bash
cd crewbox
npm install
npm start                 # → http://127.0.0.1:4747
```

Au premier lancement :

- si `ANTHROPIC_API_KEY` est défini, une connexion Claude est créée automatiquement ;
- sinon, une connexion **« Offline demo »** (sans IA) permet d'explorer l'interface. Ajoutez ensuite un vrai fournisseur dans **Settings → AI providers**.

| Variable | Défaut | Rôle |
| - | - | - |
| `CREWBOX_HOME` | `~/.crewbox` | Dossier des données (base, fichiers, skills, bases des coworkers) |
| `CREWBOX_PORT` | `4747` | Port HTTP |
| `CREWBOX_HOST` | `127.0.0.1` | Interface d'écoute (gardez la boucle locale, voir Sécurité) |
| `CREWBOX_PUBLIC_URL` | `http://127.0.0.1:4747` | URL publique utilisée pour les liens de webhooks et de fichiers publiés |
| `ANTHROPIC_API_KEY` | — | Crée la connexion Claude au premier lancement |

Tests : `npm test` (21 tests de bout en bout, sans réseau ni clé).

## Fournisseurs d'IA

| Fournisseur | Notes |
| - | - |
| **Anthropic (Claude)** | Via le SDK officiel `@anthropic-ai/sdk`, en streaming. Modèles : `claude-opus-5-5` (défaut), `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`. Prompt caching du préfixe stable, `output_config.effort`, fallback serveur `fallbacks: "default"` sur les modèles qui le supportent, coût calculé par run. |
| **OpenAI, OpenRouter, Gemini** | Endpoint Chat Completions compatible OpenAI. |
| **Modèle local** | Ollama, LM Studio, vLLM… (`http://127.0.0.1:11434/v1` par défaut). |
| **Offline demo** | Sans IA : `/tool <nom> {json}` appelle un outil, utile pour tester. |

Chaque coworker suit le modèle par défaut de l'espace de travail, ou épingle le sien ; chaque tâche planifiée / webhook peut aussi avoir son propre modèle.

## Concepts (mêmes que Rerun)

| Concept | Dans Crewbox |
| - | - |
| **Box** | Regroupement visuel de coworkers sur le board (équipe, client, projet). Ne cloisonne rien. |
| **Coworker** | Nom, `@handle` stable, **soul** (prompt système markdown), modèle, verbosité, familles de capacités, flags d'auto-amélioration, règles d'approbation. |
| **Skill** | Dossier `SKILL.md` + fichiers de référence, chargé à la demande (seul l'index est dans le contexte). Les skills installés par une app sont en lecture seule. |
| **Mémoire** | Faits durables qui s'effacent s'ils ne servent pas ; chaque rappel prolonge leur vie. Revue automatique après chaque conversation (`autoMemory`). |
| **App** | Serveur MCP + skill d'usage. 13 apps au catalogue (GitHub, Notion, Slack, Stripe, HubSpot, Airtable, Linear, Brave Search, Firecrawl, Google Maps, Postgres, navigateur headless, serveur de démo) + **n'importe quel serveur MCP** (stdio, HTTP, SSE). |
| **Run / Session** | Chaque exécution enregistre ses étapes, appels d'outils, tokens et coût. Les runs planifiés / webhooks ouvrent leur propre session. |
| **Scheduled task** | Cron 5 champs + fuseau IANA, ou date unique (se désactive après). « Run now » ne touche pas au planning. |
| **Trigger** | URL publique `/api/t/{agentId}/{slug}/{token}` ; le payload est ajouté dans un bloc `<trigger_payload>` échappé (anti-injection). |
| **Template** | Coworkers packagés (soul, skills, planning, triggers, apps, fichiers) — jamais de mémoires ni de secrets. 6 templates fournis, export / import, liens de partage. |
| **Databases / fichiers** | SQLite privée par coworker + SQLite partagée ; dossier privé + dossier partagé ; publication de fichiers à une URL publique (`/p/<slug>`). |

### Capacités d'un coworker

`filesystem`, `shared`, `shell` (denylist de commandes destructrices), `web` (fetch, recherche, téléchargement), `memory`, `db`, `sharedDb`, `skills`, `schedule`, `trigger`, `delegate` (jusqu'à 4 sous-coworkers en parallèle), `callAgent` (`@handle`), `vision`, `notify`, `hub` (apps + publication), et les quatre pauses : `askUser`, `requestApproval`, `suggestService`, `requestSecret`. Toutes activables / désactivables par coworker.

### Humain dans la boucle

Un coworker **met son run en pause** et affiche une seule carte (toutes ses demandes regroupées) :

- **Question** (choix multiples, ou réponse libre — taper un message dans le chat répond aussi à la carte) ;
- **Approbation** par action (destinataire, montant, diff…) ;
- **App à connecter** (formulaire de configuration de l'app) ;
- **Secret** via formulaire masqué : la valeur est stockée localement, le modèle n'apprend que le nom de la variable (`${NOM}` dans une config MCP, `$NOM` dans le shell), et les valeurs sont masquées dans tous les résultats d'outils.

En plus, certaines actions sont **bloquées jusqu'à votre accord** (réglable par coworker) : outils d'apps qui ne sont pas en lecture seule, shell, publication. Choix : *Allow once*, *This session*, *Always*, *Deny*. Les runs planifiés à 3 h du matin s'arrêtent aussi : rien n'est sauté parce que personne ne regarde.

## API (compatible avec l'API Rerun)

`POST /api/mcp/account` — serveur MCP sans état (JSON-RPC 2.0), clé `Authorization: Bearer ck_…` créée dans **Settings → API & MCP**. Mêmes noms d'outils et mêmes formes que l'API Rerun : `list_spaces`, `list_agents`, `get_agent`, `create_agent`, `update_agent`, `delete_agent`, `list_ai_connections`, `set_default_model`, `list_skills`, `get_skill`, `read_skill_file`, `upsert_skill`, `delete_skill`, `list_schedules`, `upsert_schedule`, `run_schedule_now`, `delete_schedule`, `list_triggers`, `upsert_trigger`, `test_trigger`, `rotate_trigger_token`, `delete_trigger`, `send_message`, `list_runs`, `get_run`, `list_tables`, `db_query`, `db_execute`, `list_space_tables`, `space_db_query`, `space_db_execute`, `search_connectors`, `list_connectors`, `list_agent_connectors`, `attach_connector`, `detach_connector`, `create_agent_share`, `list_agent_shares`, `revoke_agent_share`.

Les outils destructifs exigent `"confirm": true`, les erreurs d'outil reviennent en `isError` (pas en erreur JSON-RPC), et aucun secret ne transite par l'API.

```bash
claude mcp add --transport http crewbox http://127.0.0.1:4747/api/mcp/account \
  --header "Authorization: Bearer ck_…"
```

Puis, dans Claude Code : « Crée un coworker qui surveille les pages de prix de mes concurrents chaque matin et me prévient s'il y a un changement. »

## Architecture

```
src/
  cli.js            démarrage, bootstrap, arrêt propre
  server.js         HTTP : UI, SSE, endpoint MCP, webhooks, fichiers publiés, liens de partage
  service.js        registre unique d'opérations (UI + API MCP)
  db.js             SQLite (node:sqlite) : schéma et helpers
  agents.js         Boxes et coworkers
  automations.js    tâches planifiées (croner) et triggers webhook
  runtime/
    runner.js       boucle d'agent, pauses, approbations, délégation, appels inter-coworkers
    tools.js        outils intégrés par famille de capacités
    prompt.js       prompt système (préfixe stable d'abord, pour le cache)
    review.js       revue automatique de la mémoire
  providers/        Claude (SDK officiel), OpenAI-compatible, offline
  mcp.js            clients MCP par coworker (stdio / HTTP / SSE), pool et timeouts
  catalog.js        bibliothèque d'apps
  skills.js memory.js sqlite-tools.js secrets.js templates.js builder.js notifications.js
public/             interface (HTML/CSS/JS sans build)
templates/          templates fournis
test/               tests de bout en bout (node:test)
```

## Sécurité

- Le serveur écoute sur `127.0.0.1`. L'API de l'interface exige un jeton généré à chaque démarrage et injecté dans la page (bloque le CSRF et les autres pages locales).
- Les secrets sont stockés en clair dans la base SQLite locale (`~/.crewbox/crewbox.db`) : protégez ce dossier comme vos fichiers `.env`. Ils ne sont jamais envoyés au modèle et sont masqués dans les sorties d'outils.
- L'outil `shell` exécute de vraies commandes avec vos droits, dans le dossier du coworker, derrière une denylist (pas un bac à sable). Désactivez la capacité ou activez l'approbation shell pour les coworkers qui n'en ont pas besoin.
- Pour recevoir des webhooks d'Internet, exposez le port via un tunnel (Cloudflare Tunnel, ngrok…) et réglez `CREWBOX_PUBLIC_URL`. L'URL d'un trigger est la seule authentification : traitez-la comme un mot de passe.
- Les pages publiées sont servies avec une CSP `sandbox` pour qu'elles ne puissent pas agir sur l'interface.
