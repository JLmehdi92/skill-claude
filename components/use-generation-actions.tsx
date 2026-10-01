"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, notifyStatsChanged, type BudgetConflict } from "@/lib/client/api";
import { formatEur } from "@/lib/costs";
import type { Generation } from "@/lib/types";
import { Button, Modal } from "./ui";

/** Retry / favorite / delete, shared by the studio feed and the history page. */
export function useGenerationActions(opts: {
  upsert: (g: Generation) => void;
  removeLocal: (id: string) => void;
  setSelected: (g: Generation | null) => void;
}) {
  const { upsert, removeLocal, setSelected } = opts;
  const [conflict, setConflict] = useState<{ gen: Generation; budget: BudgetConflict; newSeed: boolean } | null>(null);

  /** Same parameters again; `newSeed` draws another seed for a different take ("Variante"). */
  const retry = useCallback(
    async (gen: Generation, opts: { confirmOverBudget?: boolean; newSeed?: boolean } = {}) => {
      const newSeed = opts.newSeed === true;
      try {
        const fresh = await api.retry(gen.id, { confirmOverBudget: opts.confirmOverBudget, newSeed });
        upsert(fresh);
        setConflict(null);
        setSelected(null);
        notifyStatsChanged();
        toast.success(newSeed ? "Variante lancée" : "Génération relancée");
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) setConflict({ gen, budget: (err.body as { budget: BudgetConflict }).budget, newSeed });
        else toast.error((err as Error).message);
      }
    },
    [upsert, setSelected],
  );

  const favorite = useCallback(
    async (gen: Generation) => {
      const fresh = await api.favorite(gen.id, !gen.favorite);
      upsert(fresh);
      setSelected(fresh);
    },
    [upsert, setSelected],
  );

  const remove = useCallback(
    async (gen: Generation) => {
      await api.remove(gen.id);
      removeLocal(gen.id);
      setSelected(null);
      notifyStatsChanged();
      toast("Génération supprimée", { description: "Fichiers effacés. Son coût reste dans tes dépenses." });
    },
    [removeLocal, setSelected],
  );

  const budgetModal = (
    <Modal open={conflict !== null} onClose={() => setConflict(null)} title="Budget mensuel dépassé">
      {conflict && (
        <>
          <p className="text-sm leading-relaxed text-muted">
            {formatEur(conflict.budget.spentEur)} engagés sur {formatEur(conflict.budget.monthlyBudgetEur)} ce mois-ci. Relancer coûterait{" "}
            {formatEur(conflict.budget.estimateEur)} de plus.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConflict(null)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void retry(conflict.gen, { confirmOverBudget: true, newSeed: conflict.newSeed })}>
              Relancer quand même
            </Button>
          </div>
        </>
      )}
    </Modal>
  );

  return { retry, favorite, remove, budgetModal };
}
