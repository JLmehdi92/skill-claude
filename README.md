# Higgsfield local

Studio de génération vidéo IA qui tourne sur ta machine, branché sur l'API [kie.ai](https://kie.ai).
Premier modèle : **Wan 3.0** (`wan/3-0-video`), filtre NSFW désactivé par défaut.

- **Créer** : barre de prompt, références glisser-déposer (`@Image1`, `@Video1`, `@Audio1`), images de début et de fin, document ou page web, résolution, format, durée (2-30 s ou auto), audio, seed. Devis en euros avant chaque lancement, raccourci `⌘/Ctrl + Entrée`.
- **Historique** : chaque génération (réussie, en cours ou échouée) est enregistrée dans SQLite. Les vidéos et les références sont copiées dans `storage/`, donc tout reste consultable même après expiration des liens kie.ai. Recherche, filtres, favoris, Remix, Relancer, téléchargement, import d'une tâche kie par son `taskId`, sauvegarde JSON.
- **Dépenses** : coût réel de chaque génération (crédits kie → $ → €, au taux BCE figé le jour même), totaux du jour, de la semaine, du mois et depuis le début, graphique sur 30 jours, répartition par modèle et par type, solde kie.ai, export CSV, budget mensuel avec confirmation avant dépassement. Supprimer une génération efface ses fichiers mais garde son coût dans le suivi.

## Lancer sur ton PC

Prérequis :
- [Node.js](https://nodejs.org) 24 LTS (22.13 minimum) : la base de données utilise le SQLite intégré à Node, rien à compiler ;
- [Git](https://git-scm.com) ;
- conseillé : `ffmpeg` pour les miniatures et la mesure exacte des durées (`winget install ffmpeg` sur Windows, `brew install ffmpeg` sur macOS).

```bash
git clone -b feature/higgsfield-local https://github.com/JLmehdi92/skill-claude.git higgsfield-local
cd higgsfield-local
npm install
cp .env.example .env.local      # Windows (cmd) : copy .env.example .env.local
```

Ouvre `.env.local` dans un éditeur et colle ta clé sur la ligne `KIE_API_KEY=` (clé disponible sur [kie.ai/api-key](https://kie.ai/api-key)). Puis :

```bash
npm run build
npm run phone
```

`npm run phone` affiche deux adresses :
- `http://localhost:3000` pour ce PC ;
- `http://192.168.x.x:3000` pour ton téléphone, s'il est connecté au même Wi-Fi.

Si tu n'en as pas besoin sur téléphone, `npm start` suffit.

En cas de souci :
- **« Ce site est inaccessible » (ERR_CONNECTION_REFUSED)** : `npm run build` ne fait que compiler. Lance ensuite `npm run phone` (ou `npm start`) et garde ce terminal ouvert tant que tu utilises le site.
- **Sur téléphone, l'app passe par `http://192.168.x.x`** : ce n'est pas une adresse « sécurisée » pour le navigateur. L'app est testée dans ce cas précis (ajout de photos et vidéos, copie, génération complète).
- **Le téléphone ne charge pas** : vérifie qu'il est sur le même Wi-Fi que le PC. Sur Windows, accepte la demande du pare-feu pour Node.js sur « Réseaux privés ».
- **Tester sans dépenser de crédits** : mets `KIE_MOCK=1` dans `.env.local`, puis relance `npm run phone`.
- **« Node.js … est trop ancien »** : installe Node.js 24 LTS depuis nodejs.org, ferme et rouvre le terminal, puis `npm install`.
- **Aucun mot de passe** : n'ouvre l'app que sur un Wi-Fi de confiance, n'importe qui sur le réseau pourrait lancer des générations avec tes crédits.

Pendant le développement : `npm run dev`. Pour tester l'interface sans dépenser de crédits : `npm run dev:mock` (faux client kie, une vidéo d'exemple au bout de 6 s, un prompt contenant `[fail]` simule un échec).

### Variables (`.env.local`)

| Variable | Rôle | Défaut |
|---|---|---|
| `KIE_API_KEY` | Clé API kie.ai, reste côté serveur | (vide) |
| `KIE_NSFW_CHECKER` | `true` pour réactiver le filtre NSFW par défaut | `false` |
| `USD_EUR_RATE` | Taux de secours si la BCE est injoignable | `0.86` |
| `KIE_MOCK` | `1` = mode test sans appel réel | `0` |
| `STORAGE_DIR` | Dossier de la base et des médias | `storage` |

## Comment ça marche

1. `POST /api/generate` valide la requête (mêmes règles que l'interface), enregistre les références en local, les envoie à kie.ai puis crée la tâche.
2. Un poller serveur (`instrumentation.ts`) interroge kie.ai toutes les 4 s : les générations avancent même navigateur fermé et reprennent après un redémarrage.
3. À la fin, la vidéo est téléchargée dans `storage/outputs/`, une miniature est générée, et le coût réel (`creditsConsumed`) est converti en euros.

Ajouter un modèle = ajouter un fichier dans `lib/models/` (schéma, champs d'interface, règles, prix, payload) et l'inscrire dans `lib/models/registry.ts`. L'interface, la validation et le devis suivent automatiquement.

## Qualité

```bash
npm run lint && npm run typecheck
npm test            # Vitest : règles Wan, coûts, statistiques, service complet en mock
npm run test:e2e    # Playwright : parcours création, historique, dépenses, budget (mode mock)
```

Le dépôt embarque les skills `emil-design-eng` (Emil Kowalski) et `design-taste-frontend` (Taste Skill) dans `.claude/skills/`, et déclare le serveur MCP Playwright dans `.mcp.json`.

## Roadmap

1. Plus de modèles via le registre : Wan 3.0 Prime, Seedance, Kling, Veo, puis des modèles image (Nano Banana, Seedream, GPT Image) pour fabriquer des images de départ et des personnages.
2. Workflows façon Higgsfield : « Animer » une image de l'historique en un clic, presets de mouvements caméra et de styles, variations par seed, comparaison côte à côte.
3. Organisation : projets et dossiers, recherche plein texte (SQLite FTS5).
4. Bibliothèque de références réutilisables (personnages, lieux, styles).
5. Assistant de prompt et templates multi-plans avec timecodes.
6. Alertes de dépenses (seuil quotidien, projection de fin de mois).
7. Export avancé : upscale (Topaz via kie.ai), montage de clips avec ffmpeg, archive ZIP de l'historique.
