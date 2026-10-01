import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "@/lib/client/id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID when available", () => {
    expect(newId()).toMatch(UUID);
  });

  it("still works without randomUUID (http://192.168.x.x on a phone)", () => {
    const { getRandomValues } = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: getRandomValues.bind(globalThis.crypto) });
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it("still works with no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newId()).toMatch(UUID);
  });
});
