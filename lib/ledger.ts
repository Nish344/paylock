// lib/ledger.ts
import type { ExtractResponse, Span } from "./types";
import { codePointSlice } from "./spans";

export interface LedgerLine {
  item_code: string;
  description: string;
  billed: number;
  invoice_price_cents: number;
  ordered: number;
  po_price_cents: number;
  accepted: number;
  printed_amount_cents: number;
  recomputed_amount_cents: number;
  issues: string[];
}

export type LedgerRule =
  | "po_mismatch"
  | "unreadable"
  | "not_ordered"
  | "over_order"
  | "over_price"
  | "over_received"
  | "line_math"
  | "subtotal_math"
  | "total_math"
  | "tax";

export interface LedgerFinding {
  rule: LedgerRule;
  sentence: string;
}

export interface LedgerResult {
  lines: LedgerLine[];
  findings: LedgerFinding[];
  payableCents: number;
  used: {
    invoice: Span[];
    po: Span[];
    receipt: Span[];
  };
}

// ponytail: EU number format upgrade (support European decimals 1.240,50 etc.)
export function parseUsNumber(val: string): number | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;

  // European format uses comma as decimal separator: e.g. "1.240,50" or "10,50"
  if (/,\d{1,2}$/.test(trimmed)) {
    return null;
  }
  // Dot as thousands separator before a comma
  if (/\.\d{3},/.test(trimmed)) {
    return null;
  }

  // A valid US number field must be a coherent numeric expression.
  // Optional currency prefix, optional minus/parens, digits with optional commas/decimal, optional unit/percent suffix.
  // Strings like "12 (80 refused)" or "1280 (damaged)" must be rejected.
  const validPattern =
    /^(?:[-+]|\()?\s*(?:USD|\$)?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:\))?\s*(?:ea|each|lbs?|kg|cases?|box(?:es)?|packs?|units?|hrs?|hours?|%)?$/i;

  if (!validPattern.test(trimmed)) {
    return null;
  }

  const isNegative = trimmed.startsWith("-") || /^\(.*\)$/.test(trimmed);

  // Strip currency, units, parens, commas, symbols, leaving digits and dot
  const stripped = trimmed.replace(/[^0-9.]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(stripped)) {
    return null;
  }
  const num = parseFloat(stripped);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Percent agreed on the purchase order, or null when it never mentions tax. */
export function agreedTaxRate(poText: string): number | null {
  if (
    /\b(?:no\s+(?:sales\s+)?tax|tax\s*-?\s*exempt(?:ion)?|zero\s+(?:sales\s+)?tax|0%\s+tax)\b/i.test(
      poText
    )
  ) {
    return 0;
  }
  // Pattern 1: "tax: 5%", "sales tax rate: 5%", "tax @ 5%", "tax of 5%", "tax (5%)", "tax 5%"
  const afterMatch = poText.match(
    /\b(?:sales\s+)?tax(?:\s+rate)?\s*(?:[:=@]|\bat\b|\bof\b|\()?\s*(\d+(?:\.\d+)?)\s*%/i
  );
  // Pattern 2: "5% sales tax", "5% tax"
  const beforeMatch = poText.match(
    /(\d+(?:\.\d+)?)\s*%\s*(?:sales\s+)?tax\b/i
  );

  const match = afterMatch || beforeMatch;
  if (!match) return null;
  const rate = Number(match[1]);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return null;
  return rate;
}

export function parseMarkdownTableRows(text: string): Array<string[]> {
  const lines = text.split("\n");
  const rows: Array<string[]> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    // Skip separator lines like |---|---|
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length >= 2) {
      rows.push(cells);
    }
  }
  return rows;
}

interface SpanValue {
  value: string;
  span: Span;
}

