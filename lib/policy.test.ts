// lib/policy.test.ts
import { describe, it, expect } from "vitest";
import { decidePay, type ChecksBundle } from "./policy";
import type { LedgerResult } from "./ledger";

function makeCleanChecks(): ChecksBundle {
  return {
    guard: {
      ok: true,
      data: { verdict: "benign", injection: 0.01, category: "benign" },
      credits: 1,
      replayed: false,
    },
    protect: {
      ok: true,
      data: { entities: [] },
      credits: 1,
      replayed: false,
    },
    invoiceExtract: {
      ok: true,
      data: { fields: {} },
      credits: 2,
      replayed: false,
    },
    poExtract: {
      ok: true,
      data: { fields: {} },
      credits: 2,
      replayed: false,
    },
    receiptExtract: {
      ok: true,
      data: { fields: {} },
      credits: 2,
      replayed: false,
    },
    compare: {
      ok: true,
      data: { pairs: [] },
      credits: 3,
      replayed: false,
    },
    decide: {
      ok: true,
      data: {
        answers: {
          recommendation: {
            choice: "PAY",
            probabilities: { PAY: 0.95, HOLD: 0.03, REJECT: 0.02 },
          },
        },
      },
      credits: 2,
      replayed: false,
    },
    fill: {
      ok: true,
      data: { fields: {} },
      credits: 3,
      replayed: false,
    },
  };
}

function makeCleanLedger(): LedgerResult {
  return {
    lines: [],
    findings: [],
    payableCents: 668_000,
    used: { invoice: [], po: [], receipt: [] },
  };
}

