export type KieState = "waiting" | "queuing" | "generating" | "success" | "fail";

export interface KieTask {
  taskId: string;
  model?: string;
  state: KieState;
  resultUrls: string[];
  failMsg?: string;
  progress?: number;
  creditsConsumed?: number;
  /** Original request parameters, when kie returns them. */
  param?: { model?: string; input?: Record<string, unknown> };
  createTime?: number;
  completeTime?: number;
}

export interface KieClient {
  createTask(model: string, input: Record<string, unknown>): Promise<string>;
  getTask(taskId: string): Promise<KieTask>;
  uploadFile(data: Buffer, fileName: string, mimeType: string, uploadPath: string): Promise<string>;
  getCredits(): Promise<number>;
  /** Returns a fetchable URL for a generated file (kie may need to sign it). */
  download(url: string): Promise<Buffer>;
}

const MESSAGES: Record<number, string> = {
  401: "Clé API kie.ai invalide ou absente. Vérifie KIE_API_KEY dans .env.local.",
  402: "Crédits kie.ai insuffisants. Recharge ton compte sur kie.ai.",
  404: "Tâche introuvable chez kie.ai.",
  422: "kie.ai a refusé les paramètres.",
  429: "Trop de requêtes vers kie.ai. Réessaie dans un instant.",
  433: "Limite de requêtes kie.ai atteinte.",
  455: "kie.ai est en maintenance.",
  500: "Erreur serveur chez kie.ai.",
  501: "La génération a échoué chez kie.ai.",
  505: "Cette fonctionnalité est désactivée chez kie.ai.",
};

export class KieError extends Error {
  constructor(
    public code: number,
    detail?: string,
  ) {
    const base = MESSAGES[code] ?? `Erreur kie.ai (${code}).`;
    super(detail && detail !== "success" ? `${base} ${detail}`.trim() : base);
  }

  get retryable(): boolean {
    return [429, 433, 455, 500].includes(this.code);
  }
}
