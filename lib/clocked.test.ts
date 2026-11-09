// lib/clocked.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callClocked, globalClockedQueue } from "./clocked";

describe("lib/clocked", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries a 503 followed by a 200 with the same idempotency key", { timeout: 10_000 }, async () => {
    const capturedKeys: string[] = [];
    let callCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      callCount++;
      const headers = init.headers as Record<string, string>;
      capturedKeys.push(headers["Idempotency-Key"]);

      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "Service Unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ verdict: "benign" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Clocked-Credits": "2",
        },
      });
    });

    const res = await callClocked<{ verdict: string }>(
      "injection",
      { text: "test" },
      { mode: "live", apiKey: "test-key" }
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.verdict).toBe("benign");
      expect(res.credits).toBe(2);
      expect(res.replayed).toBe(false);
    }
    expect(callCount).toBe(2);
    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).toBeTruthy();
    expect(capturedKeys[0]).toBe(capturedKeys[1]);
  });

  it("stops immediately after one attempt if retryAsNew is true", async () => {
    let callCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({ error: "Logical error", retryAsNew: true }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const res = await callClocked(
      "decide",
      { state: "foo" },
      { mode: "live", apiKey: "test-key" }
    );

    expect(res.ok).toBe(false);
    expect(callCount).toBe(1);
    if (!res.ok) {
      expect(res.error).toContain("retryAsNew");
    }
  });

  it("fails cleanly on replay with no recording", async () => {
    const res = await callClocked(
      "decide",
      { state: "non-existent-recording-payload-12345" },
      { mode: "replay" }
    );

    expect(res.ok).toBe(false);
    expect(res.replayed).toBe(true);
    if (!res.ok) {
      expect(res.error).toContain("Replay recording not found");
    }
  });

  it("does not call the network when no API key is provided in live mode", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const res = await callClocked(
      "extract",
      { text: "hello" },
      { mode: "live", apiKey: "" }
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Missing CLOCKED_API_KEY");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("limits concurrent calls so six calls at once never exceed 4 in flight", async () => {
    let currentInFlight = 0;
    let maxInFlight = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      currentInFlight++;
      maxInFlight = Math.max(maxInFlight, currentInFlight);
      await new Promise((resolve) => setTimeout(resolve, 50));
      currentInFlight--;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const calls = Array.from({ length: 6 }, (_, i) =>
      callClocked(
        "pii",
        { text: `call ${i}` },
        { mode: "live", apiKey: "test-key" }
      )
    );

    const results = await Promise.all(calls);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBe(4);
  });
});
