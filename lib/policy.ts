// lib/policy.ts
import type {
  Call,
  GuardResponse,
  ProtectResponse,
  ExtractResponse,
  CompareResponse,
  DecideResponse,
  FillResponse,
  VerifyResponse,
  VerifyClaim,
} from "./types";
import type { LedgerResult } from "./ledger";
import type { ButtonVerdict } from "./fixtures";

export type ReasonTag =
  | "ledger"
  | "guard"
  | "compare"
  | "verify"
  | "decide"
  | "system";

export interface PolicyReason {
  tag: ReasonTag;
  text: string;
}

export interface ChecksBundle {
  guard: Call<GuardResponse>;
  protect: Call<ProtectResponse>;
  invoiceExtract: Call<ExtractResponse>;
  poExtract: Call<ExtractResponse>;
  receiptExtract: Call<ExtractResponse>;
  compare: Call<CompareResponse>;
  decide: Call<DecideResponse>;
  fill: Call<FillResponse>;
  claimCheck?: Call<VerifyResponse>;
  noteCheck?: Call<VerifyResponse>;
}

export interface PolicyDecision {
  modelRecommendation?: {
    choice: string;
    probability: number;
  };
  button: ButtonVerdict;
  reasons: PolicyReason[];
  overruled: boolean;
  payableCents?: number;
  totalCredits: number;
}

/**
 * Returns claims that were counted and neither supported nor not_a_claim.
 */
export function unsupported(claims: VerifyClaim[] = []): VerifyClaim[] {
  return claims.filter(
    (c) => c.counted && c.verdict !== "supported" && c.verdict !== "not_a_claim"
  );
}

const SENSITIVE_KEYWORDS =
  /\b(?:bank|account|routing|iban|swift|bic|wire|deposit|transit|sort\s*code|aba|change|changed|effective|switch|redirect|notice|attention|new\s+bank)\b|[0-9]{4,}|[█■]/i;

