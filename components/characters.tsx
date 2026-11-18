"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleNotch, Plus, UserCircle, X } from "@phosphor-icons/react";
import { api, ApiError, type BudgetConflict } from "@/lib/client/api";
import { creditsToEur, formatEur } from "@/lib/costs";
import type { Character } from "@/lib/types";
import { Button, Chip, ChipCaret, cx, fieldClass, keepFocusOnRemove, MenuItem, Modal, ModalActions, onRadioArrows, Popover, Tally } from "./ui";

// 2.50 $ per Soul ID training (open.higgsfield.ai pricing), in kie-style credits (1 credit = 0.005 $).
const SOUL_ID_CREDITS = 500;
const MAX_PHOTOS = 100;

function Avatar({ c, size }: { c: Character; size: 20 | 32 }) {
  const cls = size === 20 ? "size-5" : "size-8";
  return c.thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.thumbUrl} alt="" className={cx(cls, "shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-black/10")} />
  ) : (
    <UserCircle size={size} className="shrink-0 text-muted" />
  );
}

/** "Personnage" chip for Soul 2: pick a ready Soul ID character, follow trainings, start a new one. */
export function CharacterMenu({
  characters,
  selectedId,
  onSelect,
  onRemove,
  onNew,
}: {
  characters: Character[];
  selectedId: string | null;
  onSelect: (c: Character | null) => void;
  onRemove: (c: Character) => void;
  onNew: () => void;
}) {
  const selected = characters.find((c) => c.referenceId === selectedId) ?? null;
  const panel = useRef<HTMLDivElement>(null);
  return (
    <Popover
      label="Personnage"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open || selected !== null} aria-expanded={open} aria-label={`Personnage : ${selected?.name ?? "aucun"}`}>
          {selected ? <Avatar c={selected} size={20} /> : <UserCircle size={16} />}
          <span className="max-w-48 truncate font-medium text-fg">{selected?.name ?? "Personnage"}</span>
          <ChipCaret />
        </Chip>
      )}
    >
      {(close) => (
        <div ref={panel} className="w-full sm:w-80" data-removable>
          <div role="radiogroup" aria-label="Personnage" onKeyDown={onRadioArrows}>
            <MenuItem
              selected={selected === null}
              onClick={() => {
                onSelect(null);
                close();
              }}
            >
              Aucun
            </MenuItem>
            {characters.map((c) => (
              // presentation: the row only lays out the radio and its X, it is not an item of the group.
              <div key={c.id} role="presentation" className="flex items-center gap-1">
                <MenuItem
                  selected={c.referenceId === selectedId}
                  disabled={c.status !== "ready"}
                  onClick={() => {
                    onSelect(c);
                    close();
                  }}
                  className="min-w-0 flex-1"
                >
                  <Avatar c={c} size={32} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-fg">{c.name}</span>
                    {c.status === "training" && (
                      <span className="flex items-center gap-1.5 text-xs text-faint">
                        <Tally />
                        En entraînement
                      </span>
                    )}
                    {c.status === "failed" && <span className="truncate text-xs text-danger">Échec : {c.failReason}</span>}
                  </span>
                </MenuItem>
                {/* No X while training: the server keeps it until the end, so a failure can be refunded. */}
                {c.status !== "training" && (
                  <button
                    type="button"
                    data-remove
                    onClick={() => {
                      keepFocusOnRemove(() => panel.current?.querySelector<HTMLElement>("[data-new-character]"));
                      onRemove(c);
                    }}
                    aria-label={`Retirer ${c.name} de la liste`}
                    className="pressable flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg"
                  >
                    <X size={14} weight="bold" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {characters.length === 0 && (
            <p className="px-3 pt-1 pb-2 text-xs leading-snug text-faint sm:px-2.5">
              Aucun personnage pour l&apos;instant. Entraîne Soul 2 sur tes photos pour garder le même visage d&apos;une image à l&apos;autre.
            </p>
          )}
          <MenuItem
            data-new-character
            onClick={() => {
              close();
              onNew();
            }}
          >
            <Plus size={16} weight="bold" />
            Nouveau personnage
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

interface Photo {
  id: string;
  file: File;
  url: string;
}

/** "Nouveau personnage": name, 1 to 100 photos, price, then a Soul ID training at Higgsfield. */
export function CharacterTrainer({
  open,
  onClose,
  usdEurRate,
  takenNames,
  onTrained,
}: {
  open: boolean;
  onClose: () => void;
  usdEurRate: number;
  takenNames: string[];
  onTrained: (c: Character) => void;
}) {
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [budget, setBudget] = useState<BudgetConflict | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  // Previews still alive when the composer unmounts (page change with the window open) are released too.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  });
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setName("");
    setPhotos([]);
    setErrors([]);
    setBudget(null);
  };
  const close = () => {
    if (sending) return;
    reset();
    onClose();
  };

  const add = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const room = MAX_PHOTOS - photos.length;
    if (images.length > room) toast.error("100 photos au maximum. Les suivantes n'ont pas été ajoutées.");
    setPhotos((prev) => [...prev, ...images.slice(0, room).map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file) }))]);
    setErrors([]);
  };

  const train = async (confirmOverBudget = false) => {
    const n = name.trim();
    const problems = [
      !n
        ? "Donne un nom au personnage."
        : !/^[\p{L}\p{N}_-]{1,30}$/u.test(n)
          ? "30 caractères maximum : lettres, chiffres et tirets, sans espace."
          : /^(image|video|audio)\d+$/i.test(n)
            ? "Ce nom est réservé aux fichiers joints (@Image1…). Choisis-en un autre."
            : "",
      n && takenNames.some((t) => t.toLocaleLowerCase("fr") === n.toLocaleLowerCase("fr")) ? "Ce nom est déjà pris." : "",
      photos.length === 0 ? "Ajoute au moins une photo." : "",
    ].filter(Boolean);
    setErrors(problems);
    if (problems.length || sending) return;
    const form = new FormData();
    form.set("name", n);
    for (const p of photos) form.append("file", p.file, p.file.name);
    if (confirmOverBudget) form.set("confirmOverBudget", "1");
    setSending(true);
    try {
      const c = await api.trainCharacter(form);
      onTrained(c);
      toast.success(`Entraînement lancé : ${c.name}`, { description: "Prend quelques minutes. Tu peux continuer à créer pendant ce temps." });
      setSending(false);
      reset();
      onClose();
    } catch (err) {
      setSending(false);
      if (err instanceof ApiError && err.status === 409) setBudget((err.body as { budget: BudgetConflict }).budget);
      else setErrors(err instanceof ApiError ? err.errors : [(err as Error).message]);
    }
  };

  const priceEur = formatEur(creditsToEur(SOUL_ID_CREDITS, usdEurRate));

  if (budget) {
    return (
      // Own key: a fresh dialog, so its autofocus runs and focus does not fall to the page.
      <Modal key="budget" open={open} onClose={close} title="Budget mensuel dépassé">
        <p className="text-sm leading-relaxed text-muted">
          Cet entraînement ({priceEur}) porte tes dépenses du mois à {formatEur(budget.spentEur + budget.estimateEur)}, au-delà de ton budget de {formatEur(budget.monthlyBudgetEur)}.
        </p>
        <ModalActions>
          <Button variant="ghost" onClick={() => setBudget(null)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void train(true)} aria-busy={sending} data-autofocus>
            Lancer quand même
          </Button>
        </ModalActions>
      </Modal>
    );
  }

  return (
    <Modal key="form" open={open} onClose={close} title="Nouveau personnage">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="character-name" className="text-sm font-medium text-fg">
            Nom
          </label>
          <input
            id="character-name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            placeholder="Léa"
            autoComplete="off"
            aria-describedby="character-name-hint"
            className={fieldClass}
          />
          <p id="character-name-hint" className="text-xs text-faint">
            Sert de mention : @{name.trim() || "Léa"}
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-fg">Photos</p>
          <p className="text-xs leading-snug text-faint">De 1 à 100 photos. Mets-en 10 à 20, variées : visage de face, profil, en pied, lumières différentes. Une seule personne par photo.</p>
          <ul className="grid grid-cols-3 gap-2 pt-1 sm:grid-cols-4" aria-label="Photos choisies" data-removable>
            <li>
              <label className="pressable flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-control border border-dashed border-edge bg-sunken text-center text-xs text-muted hover:border-accent hover:text-fg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
                <Plus size={18} />
                Ajouter des photos
                <input
                  ref={addRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    add([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
              </label>
            </li>
            {photos.map((p, i) => (
              <li key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="aspect-square w-full rounded-control object-cover outline outline-1 -outline-offset-1 outline-black/10" />
                <button
                  type="button"
                  data-remove
                  onClick={() => {
                    keepFocusOnRemove(() => addRef.current);
                    URL.revokeObjectURL(p.url);
                    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
                  }}
                  aria-label={`Retirer la photo ${i + 1}`}
                  className="pressable absolute top-1 right-1 flex size-7 items-center justify-center rounded-full border border-line-strong bg-raised text-muted shadow-thumb after:absolute after:-inset-2 after:content-[''] hover:text-fg"
                >
                  <X size={12} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-faint" aria-live="polite">
            {photos.length} photo{photos.length > 1 ? "s" : ""}
          </p>
        </div>

        <div className="rounded-control bg-sunken px-3 py-2.5">
          <p className="text-sm text-fg">Entraînement : 2,50 $ ≈ {priceEur}</p>
          <p className="mt-0.5 text-xs text-faint">Prend quelques minutes. Tu peux continuer à créer pendant ce temps.</p>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-0.5 text-sm text-danger" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
      <ModalActions>
        <Button variant="ghost" onClick={close}>
          Annuler
        </Button>
        <Button variant="primary" onClick={() => void train()} aria-busy={sending}>
          {sending ? (
            <>
              <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" />
              Envoi des photos
            </>
          ) : (
            "Entraîner"
          )}
        </Button>
      </ModalActions>
    </Modal>
  );
}
