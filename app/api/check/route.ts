// app/api/check/route.ts
import { NextResponse } from "next/server";
import { runPaylock } from "@/lib/paylock";
import { clockedMode } from "@/lib/clocked";
import { FIXTURES } from "@/lib/fixtures";

export const maxDuration = 300;

// ponytail: this map lives on one server instance. Move it to a shared store
// if one address burns credits by hitting a fresh instance each time.
const CHECKS_PER_HOUR = 20;
const checksByIp = new Map<string, number[]>();

function overCheckLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (checksByIp.get(ip) ?? []).filter((at) => now - at < 3_600_000);
  if (recent.length >= CHECKS_PER_HOUR) {
    checksByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  checksByIp.set(ip, recent);
  return false;
}

export async function POST(req: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      {
        error:
          "Send an invoice, a purchase order and a receiving note, each under 20,000 characters.",
      },
      { status: 400 }
    );
  }

  const { invoice, po, receipt } = body ?? {};

  // Validation boundary
  if (
    typeof invoice !== "string" ||
    typeof po !== "string" ||
    typeof receipt !== "string" ||
    !invoice.trim() ||
    !po.trim() ||
    !receipt.trim() ||
    invoice.length > 20000 ||
    po.length > 20000 ||
    receipt.length > 20000
  ) {
    return NextResponse.json(
      {
        error:
          "Send an invoice, a purchase order and a receiving note, each under 20,000 characters.",
      },
      { status: 400 }
    );
  }

  const mode = clockedMode();

  if (mode !== "replay") {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (overCheckLimit(ip)) {
      return NextResponse.json(
        { error: "Too many checks from this network. Try again in an hour." },
        { status: 429 }
      );
    }
  }

  // In replay mode, enforce that inputs match one of the eight fixtures
  // ponytail: add auth and rate limiting before live keys on public endpoints
  if (mode === "replay") {
    const isFixtureMatch = FIXTURES.some(
      (f) =>
        f.invoice.trim() === invoice.trim() &&
        f.po.trim() === po.trim() &&
        f.receipt.trim() === receipt.trim()
    );

    if (!isFixtureMatch) {
      return NextResponse.json(
        {
          error:
            "This public demo replays the eight recorded cases. Clone the repo and add a Clocked API key to check your own documents.",
        },
        { status: 400 }
      );
    }
  }

  try {
    const result = await runPaylock(invoice, po, receipt, { mode });

    return NextResponse.json({
      outcome: result.decision,
      ...result,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: `Paylock error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}

