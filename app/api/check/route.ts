// app/api/check/route.ts
import { NextResponse } from "next/server";
import { runPaylock } from "@/lib/paylock";
import { clockedMode } from "@/lib/clocked";
import { FIXTURES } from "@/lib/fixtures";

export const maxDuration = 300;

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

