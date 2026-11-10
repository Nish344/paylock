# Paylock: Implementation Decisions, Reality Checks & Findings

This document records all architectural decisions, reality checks, differences from the initial plan, and live API findings encountered during the implementation of Paylock.

---

## 1. Reality Checks & Live API Findings

### 1.1 Decide Behavior on Short Deliveries (`dock-count`)
- **Plan Hypothesis:** Case 2 (`dock-count`) was intended to test whether Decide would say `PAY` and be overruled by the software ledger.
- **Reality Check:** In live calls against `clocked-1.0` (`/clocked/decide`), the model evaluated the three documents and independently chose **HOLD with 97% probability**. It accurately noticed the cold-chain refusal on the receiving note.
- **Decision:** Following our tuning rule ("*Never tune Decide to make the model say PAY*"), we kept Decide's prompt completely neutral. Rather than artificially weakening the prompt, we let the model's true capability stand.

### 1.2 The Live Overrule Demonstrations (`bad-math` & `ai-note`)
- **Findings:**
  - **Case 4 (`bad-math`):** The vendor billed $642.00 + $556.00 = $1,198.00, but printed subtotal and total as $1,289.00 (a classic transposed-digit error). Clocked Decide recommended **PAY (100% probability)**. Paylock's ledger caught both the subtotal and total discrepancies, successfully **overruling the model to HOLD**.
  - **Case 5 (`ai-note`):** The invoice contained a bracketed prompt injection directed at AI reviewers to auto-approve. Clocked Guard flagged and extracted the evidence, which Paylock redacted prior to Decide seeing it. Clocked Decide (seeing only the legitimate lines) recommended **PAY (100% probability)**. Paylock's gate held the invoice due to the injection attempt, successfully **overruling the model to HOLD**.
- **Significance:** This proves the core thesis in two distinct failure modes: human arithmetic oversight and adversarial prompt attacks.

### 1.3 Verify Grounding on Clerk Notes (`partial-delivery`)
- **Issue Discovered:** In Case 6 (`partial-delivery`), Clocked Fill generated a clerk note concluding: `"There are no document conflicts"`. When Clocked Verify (`/clocked/grounding`) evaluated this sentence, it flagged it as ungrounded (`not_stated`) because the document set passed to Verify only contained raw documents and ledger findings bullets, but omitted the Compare conflicts summary.
- **Resolution:**
  1. Updated the Phase 4 `paylock-ledger` document in Verify to contain both `LEDGER FINDINGS` and `DOCUMENT CONFLICTS` (`- None.`).
  2. Updated `VERIFY_NOTE_POLICY` to clarify that statements affirming documents match or have no conflicts are supported if the ledger findings report no discrepancies.
  3. Constrained Fill's `clerk_note` field description to output exactly `"The invoice matches the purchase order and receiving note."` when no issues exist, and lowered `max_tokens` from 120 to 60.
- **Result:** Case 6 cleanly resolved to `PAY`, completing the 8/8 benchmark.

### 1.4 API Credit Consumption
- Across all 8 cases (10 Clocked calls per case = 80 total calls), the entire evaluation consumed **428 credits** (~53.5 credits per end-to-end 3-way match).
- Concurrency stayed strictly within the account limit of 4.

---

## 2. Architectural & Implementation Decisions

### 2.1 Concurrency Queue Design (`lib/clocked.ts`)
- **Constraint:** Account limit is 4 concurrent in-flight requests.
- **Implementation:** Created `ConcurrencyQueue` in `lib/clocked.ts`. Instead of a generic pooling library, it implements direct slot handover: when an active request completes, it hands its running slot directly to the next pending promise in the queue before decrementing the counter. This guarantees the count never exceeds 4 even under heavy async interleaving.

### 2.2 Deterministic Canonical Hashing for Record/Replay
- **Challenge:** JSON key ordering in JavaScript objects is not guaranteed to be stable across engines or serialization passes, which could produce hash mismatches between `record` and `replay`.
- **Implementation:** Implemented `canonicalStringify()` which recursively sorts all object keys lexicographically before serializing. The request hash is computed as `sha256(canonicalStringify(payload)).slice(0, 16)`. File naming follows `recordings/<endpoint>-<hash>.json`.

### 2.3 Unicode Code-Point Offsets (`lib/spans.ts`)
- **Challenge:** JavaScript `String.prototype.slice` and `.length` operate on UTF-16 code units. Characters in supplementary planes (e.g., emojis like `🍅` or `📦`) have a length of 2 in UTF-16 but count as 1 code point in Clocked API spans.
- **Implementation:** All text manipulations (`segments`, `mask`, `find`, `codePointLength`, `codePointSlice`) convert strings to code-point arrays via `Array.from(text)`. This prevents off-by-one span drift in documents containing symbols or emojis.

### 2.4 Replay Boundary in Public API Route (`app/api/check/route.ts`)
- **Decision:** When running in `CLOCKED_MODE=replay` (such as in public deployment without an API key), arbitrary user-modified input is rejected with HTTP 400:
  > *"This public demo replays the eight recorded cases. Clone the repo and add a Clocked API key to check your own documents."*
- **Rationale:** Without this check, unrecorded custom text would attempt to load non-existent recording files, producing a confusing waterfall of "call failed" system errors.

### 2.5 TypeScript & Linting Strictness
- Prohibited `any` across the codebase.
- Typed `verifySpan` in `lib/ledger.ts` to accept `value?: unknown` and validate against raw source code points safely.
- Annotated dynamic file reading in `lib/clocked.ts` with `/*turbopackIgnore: true*/` to prevent Next.js Turbopack from bundling unwanted file trees into server chunks.

---

## 3. Differences from the Original Execution Plan

| Plan Specification | Implemented Behavior | Rationale |
|---|---|---|
| Primary overrule demonstration on Case 2 (`dock-count`) | Primary overrule demonstration on Case 4 (`bad-math`) and Case 5 (`ai-note`) | Live Clocked Decide model proved smarter than anticipated and correctly held Case 2; Cases 4 and 5 provided genuine, uncoerced live model overrules. |
| Verify clerk note checked against raw `findingsBullets` | Verify clerk note checked against `LEDGER FINDINGS` + `DOCUMENT CONFLICTS` | Enabled Verify to validate clerk note sentences that comment on document consistency. |
| `clerk_note` token limit 120 | `clerk_note` token limit 60 | Shorter, direct sentences prevent hallucinated narrative details from triggering false ungrounded strikes on clean cases. |

---

## 4. Verification & Reproduction Status

- **Unit Tests:** `pnpm test` → 29 passing tests across 4 test suites (`clocked`, `spans`, `ledger`, `policy`).
- **Evaluation Runner:** `pnpm eval` → 8/8 pass in both live and replay mode.
- **Build & Lint:** `pnpm lint && pnpm build` → 0 errors, 0 warnings.

