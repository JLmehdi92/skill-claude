# DESIGN.md : Higgsfield local

Nom : **Higgsfield local**, choix de l'utilisateur (pas de renommage).

Promesse : de l'idée à la première prise en quelques secondes, sur le téléphone, en sachant toujours ce qui tourne et ce que ça coûte.

Mode impeccable : **Operate**. Précision et retenue d'abord, la marque vit dans les détails.

## Direction : « gris de charte »

Les étalonneurs jugent une image sur un gris neutre, jamais sur du noir (qui gonfle le contraste) ni sur du crème (qui réchauffe). Le studio pose donc les vidéos sur un gris neutre, lisible en plein jour au téléphone, et garde deux couleurs de plateau : le **bleu d'incrustation** pour l'action, le **rouge du voyant** pour ce qui tourne.

Deux thèmes, une seule famille de tokens. Le thème suit `prefers-color-scheme` (réglage du téléphone ou du PC), sans bouton. Le sombre est un gris neutre foncé, pas du noir et pas de vert acide.

On quitte le noir + vert acide d'avant (un tic de design généré) sans tomber dans les autres : pas de crème + serif + terracotta, pas de dégradé violet-bleu, pas de verre.

## Tokens (`app/globals.css`)

Variables brutes dans `:root` (clair), redéfinies dans `@media (prefers-color-scheme: dark)`, exposées à Tailwind par `@theme inline` (`bg-surface`, `text-muted`... basculent seules). `color-scheme: light dark`.

| Token | Clair | Sombre | Usage |
|---|---|---|---|
| `canvas` | `#e3e3e0` | `#1c1d20` | fond de page, barre de navigation |
| `surface` | `#f7f7f5` | `#25262a` | composer, cartes, panneaux, drawer |
| `raised` | `#ffffff` | `#2e2f34` | menus, feuilles, modales, champs, pastille des segmented |
| `sunken` | `#ebebe8` | `#18191b` | rail des segmented, fond média, shimmer |
| `hover` | `#efefec` | `#36373c` | survol des boutons secondaires |
| `line` / `line-strong` | `rgb(22 24 29 / .10)` / `.18` | `rgb(255 255 255 / .09)` / `.16` | filets 1 px |
| `edge` | `#7d8087` | `#7c7f87` | bord des champs, interrupteur éteint (3:1) |
| `fg` | `#16181d` | `#ededeb` | texte |
| `muted` | `#4d5057` | `#b5b7bd` | texte secondaire |
| `faint` | `#5f626a` | `#9c9ea5` | méta, axes, placeholders |
| `accent` | `#1747d6` | `#8fa8ff` | action principale, focus, sélection, liens |
| `accent-hover` | `#1139b0` | `#a9bcff` | survol de l'action |
| `on-accent` | `#ffffff` | `#0f1630` | texte sur l'accent (le sombre éclaircit l'accent, donc texte foncé) |
| `accent-soft` | `#e3eafc` | `#2a3352` | option choisie, chip active |
| `tally` | `#e0362c` | `#ff6b5e` | voyant « en cours » (pastille seule, jamais du texte) |
| `danger` | `#b3261e` | `#ff8f84` | erreurs, suppression |
| `warn` | `#8a5300` | `#e7b356` | budget à 80 %, seed fixé, mode test |
| `chart` / `chart-hover` / `chart-track` | `#1747d6` / `#0e2f96` / `#dce3f5` | `#5c82f2` / `#8fa8ff` / `#30343f` | barres, survol, pistes |