export function verifySpan(
  text: string,
  field?: {
    value?: unknown;
    start?: number;
    end?: number;
  }
): SpanValue | null {
  if (
    !field ||
    typeof field.start !== "number" ||
    typeof field.end !== "number" ||
    field.start < 0 ||
    field.end < field.start
  ) {
    return null;
  }
  const slice = codePointSlice(text, field.start, field.end);
  const rawValue = String(field.value ?? "");
  if (slice !== rawValue) {
    return null;
  }
  return {
    value: slice,
    span: { start: field.start, end: field.end },
  };
}

export function buildLedger(
  invoiceExtract: ExtractResponse,
  poExtract: ExtractResponse,
  receiptExtract: ExtractResponse,
  invoiceText: string,
  poText: string,
  receiptText: string
): LedgerResult {
  const findings: LedgerFinding[] = [];
  const lines: LedgerLine[] = [];
  const used = {
    invoice: [] as Span[],
    po: [] as Span[],
    receipt: [] as Span[],
  };

  // 1. PO reference check
  const invPoRef = verifySpan(invoiceText, invoiceExtract.fields?.po_reference);
  const poNum = verifySpan(poText, poExtract.fields?.po_number);

  if (invPoRef && poNum) {
    if (invPoRef.value.trim() !== poNum.value.trim()) {
      findings.push({
        rule: "po_mismatch",
        sentence: `The invoice cites ${invPoRef.value.trim()}, but this purchase order is ${poNum.value.trim()}.`,
      });
    }
  }

  // 1b. Receiving note and PO internal arithmetic cross-checks
  const rnRows = parseMarkdownTableRows(receiptText);
  const rnTableAccepted = new Map<string, number>();
  if (rnRows.length > 1) {
    const header = rnRows[0];
    const colCode = header.findIndex((c) => /item\s*code|code/i.test(c));
    const colDelivered = header.findIndex((c) =>
      /delivered|received/i.test(c)
    );
    const colRefused = header.findIndex((c) =>
      /refused|returned|damaged/i.test(c)
    );
    const colAccepted = header.findIndex((c) => /accepted/i.test(c));

    if (
      colCode !== -1 &&
      colDelivered !== -1 &&
      colRefused !== -1 &&
      colAccepted !== -1
    ) {
      for (let i = 1; i < rnRows.length; i++) {
        const row = rnRows[i];
        const code = row[colCode] || `row ${i}`;
        const norm = normalizeCode(code);
        const del = parseUsNumber(row[colDelivered]);
        const ref = parseUsNumber(row[colRefused]);
        const acc = parseUsNumber(row[colAccepted]);

        if (del !== null && ref !== null && acc !== null) {
          const expected = del - ref;
          if (acc !== expected) {
            findings.push({
              rule: "line_math",
              sentence: `Receiving note for ${code}: delivered ${del} - refused ${ref} = ${expected}, but accepted is listed as ${acc}.`,
            });
          }
          if (norm) {
            rnTableAccepted.set(norm, expected);
          }
        }
      }
    }
  }

  const poRows = parseMarkdownTableRows(poText);
  if (poRows.length > 1) {
    const header = poRows[0];
    const colCode = header.findIndex((c) => /item\s*code|code/i.test(c));
    const colQty = header.findIndex((c) => /qty|quantity/i.test(c));
    const colPrice = header.findIndex((c) => /unit\s*price|price/i.test(c));
    const colAmt = header.findIndex((c) =>
      /amount|line\s*total|total/i.test(c)
    );

    if (
      colCode !== -1 &&
      colQty !== -1 &&
      colPrice !== -1 &&
      colAmt !== -1
    ) {
      for (let i = 1; i < poRows.length; i++) {
        const row = poRows[i];
        const code = row[colCode] || `row ${i}`;
        const qty = parseUsNumber(row[colQty]);
        const price = parseUsNumber(row[colPrice]);
        const amt = parseUsNumber(row[colAmt]);

        if (qty !== null && price !== null && amt !== null) {
          const expectedAmtCents = Math.round(qty * toCents(price));
          const printedAmtCents = toCents(amt);
          if (expectedAmtCents !== printedAmtCents) {
            findings.push({
              rule: "line_math",
              sentence: `Purchase order line math error for ${code}: ${qty} × $${price.toFixed(2)} = $${formatCents(expectedAmtCents)}, but PO says $${formatCents(printedAmtCents)}.`,
            });
          }
        }
      }
    }
  }

  // 2. Parse PO items
  interface PoItem {
    code: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    qtySpan?: Span;
    priceSpan?: Span;
  }
  const poItems = new Map<string, PoItem>();
  const poLinesItems = poExtract.fields?.lines?.items ?? [];

  for (const item of poLinesItems) {
    const codeSpan = verifySpan(poText, item.fields?.item_code);
    const descSpan = verifySpan(poText, item.fields?.description);
    const qtySpan = verifySpan(poText, item.fields?.quantity);
    const priceSpan = verifySpan(poText, item.fields?.unit_price);

    const code = codeSpan ? codeSpan.value.trim() : "";
    const normCode = normalizeCode(code);
    const desc = descSpan ? descSpan.value.trim() : "";
    const qtyNum = qtySpan ? parseUsNumber(qtySpan.value) : null;
    const priceNum = priceSpan ? parseUsNumber(priceSpan.value) : null;

    if (normCode) {
      poItems.set(normCode, {
        code,
        description: desc,
        quantity: qtyNum ?? 0,
        unitPriceCents: priceNum !== null ? toCents(priceNum) : 0,
        qtySpan: qtySpan?.span,
        priceSpan: priceSpan?.span,
      });
    }
  }

  // 3. Parse Receiving note items
  interface ReceiptItem {
    accepted: number;
    acceptedSpan?: Span;
  }
  const receiptItems = new Map<string, ReceiptItem[]>();
  const receiptLinesItems = receiptExtract.fields?.lines?.items ?? [];

  for (const item of receiptLinesItems) {
    const codeSpan = verifySpan(receiptText, item.fields?.item_code);
    const accSpan = verifySpan(receiptText, item.fields?.accepted);

    const code = codeSpan ? codeSpan.value.trim() : "";
    const normCode = normalizeCode(code);
    const accNum = accSpan ? parseUsNumber(accSpan.value) : null;

    if (normCode) {
      const expectedAcc = rnTableAccepted.get(normCode);
      if (
        expectedAcc !== undefined &&
        accNum !== null &&
        accNum !== expectedAcc
      ) {
        findings.push({
          rule: "line_math",
          sentence: `Extracted dock count (${accNum}) does not match receiving note calculation (${expectedAcc}) for ${code || normCode}.`,
        });
      }

      const list = receiptItems.get(normCode) ?? [];
      list.push({
        accepted: accNum ?? 0,
        acceptedSpan: accSpan?.span,
      });
      receiptItems.set(normCode, list);
    }
  }

  // 4. Parse Invoice lines
  const invoiceLinesItems = invoiceExtract.fields?.lines?.items ?? [];
  if (invoiceLinesItems.length === 0) {
    findings.push({
      rule: "unreadable",
      sentence: "Couldn't read any lines on the invoice.",
    });
  }

  let sumLinesCents = 0;

  for (const item of invoiceLinesItems) {
    const issues: string[] = [];
    const codeSpan = verifySpan(invoiceText, item.fields?.item_code);
    const descSpan = verifySpan(invoiceText, item.fields?.description);
    const qtySpan = verifySpan(invoiceText, item.fields?.quantity);
    const priceSpan = verifySpan(invoiceText, item.fields?.unit_price);
    const amtSpan = verifySpan(invoiceText, item.fields?.amount);

    const code = codeSpan ? codeSpan.value.trim() : "";
    const normCode = normalizeCode(code);
    const desc = descSpan ? descSpan.value.trim() : code;

    const billedNum = qtySpan ? parseUsNumber(qtySpan.value) : null;
    const priceNum = priceSpan ? parseUsNumber(priceSpan.value) : null;
    const amtNum = amtSpan ? parseUsNumber(amtSpan.value) : null;

    if (
      !codeSpan ||
      !qtySpan ||
      billedNum === null ||
      !priceSpan ||
      priceNum === null ||
      !amtSpan ||
      amtNum === null
    ) {
      findings.push({
        rule: "unreadable",
        sentence: `Couldn't read an invoice line (${code || "unknown"}).`,
      });
      issues.push("unreadable");
    }

    const billed = billedNum ?? 0;
    const invPriceCents = priceNum !== null ? toCents(priceNum) : 0;
    const printedAmtCents = amtNum !== null ? toCents(amtNum) : 0;
    const recomputedAmtCents = Math.round(billed * invPriceCents);
    sumLinesCents += recomputedAmtCents;

    if (qtySpan) used.invoice.push(qtySpan.span);
    if (priceSpan) used.invoice.push(priceSpan.span);
    if (amtSpan) used.invoice.push(amtSpan.span);

    // Match with PO
    const poMatch = poItems.get(normCode);
    let ordered = 0;
    let poPriceCents = 0;

    if (!poMatch) {
      findings.push({
        rule: "not_ordered",
        sentence: `${desc} is billed but isn't on the purchase order.`,
      });
      issues.push("not_ordered");
    } else {
      ordered = poMatch.quantity;
      poPriceCents = poMatch.unitPriceCents;
      if (poMatch.priceSpan) used.po.push(poMatch.priceSpan);
      if (poMatch.qtySpan) used.po.push(poMatch.qtySpan);

      if (billed > ordered) {
        findings.push({
          rule: "over_order",
          sentence: `${desc}: billed ${billed}, the PO agreed ${ordered}.`,
        });
        issues.push("over_order");
      }

      if (invPriceCents > poPriceCents) {
        findings.push({
          rule: "over_price",
          sentence: `${desc}: billed at $${(invPriceCents / 100).toFixed(2)} each, the PO agreed $${(poPriceCents / 100).toFixed(2)}.`,
        });
        issues.push("over_price");
      }
    }

    // Match with Receiving note
    const rnMatches = receiptItems.get(normCode) ?? [];
    let accepted = 0;
    for (const r of rnMatches) {
      accepted += r.accepted;
      if (r.acceptedSpan) used.receipt.push(r.acceptedSpan);
    }

    if (billed > accepted) {
      findings.push({
        rule: "over_received",
        sentence: `${desc}: billed ${billed}, the dock accepted ${accepted}.`,
      });
      issues.push("over_received");
    }

    // Line math check
    if (printedAmtCents !== recomputedAmtCents) {
      findings.push({
        rule: "line_math",
        sentence: `${desc}: ${billed} × $${(invPriceCents / 100).toFixed(2)} = $${(recomputedAmtCents / 100).toFixed(2)}, the invoice says $${(printedAmtCents / 100).toFixed(2)}.`,
      });
      issues.push("line_math");
    }

    lines.push({
      item_code: code,
      description: desc,
      billed,
      invoice_price_cents: invPriceCents,
      ordered,
      po_price_cents: poPriceCents,
      accepted,
      printed_amount_cents: printedAmtCents,
      recomputed_amount_cents: recomputedAmtCents,
      issues,
    });
  }

  // Same code on two lines: 24 and 6 each pass a dock count of 24. The sum does not.
  const billedByCode = new Map<
    string,
    {
      desc: string;
      billed: number;
      accepted: number;
      ordered: number;
      indexes: number[];
    }
  >();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = normalizeCode(line.item_code);
    if (!key || line.issues.includes("unreadable")) continue;
    const group = billedByCode.get(key) ?? {
      desc: line.description,
      billed: 0,
      accepted: line.accepted,
      ordered: line.ordered,
      indexes: [],
    };
    group.billed += line.billed;
    group.indexes.push(i);
    billedByCode.set(key, group);
  }
  for (const group of billedByCode.values()) {
    const oneLineAlreadyOverReceived = group.indexes.some(
      (i) => lines[i].billed > group.accepted
    );
    if (!oneLineAlreadyOverReceived && group.billed > group.accepted) {
      findings.push({
        rule: "over_received",
        sentence: `${group.desc}: billed ${group.billed} across ${group.indexes.length} lines, the dock accepted ${group.accepted}.`,
      });
      for (const i of group.indexes) lines[i].issues.push("over_received");
    }

    const oneLineAlreadyOverOrder = group.indexes.some(
      (i) => lines[i].billed > group.ordered
    );
    if (!oneLineAlreadyOverOrder && group.billed > group.ordered) {
      findings.push({
        rule: "over_order",
        sentence: `${group.desc}: billed ${group.billed} across ${group.indexes.length} lines, the PO agreed ${group.ordered}.`,
      });
      for (const i of group.indexes) lines[i].issues.push("over_order");
    }
  }

  // 5. Subtotal and Total checks
  const subtotalSpan = verifySpan(
    invoiceText,
    invoiceExtract.fields?.subtotal
  );
  const taxSpan = verifySpan(invoiceText, invoiceExtract.fields?.tax);
  const totalSpan = verifySpan(invoiceText, invoiceExtract.fields?.total);

  if (subtotalSpan) used.invoice.push(subtotalSpan.span);
  if (taxSpan) used.invoice.push(taxSpan.span);
  if (totalSpan) used.invoice.push(totalSpan.span);

  const subtotalNum = subtotalSpan ? parseUsNumber(subtotalSpan.value) : null;
  const taxNum = taxSpan ? parseUsNumber(taxSpan.value) : 0;
  const totalNum = totalSpan ? parseUsNumber(totalSpan.value) : null;

  const taxCents = taxNum !== null ? toCents(taxNum) : 0;
  const agreedRate = agreedTaxRate(poText);
  let payableTaxCents = taxCents;
  if (agreedRate === null) {
    if (taxCents > 0) {
      findings.push({
        rule: "tax",
        sentence: `The invoice charges $${formatCents(taxCents)} tax, and the purchase order doesn't agree a tax.`,
      });
      payableTaxCents = 0;
    }
  } else {
    const expectedTaxCents = Math.round((sumLinesCents * agreedRate) / 100);
    if (Math.abs(taxCents - expectedTaxCents) > 1) {
      findings.push({
        rule: "tax",
        sentence: `Sales tax is $${formatCents(taxCents)}; at the purchase order's ${agreedRate}% that is $${formatCents(expectedTaxCents)}.`,
      });
      payableTaxCents = expectedTaxCents;
    }
  }
  const payableCents = sumLinesCents + payableTaxCents;
  const invoiceTotalCents = sumLinesCents + taxCents;

  if (!subtotalSpan || subtotalNum === null) {
    findings.push({
      rule: "unreadable",
      sentence: "Couldn't read the invoice subtotal.",
    });
  } else {
    const printedSubtotalCents = toCents(subtotalNum);
    if (printedSubtotalCents !== sumLinesCents) {
      findings.push({
        rule: "subtotal_math",
        sentence: `The lines add up to $${formatCents(sumLinesCents)}; the invoice subtotal says $${formatCents(printedSubtotalCents)}.`,
      });
    }
  }

  if (!totalSpan || totalNum === null) {
    findings.push({
      rule: "unreadable",
      sentence: "Couldn't read the invoice total.",
    });
  } else {
    const printedTotalCents = toCents(totalNum);
    if (printedTotalCents !== invoiceTotalCents) {
      findings.push({
        rule: "total_math",
        sentence: `Recomputed total is $${formatCents(invoiceTotalCents)}; the invoice asks for $${formatCents(printedTotalCents)}.`,
      });
    }
  }

  return {
    lines,
    findings,
    payableCents,
    used,
  };
}