const ROUTINE_PATTERNS = [
  /^(?:thank\s+you(?:\s+for\s+your\s+(?:business|order))?|thanks)\.?$/i,
  /^(?:(?:(?:payment\s+)?terms?\s*:\s*)?(?:net\s+\d{1,3}(?:\s+days)?|due\s+(?:on|upon)\s+receipt)|payment\s+due\s+(?:on|upon)\s+receipt)\.?$/i,
  /^(?:please\s+)?remit(?:tance)?(?:\s+payment)?\s+to\s+[A-Za-z0-9&.,' -]+$/i,
];

/** Payment terms, a thank-you, or "remit to <vendor>". A remit-to account number, bank details, or change notice is NOT routine. */
export function isRoutineInvoiceLine(claim: string): boolean {
  if (SENSITIVE_KEYWORDS.test(claim)) {
    return false;
  }
  const parts = claim
    .split(/(?<=[.!])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((part) => ROUTINE_PATTERNS.some((pat) => pat.test(part)))
  );
}

export interface InvoiceConflictFormatted {
  quoteInvoice: string;
  quoteOther: string;
  otherDoc: string;
  sentence: string;
  summary: string;
}

const ITEM_CODE = /\b[A-Z]{2,}-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/;

/** One readable line from a Compare passage, which can be a whole document. */
export function shortQuote(quote: string, near = ""): string {
  const lines = quote.split("\n").map((l) => l.trim().replace(/^\|\s*|\s*\|$/g, "")).filter(Boolean);
  const code = near.match(ITEM_CODE)?.[0];
  const line = (code && lines.find((l) => l.includes(code))) || lines[0] || "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/**
 * Extracts Compare conflicts involving the invoice document.
 * Conflicts between PO and receiving note are ignored.
 */
export function invoiceConflicts(
  compare?: CompareResponse
): InvoiceConflictFormatted[] {
  if (!compare?.pairs) return [];
  const results: InvoiceConflictFormatted[] = [];

  for (const pair of compare.pairs) {
    const isAInvoice = pair.a === "invoice";
    const isBInvoice = pair.b === "invoice";

    if (!isAInvoice && !isBInvoice) {
      continue; // Ignore conflicts between PO and receiving note
    }

    const otherDocId = isAInvoice ? pair.b : pair.a;
    const otherDocLabel =
      otherDocId === "purchase-order"
        ? "the purchase order"
        : otherDocId === "receiving-note"
          ? "the receiving note"
          : otherDocId;

    const conflicts = pair.conflicts ?? [];
    for (const c of conflicts) {
      const invPassage = isAInvoice ? c.a : c.b;
      const otherPassage = isAInvoice ? c.b : c.a;

      const quoteInvoice = invPassage?.quote?.trim() ?? "";
      const quoteOther = otherPassage?.quote?.trim() ?? "";

      results.push({
        quoteInvoice,
        quoteOther,
        otherDoc: otherDocLabel,
        sentence: `The invoice says "${quoteInvoice}"; ${otherDocLabel} says "${quoteOther}".`,
        summary: `The invoice says "${shortQuote(quoteInvoice)}"; ${otherDocLabel} says "${shortQuote(quoteOther, quoteInvoice)}".`,
      });
    }
  }

  return results;
}

export function decidePay(
  checks: ChecksBundle,
  ledger?: LedgerResult
): PolicyDecision {
  let totalCredits = 0;
  const namedChecks: Array<{ name: string; call?: Call<unknown> }> = [
    { name: "Guard", call: checks.guard },
    { name: "Protect", call: checks.protect },
    { name: "Invoice Extract", call: checks.invoiceExtract },
    { name: "PO Extract", call: checks.poExtract },
    { name: "Receipt Extract", call: checks.receiptExtract },
    { name: "Compare", call: checks.compare },
    { name: "Decide", call: checks.decide },
    { name: "Fill", call: checks.fill },
    { name: "Vendor Verify", call: checks.claimCheck },
    { name: "Clerk Note Verify", call: checks.noteCheck },
  ];

  for (const { call } of namedChecks) {
    if (call?.ok) {
      totalCredits += call.credits;
    }
  }

  const reasons: PolicyReason[] = [];

  // 1. Failed calls
  for (const { name, call } of namedChecks) {
    if (call && !call.ok) {
      reasons.push({
        tag: "system",
        text: `${name} failed: ${call.error}. Paylock holds rather than guesses.`,
      });
    }
  }

  // If ledger is missing but extracts were called
  if (!ledger) {
    reasons.push({
      tag: "system",
      text: "Ledger could not be constructed. Paylock holds rather than guesses.",
    });
  }

  // 2. Ledger findings
  if (ledger) {
    for (const finding of ledger.findings) {
      reasons.push({
        tag: "ledger",
        text: finding.sentence,
      });
    }
  }

  // 3. Guard verdict
  if (checks.guard?.ok) {
    const guardData = checks.guard.data;
    if (guardData.verdict !== "benign") {
      reasons.push({
        tag: "guard",
        text: `The invoice contains instructions aimed at an automated reviewer (${guardData.category || "instruction override"}). They were removed before Compare, Decide, or Fill read the invoice.`,
      });
    }
  }

  // 4. Compare conflicts involving invoice
  if (checks.compare?.ok) {
    const conflicts = invoiceConflicts(checks.compare.data);
    for (const c of conflicts) {
      reasons.push({
        tag: "compare",
        text: c.summary,
      });
    }
  }

  // 5. Vendor claim Verify failures
  if (checks.claimCheck?.ok) {
    const unbackedClaims = unsupported(checks.claimCheck.data.claims).filter(
      (c) => !isRoutineInvoiceLine(c.claim)
    );
    for (const c of unbackedClaims) {
      reasons.push({
        tag: "verify",
        text: `Vendor claim not backed by the PO or receiving note: "${c.claim}"`,
      });
    }
  }

  // 6. Clerk note Verify failures
  if (checks.noteCheck?.ok) {
    const unbackedNotes = unsupported(checks.noteCheck.data.claims);
    for (const c of unbackedNotes) {
      reasons.push({
        tag: "verify",
        text: `Clerk note sentence not supported by the documents: "${c.claim}"`,
      });
    }
  }

  // Determine model recommendation
  let modelRecommendation:
    | {
        choice: string;
        probability: number;
      }
    | undefined;

  if (checks.decide?.ok) {
    const rec = checks.decide.data.answers?.recommendation;
    if (rec?.choice) {
      const prob = rec.probabilities?.[rec.choice] ?? rec.confidence ?? 0;
      modelRecommendation = {
        choice: rec.choice.toUpperCase(),
        probability: prob,
      };
    }
  }

  // Decide button rules
  let button: ButtonVerdict = "HOLD";
  let overruled = false;
  let payableCents: number | undefined;

  if (!modelRecommendation) {
    // Decide failed or gave no choice -> HOLD
    button = "HOLD";
  } else if (modelRecommendation.choice === "REJECT") {
    button = "REJECT";
    const pct = Math.round(modelRecommendation.probability * 100);
    reasons.unshift({
      tag: "decide",
      text: `The model recommends REJECT (${pct}%).`,
    });
  } else if (modelRecommendation.choice === "HOLD") {
    button = "HOLD";
    const pct = Math.round(modelRecommendation.probability * 100);
    reasons.unshift({
      tag: "decide",
      text: `The model recommends HOLD (${pct}%).`,
    });
  } else if (modelRecommendation.choice === "PAY") {
    if (modelRecommendation.probability < 0.7) {
      const pct = Math.round(modelRecommendation.probability * 100);
      reasons.push({
        tag: "decide",
        text: `The model leans PAY but is only ${pct}% sure.`,
      });
      button = "HOLD";
      overruled = true;
    } else {
      // Model says PAY with confidence >= 0.7
      if (reasons.length === 0 && ledger) {
        button = "PAY";
        payableCents = ledger.payableCents;
      } else {
        button = "HOLD";
        overruled = true;
      }
    }
  }

  return {
    modelRecommendation,
    button,
    reasons,
    overruled,
    payableCents,
    totalCredits,
  };
}

