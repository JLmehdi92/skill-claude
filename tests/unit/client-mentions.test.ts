import { describe, expect, it } from "vitest";
import { activeMention, matchesMention } from "@/lib/client/mentions";

describe("activeMention", () => {
  it("finds the mention being typed at the start, in the middle and after a line break", () => {
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("la femme de @Ima", 16)).toEqual({ start: 12, query: "Ima" });
    expect(activeMention("ligne 1\n@Lé", 11)).toEqual({ start: 8, query: "Lé" });
  });

  it("ignores e-mail addresses, finished mentions and the text after the caret", () => {
    expect(activeMention("moi@exemple", 11)).toBeNull();
    expect(activeMention("@Image1 danse", 13)).toBeNull();
    expect(activeMention("@Image1 danse", 4)).toEqual({ start: 0, query: "Ima" });
  });
});

describe("matchesMention", () => {
  it("matches the start of any word, without case or accents", () => {
    expect(matchesMention("@Image1", "ima")).toBe(true);
    expect(matchesMention("Ajouter une image", "ima")).toBe(true);
    expect(matchesMention("@Léa", "lea")).toBe(true);
    expect(matchesMention("@Video1", "ima")).toBe(false);
    expect(matchesMention("@Video1", "")).toBe(true);
  });
});
