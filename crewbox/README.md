# Crewbox — des coworkers IA autonomes, en local

Crewbox est un clone local et auto-hébergé de [Rerun](https://rerun.build) : des **coworkers IA** qui font votre travail récurrent (relances de factures, prospection, tri du support, rapports…), sur un **cron** ou un **webhook**, avec leurs **skills**, leur **mémoire**, leurs **bases SQLite**, leurs **apps (MCP)**, et qui **s'arrêtent pour vous demander** avant toute action risquée.

Tout tourne sur votre machine : une seule commande Node, aucune base externe, données dans `~/.crewbox`. Vos coworkers peuvent tourner sur **votre abonnement Claude (Pro / Max)**. L'interface est **en français par défaut** (bouton FR / EN en haut à droite), avec le **plateau isométrique de Rerun** reproduit au plus près (chaque Box est un plateau, chaque coworker un petit bloc avec des yeux, animé selon son état), et le reste du site animé avec **GSAP**, **Lenis** et **React Bits** (voir [Design](#design)).

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

- `npm test` : 34 tests de bout en bout du serveur (`node:test`, sans réseau ni clé : l'abonnement, Resend, le jeton OAuth Google et Anthropic sont testés contre de fausses API locales).
- `npm run test:e2e` : 28 scénarios **Playwright** dans un vrai Chromium (desktop + mobile) contre un serveur jetable : français par défaut et bascule EN, **Foreman de bout en bout** (il lit un faux site d'entreprise, remplit le Cerveau, propose une équipe « leads + prospection » avec Resend, la construit ; on connecte Resend avec une clé dans l'onglet Apps, le coworker envoie un e-mail après approbation et la fausse API Resend reçoit exactement le bon e-mail avec la bonne clé), bibliothèque des 207 apps, Cerveau (proposition acceptée), pilote auto, onboarding sur téléphone, création d'un coworker, plateau (un plateau par Box, un bloc par coworker, humeurs t'attend / éteint / apps à connecter, menu des Box, recherche, zoom et recentrage, couleur d'un coworker, plein écran et HUD sur téléphone), vue liste, chat en streaming, carte de question, approbation shell, tous les onglets, bibliothèque rerun.build et installation avec configuration guidée, connexion par abonnement, clé API, et **accessibilité** (axe-core WCAG 2.2 AA en FR et EN, panneau, parcours au clavier avec focus visible partout). Écrits selon les pratiques d'[everything-claude-code](https://github.com/affaan-m/everything-claude-code) (agent `e2e-runner`, skills `e2e-testing` et `browser-qa` dans `../.claude/`) : Page Object Model, sélecteurs `data-testid`, et une fixture qui **fait échouer le test à la moindre erreur console ou exception de page**. Rapport HTML dans `e2e-report/`.

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
| **App** | Serveur MCP (ou API REST) + skill d'usage. **Les 207 apps de Rerun** (voir « Apps ») + **n'importe quel serveur MCP** (stdio, HTTP, SSE). |
| **Cerveau (Brain)** | Les pages de l'entreprise (offre, clients, ton, marché…) que chaque coworker lit avant de travailler. Les coworkers proposent des modifications, vous acceptez ou refusez. |
| **Foreman** | L'assistant derrière l'orbe : il lit votre site, comprend votre business, conçoit et construit une équipe, et peut tout piloter dans l'espace de travail. |
| **Pilote auto** | Des règles en phrases simples qui répondent aux cartes des coworkers à votre place quand une règle les couvre clairement ; le reste (et tout identifiant) vous attend. |
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

## Foreman : de votre site à une équipe qui travaille

Comme sur Rerun, au premier lancement Crewbox vous demande votre site :

1. **Lecture du site** : Foreman parcourt jusqu'à 18 pages (accueil, tarifs, à propos, fonctionnalités, clients, blog limité, sitemap compris ; pages légales ignorées), en direct à l'écran, et repère les outils que le site utilise vraiment (scripts et liens externes : Stripe, HubSpot, Intercom, Calendly, LinkedIn…).
2. **Le Cerveau** : il en tire les pages *Entreprise*, *Offre et tarifs*, *Clients cibles*, *Ton et marque*, *Marché*, *Croissance*, *Outils*. Avec un modèle connecté, c'est le modèle qui rédige le profil ; sans modèle, un profil heuristique (tarifs extraits, cible repérée dans les titres « Pour les… »).
3. **Votre objectif** en une phrase (« Trouver des leads et leur envoyer des emails de prospection »).
4. **Le plan** : une carte par coworker (rôle, apps, sa journée, sa première semaine, les questions qu'il vous posera) ; « Changer quelque chose » le refait selon vos remarques.
5. **Construction** : coworkers, skills, plannings en pause, apps branchées, puis chaque coworker démarre sa **configuration guidée** et vous demande ce qui lui manque (clé Resend, ICP, signature…).

Exemple « leads + prospection » : **Lina** (Apollo, Google Maps, Firecrawl) trouve et qualifie les leads dans la table partagée `leads` ; **Oscar** écrit les e-mails personnalisés et les envoie avec **Resend** (chaque envoi passe par votre approbation, ou par une règle du pilote auto). Ensuite l'orbe ouvre Foreman, qui garde la main sur tout : vue d'ensemble, nouveaux coworkers, templates, apps, Cerveau.

## Apps : les 207 connecteurs de Rerun

`data/connectors-research.json` recense les 207 services du catalogue Rerun, avec pour chacun la meilleure façon de s'y connecter, vérifiée : serveur MCP distant officiel (connexion **OAuth** dans une fenêtre, enregistrement dynamique du client, jetons rangés sur votre machine), **clé API** (serveur MCP officiel ou API REST décrite opération par opération + un outil `request` générique), **commande locale** (`npx` du serveur MCP officiel), ou **votre propre app OAuth** (Google Analytics, Search Console, Tasks, Meet, Photos, YouTube, Microsoft, Outlook, LinkedIn, Reddit). Statuts : *connecté*, *à connecter*, *à configurer*. Six services n'ont aucune intégration publique (Autodesk, CrowdStrike, Expedia, Moonbundle, Replit, Vocci) : l'app l'indique et propose un serveur MCP personnalisé.

**Resend** est entièrement pilotable par les coworkers (24 outils) : envoyer un e-mail ou un lot de 100, programmer / reprogrammer / annuler, suivre la délivrance, domaines et DNS, e-mails reçus (réponses des prospects), contacts, segments, broadcasts. La clé est saisie dans un champ masqué et n'atteint jamais le modèle.



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

### Le QG : le plateau isométrique

La section « QG » reprend le plateau de l'app Rerun (`web/src/board/`, SVG pur, sans WebGL), mesuré au pixel sur une capture de l'original (grille, plateaux, blocs, HUD) :

- **Le sol** : une grille isométrique (fond `#0a0a0a`, lignes à 6–7 % de blanc) qui s'estompe loin du centre.
- **Chaque Box est un plateau** de 8 × 8 cases au bord clair, avec son nom écrit en italique le long du bord. Les Box se placent autour de la première, et en ajouter une ne déplace jamais les autres. Clic sur le nom pour la renommer ; au survol, une place en pointillés propose d'ajouter un coworker.
- **Chaque coworker est un bloc** arrondi dans sa couleur (choisie ou automatique), avec son nom sur le dessus et ses yeux sur la face avant. Son état se lit d'un coup d'œil :
  - **prêt** : yeux ouverts, il cligne ;
  - **au travail** (ambre, comme sur Rerun) : il sautille, ses pupilles bougent, un anneau ambré tourne au sol, une bulle affiche l'outil qu'il utilise et « au travail » s'écrit sous son nom ;
  - **t'attend** (cyan) : une bulle « ? » cyan, un anneau qui pulse, il lève les yeux vers vous, « t'attend · 2 » sous son nom ;
  - **erreur** : bloc entièrement rouge, yeux en croix et bouche triste, avec un petit tremblement, « en erreur » ;
  - **éteint** : il dort, yeux fermés qui luisent ;
  - **apps à connecter** : bloc fantôme translucide avec un cadenas tant qu'une de ses apps attend une clé ou une connexion.
- Chaque appel d'outil fait **flasher** le bloc et envoie une **onde** au sol ; quand un coworker en appelle un autre, un **arc** relie les deux blocs. À l'arrivée, les blocs tombent sur le plateau un par un.
- **Le HUD**, comme dans l'app : en haut à gauche, le menu de l'espace de travail (liste des Box pour y voler, nouvelle Box, vue liste) et le bouton clair « Templates » ; à droite, le zoom (+, −, recentrer) ; en bas, la cloche des notifications, la pastille « au travail / total » (son anneau tourne quand quelqu'un bosse, et un point ambré signale ce qui t'attend), « + » pour un nouveau coworker, la loupe pour en chercher un, et l'orbe : **Foreman**, votre assistant. Le menu de l'espace de travail ouvre aussi le Cerveau, le pilote auto et « Monter une équipe avec Foreman ».
- **Gestes** : glisser pour déplacer, pincer (ou Ctrl/⌘ + molette) pour zoomer, toucher un bloc pour l'ouvrir (la caméra s'en approche d'abord). Sur téléphone le plateau prend tout l'écran et le dock du site s'efface tant qu'il est affiché ; un doigt à la verticale continue de faire défiler la page.
- Tout est accessible au clavier (blocs, noms de Box, HUD) et `prefers-reduced-motion` coupe les animations. Une **vue liste** reste disponible.

Les tests comparent la capture de référence et le rendu de Crewbox avec les mêmes Box et les mêmes coworkers : sur la zone du plateau, environ 94 % des pixels sont à moins de 30/765 d'écart (le reste tient surtout aux textes et à la police : SF Pro sur iPhone, une autre sur Linux).

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
  src/board/        plateau isométrique : géométrie, blocs (SVG), HUD, activité en direct
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
