// lib/clocked.ts
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Call } from "./types";

export type ClockedMode = "live" | "record" | "replay";

export function clockedMode(): ClockedMode {
  const envMode = process.env.CLOCKED_MODE?.toLowerCase();
  if (envMode === "live" || envMode === "record" || envMode === "replay") {
    return envMode;
  }
  if (process.env.CLOCKED_API_KEY && process.env.CLOCKED_API_KEY.trim() !== "") {
    return "live";
  }
  return "replay";
}

// Canonical JSON for deterministic hashing
export function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return "[" + val.map(canonicalStringify).join(",") + "]";
  }
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]))
      .join(",") +
    "}"
  );
}

export function hashPayload(payload: unknown): string {
  const canonical = canonicalStringify(payload);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function normalizeEndpoint(endpoint: string): {
  normalizedName: string;
  url: string;
} {
  const cleaned = endpoint.replace(/^\/?(clocked\/)?/, "").replace(/\/$/, "");
  return {
    normalizedName: cleaned,
    url: `https://clocked.rezolve.ai/clocked/${cleaned}`,
  };
}

// Concurrency queue: at most 4 requests in flight
class ConcurrencyQueue {
  private readonly maxConcurrency = 4;
  private currentRunning = 0;
  private queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (this.currentRunning < this.maxConcurrency) {
      this.currentRunning++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      });
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      // Hand the slot directly to the next waiting request without decrementing
      next();
    } else {
      this.currentRunning = Math.max(0, this.currentRunning - 1);
    }
  }

  get runningCount(): number {
    return this.currentRunning;
  }
}

export const globalClockedQueue = new ConcurrencyQueue();

export interface CallClockedOptions {
  timeBudgetMs?: number;
  mode?: ClockedMode;
  apiKey?: string;
  recordingsDir?: string;
}

export async function callClocked<T>(
  endpoint: string,
  payload: unknown,
  options: CallClockedOptions = {}
): Promise<Call<T>> {
  const mode = options.mode ?? clockedMode();
  const { normalizedName, url } = normalizeEndpoint(endpoint);
  const hash = hashPayload(payload);
  const recDir =
    options.recordingsDir ?? path.join(process.cwd(), "recordings");
  const recordingFilePath = path.join(
    recDir,
    `${normalizedName}-${hash}.json`
  );

  // 1. Replay mode
  if (mode === "replay") {
    try {
      if (!fs.existsSync(recordingFilePath)) {
        return {
          ok: false,
          error: `Replay recording not found: ${normalizedName}-${hash}.json`,
          replayed: true,
        };
      }
      const raw = fs.readFileSync(recordingFilePath, "utf-8");
      const saved = JSON.parse(raw);
      return {
        ok: true,
        data: saved.data as T,
        credits: saved.credits ?? 0,
        replayed: true,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: `Failed to read recording: ${err instanceof Error ? err.message : String(err)}`,
        replayed: true,
      };
    }
  }

  // 2. Live or Record mode: requires API key
  const apiKey = (options.apiKey ?? process.env.CLOCKED_API_KEY)?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "Missing CLOCKED_API_KEY for live/record call",
      replayed: false,
    };
  }

  // Queue to limit concurrency to 4
  const release = await globalClockedQueue.acquire();

  try {
    const idempotencyKey = randomUUID();
    const startTime = Date.now();
    const timeBudgetMs = options.timeBudgetMs ?? 70_000;
    const maxAttempts = 4;
    let attempt = 0;
    let lastError = "Request failed";
    let lastStatus: number | undefined;

    while (attempt < maxAttempts) {
      attempt++;
      const timeRemaining = timeBudgetMs - (Date.now() - startTime);
      if (timeRemaining <= 0) {
        return {
          ok: false,
          error: `Time budget exceeded (${timeBudgetMs}ms) after ${attempt - 1} attempts. Last: ${lastError}`,
          status: lastStatus,
          replayed: false,
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), Math.min(timeRemaining, 65_000));

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const status = response.status;
        lastStatus = status;

        if (response.ok) {
          const creditsHeader = response.headers.get("x-clocked-credits");
          const credits = creditsHeader ? parseInt(creditsHeader, 10) || 1 : 1;
          const data = (await response.json()) as T;

          // Record if in record mode
          if (mode === "record") {
            try {
              if (!fs.existsSync(recDir)) {
                fs.mkdirSync(recDir, { recursive: true });
              }
              fs.writeFileSync(
                recordingFilePath,
                JSON.stringify({ endpoint: normalizedName, payload, data, credits }, null, 2),
                "utf-8"
              );
            } catch (writeErr) {
              console.error("Failed to write recording:", writeErr);
            }
          }

          return {
            ok: true,
            data,
            credits,
            replayed: false,
          };
        }

        // Handle error responses
        let errJson: { error?: string; retryAsNew?: boolean } | null = null;
        try {
          errJson = await response.json();
        } catch {
          // not json
        }

        const errorMsg =
          errJson?.error || `HTTP ${status}: ${response.statusText}`;
        lastError = errorMsg;

        // Stop immediately if retryAsNew is true
        if (errJson?.retryAsNew) {
          return {
            ok: false,
            error: `${errorMsg} (retryAsNew)`,
            status,
            replayed: false,
          };
        }

        // Retry on 409, 429, 5xx
        const isTransient =
          status === 409 || status === 429 || (status >= 500 && status <= 599);

        if (!isTransient || attempt >= maxAttempts) {
          return {
            ok: false,
            error: errorMsg,
            status,
            replayed: false,
          };
        }

        // Bounded exponential backoff: 200ms, 400ms, 800ms
        const backoffMs = Math.min(200 * Math.pow(2, attempt - 1), 3000);
        const waitBudget = Math.min(backoffMs, timeBudgetMs - (Date.now() - startTime));
        if (waitBudget > 0) {
          await new Promise((res) => setTimeout(res, waitBudget));
        }
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);
        lastError =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr);

        if (attempt >= maxAttempts) {
          return {
            ok: false,
            error: `Network error: ${lastError}`,
            status: lastStatus,
            replayed: false,
          };
        }

        const backoffMs = Math.min(200 * Math.pow(2, attempt - 1), 2000);
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }

    return {
      ok: false,
      error: lastError,
      status: lastStatus,
      replayed: false,
    };
  } finally {
    release();
  }
}
