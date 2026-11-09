// lib/ledger.test.ts
import { describe, it, expect } from "vitest";
import { FIXTURES, getFixture } from "./fixtures";
import { buildLedger, parseUsNumber } from "./ledger";
import { find, codePointLength } from "./spans";
import type { ExtractResponse } from "./types";

/**
 * Helper to build an exact ExtractResponse for a fixture invoice
 */
function extractFixtureInvoice(text: string): ExtractResponse {
  const fields: ExtractResponse["fields"] = {};

  // PO Reference
  const poMatch = text.match(/PO Reference:\s*([A-Z0-9-]+)/);
  if (poMatch) {
    const span = find(text, poMatch[1]);
    if (span) {
      fields.po_reference = { value: poMatch[1], ...span };
    }
  }

  // Lines
  const lineRegex =
    /\|\s*([A-Z0-9-]+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([\d,.]+)\s*\|\s*([\d,.]+)\s*\|/g;
  const items: any[] = [];
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const itemCode = match[1];
    const desc = match[2];
    const qty = match[3];
    const price = match[4];
    const amt = match[5];

    // Find full match span to locate inner values precisely
    const fullSpan = find(text, fullMatch);
    if (!fullSpan) continue;

    // Find values inside the full match
    const codeSpan = find(fullMatch, itemCode);
    const descSpan = find(fullMatch, desc);
    const qtySpan = find(fullMatch, qty);
    const priceSpan = find(fullMatch, price);
    const amtSpan = find(fullMatch, amt);

    if (codeSpan && descSpan && qtySpan && priceSpan && amtSpan) {
      items.push({
        start: fullSpan.start,
        end: fullSpan.end,
        fields: {
          item_code: {
            value: itemCode,
            start: fullSpan.start + codeSpan.start,
            end: fullSpan.start + codeSpan.end,
          },
          description: {
            value: desc,
            start: fullSpan.start + descSpan.start,
            end: fullSpan.start + descSpan.end,
          },
          quantity: {
            value: qty,
            start: fullSpan.start + qtySpan.start,
            end: fullSpan.start + qtySpan.end,
          },
          unit_price: {
            value: price,
            start: fullSpan.start + priceSpan.start,
            end: fullSpan.start + priceSpan.end,
          },
          amount: {
            value: amt,
            start: fullSpan.start + amtSpan.start,
            end: fullSpan.start + amtSpan.end,
          },
        },
      });
    }
  }
  fields.lines = { items };

  // Subtotal
  const subMatch = text.match(/Subtotal:\s*USD\s*([\d,.]+)/);
  if (subMatch) {
    const span = find(text, subMatch[1]);
    if (span) fields.subtotal = { value: subMatch[1], ...span };
  }

  // Tax
  const taxMatch = text.match(/Tax:\s*([\d,.]+)/);
  if (taxMatch) {
    const span = find(text, taxMatch[1]);
    if (span) fields.tax = { value: taxMatch[1], ...span };
  }

  // Total
  const totalMatch = text.match(/Total due:\s*USD\s*([\d,.]+)/);
  if (totalMatch) {
    // Find the second occurrence of this amount if it equals subtotal
    const firstOccur = find(text, totalMatch[1]);
    let span = firstOccur;
    if (firstOccur && subMatch && subMatch[1] === totalMatch[1]) {
      const rest = text.slice(firstOccur.end);
      const secondOccur = find(rest, totalMatch[1]);
      if (secondOccur) {
        span = {
          start: firstOccur.end + secondOccur.start,
          end: firstOccur.end + secondOccur.end,
        };
      }
    }
    if (span) fields.total = { value: totalMatch[1], ...span };
  }

  return { fields };
}