describe("lib/policy", () => {
  it("1. Everything clean -> PAY, payable 668,000, credits summed", () => {
    const checks = makeCleanChecks();
    const ledger = makeCleanLedger();

    const decision = decidePay(checks, ledger);

    expect(decision.button).toBe("PAY");
    expect(decision.overruled).toBe(false);
    expect(decision.payableCents).toBe(668_000);
    expect(decision.reasons).toEqual([]);
    expect(decision.totalCredits).toBe(1 + 1 + 2 + 2 + 2 + 3 + 2 + 3); // 16
  });

  it("2. A ledger finding with Decide PAY -> HOLD and overruled, with ledger reason first", () => {
    const checks = makeCleanChecks();
    const ledger = makeCleanLedger();
    ledger.findings.push({
      rule: "over_received",
      sentence: "Roma tomatoes, 25 lb case: billed 500, the dock accepted 420.",
    });

    const decision = decidePay(checks, ledger);

    expect(decision.button).toBe("HOLD");
    expect(decision.overruled).toBe(true);
    expect(decision.payableCents).toBeUndefined();
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toEqual({
      tag: "ledger",
      text: "Roma tomatoes, 25 lb case: billed 500, the dock accepted 420.",
    });
  });

  it("3. One unsupported vendor claim -> HOLD, with exactly one verify reason", () => {
    const checks = makeCleanChecks();
    const ledger = makeCleanLedger();
    checks.claimCheck = {
      ok: true,
      data: {
        claims: [
          {
            claim: "Your head chef approved keeping all 500 cases by phone on 12 Oct.",
            verdict: "not_stated",
            counted: true,
          },
        ],
      },
      credits: 2,
      replayed: false,
    };

    const decision = decidePay(checks, ledger);

    expect(decision.button).toBe("HOLD");
    expect(decision.overruled).toBe(true);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toEqual({
      tag: "verify",
      text: 'Vendor claim not backed by the PO or receiving note: "Your head chef approved keeping all 500 cases by phone on 12 Oct."',
    });
  });

  it("4. One unsupported note sentence -> HOLD", () => {
    const checks = makeCleanChecks();
    const ledger = makeCleanLedger();
    checks.noteCheck = {
      ok: true,
      data: {
        claims: [
          {
            claim: "The chef gave phone approval to pay the invoice today.",
            verdict: "contradicted",
            counted: true,
          },
        ],
      },
      credits: 2,
      replayed: false,
    };

    const decision = decidePay(checks, ledger);

    expect(decision.button).toBe("HOLD");
    expect(decision.overruled).toBe(true);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0].tag).toBe("verify");
    expect(decision.reasons[0].text).toContain("Clerk note sentence not supported");
  });

  it("5. Decide REJECT at 80% -> REJECT, not overruled, decide reason first. Decide HOLD -> HOLD", () => {
    const checksReject = makeCleanChecks();
    checksReject.decide = {
      ok: true,
      data: {
        answers: {
          recommendation: {
            choice: "REJECT",
            probabilities: { REJECT: 0.8 },
          },
        },
      },
      credits: 2,
      replayed: false,
    };

    const decisionReject = decidePay(checksReject, makeCleanLedger());
    expect(decisionReject.button).toBe("REJECT");
    expect(decisionReject.overruled).toBe(false);
    expect(decisionReject.reasons[0]).toEqual({
      tag: "decide",
      text: "The model recommends REJECT (80%).",
    });

    const checksHold = makeCleanChecks();
    checksHold.decide = {
      ok: true,
      data: {
        answers: {
          recommendation: {
            choice: "HOLD",
            probabilities: { HOLD: 0.75 },
          },
        },
      },
      credits: 2,
      replayed: false,
    };

    const decisionHold = decidePay(checksHold, makeCleanLedger());
    expect(decisionHold.button).toBe("HOLD");
    expect(decisionHold.overruled).toBe(false);
    expect(decisionHold.reasons[0]).toEqual({
      tag: "decide",
      text: "The model recommends HOLD (75%).",
    });
  });

  it("6. PAY at 62% -> HOLD with decide reason", () => {
    const checks = makeCleanChecks();
    checks.decide = {
      ok: true,
      data: {
        answers: {
          recommendation: {
            choice: "PAY",
            probabilities: { PAY: 0.62 },
          },
        },
      },
      credits: 2,
      replayed: false,
    };

    const decision = decidePay(checks, makeCleanLedger());
    expect(decision.button).toBe("HOLD");
    expect(decision.overruled).toBe(true);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toEqual({
      tag: "decide",
      text: "The model leans PAY but is only 62% sure.",
    });
  });

  it("7. A failed Compare -> HOLD with a system reason. A failed Decide -> HOLD. No ledger -> HOLD", () => {
    // Failed Compare
    const checksFailedCompare = makeCleanChecks();
    checksFailedCompare.compare = {
      ok: false,
      error: "503 Service Unavailable",
    };
    const decCompare = decidePay(checksFailedCompare, makeCleanLedger());
    expect(decCompare.button).toBe("HOLD");
    expect(decCompare.reasons[0]).toEqual({
      tag: "system",
      text: "Compare failed: 503 Service Unavailable. Paylock holds rather than guesses.",
    });

    // Failed Decide
    const checksFailedDecide = makeCleanChecks();
    checksFailedDecide.decide = {
      ok: false,
      error: "500 Internal Server Error",
    };
    const decDecide = decidePay(checksFailedDecide, makeCleanLedger());
    expect(decDecide.button).toBe("HOLD");
    expect(decDecide.reasons[0].tag).toBe("system");

    // No ledger
    const decNoLedger = decidePay(makeCleanChecks(), undefined);
    expect(decNoLedger.button).toBe("HOLD");
    expect(decNoLedger.reasons[0].tag).toBe("system");
    expect(decNoLedger.reasons[0].text).toContain("Ledger could not be constructed");
  });

  it("8. Guard flagged -> HOLD with guard reason", () => {
    const checks = makeCleanChecks();
    checks.guard = {
      ok: true,
      data: {
        verdict: "injection",
        injection: 0.98,
        category: "instruction override",
      },
      credits: 1,
      replayed: false,
    };

    const decision = decidePay(checks, makeCleanLedger());
    expect(decision.button).toBe("HOLD");
    expect(decision.overruled).toBe(true);
    expect(decision.reasons[0]).toEqual({
      tag: "guard",
      text: "The invoice contains instructions aimed at an automated reviewer (instruction override). They were removed before any model read the invoice.",
    });
  });

  it("9. A PO-vs-receiving-note conflict alone -> still PAY. An invoice-vs-PO conflict -> HOLD, with the exact sentence", () => {
    // PO vs RN conflict only
    const checksPoRn = makeCleanChecks();
    checksPoRn.compare = {
      ok: true,
      data: {
        pairs: [
          {
            a: "purchase-order",
            b: "receiving-note",
            relation: "conflicting",
            conflicts: [
              {
                a: { document: "purchase-order", quote: "500", start: 0, end: 3 },
                b: { document: "receiving-note", quote: "420", start: 0, end: 3 },
              },
            ],
          },
        ],
      },
      credits: 3,
      replayed: false,
    };

    const decPoRn = decidePay(checksPoRn, makeCleanLedger());
    expect(decPoRn.button).toBe("PAY");
    expect(decPoRn.reasons).toEqual([]);

    // Invoice vs PO conflict
    const checksInvPo = makeCleanChecks();
    checksInvPo.compare = {
      ok: true,
      data: {
        pairs: [
          {
            a: "invoice",
            b: "purchase-order",
            relation: "conflicting",
            conflicts: [
              {
                a: { document: "invoice", quote: "60 ct case", start: 0, end: 10 },
                b: { document: "purchase-order", quote: "48 ct case", start: 0, end: 10 },
              },
            ],
          },
        ],
      },
      credits: 3,
      replayed: false,
    };

    const decInvPo = decidePay(checksInvPo, makeCleanLedger());
    expect(decInvPo.button).toBe("HOLD");
    expect(decInvPo.overruled).toBe(true);
    expect(decInvPo.reasons[0]).toEqual({
      tag: "compare",
      text: 'The invoice says "60 ct case"; the purchase order says "48 ct case".',
    });
  });
});

