"use client";

import React, { useState } from "react";
import { FIXTURES, type FixtureCase } from "@/lib/fixtures";
import { segments, type Mark, find } from "@/lib/spans";
import type { PaylockRunResult } from "@/lib/paylock";
import type { VerifyClaim } from "@/lib/types";

export default function PaylockPage() {
  const [selectedCaseId, setSelectedCaseId] = useState<string>("dock-count");
  const defaultFixture =
    FIXTURES.find((f) => f.id === "dock-count") || FIXTURES[0];

  const [invoice, setInvoice] = useState<string>(defaultFixture.invoice);
  const [po, setPo] = useState<string>(defaultFixture.po);
  const [receipt, setReceipt] = useState<string>(defaultFixture.receipt);

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<PaylockRunResult | null>(null);
  const [paidDemo, setPaidDemo] = useState<boolean>(false);

  const selectCase = (c: FixtureCase) => {
    setSelectedCaseId(c.id);
    setInvoice(c.invoice);
    setPo(c.po);
    setReceipt(c.receipt);
    setResult(null);
    setErrorMsg(null);
    setIsEditing(false);
    setPaidDemo(false);
  };

  const handleTextChange = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string
  ) => {
    setter(value);
    setSelectedCaseId(""); // Detach from fixed fixture
    setResult(null);
  };

  const runCheck = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setPaidDemo(false);

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice, po, receipt }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || `HTTP ${res.status}: Failed to run check`);
      } else {
        setResult(data);
        setIsEditing(false);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Build marks for Invoice
  const renderDocumentView = (
    text: string,
    marks: Mark[],
    emptyLabel: string
  ) => {
    if (!text.trim()) {
      return (
        <span className="text-zinc-600 italic text-sm">{emptyLabel}</span>
      );
    }
    const segs = segments(text, marks);
    return (
      <div className="font-mono text-xs whitespace-pre-wrap leading-relaxed select-text">
        {segs.map((seg, idx) => {
          if (!seg.mark) {
            return <span key={idx}>{seg.text}</span>;
          }
          const { kind, label } = seg.mark;
          if (kind === "used") {
            return (
              <mark
                key={idx}
                title={label || "Number read and verified by ledger"}
                className="bg-emerald-500/25 text-emerald-300 font-semibold px-0.5 rounded transition-colors"
              >
                {seg.text}
              </mark>
            );
          }
          if (kind === "removed") {
            return (
              <mark
                key={idx}
                title={label || "Instruction removed by Guard before review"}
                className="bg-rose-900/60 text-rose-300 line-through px-0.5 rounded border border-rose-700/50"
              >
                {seg.text}
              </mark>
            );
          }
          if (kind === "masked") {
            return (
              <span
                key={idx}
                title={label || "Masked bank details (Protect)"}
                className="bg-zinc-800 text-zinc-500 px-0.5 rounded select-none font-mono"
              >
                {seg.text}
              </span>
            );
          }
          if (kind === "unbacked") {
            return (
              <span
                key={idx}
                title={label || "Vendor claim not backed by PO or receiving note"}
                className="line-through decoration-rose-400 decoration-2 text-rose-300 bg-rose-950/40 px-0.5 rounded"
              >
                {seg.text}
              </span>
            );
          }
          if (kind === "backed") {
            return (
              <span
                key={idx}
                title={label || "Vendor claim backed by buyer records"}
                className="underline decoration-dotted decoration-emerald-400 text-emerald-300 bg-emerald-950/30 px-0.5 rounded"
              >
                {seg.text}
              </span>
            );
          }
          return <span key={idx}>{seg.text}</span>;
        })}
      </div>
    );
  };

  // Compile Invoice Marks
  const invoiceMarks: Mark[] = [];
  if (result) {
    // Ledger numbers
    for (const span of result.ledger?.used.invoice ?? []) {
      invoiceMarks.push({ ...span, kind: "used", label: "Ledger verified number" });
    }
    // Removed AI instructions
    for (const span of result.removedSpans ?? []) {
      invoiceMarks.push({
        ...span,
        kind: "removed",
        label: "AI instruction flagged & removed by Guard",
      });
    }
    // Masked bank details
    for (const span of result.maskedSpans ?? []) {
      invoiceMarks.push({
        ...span,
        kind: "masked",
        label: "Bank details masked by Protect",
      });
    }
    // Vendor claims
    for (const vc of result.vendorClaims ?? []) {
      if (vc.span) {
        const isSupported = vc.verdict === "supported";
        invoiceMarks.push({
          ...vc.span,
          kind: isSupported ? "backed" : "unbacked",
          label: isSupported
            ? "Vendor claim backed by buyer records"
            : `Vendor claim unsupported by records (${vc.verdict || "unbacked"})`,
        });
      }
    }
  }

  // Compile PO Marks
  const poMarks: Mark[] = [];
  if (result) {
    for (const span of result.ledger?.used.po ?? []) {
      poMarks.push({ ...span, kind: "used", label: "PO number verified by ledger" });
    }
  }

  // Compile Receipt Marks
  const receiptMarks: Mark[] = [];
  if (result) {
    for (const span of result.ledger?.used.receipt ?? []) {
      receiptMarks.push({
        ...span,
        kind: "used",
        label: "Accepted dock count verified by ledger",
      });
    }
  }

  // Helper for clerk note strike-through
  const renderClerkNote = (
    note: string,
    claims: VerifyClaim[] | undefined
  ) => {
    if (!note) return <span className="text-zinc-500 italic">None</span>;
    if (!claims || claims.length === 0) return <span>{note}</span>;

    const noteMarks: Mark[] = [];
    for (const c of claims) {
      if (
        c.counted &&
        c.verdict !== "supported" &&
        c.verdict !== "not_a_claim"
      ) {
        const span = find(note, c.claim);
        if (span) {
          noteMarks.push({
            ...span,
            kind: "unbacked",
            label: `Sentence unsupported by records (${c.verdict})`,
          });
        }
      }
    }

    if (noteMarks.length === 0) return <span>{note}</span>;
    const segs = segments(note, noteMarks);
    return (
      <span>
        {segs.map((s, i) =>
          s.mark?.kind === "unbacked" ? (
            <span
              key={i}
              title="Sentence not supported by records"
              className="line-through decoration-rose-500 decoration-2 text-rose-300 bg-rose-950/40 px-1 rounded"
            >
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          )
        )}
      </span>
    );
  };

  const decision = result?.decision;
  const isOverruled =
    decision?.overruled && decision?.modelRecommendation?.choice === "PAY";

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-100 antialiased">
      {/* Top Navbar */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-bold text-emerald-400">
            P
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
              Paylock
              <span className="text-[10px] font-mono uppercase bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-700">
                Clocked Gate
              </span>
            </h1>
            <p className="text-xs text-zinc-400">
              The model may recommend PAY. The button only pays if the dock and
              the purchase order agree.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-400 hidden sm:inline">
            7 Clocked Endpoints: Decide · Extract · Fill · Verify · Compare · Guard · Protect
          </span>
          <a
            href="https://github.com/Nish344/paylock"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-zinc-400 hover:text-white transition-colors border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 rounded"
          >
            GitHub
          </a>
        </div>
      </header>

      {/* Main 3-Column Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[240px_1fr_420px] divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">
        {/* ========================================================= */}
        {/* LEFT COLUMN: Test Cases */}
        {/* ========================================================= */}
        <section className="p-4 bg-zinc-950/80 overflow-y-auto">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-3 px-1">
            Invoices to Review
          </div>
          <div className="space-y-1.5">
            {FIXTURES.map((c) => {
              const isSelected = selectedCaseId === c.id;
              const badgeColor =
                c.expected === "PAY"
                  ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/60"
                  : c.expected === "HOLD"
                    ? "bg-amber-950/80 text-amber-300 border-amber-700/60"
                    : "bg-rose-950/80 text-rose-300 border-rose-700/60";

              return (
                <button
                  key={c.id}
                  onClick={() => selectCase(c)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all text-xs flex flex-col gap-1.5 ${
                    isSelected
                      ? "bg-zinc-800/90 border-zinc-600 shadow-sm"
                      : "bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`font-medium ${
                        isSelected ? "text-white" : "text-zinc-300"
                      }`}
                    >
                      {c.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className={`px-1.5 py-0.5 rounded border font-mono font-medium ${badgeColor}`}
                    >
                      Exp: {c.expected}
                    </span>
                    <span className="text-zinc-500 font-mono">
                      {c.id}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-800/80 text-[11px] text-zinc-500 leading-relaxed px-1">
            <strong className="text-zinc-400">Three-way matching:</strong>{" "}
            The invoice is vendor claims; the purchase order and receiving note
            are proof.
          </div>
        </section>

        {/* ========================================================= */}
        {/* MIDDLE COLUMN: Three Documents & Editor */}
        {/* ========================================================= */}
        <section className="p-5 flex flex-col gap-4 overflow-y-auto bg-zinc-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Documents Under Review
              </span>
              {selectedCaseId ? (
                <span className="text-[11px] text-zinc-500 font-mono">
                  ({selectedCaseId})
                </span>
              ) : (
                <span className="text-[11px] text-amber-400 font-mono">
                  (Custom inputs)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {result && (
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-800 border border-zinc-700 transition-colors"
                >
                  {isEditing ? "View highlighted" : "Edit documents"}
                </button>
              )}
            </div>
          </div>

          {/* Document 1: Invoice */}
          <div className="flex flex-col gap-1.5 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5">
            <label
              htmlFor="invoice-input"
              className="text-xs font-semibold text-zinc-300 flex items-center justify-between"
            >
              <span>1. Invoice (vendor&apos;s claim)</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                Outside untrusted data
              </span>
            </label>
            {isEditing || !result ? (
              <textarea
                id="invoice-input"
                rows={9}
                value={invoice}
                onChange={(e) => handleTextChange(setInvoice, e.target.value)}
                placeholder="Paste vendor invoice text..."
                className="w-full bg-zinc-950 font-mono text-xs text-zinc-200 border border-zinc-800 rounded p-2.5 focus:outline-none focus:border-emerald-500/50 resize-y"
              />
            ) : (
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800/80 max-h-72 overflow-y-auto">
                {renderDocumentView(
                  result.cleanInvoice || invoice,
                  invoiceMarks,
                  "No invoice provided"
                )}
              </div>
            )}
          </div>

          {/* Document 2: Purchase Order */}
          <div className="flex flex-col gap-1.5 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5">
            <label
              htmlFor="po-input"
              className="text-xs font-semibold text-zinc-300 flex items-center justify-between"
            >
              <span>2. Purchase Order (what we agreed)</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                Buyer record
              </span>
            </label>
            {isEditing || !result ? (
              <textarea
                id="po-input"
                rows={7}
                value={po}
                onChange={(e) => handleTextChange(setPo, e.target.value)}
                placeholder="Paste purchase order text..."
                className="w-full bg-zinc-950 font-mono text-xs text-zinc-200 border border-zinc-800 rounded p-2.5 focus:outline-none focus:border-emerald-500/50 resize-y"
              />
            ) : (
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800/80 max-h-60 overflow-y-auto">
                {renderDocumentView(po, poMarks, "No PO provided")}
              </div>
            )}
          </div>

          {/* Document 3: Receiving Note */}
          <div className="flex flex-col gap-1.5 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5">
            <label
              htmlFor="receipt-input"
              className="text-xs font-semibold text-zinc-300 flex items-center justify-between"
            >
              <span>3. Receiving Note (what the dock accepted)</span>
              <span className="text-[10px] text-zinc-500 font-normal">
                Dock count by Marta Ruiz
              </span>
            </label>
            {isEditing || !result ? (
              <textarea
                id="receipt-input"
                rows={7}
                value={receipt}
                onChange={(e) => handleTextChange(setReceipt, e.target.value)}
                placeholder="Paste receiving note text..."
                className="w-full bg-zinc-950 font-mono text-xs text-zinc-200 border border-zinc-800 rounded p-2.5 focus:outline-none focus:border-emerald-500/50 resize-y"
              />
            ) : (
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800/80 max-h-60 overflow-y-auto">
                {renderDocumentView(
                  receipt,
                  receiptMarks,
                  "No receiving note provided"
                )}
              </div>
            )}
          </div>

          {/* Action Row & Color Legend */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <button
              onClick={runCheck}
              disabled={isLoading}
              className={`px-5 py-2.5 rounded-lg text-xs font-semibold tracking-wide flex items-center justify-center gap-2 shadow-sm transition-all ${
                isLoading
                  ? "bg-zinc-800 text-zinc-400 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
              }`}
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin h-3.5 w-3.5 text-zinc-400"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  <span>Reading with Clocked…</span>
                </>
              ) : (
                <span>Check invoice</span>
              )}
            </button>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-500 inline-block" />
                Ledger verified
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/40 border border-rose-500 inline-block" />
                Guard removed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-zinc-700 border border-zinc-500 inline-block" />
                █ Masked PII
              </span>
              <span className="flex items-center gap-1.5">
                <span className="line-through text-rose-400 font-bold">abc</span>
                Unbacked claim
              </span>
            </div>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg text-xs text-rose-200">
              {errorMsg}
            </div>
          )}
        </section>

        {/* ========================================================= */}
        {/* RIGHT COLUMN: Results & Gate Decision */}
        {/* ========================================================= */}
        <section
          aria-live="polite"
          className="p-5 flex flex-col gap-4 overflow-y-auto bg-zinc-950"
        >
          {/* 1. Model Decide Banner */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <span className="text-zinc-400">Decide model analysis:</span>
            {decision?.modelRecommendation ? (
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                Clocked Decide recommends{" "}
                <span
                  className={
                    decision.modelRecommendation.choice === "PAY"
                      ? "text-emerald-400 font-bold"
                      : decision.modelRecommendation.choice === "HOLD"
                        ? "text-amber-400 font-bold"
                        : "text-rose-400 font-bold"
                  }
                >
                  {decision.modelRecommendation.choice}
                </span>{" "}
                · {Math.round(decision.modelRecommendation.probability * 100)}%
              </span>
            ) : (
              <span className="text-zinc-500 italic">Run check to evaluate</span>
            )}
          </div>

          {/* 2. Overruled Banner */}
          {isOverruled && (
            <div className="p-3 rounded-lg bg-amber-950/70 border border-amber-600/80 text-amber-200 text-xs flex items-center gap-2 font-medium animate-fadeIn">
              <span className="text-amber-400 text-base font-bold">⚠</span>
              <span>
                The model said PAY. The ledger disagrees, so the button stays locked.
              </span>
            </div>
          )}

          {/* 3. The Button */}
          <div className="flex flex-col gap-1.5">
            {decision ? (
              decision.button === "PAY" ? (
                <button
                  onClick={() => setPaidDemo(true)}
                  aria-describedby="paylock-reasons"
                  className={`w-full py-3.5 px-4 rounded-lg font-bold text-sm tracking-wide shadow-lg transition-all ${
                    paidDemo
                      ? "bg-emerald-800 text-emerald-200 cursor-default"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                  }`}
                >
                  {paidDemo
                    ? "✓ Queued for the payment run (demo)"
                    : `Pay $${(
                        (decision.payableCents ?? 0) / 100
                      ).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                </button>
              ) : decision.button === "HOLD" ? (
                <button
                  disabled
                  aria-describedby="paylock-reasons"
                  className="w-full py-3 px-4 rounded-lg bg-amber-600/90 text-white cursor-not-allowed opacity-90 shadow text-left flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm tracking-wider uppercase">
                    PAYMENT HELD
                  </span>
                  {decision.reasons[0] && (
                    <span className="text-[11px] opacity-90 font-normal truncate max-w-full">
                      {decision.reasons[0].text}
                    </span>
                  )}
                </button>
              ) : (
                <button
                  disabled
                  aria-describedby="paylock-reasons"
                  className="w-full py-3 px-4 rounded-lg bg-rose-600/90 text-white cursor-not-allowed opacity-90 shadow text-left flex flex-col items-center justify-center gap-0.5"
                >
                  <span className="font-bold text-sm tracking-wider uppercase">
                    PAYMENT REJECTED
                  </span>
                  {decision.reasons[0] && (
                    <span className="text-[11px] opacity-90 font-normal truncate max-w-full">
                      {decision.reasons[0].text}
                    </span>
                  )}
                </button>
              )
            ) : (
              <div className="w-full py-3.5 px-4 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 font-medium text-xs text-center">
                Button is locked pending document check
              </div>
            )}
          </div>

          {/* 4. Why: Reasons List */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Why ({decision?.reasons.length ?? 0} reasons)
            </span>
            <div
              id="paylock-reasons"
              className="space-y-1.5 max-h-44 overflow-y-auto"
            >
              {decision && decision.reasons.length > 0 ? (
                decision.reasons.map((r, i) => {
                  const tagColors: Record<string, string> = {
                    ledger: "bg-blue-950 text-blue-300 border-blue-800",
                    guard: "bg-rose-950 text-rose-300 border-rose-800",
                    compare: "bg-purple-950 text-purple-300 border-purple-800",
                    verify: "bg-amber-950 text-amber-300 border-amber-800",
                    decide: "bg-indigo-950 text-indigo-300 border-indigo-800",
                    system: "bg-zinc-800 text-zinc-300 border-zinc-700",
                  };
                  return (
                    <div
                      key={i}
                      className="p-2 rounded bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 flex items-start gap-2"
                    >
                      <span
                        className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border font-semibold ${
                          tagColors[r.tag] || "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {r.tag}
                      </span>
                      <span className="flex-1 leading-snug">{r.text}</span>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-zinc-500 italic p-2 bg-zinc-900/40 rounded border border-zinc-800/60">
                  {decision?.button === "PAY"
                    ? "All checks passed. Billed amounts match agreed PO and dock counts."
                    : "No run executed yet."}
                </div>
              )}
            </div>
          </div>

          {/* 5. Ledger Table */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>Three-Way Match Ledger</span>
              {result?.ledger && (
                <span className="text-[11px] font-mono text-emerald-400 font-normal">
                  Payable: $
                  {(result.ledger.payableCents / 100).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              )}
            </span>

            <div className="overflow-x-auto border border-zinc-800 rounded-lg">
              <table className="w-full text-left text-[11px] font-mono divide-y divide-zinc-800">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="py-1.5 px-2 font-medium">Item</th>
                    <th className="py-1.5 px-2 font-medium">Billed</th>
                    <th className="py-1.5 px-2 font-medium">Ord</th>
                    <th className="py-1.5 px-2 font-medium">Acc</th>
                    <th className="py-1.5 px-2 font-medium">Inv $</th>
                    <th className="py-1.5 px-2 font-medium">PO $</th>
                    <th className="py-1.5 px-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 bg-zinc-950">
                  {result?.ledger && result.ledger.lines.length > 0 ? (
                    result.ledger.lines.map((l, i) => {
                      const hasIssue = l.issues.length > 0;
                      return (
                        <tr
                          key={i}
                          className={
                            hasIssue
                              ? "bg-rose-950/25 text-rose-200"
                              : "text-zinc-300"
                          }
                        >
                          <td className="py-1.5 px-2 font-bold">{l.item_code}</td>
                          <td
                            className={`py-1.5 px-2 ${
                              l.billed > l.accepted ? "font-bold text-rose-400" : ""
                            }`}
                          >
                            {l.billed}
                          </td>
                          <td className="py-1.5 px-2">{l.ordered}</td>
                          <td className="py-1.5 px-2 text-emerald-400">
                            {l.accepted}
                          </td>
                          <td
                            className={`py-1.5 px-2 ${
                              l.invoice_price_cents > l.po_price_cents
                                ? "font-bold text-rose-400"
                                : ""
                            }`}
                          >
                            {(l.invoice_price_cents / 100).toFixed(2)}
                          </td>
                          <td className="py-1.5 px-2">
                            {(l.po_price_cents / 100).toFixed(2)}
                          </td>
                          <td className="py-1.5 px-2 font-semibold">
                            {(l.recomputed_amount_cents / 100).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-3 px-2 text-center text-zinc-500 italic font-sans"
                      >
                        No ledger data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. Where Documents Disagree (Compare Conflicts) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Where Documents Disagree (Compare)
            </span>
            <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
              {result?.checks?.compare?.ok ? (
                (() => {
                  const conflicts =
                    result.decision.reasons.filter((r) => r.tag === "compare");
                  if (conflicts.length === 0) {
                    return (
                      <span className="text-zinc-500 italic">
                        No disagreements about what was delivered.
                      </span>
                    );
                  }
                  return (
                    <div className="space-y-1">
                      {conflicts.map((c, i) => (
                        <p key={i} className="text-purple-300 font-mono text-[11px]">
                          {c.text}
                        </p>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <span className="text-zinc-500 italic">
                  Compare findings will appear here.
                </span>
              )}
            </div>
          </div>

          {/* 7. Clerk Note & Question for Vendor */}
          <div className="grid grid-cols-1 gap-2.5">
            {/* Clerk note */}
            <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-300">Clerk Note</span>
                <span className="text-[9px] uppercase tracking-wider bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
                  Generated (Fill)
                </span>
              </div>
              <div className="text-zinc-300 leading-relaxed text-[11px]">
                {renderClerkNote(result?.clerkNote ?? "", result?.clerkNoteClaims)}
              </div>
            </div>

            {/* Vendor question */}
            <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-300">
                  Question for Vendor
                </span>
                <span className="text-[9px] uppercase tracking-wider bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
                  Generated (Fill)
                </span>
              </div>
              <p className="text-zinc-300 leading-relaxed text-[11px]">
                {result?.vendorQuestion || (
                  <span className="text-zinc-500 italic">None generated</span>
                )}
              </p>
            </div>
          </div>

          {/* 8. Footer */}
          <div className="pt-2 border-t border-zinc-800 text-[11px] text-zinc-500 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span>
                Usage:{" "}
                {result?.decision?.totalCredits !== undefined
                  ? `${result.decision.totalCredits} credits`
                  : "0 credits"}
              </span>
              <span className="font-mono text-zinc-600">
                {result?.checks.decide.replayed ? "Replayed from disk" : "Live Clocked API"}
              </span>
            </div>
            <p className="italic text-zinc-500">
              Paylock never moves money. Approval stays in your AP system.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