function extractFixturePo(text: string): ExtractResponse {
  const fields: ExtractResponse["fields"] = {};

  const poMatch = text.match(/PURCHASE ORDER:\s*([A-Z0-9-]+)/);
  if (poMatch) {
    const span = find(text, poMatch[1]);
    if (span) fields.po_number = { value: poMatch[1], ...span };
  }

  const lineRegex =
    /\|\s*([A-Z0-9-]+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([\d,.]+)\s*\|/g;
  const items: any[] = [];
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const itemCode = match[1];
    const desc = match[2];
    const qty = match[3];
    const price = match[4];

    const fullSpan = find(text, fullMatch);
    if (!fullSpan) continue;

    const codeSpan = find(fullMatch, itemCode);
    const descSpan = find(fullMatch, desc);
    const qtySpan = find(fullMatch, qty);
    const priceSpan = find(fullMatch, price);

    if (codeSpan && descSpan && qtySpan && priceSpan) {
      items.push({
        start: fullSpan.start,
        end: fullSpan.end,
        fields: {
          item_code: {
            value: itemCode,
            start: fullSpan.start + codeSpan.start,
            end: fullSpan.start + codeSpan.end,
          },
          description: {
            value: desc,
            start: fullSpan.start + descSpan.start,
            end: fullSpan.start + descSpan.end,
          },
          quantity: {
            value: qty,
            start: fullSpan.start + qtySpan.start,
            end: fullSpan.start + qtySpan.end,
          },
          unit_price: {
            value: price,
            start: fullSpan.start + priceSpan.start,
            end: fullSpan.start + priceSpan.end,
          },
        },
      });
    }
  }
  fields.lines = { items };

  return { fields };
}

function extractFixtureReceipt(text: string): ExtractResponse {
  const fields: ExtractResponse["fields"] = {};

  const poMatch = text.match(/PO Reference:\s*([A-Z0-9-]+)/);
  if (poMatch) {
    const span = find(text, poMatch[1]);
    if (span) fields.po_reference = { value: poMatch[1], ...span };
  }

  // | Item Code | Description | Delivered | Refused | Accepted |
  const lineRegex =
    /\|\s*([A-Z0-9-]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/g;
  const items: any[] = [];
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const itemCode = match[1];
    const accepted = match[5];

    const fullSpan = find(text, fullMatch);
    if (!fullSpan) continue;

    const codeSpan = find(fullMatch, itemCode);
    // Find accepted in the fullMatch
    const lastPipe = fullMatch.lastIndexOf("|");
    const secondLastPipe = fullMatch.lastIndexOf("|", lastPipe - 1);
    const acceptedPart = fullMatch.slice(secondLastPipe + 1, lastPipe);
    const accSpan = find(acceptedPart, accepted);

    if (codeSpan && accSpan) {
      items.push({
        start: fullSpan.start,
        end: fullSpan.end,
        fields: {
          item_code: {
            value: itemCode,
            start: fullSpan.start + codeSpan.start,
            end: fullSpan.start + codeSpan.end,
          },
          accepted: {
            value: accepted,
            start: fullSpan.start + secondLastPipe + 1 + accSpan.start,
            end: fullSpan.start + secondLastPipe + 1 + accSpan.end,
          },
        },
      });
    }
  }
  fields.lines = { items };

  return { fields };
}