Le puits média du drawer reste **noir pur** dans les deux thèmes (letterbox d'écran, pas un quasi-noir décoratif).

### Contrastes WCAG calculés

Ratios calculés (luminance relative WCAG 2.x) par script, pas à l'œil. AA : 4,5 pour le texte, 3 pour les éléments non textuels. Toutes les paires utilisées passent dans les deux thèmes.

| Paire | Usage | Clair | Sombre |
|---|---|---|---|
| `fg` sur `canvas` | texte (≥ 4,5) | 13,81 | 14,38 |
| `fg` sur `surface` | texte (≥ 4,5) | 16,56 | 12,89 |
| `fg` sur `raised` | texte (≥ 4,5) | 17,76 | 11,39 |
| `fg` sur `sunken` | texte (≥ 4,5) | 14,87 | 15,01 |
| `fg` sur `accent-soft` | texte (≥ 4,5) | 14,75 | 10,58 |
| `muted` sur `canvas` | texte (≥ 4,5) | 6,28 | 8,41 |
| `muted` sur `surface` | texte (≥ 4,5) | 7,53 | 7,54 |
| `muted` sur `raised` | texte (≥ 4,5) | 8,07 | 6,66 |
| `muted` sur `sunken` | texte (≥ 4,5) | 6,76 | 8,77 |
| `faint` sur `canvas` | texte (≥ 4,5) | 4,74 | 6,30 |
| `faint` sur `surface` | texte (≥ 4,5) | 5,69 | 5,65 |
| `faint` sur `raised` | texte (≥ 4,5) | 6,10 | 4,99 |
| `faint` sur `sunken` | texte (≥ 4,5) | 5,11 | 6,57 |
| `on-accent` sur `accent` | texte (≥ 4,5) | 7,22 | 7,82 |
| `on-accent` sur `accent-hover` | texte (≥ 4,5) | 9,39 | 9,62 |
| `accent` sur `canvas` | texte (≥ 4,5) | 5,61 | 7,39 |
| `accent` sur `surface` | texte (≥ 4,5) | 6,73 | 6,63 |
| `accent` sur `raised` | texte (≥ 4,5) | 7,22 | 5,86 |
| `accent` sur `accent-soft` | texte (≥ 4,5) | 6,00 | 5,44 |
| `danger` sur `canvas` | texte (≥ 4,5) | 5,08 | 7,64 |
| `danger` sur `surface` | texte (≥ 4,5) | 6,09 | 6,85 |
| `danger` sur `raised` | texte (≥ 4,5) | 6,54 | 6,05 |
| `warn` sur `canvas` | texte (≥ 4,5) | 4,92 | 8,81 |
| `warn` sur `surface` | texte (≥ 4,5) | 5,90 | 7,90 |
| `warn` sur `raised` | texte (≥ 4,5) | 6,33 | 6,98 |
| `tally` sur `surface` | non-texte (≥ 3) | 4,14 | 5,41 |
| `tally` sur `raised` | non-texte (≥ 3) | 4,44 | 4,78 |
| `tally` sur `sunken` | non-texte (≥ 3) | 3,71 | 6,30 |
| `tally` sur `canvas` | non-texte (≥ 3) | 3,45 | 6,03 |
| `edge` sur `raised` | non-texte (≥ 3) | 3,96 | 3,33 |
| `edge` sur `surface` | non-texte (≥ 3) | 3,69 | 3,77 |
| `edge` sur `sunken` | non-texte (≥ 3) | 3,31 | 4,39 |
| `accent` sur `raised` | non-texte (≥ 3) | 7,22 | 5,86 |
| `chart` sur `surface` | non-texte (≥ 3) | 6,73 | 4,27 |
| `chart-hover` sur `surface` | non-texte (≥ 3) | 10,49 | 6,63 |
| `chart` sur `chart-track` | non-texte (≥ 3) | 5,62 | 3,51 |
| `warn` sur `chart-track` | non-texte (≥ 3) | 4,93 | 6,50 |
| `danger` sur `chart-track` | non-texte (≥ 3) | 5,09 | 5,63 |

### Graphique (skill `dataviz`)

Une seule série (dépenses par jour) : une seule couleur, pas de légende, le titre nomme la série. Validateur `validate_palette.js` du skill passé dans les deux thèmes :

- clair, `#1747d6` sur `#f7f7f5` : bande de luminosité, chroma, contraste (6,73) : **tout passe** ; rampe ordinale `#1747d6` → `#0e2f96` (survol) : **passe** ;
- sombre, `#5c82f2` sur `#25262a` : **tout passe** (contraste 4,27) ; rampe `#5c82f2` → `#8fa8ff` : **passe**.

Le sombre a ses propres pas (pas une inversion automatique). Info au survol **et** au focus clavier, vue tableau en vrai bouton, axes et grilles discrets en `faint` / `line`.

## Typographie

**Mona Sans** seule, variable, chargée par `next/font/google` (axe `wdth`, sous-ensembles latin et latin-ext, variable `--font-mona`).

- Chasse 100 pour toute l'interface.
- Classe `.font-wide` : chasse 118, graisse 640 pour le mot-symbole, les titres de page et les montants. La marque vit dans la largeur de la lettre.
- Échelle fixe en px, rapport ~1,2 : 12 / 13 / 14 / 15 / 16 / 20 / 24 / 32 / 40.
- Champs à 16 px à toutes les tailles (pas de zoom iOS).
- Chiffres **proportionnels** : les chiffres tabulaires de Mona Sans ont un zéro barré qui transforme « 0,34 € » en « Ø,34 € ». Les montants restent en chiffres normaux ; les largeurs qui comptent (bouton Générer, pastilles) sont tenues par des largeurs minimales.
- Mono : pile système `ui-monospace` (identifiant de tâche kie.ai, raccourci clavier), sans police chargée.

## Rayons concentriques

Sheet 20 (composer, drawer, modale, feuille) > panneau 16 (cartes, panneaux des dépenses) > contrôle 12 (boutons, champs, rails, menus desktop) > item 8 (options de menu, pastille). Chaque niveau est inséré de 4 à 8 px dans le précédent : 20 - 8 = 12, 12 - 4 = 8. Les chips de réglage sont des pilules.

## Élévation

- Clair : surfaces flottantes (composer, menus, modales, drawer) = filet 1 px + ombre douce décalée à deux couches (`--elevation`). Aucune ombre sur les cartes posées.
- Sombre : une ombre ne se voit pas sur du sombre. L'élévation passe par la surface plus claire (`canvas` < `surface` < `raised`) et un filet ; `--elevation` devient un simple liseré clair en haut (`inset 0 1px 0`), sans ombre portée.

## Motion

- Durées 150 à 220 ms (700 ms pour la ligne de progression, qui suit un serveur). `--ease-out: cubic-bezier(.23,1,.32,1)`, `--ease-drawer: cubic-bezier(.32,.72,0,1)`.
- Uniquement `transform`, `opacity`, `clip-path`, `filter`, couleurs. Jamais `transition: all`, jamais de `width`/`height`/`top`/`left` animés, jamais `scale(0)`.
- Pression `scale(.97)`. Popovers desktop depuis leur déclencheur, feuilles téléphone qui montent de 16 px, modales depuis le bas sur téléphone.
- Pastille des segmented : `translateX` en pourcentage. Libellés qui s'échangent (`.swap`) : opacité + 4 px + flou 2 px. Coche qui arrive (`.check-in`). Chiffre qui change (`.tick`) : entre depuis le sens du changement.
- Rien sur les raccourcis clavier (Cmd+Entrée, /, Échap).
- `prefers-reduced-motion` : déplacements coupés, fondus courts gardés, shimmer et respiration du voyant arrêtés.

## Composants (`components/ui.tsx`)

- **Button** : primary (accent), secondary (raised + filet), ghost, danger ; tailles `sm`, `md`, `icon` ; 44 px au téléphone, 32 à 36 px dès `sm`. `buttonClass()` pour les liens qui ressemblent à des boutons.
- **Chip** : pilule 44 px au téléphone, 36 px dès `sm` ; active = `accent-soft` ; `ChipCaret` qui se retourne quand le menu est ouvert.
- **Segmented** : choix exclusif, `role="radiogroup"`, colonnes égales, pastille qui glisse, tabindex itinérant et flèches. Sert aux modes, aux filtres ; la navigation reprend le même dessin avec des liens.
- **Popover** : desktop, panneau ancré au déclencheur ; téléphone (< 640 px), **feuille pleine largeur en bas** au-dessus de la safe-area, voile qui ferme au toucher. Focus dans le panneau à l'ouverture, retour au déclencheur à Échap.
- **MenuItem** : 48 px au téléphone, coche Phosphor sur l'option choisie, `aria-pressed` pour les choix.
- **Switch** : piste 40 × 24 dans une cible de 44 px, pouce qui glisse et s'étire à la pression.
- **Stepper** : durée à la seconde, boutons 44 px « Une seconde de moins / de plus », valeur en `output aria-live`.
- **Modal** : feuille en bas au téléphone (boutons pleine largeur, action principale en haut), centrée dès `sm` ; focus initial, Tab qui boucle, retour du focus, Échap.
- **Tally** : pastille rouge qui respire, marque tout ce qui tourne.
- **fieldClass** : champs 16 px, 44 px au téléphone, bord `edge` à 3:1, focus accent.

## Règles produit

- **Mobile first, sans exception** : conçu à 390 px, vérifié à 320 px sans scroll horizontal, élargi vers 1440 px avec `sm:` / `md:` / `lg:`.
- Cibles tactiles 44 px minimum, safe-area iOS respectée (barre, composer, feuilles, drawer).
- Aucun réglage caché dans une bande qui défile : les réglages du composer passent à la ligne.
- Rien qui ne marche qu'au survol : légende toujours visible sous chaque carte, aide du mode affichée sous les modes.
- Galerie : 2 colonnes au téléphone (les vidéos UGC sont verticales), 3 dès `sm`, 4 dès `lg`, 5 dès `2xl`.
- Icônes Phosphor uniquement ; le logo (cadre de visée + voyant) est une marque, partagée avec le favicon.
- Pas de tiret cadratin ni demi-cadratin dans les textes visibles, pas d'emoji.

## Les 3 décisions dont je suis le plus fier

1. **Le gris de charte, en clair comme en sombre.** C'est le fond sur lequel un étalonneur juge une image : les vidéos y gardent leurs vraies valeurs, et le clair se lit au soleil sur un téléphone. Le sombre est le même gris descendu, pas un noir de « mode nuit ».
2. **Le voyant.** Une seule couleur vive hors action, le rouge du plateau, réservée à ce qui tourne : sur chaque carte en cours, dans l'onglet Créer au téléphone, en « N en cours » dans la barre dès la tablette, et dans le logo. On sait de partout qu'une prise est en cours sans chercher.
3. **Une seule pastille qui glisse pour tous les choix exclusifs.** Modes, filtres d'Historique et navigation partagent le même rail en colonnes égales : la pastille se déplace par un `translateX` en pourcentage, sans mesure de largeur ni animation de taille, au doigt comme au clavier.
