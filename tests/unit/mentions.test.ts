import { describe, expect, it } from "vitest";
import { gptImage25 } from "@/lib/models/gpt-image";
import { genjutsuSwap } from "@/lib/models/genjutsu";
import { orphanMentions, resolveMentions } from "@/lib/models/mentions";
import { summarizeMedia, validateRequest } from "@/lib/models/registry";
import { seedance25Edit } from "@/lib/models/seedance-2-5-edit";
import { soul2 } from "@/lib/models/soul-2";
import { wan30Video } from "@/lib/models/wan-3-0-video";

const files = (slot: string, n: number) => Array.from({ length: n }, () => ({ slot, size: 10 }));

describe("mentions", () => {
  it("keeps Wan's documented @Image1 syntax", () => {
    expect(resolveMentions("la femme de @Image1 danse sur @Audio1", wan30Video)).toBe("la femme de @Image1 danse sur @Audio1");
  });

  it("turns mentions into words, in send order, for models without a mention syntax", () => {
    expect(resolveMentions("@Image1 porte la veste de @Image2", gptImage25)).toBe("image 1 porte la veste de image 2");
    expect(resolveMentions("Remplace la personne de @Video1 par @Image1.", genjutsuSwap)).toBe("Remplace la personne de video 1 par image 1.");
    expect(resolveMentions("Mets la veste de @Image1\n@Video1", seedance25Edit)).toBe("Mets la veste de image 1\nvideo 1");
  });

  it("leaves e-mail addresses and unknown words alone", () => {
    expect(resolveMentions("écris à moi@exemple.fr pour @quelquun", gptImage25)).toBe("écris à moi@exemple.fr pour @quelquun");
  });

  it("removes character mentions for Soul 2, which reads custom_reference_id instead", () => {
    expect(resolveMentions("@Léa en veste de cuir, lumière douce", soul2, ["Léa"])).toBe("en veste de cuir, lumière douce");
    expect(resolveMentions("portrait de @léa au soleil", soul2, ["Léa"])).toBe("portrait de au soleil");
    // Not a character: a brand or a handle stays, spacing untouched.
    expect(resolveMentions("sac @gucci,  fond blanc", soul2, ["Léa"])).toBe("sac @gucci,  fond blanc");
  });

  it("flags mentions with no attached file, shared by the composer and the server", () => {
    expect(orphanMentions("@Image1 et @Image3", gptImage25, summarizeMedia(files("reference_image", 2)))).toEqual(["@Image3"]);
    expect(orphanMentions("@Video1", gptImage25, {})).toEqual(["@Video1"]);
    const r = validateRequest(gptImage25, { ...gptImage25.defaults, prompt: "@Image2 en couleur" }, files("reference_image", 1));
    expect(r.ok ? [] : r.errors).toEqual(["@Image2 ne correspond à aucun fichier joint."]);
  });
});

describe("Soul 2 avec un personnage Soul ID", () => {
  it("sends the character and its resemblance only when one is chosen", () => {
    expect(soul2.buildInput({ ...soul2.defaults, prompt: "x" }, {})).not.toHaveProperty("custom_reference_id");
    expect(soul2.buildInput({ ...soul2.defaults, prompt: "x", custom_reference_id: "ref-1", custom_reference_strength: "0.7" }, {})).toMatchObject({
      custom_reference_id: "ref-1",
      custom_reference_strength: 0.7,
    });
    // Generations made before Soul ID still validate.
    const r = validateRequest(soul2, { prompt: "x", resolution: "720p", aspect_ratio: "1:1", enhance_prompt: false }, []);
    expect(r.ok).toBe(true);
  });
});
