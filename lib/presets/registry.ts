import type { Preset } from "./types";

export const PRESETS: Preset[] = [
  // ── Caméra ────────────────────────────────────────────
  {
    id: "push-in",
    label: "Push In",
    description: "La caméra avance doucement vers le sujet.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", smooth push-in camera movement slowly approaching the subject",
  },
  {
    id: "pull-back",
    label: "Pull Back",
    description: "La caméra recule pour révéler la scène.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", slow pull-back camera movement revealing the full scene",
  },
  {
    id: "crane-shot",
    label: "Crane Shot",
    description: "Mouvement vertical ascendant de la caméra.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", vertical crane shot rising upward to reveal the scene from above",
  },
  {
    id: "orbit",
    label: "Orbit",
    description: "La caméra tourne autour du sujet.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", smooth orbiting camera movement circling around the subject",
  },
  {
    id: "dolly-zoom",
    label: "Dolly Zoom",
    description: "Effet Vertigo : zoom avant + recul simultané.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", dolly zoom vertigo effect with simultaneous zoom-in and camera pull-back",
  },
  {
    id: "whip-pan",
    label: "Whip Pan",
    description: "Panoramique rapide avec flou de mouvement.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", fast whip pan with motion blur transitioning to the subject",
  },
  {
    id: "top-down",
    label: "Vue du dessus",
    description: "Plongée verticale vers le bas.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", top-down overhead camera angle looking straight down",
  },
  {
    id: "tracking",
    label: "Tracking",
    description: "La caméra suit le sujet latéralement.",
    category: "camera",
    icon: "🎥",
    promptSuffix: ", lateral tracking shot following the subject's movement",
  },

  // ── Style ─────────────────────────────────────────────
  {
    id: "cinematic",
    label: "Cinématique",
    description: "Look film avec profondeur de champ et étalonnage.",
    category: "style",
    icon: "🎬",
    promptSuffix: ", cinematic film look with shallow depth of field, anamorphic lens flares, professional color grading",
  },
  {
    id: "anime",
    label: "Anime",
    description: "Style animation japonaise.",
    category: "style",
    icon: "🎨",
    promptSuffix: ", anime art style, vibrant colors, expressive character animation, Japanese animation aesthetic",
  },
  {
    id: "realistic",
    label: "Photoréaliste",
    description: "Le plus réaliste possible, comme une vraie caméra.",
    category: "style",
    icon: "📷",
    promptSuffix: ", photorealistic, shot on RED camera, natural lighting, 8K resolution, ultra-detailed",
  },
  {
    id: "ugc",
    label: "UGC",
    description: "Style créateur de contenu, face caméra naturel.",
    category: "style",
    icon: "📱",
    promptSuffix: ", casual UGC style, handheld smartphone footage, natural ambient lighting, authentic feel",
  },
  {
    id: "noir",
    label: "Film Noir",
    description: "Noir et blanc, ombres dures, atmosphère mystérieuse.",
    category: "style",
    icon: "🖤",
    promptSuffix: ", film noir style, black and white, high contrast, dramatic hard shadows, mysterious atmosphere",
  },
  {
    id: "vintage",
    label: "Vintage",
    description: "Film analogique des années 70, grain et couleurs chaudes.",
    category: "style",
    icon: "📼",
    promptSuffix: ", vintage 1970s film aesthetic, warm color palette, film grain, soft focus, retro look",
  },
  {
    id: "neon",
    label: "Néon",
    description: "Lumières néon cyberpunk, couleurs saturées.",
    category: "style",
    icon: "💜",
    promptSuffix: ", neon-lit cyberpunk aesthetic, vibrant saturated colors, glowing neon lights, futuristic urban",
  },
  {
    id: "dreamy",
    label: "Onirique",
    description: "Doux, éthéré, comme un rêve.",
    category: "style",
    icon: "☁️",
    promptSuffix: ", dreamy ethereal atmosphere, soft diffused light, gentle lens bloom, pastel tones",
  },

  // ── Mouvement ─────────────────────────────────────────
  {
    id: "slow-motion",
    label: "Ralenti",
    description: "Mouvement au ralenti dramatique.",
    category: "motion",
    icon: "🐌",
    promptSuffix: ", dramatic slow motion, time stretching, every detail visible in slow motion",
  },
  {
    id: "timelapse",
    label: "Timelapse",
    description: "Accéléré : le temps passe vite.",
    category: "motion",
    icon: "⏩",
    promptSuffix: ", timelapse effect, fast forward passage of time, clouds moving quickly",
  },
  {
    id: "freeze-frame",
    label: "Arrêt sur image",
    description: "Le mouvement se fige au moment clé.",
    category: "motion",
    icon: "⏸️",
    promptSuffix: ", freeze frame at the peak moment, time stops, particles frozen mid-air",
  },
  {
    id: "speed-ramp",
    label: "Speed Ramp",
    description: "Accélération puis ralenti soudain.",
    category: "motion",
    icon: "⚡",
    promptSuffix: ", speed ramping from fast motion to sudden slow motion, dynamic pacing",
  },

  // ── Effet ─────────────────────────────────────────────
  {
    id: "particle-burst",
    label: "Explosion de particules",
    description: "Le sujet éclate en particules lumineuses.",
    category: "effect",
    icon: "✨",
    promptSuffix: ", subject dissolving into glowing light particles, dramatic particle burst effect",
  },
  {
    id: "liquid-wrap",
    label: "Enveloppe liquide",
    description: "Du liquide s'enroule autour du sujet.",
    category: "effect",
    icon: "💧",
    promptSuffix: ", liquid flowing and wrapping around the subject, fluid dynamics, glossy reflections",
  },
  {
    id: "smoke-reveal",
    label: "Révélation fumée",
    description: "Le sujet apparait dans la fumée.",
    category: "effect",
    icon: "🌫️",
    promptSuffix: ", subject emerging from dramatic smoke and fog, atmospheric reveal",
  },
  {
    id: "glitch",
    label: "Glitch",
    description: "Distorsion numérique et artefacts visuels.",
    category: "effect",
    icon: "📺",
    promptSuffix: ", digital glitch effect, RGB split, scan lines, visual artifacts, corrupted signal aesthetic",
  },
  {
    id: "paint-splash",
    label: "Splash de peinture",
    description: "Une vague de peinture colorée.",
    category: "effect",
    icon: "🎨",
    promptSuffix: ", colorful paint splash wave, vibrant liquid paint flowing across the frame",
  },
  {
    id: "fire-reveal",
    label: "Révélation flammes",
    description: "Le sujet est révélé par les flammes.",
    category: "effect",
    icon: "🔥",
    promptSuffix: ", subject revealed through dramatic fire and flames, ember particles, warm glow",
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function getPresetsByCategory(category: Preset["category"]): Preset[] {
  return PRESETS.filter((p) => p.category === category);
}
