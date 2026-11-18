import { afterEach, describe, expect, it, vi } from "vitest";
import { HiggsfieldError, realHiggsfieldClient } from "@/lib/higgsfield/client";

const API = "https://api.higgsfield.ai";
const KEY = "hf_abc123:secret456";
type Call = { url: string; init: RequestInit };

function stubFetch(responses: Response[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return responses.shift() ?? new Response("{}", { status: 500 });
    }),
  );
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

afterEach(() => vi.unstubAllGlobals());

describe("Higgsfield client", () => {
  it("submits with the complete key as-is and an idempotency key", async () => {
    const calls = stubFetch([json({ request_id: "req-1", status: "queued" })]);
    const id = await realHiggsfieldClient(KEY, API).createTask("higgsfield-ai/soul/v2/standard", { prompt: "x" });
    expect(id).toBe("req-1");
    expect(calls[0].url).toBe(`${API}/higgsfield-ai/soul/v2/standard`);
    expect(header(calls[0], "Authorization")).toBe(`Key ${KEY}`);
    expect(header(calls[0], "Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ prompt: "x" });
  });

  it("maps terminal states: media URLs, uncharged failures and moderation", async () => {
    stubFetch([
      json({ status: "completed", request_id: "a", images: [{ url: "https://cdn/i.png" }] }),
      json({ status: "completed", request_id: "b", video: { url: "https://cdn/v.mp4" } }),
      json({ status: "nsfw", request_id: "c" }),
      json({ status: "in_progress", request_id: "d" }),
    ]);
    const c = realHiggsfieldClient(KEY, API);
    expect(await c.getTask("a")).toMatchObject({ state: "success", resultUrls: ["https://cdn/i.png"] });
    expect(await c.getTask("b")).toMatchObject({ state: "success", resultUrls: ["https://cdn/v.mp4"] });
    expect(await c.getTask("c")).toMatchObject({ state: "fail", failMsg: "Refusé par la modération de Higgsfield.", creditsConsumed: 0 });
    expect(await c.getTask("d")).toMatchObject({ state: "generating" });
  });

  it("uploads to the signed URL with its own headers only, then returns the public URL", async () => {
    const calls = stubFetch([
      json({ public_url: "https://cdn/in.png", upload_url: "https://storage/signed", content_type: "image/png", upload_headers: { "Content-Type": "image/png", "x-amz-tagging": "retention=temporary" } }),
      new Response(null, { status: 200 }),
    ]);
    const url = await realHiggsfieldClient(KEY, API).uploadFile(Buffer.from("png"), "a.png", "image/png", "x");
    expect(url).toBe("https://cdn/in.png");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ content_type: "image/png" });
    expect(calls[1].url).toBe("https://storage/signed");
    expect(header(calls[1], "Authorization")).toBeNull();
    expect(header(calls[1], "x-amz-tagging")).toBe("retention=temporary");
  });

  it("cancels queued requests through the API and reports when it is too late", async () => {
    const calls = stubFetch([new Response(null, { status: 202 }), json({ detail: "already started" }, 400)]);
    const c = realHiggsfieldClient(KEY, API);
    expect(await c.cancelTask!("req-1")).toBe(true);
    expect(calls[0]).toMatchObject({ url: `${API}/requests/req-1/cancel` });
    expect(calls[0].init.method).toBe("POST");
    expect(await c.cancelTask!("req-2")).toBe(false);
  });

  it("explains a missing key, a low balance and invalid parameters in French", async () => {
    await expect(realHiggsfieldClient("", API).createTask("x", {})).rejects.toThrow(/HF_API_KEY/);
    stubFetch([json({ detail: "Insufficient balance" }, 403), json({ detail: [{ msg: "field required" }] }, 422)]);
    const c = realHiggsfieldClient(KEY, API);
    await expect(c.createTask("x", {})).rejects.toThrow(/Solde Higgsfield insuffisant/);
    await expect(c.createTask("x", {})).rejects.toBeInstanceOf(HiggsfieldError);
  });
});

describe("Higgsfield Soul ID", () => {
  it("creates a v2 character from image URLs and maps its training states", async () => {
    const calls = stubFetch([
      json({ id: "ref-1", status: "not_ready" }),
      json({ id: "ref-1", status: "in_progress" }),
      json({ id: "ref-1", status: "completed", thumbnail_url: "https://cdn/t.jpg" }),
      json({ id: "ref-1", status: "failed", fail_reason: "Pas de visage" }),
    ]);
    const c = realHiggsfieldClient(KEY, API);
    expect(await c.createCharacter("Léa", ["https://cdn/a.png", "https://cdn/b.png"])).toBe("ref-1");
    expect(calls[0].url).toBe(`${API}/v1/custom-references`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      name: "Léa",
      model_version: "v2",
      input_images: [
        { type: "image_url", image_url: "https://cdn/a.png" },
        { type: "image_url", image_url: "https://cdn/b.png" },
      ],
    });
    expect(await c.getCharacter("ref-1")).toEqual({ state: "training", thumbnailUrl: undefined, failReason: undefined });
    expect((await c.getCharacter("ref-1")).state).toBe("ready");
    expect(await c.getCharacter("ref-1")).toMatchObject({ state: "failed", failReason: "Pas de visage" });
    expect(calls[1].url).toBe(`${API}/v1/custom-references/ref-1`);
  });
});
