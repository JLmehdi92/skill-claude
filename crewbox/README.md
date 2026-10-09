# Crewbox — des coworkers IA autonomes, en local

Crewbox est un clone local et auto-hébergé de [Rerun](https://rerun.build) : des **coworkers IA** qui font votre travail récurrent (relances de factures, prospection, tri du support, rapports…), sur un **cron** ou un **webhook**, avec leurs **skills**, leur **mémoire**, leurs **bases SQLite**, leurs **apps (MCP)**, et qui **s'arrêtent pour vous demander** avant toute action risquée.

Tout tourne sur votre machine : une seule commande Node, aucune base externe, données dans `~/.crewbox`. Vos coworkers peuvent tourner sur **votre abonnement Claude (Pro / Max)**. L'interface est **en français par défaut** (bouton FR / EN en haut à droite), avec un **QG en 3D, la Constellation** : tu es le noyau au centre, chaque Box est une nébuleuse en orbite et chaque coworker une entité liquide dont la forme dit ce qu'elle fait, animée avec **GSAP**, **Lenis**, **React Bits** et **three.js** (voir [Design](#design)).

> Comment ce clone a été obtenu (REA + documentation publique), et ce qui diffère de l'original : voir [`docs/REVERSE_ENGINEERING.md`](docs/REVERSE_ENGINEERING.md).

## Démarrage

Prérequis : **Node.js ≥ 22.13** (SQLite est intégré à Node, pas de dépendance native).

```bash
cd crewbox
npm install
npm start                 # construit l'interface si besoin, puis → http://127.0.0.1:4747
```

Développement de l'interface avec rechargement à chaud :

```bash
npm run dev:api           # API sur :4747 (jeton UI fixe « dev »)
npm run dev:ui            # Vite sur http://127.0.0.1:5173, proxy vers l'API
```

Au premier lancement :

- si `CLAUDE_CODE_OAUTH_TOKEN` est défini, une connexion **« My Claude plan »** (abonnement Claude) est créée et devient le modèle par défaut ;
- sinon, si `ANTHROPIC_API_KEY` est défini, une connexion par clé API est créée ;
- sinon, une connexion **« Offline demo »** (sans IA) permet d'explorer l'interface. Ajoutez ensuite un vrai fournisseur dans **Réglages → Fournisseurs d'IA**.

### Utiliser votre abonnement Claude

```bash
npm install -g @anthropic-ai/claude-code   # si ce n'est pas déjà fait
claude setup-token                          # se connecte avec votre compte Claude, affiche un jeton sk-ant-oat…
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat… npm start
```

Ou collez le jeton dans **Réglages → Fournisseurs d'IA → Abonnement Claude**. Les coworkers passent alors par le **Claude Agent SDK** (le même moteur que Claude Code) authentifié avec votre jeton : pas de clé API, pas de facturation à l'usage, les runs comptent dans les limites de votre forfait. Les outils intégrés de Claude Code sont désactivés : le coworker ne voit que ses outils Crewbox (fichiers, base, mémoire, apps MCP, pauses…), servis au SDK comme un serveur MCP en mémoire, et ses pauses / approbations fonctionnent exactement comme avec une clé API. Le jeton est personnel : n'exposez pas Crewbox à d'autres personnes avec votre abonnement.

| Variable | Défaut | Rôle |
| - | - | - |
| `CREWBOX_HOME` | `~/.crewbox` | Dossier des données (base, fichiers, skills, bases des coworkers) |
| `CREWBOX_PORT` | `4747` | Port HTTP |
| `CREWBOX_HOST` | `127.0.0.1` | Interface d'écoute (gardez la boucle locale, voir Sécurité) |
| `CREWBOX_PUBLIC_URL` | `http://127.0.0.1:4747` | URL publique utilisée pour les liens de webhooks et de fichiers publiés |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Jeton `claude setup-token` : crée la connexion « abonnement Claude » au premier lancement |
| `ANTHROPIC_API_KEY` | — | Crée la connexion Claude par clé API au premier lancement |

### Tests

- `npm test` : 25 tests de bout en bout du serveur (`node:test`, sans réseau ni clé, l'abonnement est testé contre une fausse API).
- `npm run test:e2e` : 22 scénarios **Playwright** dans un vrai Chromium (desktop + mobile) contre un serveur jetable : français par défaut et bascule EN, création d'un coworker, Constellation (une entité par coworker, vol vers l'entité, noyau qui ouvre « À traiter », légende, noms masquables, cadrage mobile), vue liste, chat en streaming, carte de question, approbation shell, tous les onglets, bibliothèque rerun.build et installation avec configuration guidée, connexion par abonnement, clé API, et **accessibilité** (axe-core WCAG 2.2 AA en FR et EN, panneau, parcours au clavier avec focus visible partout). Écrits selon les pratiques d'[everything-claude-code](https://github.com/affaan-m/everything-claude-code) (agent `e2e-runner`, skills `e2e-testing` et `browser-qa` dans `../.claude/`) : Page Object Model, sélecteurs `data-testid`, et une fixture qui **fait échouer le test à la moindre erreur console ou exception de page**. Rapport HTML dans `e2e-report/`.

## Fournisseurs d'IA

| Fournisseur | Notes |
| - | - |
| **Abonnement Claude (Pro / Max)** | Via `@anthropic-ai/claude-agent-sdk` et un jeton `claude setup-token`. Sessions reprises d'un message à l'autre, coût affiché à 0 (inclus dans le forfait). |
| **Anthropic (clé API)** | Via le SDK officiel `@anthropic-ai/sdk`, en streaming. Modèles : `claude-opus-5-5` (défaut), `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`. Prompt caching du préfixe stable, `output_config.effort`, fallback serveur `fallbacks: "default"` sur les modèles qui le supportent, coût calculé par run. |
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
| **App** | Serveur MCP + skill d'usage. 14 apps au catalogue (GitHub, Notion, Slack, Stripe, HubSpot, Airtable, Linear, Brave Search, Firecrawl, Apify, Google Maps, Postgres, navigateur headless, serveur de démo) + **n'importe quel serveur MCP** (stdio, HTTP, SSE). |
| **Run / Session** | Chaque exécution enregistre ses étapes, appels d'outils, tokens et coût. Les runs planifiés / webhooks ouvrent leur propre session. |
| **Scheduled task** | Cron 5 champs + fuseau IANA, ou date unique (se désactive après). « Run now » ne touche pas au planning. |
| **Trigger** | URL publique `/api/t/{agentId}/{slug}/{token}` ; le payload est ajouté dans un bloc `<trigger_payload>` échappé (anti-injection). |
| **Template** | Coworkers packagés (soul, skills, planning, triggers, apps, fichiers) — jamais de mémoires ni de secrets. **100 templates** : 6 Crewbox + les **94 de la bibliothèque publique de rerun.build** (voir plus bas), export / import, liens de partage. |
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

## La bibliothèque rerun.build

`templates/rerun/` contient les 94 templates publics de [rerun.build/templates](https://rerun.build/templates) (ventes, e-commerce, agences, immobilier, créateurs, juridique, recrutement, SaaS, finance…), récupérés depuis les pages publiques : nom, catégorie, description, créateur, coworkers, leurs skills, leurs plannings, les apps requises, les étapes de configuration guidée et la FAQ. Chaque fichier garde sa source (`from.url`, `from.creator`) et la carte affiche un badge « rerun.build ».

Le **corps** des skills et des souls n'est pas public chez Rerun (il n'est livré qu'à l'installation) : Crewbox les reconstitue à partir des descriptions publiques, en procédures concrètes, étape par étape. À l'installation, chaque coworker qui a une configuration démarre une session **« Configuration guidée »** qui vous pose ses questions (comptes à connecter, règles, seuils) avant de lancer ses plannings, qui restent en pause d'ici là. Les apps du catalogue sont branchées automatiquement ; les autres s'ajoutent comme serveur MCP personnalisé.

## API (compatible avec l'API Rerun)

`POST /api/mcp/account` — serveur MCP sans état (JSON-RPC 2.0), clé `Authorization: Bearer ck_…` créée dans **Settings → API & MCP**. Mêmes noms d'outils et mêmes formes que l'API Rerun : `list_spaces`, `list_agents`, `get_agent`, `create_agent`, `update_agent`, `delete_agent`, `list_ai_connections`, `set_default_model`, `list_skills`, `get_skill`, `read_skill_file`, `upsert_skill`, `delete_skill`, `list_schedules`, `upsert_schedule`, `run_schedule_now`, `delete_schedule`, `list_triggers`, `upsert_trigger`, `test_trigger`, `rotate_trigger_token`, `delete_trigger`, `send_message`, `list_runs`, `get_run`, `list_tables`, `db_query`, `db_execute`, `list_space_tables`, `space_db_query`, `space_db_execute`, `search_connectors`, `list_connectors`, `list_agent_connectors`, `attach_connector`, `detach_connector`, `create_agent_share`, `list_agent_shares`, `revoke_agent_share`.

Les outils destructifs exigent `"confirm": true`, les erreurs d'outil reviennent en `isError` (pas en erreur JSON-RPC), et aucun secret ne transite par l'API.

```bash
claude mcp add --transport http crewbox http://127.0.0.1:4747/api/mcp/account \
  --header "Authorization: Bearer ck_…"
```

Puis, dans Claude Code : « Crée un coworker qui surveille les pages de prix de mes concurrents chaque matin et me prévient s'il y a un changement. »

## Design

L'interface (`web/`) est une app React 19 construite avec Vite, pensée comme un site primé plutôt qu'un tableau de bord générique : thème sombre, verre dépoli, typographie Bricolage Grotesque, et surtout du **mouvement**.

### Le QG en 3D : la Constellation

La section « QG » n'est ni une grille de cartes ni un plateau isométrique : c'est une constellation (`web/src/world/`, react-three-fiber + shaders GLSL + postprocessing) organisée **autour de toi**.

- **Toi, le noyau** : au centre, un gyroscope de lumière. Tous les coworkers y sont reliés par une **synapse**. Quand l'un d'eux t'attend, le noyau vire à l'ambre et bat comme un cœur, des **paquets ambrés filent le long de sa synapse jusqu'à toi**, et un clic sur le noyau ouvre « À traiter ».
- **Chaque Box est une nébuleuse** : un disque de poussière à deux bras qui tourne lentement, en orbite autour du noyau.
- **Chaque coworker est une entité vivante** : une coque liquide irisée (bruit simplex dans un shader) autour d'un cœur lumineux, avec un anneau. Sa forme et ses couleurs lui sont propres (tirées de son @handle), et son **comportement montre son état** :
  - **prête** : elle respire, calme ;
  - **au travail** : elle bouillonne et tourne vite, et de l'énergie cyan lui arrive depuis le noyau. Ce qu'elle fait s'affiche sous son nom (« ⚡ web_search », « demande à Sam ») ;
  - **t'attend** : battement de cœur, teinte ambrée, et un **signal lumineux** qui monte vers le ciel, visible de loin ;
  - **erreur** : des tranches rouges qui buggent ; **éteinte** : obsidienne figée.
- Ses **lunes** sont ses tâches planifiées, ses **éclats** ses apps connectées. Chaque appel d'outil envoie une **onde de choc**, et quand un coworker en sollicite un autre, une **comète** traverse l'espace de l'un à l'autre.
- Au survol, les autres entités s'estompent (mode focus) et une fiche s'affiche. Au clic, la caméra **plonge vers l'entité** puis ouvre son panneau.
- En dessous, un radar à anneaux concentriques avec un balayage lent. Le ciel suit l'heure réelle (« Équipe de nuit » après 20 h), un fil en direct raconte ce que fait l'équipe, et un bouton **?** affiche la légende.
- Le cadrage s'adapte à l'écran (téléphone, tablette, desktop), on peut pincer pour zoomer sur écran tactile, et `prefers-reduced-motion` coupe la rotation automatique. Une **vue liste** reste disponible.

### Français et anglais

Toute l'interface est traduite (`web/src/lib/i18n.js` + `fr.js`, clés en anglais, pluriels, dates relatives). Le choix est mémorisé, et la langue est aussi transmise aux coworkers : ils vous parlent en français par défaut (`set_language` via l'API, Box par défaut nommée « Box principale »).

| Outil | Rôle dans Crewbox |
| - | - |
| [GSAP](https://github.com/greensock/GSAP) + ScrollTrigger + SplitText | Titres qui se dévoilent lettre par lettre, parallaxe du hero, cartes révélées en cascade au scroll, section « How it works » épinglée et pilotée par le scroll, tiroir du coworker, indicateur d'onglet glissant, entrée des messages et des dialogues. |
| [Lenis](https://github.com/darkroomengineering/lenis) | Scroll fluide de la page, synchronisé sur le ticker GSAP pour que ScrollTrigger reste exact ; mis en pause quand un tiroir ou un dialogue est ouvert. |
| [React Bits](https://github.com/DavidHDev/react-bits) | Aurora (fond WebGL du hero), SplitText, RotatingText, ShinyText, GradientText, BlurText, CountUp, DecryptedText, SpotlightCard (coworkers, skills, apps), GlareHover (templates), BorderGlow (cartes d'approbation), StarBorder + Magnet (bouton principal), Dock (navigation), ClickSpark, AnimatedContent. |

Les animations respectent `prefers-reduced-motion`. Les composants React Bits sont copiés dans `web/src/reactbits/` sous leur licence (MIT + Commons Clause, voir `web/src/reactbits/LICENSE.md`) : utilisables dans une application, pas revendables seuls.

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
    claude-code.js  moteur « abonnement Claude » (Claude Agent SDK, outils Crewbox en MCP en mémoire)
    review.js       revue automatique de la mémoire
  providers/        Claude (SDK officiel), OpenAI-compatible, offline
  mcp.js            clients MCP par coworker (stdio / HTTP / SSE), pool et timeouts
  catalog.js        bibliothèque d'apps
  skills.js memory.js sqlite-tools.js secrets.js templates.js builder.js notifications.js
web/                interface React + Vite (sections, panneau, dialogues, composants React Bits)
  src/world/        Constellation : noyau, nébuleuses, entités (shaders), synapses, comètes, étiquettes projetées
  src/lib/i18n.js   traduction FR / EN
scripts/ensure-ui.js  construit l'interface au démarrage si elle manque ou a changé
templates/          templates fournis (+ rerun/ : les 94 templates de rerun.build)
test/               tests de bout en bout du serveur (node:test)
e2e/                tests Playwright (pages, fixtures, specs) ; scripts/e2e-server.js lance un serveur jetable
```

## Sécurité

- Le serveur écoute sur `127.0.0.1`. L'API de l'interface exige un jeton généré à chaque démarrage et injecté dans la page (bloque le CSRF et les autres pages locales).
- Les secrets sont stockés en clair dans la base SQLite locale (`~/.crewbox/crewbox.db`) : protégez ce dossier comme vos fichiers `.env`. Ils ne sont jamais envoyés au modèle et sont masqués dans les sorties d'outils.
- L'outil `shell` exécute de vraies commandes avec vos droits, dans le dossier du coworker, derrière une denylist (pas un bac à sable). Désactivez la capacité ou activez l'approbation shell pour les coworkers qui n'en ont pas besoin.
- Pour recevoir des webhooks d'Internet, exposez le port via un tunnel (Cloudflare Tunnel, ngrok…) et réglez `CREWBOX_PUBLIC_URL`. L'URL d'un trigger est la seule authentification : traitez-la comme un mot de passe.
- Les pages publiées sont servies avec une CSP `sandbox` pour qu'elles ne puissent pas agir sur l'interface.
