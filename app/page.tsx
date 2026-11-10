"use client";

import React, { useState, useSyncExternalStore } from "react";
import { FIXTURES, type FixtureCase } from "@/lib/fixtures";
import { segments, type Mark, find } from "@/lib/spans";
import type { PaylockRunResult } from "@/lib/paylock";
import type { VerifyClaim } from "@/lib/types";

const ENDPOINTS = ["Decide", "Extract", "Fill", "Verify", "Compare", "Guard", "Protect"];

const TICKER = [
  "Invoice = claim",
  "PO + receiving note = proof",
  "Code can only turn PAY into HOLD",
  "Decide's HOLD and REJECT are always followed",
  "Every number is a verified span",
];

const VERDICT_PILL: Record<string, string> = {
  PAY: "bg-mint-soft text-pay-ink border-mint/40",
  HOLD: "bg-signal-soft text-hold-ink border-signal/50",
  REJECT: "bg-alarm-soft text-reject-ink border-alarm/40",
};

const VERDICT_STAMP: Record<string, string> = {
  PAY: "text-mint",
  HOLD: "text-stamp-hold",
  REJECT: "text-alarm",
};

const REASON_TAG: Record<string, string> = {
  ledger: "text-accent-deep border-accent/30 bg-accent/10",
  guard: "text-reject-ink border-alarm/40 bg-alarm-soft",
  compare: "text-fg border-line bg-desk",
  verify: "text-hold-ink border-signal/40 bg-signal-soft",
  decide: "text-fg border-line bg-desk",
  system: "text-muted border-line bg-desk",
};

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
  const dark = useSyncExternalStore(
    (onChange) => {
      const obs = new MutationObserver(onChange);
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      return () => obs.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("paylock-theme", next ? "dark" : "light");
  };

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
        <span className="text-zinc-500 italic text-sm">{emptyLabel}</span>
      );
    }
    const segs = segments(text, marks);
    return (
      <div className="font-mono text-xs leading-5 whitespace-pre-wrap select-text">
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
                className="bg-accent/12 text-accent-deep font-bold border-b-2 border-accent px-0.5"
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
                className="bg-alarm-soft text-alarm line-through decoration-2 px-0.5 rounded-sm"
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
                className="text-ink px-0.5 select-none font-mono"
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
                className="line-through decoration-alarm decoration-2 text-alarm bg-alarm-soft px-0.5"
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
                className="underline decoration-dotted decoration-2 decoration-mint bg-mint-soft px-0.5"
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
      if (vc.span && vc.verdict !== "not_a_claim") {
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
    if (!note) return <span className="text-muted italic">None</span>;
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
              className="line-through decoration-alarm decoration-2 text-alarm bg-alarm-soft px-1"
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

  const docBlocks = [
    {
      id: "invoice-input",
      title: "Invoice",
      subtitle: "the vendor's claim",
      note: "Outside · untrusted",
      value: invoice,
      setter: setInvoice,
      rows: 9,
      view: result?.cleanInvoice || invoice,
      marks: invoiceMarks,
      empty: "No invoice provided",
      placeholder: "Paste vendor invoice text...",
    },
    {
      id: "po-input",
      title: "Purchase order",
      subtitle: "what we agreed",
      note: "Buyer record",
      value: po,
      setter: setPo,
      rows: 7,
      view: po,
      marks: poMarks,
      empty: "No PO provided",
      placeholder: "Paste purchase order text...",
    },
    {
      id: "receipt-input",
      title: "Receiving note",
      subtitle: "what the dock accepted",
      note: "Dock count · M. Ruiz",
      value: receipt,
      setter: setReceipt,
      rows: 7,
      view: receipt,
      marks: receiptMarks,
      empty: "No receiving note provided",
      placeholder: "Paste receiving note text...",
    },
  ];

  const money = (cents: number) =>
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="flex flex-col min-h-screen bg-desk text-fg antialiased">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-desk/80 backdrop-blur-md border-b border-line">
        <div className="max-w-[1500px] mx-auto px-6 py-3.5 flex items-center justify-between gap-6">
          <div className="font-serif text-[30px] leading-none flex items-center gap-2.5">
            <span
              aria-hidden
              className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center"
            >
              <span className="w-2 h-2.5 rounded-[2px] bg-desk" />
            </span>
            <span>
              Pay<span className="italic text-accent">lock</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
            {ENDPOINTS.map((e, i) => (
              <span key={e} className="flex items-center gap-1">
                {i > 0 && <span className="text-accent/70">/</span>}
                {e}
              </span>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={dark}
              className="btn border border-line bg-panel text-fg hover:border-accent text-[11px] px-3.5 py-2"
            >
              {dark ? "Light" : "Dark"}
            </button>
            <a
              href="https://github.com/Nish344/paylock"
              target="_blank"
              rel="noreferrer"
              className="btn bg-accent text-on-accent hover:bg-accent-deep text-[11px] px-4 py-2"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="grid-bg absolute inset-0" />
        <div
          aria-hidden
          className="absolute -right-32 -top-48 w-[620px] h-[620px] rounded-full bg-accent/10 blur-[140px]"
        />
        <section className="relative max-w-[1500px] w-full mx-auto px-6 pt-20 pb-16 grid lg:grid-cols-[1.5fr_1fr] gap-12 items-end">
          <div>
            <span className="tag text-muted">Three-way match · built on Clocked</span>
            <h1 className="mt-7 font-serif leading-[0.92] tracking-[-0.02em] text-6xl sm:text-7xl xl:text-[104px]">
              The model may say pay.
              <br />
              The <span className="hl">dock</span> decides.
            </h1>
          </div>
          <div className="flex flex-col gap-7">
            <p className="text-[15px] leading-relaxed text-fg/90 max-w-md">
              Paste an invoice, a purchase order and a receiving note. Clocked
              reads all three; a few lines of ordinary code decide whether the
              Pay button is live. It only pays if the dock and the purchase
              order agree.
            </p>
            <dl className="grid grid-cols-3 max-w-md border-y border-line divide-x divide-line">
              {[
                ["7", "Clocked endpoints"],
                ["10", "calls per invoice"],
                ["$0", "moved by Paylock"],
              ].map(([n, l]) => (
                <div key={l} className="py-4 px-4 first:pl-0">
                  <dt className="font-serif text-4xl leading-none">{n}</dt>
                  <dd className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                    {l}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>

      {/* Ticker tape */}
      <div className="bg-accent text-on-accent overflow-hidden" aria-hidden>
        <div className="ticker flex w-max py-3 font-mono text-xs font-semibold uppercase tracking-[0.2em]">
          {[0, 1].map((k) => (
            <div key={k} className="flex">
              {TICKER.map((t) => (
                <span key={t} className="flex items-center gap-6 pr-6">
                  {t}
                  <span className="text-[10px]">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Main 3-Column Layout */}
      <main className="flex-1 max-w-[1500px] w-full mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-[250px_1fr_440px] gap-8 items-start">
        {/* ========================================================= */}
        {/* LEFT COLUMN: Test Cases */}
        {/* ========================================================= */}
        <section className="flex flex-col gap-4 lg:sticky lg:top-24">
          <span className="tag text-muted">Invoices to review</span>
          <div className="flex flex-col gap-2">
            {FIXTURES.map((c) => {
              const isSelected = selectedCaseId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => selectCase(c)}
                  className={`relative w-full text-left pl-4 pr-3 py-3 rounded-xl border flex flex-col gap-2 transition-all overflow-hidden ${
                    isSelected
                      ? "bg-accent/[0.07] border-accent/50"
                      : "bg-panel border-line hover:border-accent/30 hover:-translate-y-px"
                  }`}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
                  )}
                  <span className="text-[13px] font-medium leading-snug">
                    {c.title}
                  </span>
                  <span className="flex items-center gap-2 text-[10px]">
                    <span
                      className={`px-2 py-0.5 rounded-full border font-mono font-semibold uppercase tracking-wider ${VERDICT_PILL[c.expected]}`}
                    >
                      {c.expected}
                    </span>
                    <span className="font-mono text-muted">{c.id}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="font-serif italic text-xl text-fg/80 leading-snug mt-2">
            “The invoice is the vendor&apos;s story. The PO and the receiving
            note are the buyer&apos;s evidence.”
          </p>
        </section>

        {/* ========================================================= */}
        {/* MIDDLE COLUMN: Three Documents & Editor */}
        {/* ========================================================= */}
        <section className="flex flex-col gap-6 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="tag text-muted">Documents under review</span>
              {selectedCaseId ? (
                <span className="text-[11px] font-mono text-muted">
                  {selectedCaseId}
                </span>
              ) : (
                <span className="text-[10px] font-mono uppercase tracking-wider rounded-full bg-signal-soft text-hold-ink border border-signal/40 px-2">
                  custom input
                </span>
              )}
            </div>

            {result && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="btn border border-line text-fg/80 hover:border-fg/40 text-[10px] px-3.5 py-1.5"
              >
                {isEditing ? "View highlighted" : "Edit documents"}
              </button>
            )}
          </div>

          {docBlocks.map((d, i) => (
            <div key={d.id} className="sheet overflow-hidden">
              <label
                htmlFor={d.id}
                className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line"
              >
                <span className="flex items-baseline gap-2.5">
                  <span aria-hidden className="font-mono text-[11px] text-accent-deep font-semibold">
                    0{i + 1}
                  </span>
                  <span className="font-serif text-[26px] leading-none">{d.title}</span>
                  <span className="font-serif italic text-base text-muted">
                    {d.subtitle}
                  </span>
                </span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
                  {d.note}
                </span>
              </label>
              {isEditing || !result ? (
                <textarea
                  id={d.id}
                  rows={d.rows}
                  value={d.value}
                  onChange={(e) => handleTextChange(d.setter, e.target.value)}
                  placeholder={d.placeholder}
                  className="ledger block w-full font-mono text-xs leading-5 text-ink placeholder:text-muted focus:outline-none resize-y"
                />
              ) : (
                <div className="ledger max-h-80 overflow-y-auto">
                  {renderDocumentView(d.view, d.marks, d.empty)}
                </div>
              )}
            </div>
          ))}

          {/* Action Row & Color Legend */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <button
              onClick={runCheck}
              disabled={isLoading}
              className={`btn px-7 py-3.5 text-xs flex items-center justify-center gap-2 ${
                isLoading
                  ? "bg-panel text-muted border border-line cursor-not-allowed"
                  : "bg-accent text-on-accent hover:bg-accent-deep shadow-[0_10px_24px_-12px_rgb(47_111_106/0.8)] cursor-pointer"
              }`}
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin h-3.5 w-3.5"
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
                <span>Check invoice →</span>
              )}
            </button>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-fg/80">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-accent/30 border-b-2 border-accent inline-block" />
                Ledger verified
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-alarm/30 inline-block" />
                Guard removed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="font-mono">█</span>
                Masked bank details
              </span>
              <span className="flex items-center gap-1.5">
                <span className="line-through decoration-2 text-alarm font-bold">abc</span>
                Unbacked claim
              </span>
            </div>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-alarm-soft border border-alarm/40 text-reject-ink text-xs font-medium"
            >
              {errorMsg}
            </div>
          )}
        </section>

        {/* ========================================================= */}
        {/* RIGHT COLUMN: Results & Gate Decision */}
        {/* ========================================================= */}
        <section aria-live="polite" className="flex flex-col gap-6 min-w-0">
          {/* Decision receipt */}
          <div className="drop-shadow-[0_22px_36px_rgb(43_52_64/0.16)]">
            <div className="receipt bg-paper text-ink rounded-t-2xl px-6 pt-6 flex flex-col gap-5">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-muted border-b border-dashed border-line pb-3">
                <span>Paylock · gate receipt</span>
                <span>{selectedCaseId || "custom"}</span>
              </div>

              {/* 1. Model Decide */}
              <div className="flex items-center justify-between gap-4 min-h-20">
                <div className="flex flex-col gap-1.5">
                  <span className="tag text-muted">Clocked Decide says</span>
                  <span className="font-mono text-xs text-muted">
                    {decision?.modelRecommendation
                      ? `${Math.round(decision.modelRecommendation.probability * 100)}% probability`
                      : "Run a check to evaluate"}
                  </span>
                </div>
                {decision?.modelRecommendation ? (
                  <span
                    className={`stamp text-5xl ${
                      VERDICT_STAMP[decision.modelRecommendation.choice] ?? "text-ink"
                    }`}
                  >
                    {decision.modelRecommendation.choice}
                  </span>
                ) : (
                  <span className="stamp text-5xl text-muted/70">—</span>
                )}
              </div>

              {/* 2. Overruled Banner */}
              {isOverruled && (
                <div className="p-3 rounded-lg bg-signal-soft border border-signal/50 text-hold-ink text-xs font-semibold flex items-center gap-2.5">
                  <span className="text-base">⚠</span>
                  <span>
                    The model said PAY. The ledger disagrees, so the button
                    stays locked.
                  </span>
                </div>
              )}

              {/* 3. The Button */}
              {decision ? (
                decision.button === "PAY" ? (
                  <button
                    onClick={() => setPaidDemo(true)}
                    aria-describedby="paylock-reasons"
                    className={`w-full py-4 px-4 rounded-xl font-mono font-semibold uppercase tracking-[0.12em] text-sm transition-all ${
                      paidDemo
                        ? "bg-mint-soft text-pay-ink border border-mint/40 cursor-default"
                        : "bg-mint text-on-accent hover:bg-mint-deep shadow-[0_10px_24px_-12px_rgb(78_143_107/0.9)] cursor-pointer"
                    }`}
                  >
                    {paidDemo
                      ? "✓ Queued for the payment run (demo)"
                      : `Pay $${money(decision.payableCents ?? 0)}`}
                  </button>
                ) : (
                  <button
                    disabled
                    aria-describedby="paylock-reasons"
                    className={`w-full py-3.5 px-4 rounded-xl cursor-not-allowed flex flex-col items-center justify-center gap-1 border ${
                      decision.button === "HOLD"
                        ? "bg-signal-soft text-hold-ink border-signal"
                        : "bg-alarm-soft text-reject-ink border-alarm"
                    }`}
                  >
                    <span className="font-mono font-semibold text-sm tracking-[0.12em] uppercase">
                      {decision.button === "HOLD" ? "🔒 Payment held" : "✕ Payment rejected"}
                    </span>
                    {decision.reasons[0] && (
                      <span className="text-[11px] text-fg/90 truncate max-w-full">
                        {decision.reasons[0].text}
                      </span>
                    )}
                  </button>
                )
              ) : (
                <div className="w-full py-4 px-4 rounded-xl border border-dashed border-line text-muted font-mono text-[11px] uppercase tracking-[0.12em] text-center">
                  Button locked pending document check
                </div>
              )}

              {/* 4. Why: Reasons List */}
              <div className="flex flex-col gap-3 border-t border-dashed border-line pt-4">
                <span className="tag text-muted">
                  Why · {decision?.reasons.length ?? 0} reasons
                </span>
                <div
                  id="paylock-reasons"
                  className="space-y-2.5 max-h-60 overflow-y-auto pr-1"
                >
                  {decision && decision.reasons.length > 0 ? (
                    decision.reasons.map((r, i) => (
                      <div
                        key={i}
                        className="text-xs text-fg flex items-start gap-2.5"
                      >
                        <span
                          className={`shrink-0 w-16 text-center text-[9px] font-mono font-semibold uppercase tracking-wider py-0.5 rounded-full border ${
                            REASON_TAG[r.tag] ?? REASON_TAG.system
                          }`}
                        >
                          {r.tag}
                        </span>
                        <span className="flex-1 leading-snug break-words">{r.text}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted italic">
                      {decision?.button === "PAY"
                        ? "All checks passed. Billed amounts match agreed PO and dock counts."
                        : "No run executed yet."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 5. Ledger Table */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-line">
              <span className="tag text-muted">Three-way match ledger</span>
              {result?.ledger && (
                <span className="text-[11px] font-mono font-semibold rounded-full bg-accent/15 text-accent border border-accent/40 px-2.5 py-0.5">
                  Payable ${money(result.ledger.payableCents)}
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="text-muted uppercase text-[9.5px] tracking-wider border-b border-line">
                  <tr>
                    <th className="py-2 px-3 font-semibold">Item</th>
                    <th className="py-2 px-2 font-semibold">Billed</th>
                    <th className="py-2 px-2 font-semibold">Ord</th>
                    <th className="py-2 px-2 font-semibold">Acc</th>
                    <th className="py-2 px-2 font-semibold">Inv $</th>
                    <th className="py-2 px-2 font-semibold">PO $</th>
                    <th className="py-2 px-3 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result?.ledger && result.ledger.lines.length > 0 ? (
                    result.ledger.lines.map((l, i) => {
                      const hasIssue = l.issues.length > 0;
                      return (
                        <tr key={i} className={hasIssue ? "bg-alarm-soft" : ""}>
                          <td className="py-2.5 px-3 font-semibold">{l.item_code}</td>
                          <td
                            className={`py-2.5 px-2 ${
                              l.billed > l.accepted ? "font-bold text-reject-ink" : ""
                            }`}
                          >
                            {l.billed}
                          </td>
                          <td className="py-2.5 px-2">{l.ordered}</td>
                          <td className="py-2.5 px-2 font-bold text-accent">
                            {l.accepted}
                          </td>
                          <td
                            className={`py-2.5 px-2 ${
                              l.invoice_price_cents > l.po_price_cents
                                ? "font-bold text-reject-ink"
                                : ""
                            }`}
                          >
                            {(l.invoice_price_cents / 100).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-2">
                            {(l.po_price_cents / 100).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 font-bold">
                            {(l.recomputed_amount_cents / 100).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-5 px-2 text-center text-muted italic font-sans"
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
          <div className="card p-5 flex flex-col gap-3">
            <span className="tag text-muted">Where the documents disagree</span>
            <div className="text-xs">
              {result?.checks?.compare?.ok ? (
                (() => {
                  const conflicts =
                    result.decision.reasons.filter((r) => r.tag === "compare");
                  if (conflicts.length === 0) {
                    return (
                      <span className="font-serif italic text-lg text-muted">
                        No disagreements about what was delivered.
                      </span>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {conflicts.map((c, i) => (
                        <p
                          key={i}
                          className="font-mono text-[11px] text-fg/85 rounded-lg bg-accent/10 border-l-2 border-accent p-2.5 whitespace-pre-wrap break-words"
                        >
                          {c.text}
                        </p>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <span className="font-serif italic text-lg text-muted">
                  Compare findings will appear here.
                </span>
              )}
            </div>
          </div>

          {/* 7. Clerk Note & Question for Vendor */}
          {[
            {
              title: "Clerk note",
              body: renderClerkNote(result?.clerkNote ?? "", result?.clerkNoteClaims),
            },
            {
              title: "Question for the vendor",
              body: result?.vendorQuestion || (
                <span className="text-muted italic">None generated</span>
              ),
            },
          ].map((b) => (
            <div key={b.title} className="card p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="tag text-muted">{b.title}</span>
                <span className="text-[9.5px] font-mono font-semibold uppercase tracking-wider rounded-full bg-accent/15 text-accent px-2 py-0.5">
                  Generated · Fill
                </span>
              </div>
              <div className="font-serif text-[19px] leading-snug text-fg/90">{b.body}</div>
            </div>
          ))}

          {/* 8. Footer */}
          <div className="border-t border-line pt-3 text-[11px] text-muted flex flex-col gap-1.5">
            <div className="flex items-center justify-between font-mono">
              <span>
                Usage:{" "}
                {result?.decision?.totalCredits !== undefined
                  ? `${result.decision.totalCredits} credits`
                  : "0 credits"}
              </span>
              <span>
                {result?.checks.decide.replayed ? "Replayed from disk" : "Live Clocked API"}
              </span>
            </div>
            <p className="font-serif italic text-base text-fg">
              Paylock never moves money. Approval stays in your AP system.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