describe("lib/ledger", () => {
  it("1. Clean produce: no findings, payable 668,000 cents, 9 used spans on invoice", () => {
    const f = getFixture("clean-produce")!;
    const invEx = extractFixtureInvoice(f.invoice);
    const poEx = extractFixturePo(f.po);
    const rnEx = extractFixtureReceipt(f.receipt);

    const res = buildLedger(invEx, poEx, rnEx, f.invoice, f.po, f.receipt);

    expect(res.findings).toEqual([]);
    expect(res.payableCents).toBe(668_000);
    // 2 lines * 3 numbers + subtotal + tax + total = 9 used spans
    expect(res.used.invoice).toHaveLength(9);
  });

  it("2. Dock count: exactly one finding 'Roma tomatoes, 25 lb case: billed 500, the dock accepted 420.'", () => {
    const f = getFixture("dock-count")!;
    const invEx = extractFixtureInvoice(f.invoice);
    const poEx = extractFixturePo(f.po);
    const rnEx = extractFixtureReceipt(f.receipt);

    const res = buildLedger(invEx, poEx, rnEx, f.invoice, f.po, f.receipt);

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toEqual({
      rule: "over_received",
      sentence: "Roma tomatoes, 25 lb case: billed 500, the dock accepted 420.",
    });
  });

  it("3. Partial delivery: no findings, payable 572,800", () => {
    const f = getFixture("partial-delivery")!;
    const invEx = extractFixtureInvoice(f.invoice);
    const poEx = extractFixturePo(f.po);
    const rnEx = extractFixtureReceipt(f.receipt);

    const res = buildLedger(invEx, poEx, rnEx, f.invoice, f.po, f.receipt);

    expect(res.findings).toEqual([]);
    expect(res.payableCents).toBe(572_800);
  });

  it("4. Bad math: two total_math/subtotal_math findings, second reads 'Recomputed total is $1,198.00; the invoice asks for $1,289.00.'", () => {
    const f = getFixture("bad-math")!;
    const invEx = extractFixtureInvoice(f.invoice);
    const poEx = extractFixturePo(f.po);
    const rnEx = extractFixtureReceipt(f.receipt);

    const res = buildLedger(invEx, poEx, rnEx, f.invoice, f.po, f.receipt);

    expect(res.findings).toHaveLength(2);
    expect(res.findings[0]).toEqual({
      rule: "subtotal_math",
      sentence: "The lines add up to $1,198.00; the invoice subtotal says $1,289.00.",
    });
    expect(res.findings[1]).toEqual({
      rule: "total_math",
      sentence: "Recomputed total is $1,198.00; the invoice asks for $1,289.00.",
    });
  });

  it("5. Price creep: exactly one over_price finding", () => {
    const f = getFixture("price-creep")!;
    const invEx = extractFixtureInvoice(f.invoice);
    const poEx = extractFixturePo(f.po);
    const rnEx = extractFixtureReceipt(f.receipt);

    const res = buildLedger(invEx, poEx, rnEx, f.invoice, f.po, f.receipt);

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toEqual({
      rule: "over_price",
      sentence: "Heavy cream, 1 gal: billed at $15.10 each, the PO agreed $14.20.",
    });
  });

  it("6. Wrong buyer: findings in order are po_mismatch, not_ordered, over_received, not_ordered, over_received", () => {
    const f = getFixture("wrong-buyer")!;
    const invEx = extractFixtureInvoice(f.invoice);
    const poEx = extractFixturePo(f.po);
    const rnEx = extractFixtureReceipt(f.receipt);

    const res = buildLedger(invEx, poEx, rnEx, f.invoice, f.po, f.receipt);

    expect(res.findings.map((finding) => finding.rule)).toEqual([
      "po_mismatch",
      "not_ordered",
      "over_received",
      "not_ordered",
      "over_received",
    ]);
  });

  it("7. A quantity span shifted by one character causes an 'unreadable' finding for BP-TOM-25", () => {
    const f = getFixture("clean-produce")!;
    const invEx = extractFixtureInvoice(f.invoice);
    const poEx = extractFixturePo(f.po);
    const rnEx = extractFixtureReceipt(f.receipt);

    // Shift quantity span by 1 character
    const tomItem = invEx.fields.lines.items![0];
    tomItem.fields.quantity.start += 1;
    tomItem.fields.quantity.end += 1;

    const res = buildLedger(invEx, poEx, rnEx, f.invoice, f.po, f.receipt);

    const unreadable = res.findings.find((x) => x.rule === "unreadable");
    expect(unreadable).toBeDefined();
    expect(unreadable?.sentence).toBe("Couldn't read an invoice line (BP-TOM-25).");
  });

  it("8. Number parsing handles accepted and refused formats correctly", () => {
    expect(parseUsNumber("5,950.00")).toBe(5950.0);
    expect(parseUsNumber("USD 6,680.00")).toBe(6680.0);
    expect(parseUsNumber("$11.90")).toBe(11.9);
    expect(parseUsNumber("420")).toBe(420);
    expect(parseUsNumber("1.240,50")).toBeNull();
    expect(parseUsNumber("1240,50")).toBeNull();
  });
});

