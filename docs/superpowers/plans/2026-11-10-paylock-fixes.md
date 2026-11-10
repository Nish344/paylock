# Paylock: pre-submission fixes

> Run these in order. There's no code in this file; each step says what to change, where, and how to check it. Deadline: **Nov 11, 10:29 IST**. Aim to push by Tue 13:00 IST so there's time for the video.

**Starting state (checked Tue Nov 10, 09:10 IST):** 27/27 tests, type check, lint and build all pass. `CLOCKED_MODE=replay pnpm eval` prints 8/8 with 2 overrules (`bad-math`, `ai-note`). The working tree has two untracked files: `,env` and `docs/TEST_RESULTS.md`.

**Rules for every step:**
- **Don't re-record.** Leave `recordings/` alone and don't change any text sent to Clocked: prompts, fixtures, or the Fill input built in `lib/paylock.ts`. If a request body changes, replay can't find its recording and the public demo breaks.
- Run `CLOCKED_MODE=replay pnpm eval` after each code step. It must still print **8/8 · model PAY overruled 2× · 0 credits**.
- Never `git add -A` until Fix 1 is done.

---

## Fix 1: Delete the stray key file (do this first)

**Problem:** `,env` (a comma instead of a dot) is a byte-for-byte copy of `.env.local`, including the real `CLOCKED_API_KEY`. `.gitignore` only matches names starting with `.env`, so this file **would be committed and pushed to the public repo**. It isn't in the git history yet; I checked every commit for the exact key value.

**Steps:**
1. Delete `,env` from the project root. `.env.local` stays; it's ignored and is the copy the scripts use.
2. Check `git status --short`. `,env` must no longer appear.
3. Check `git check-ignore -v .env.local` still reports that it's ignored.
4. No key rotation is needed, because it never left the machine. If it ever gets pushed, rotate it in the Clocked dashboard right away.

**Done when:** `git status` shows only `docs/TEST_RESULTS.md` as untracked.

---

## Fix 2: Make the README story match the eval

**Problem:** README line 17 says the AI "leans **PAY**" on Marta's tomato invoice. The eval shows Decide said **HOLD at 97%** on `dock-count`, and line 139 says so. A judge who reads both will see the opening is untrue, which costs the explanation and depth points that make up the lead.

**What's actually true (use these facts, from the eval output):**
- `dock-count`: Decide HOLD 97%. Paylock *also* holds it, on two independent grounds: the ledger (billed 500, dock accepted 420) and two vendor claims struck by Verify (the chef's phone approval, the CFO's "pay today"). The point here is independent agreement, not an overrule.
- `bad-math` (Copperleaf Dry Goods): **Decide PAY 100%.** The ledger recomputes $1,198.00 against the $1,289.00 the invoice asks for, and the button locks. **This is the real overrule. It's the strongest moment in the eval.**
- `ai-note` (Coastline Seafood): Decide PAY 100%, button HOLD. But the hidden instruction was masked *before* Decide read the invoice, so Decide's PAY is reasonable. The hold comes from Guard detecting the instruction. Describe it as "Guard's catch", not "the model was fooled".

**Changes in `README.md`:**
1. **Section 1 (The Story), third paragraph:** replace "An AI reviewer reads the documents and leans PAY" with wording that matches the eval: the AI reviewer catches it too, and Paylock doesn't depend on that. The button is locked by the ledger (500 vs 420), and the chef's approval is struck because the PO and Marta's receiving note don't back it.
2. **Add a short second story right after it**, headed something like "The one the model missed". Use the Copperleaf invoice: rice and flour lines that each multiply correctly, a subtotal printed as $1,289.00 when the lines add up to $1,198.00, Decide saying **PAY at 100%**, and the button showing *"Recomputed total is $1,198.00; the invoice asks for $1,289.00."* End on the one-line pitch.
3. **Note on overrides (around line 139):** keep it, but make it say exactly the three facts above, including that `ai-note`'s hold comes from Guard.
4. **Screenshot/GIF:** if the README image or GIF shows `dock-count` captioned as an overrule, either re-caption it ("Paylock and the model both hold; the ledger says why") or replace it with a `bad-math` capture. It must show *"The model said PAY. The ledger disagrees…"* banner.

**Matching changes outside the README:**
5. `docs/superpowers/specs/2026-11-09-paylock-design.md`:
   - **LinkedIn post draft:** "I gave all three documents to an AI reviewer. It said PAY." is no longer true for Marta. Keep Marta as the hook, but move the "It said PAY" beat to the Copperleaf invoice ("On another invoice the subtotal was $91 too high. The AI said PAY, 100% sure.").
   - **Two-minute video script:** step 3 becomes "Decide also holds this one, and Paylock shows *why*"; step 5 (`bad-math`) becomes the main overrule beat, given the most screen time.
   - **Eight-cases table:** set the "Model PAY likely?" column to the observed results (case 2: HOLD 97%, case 4: PAY 100%, case 5: PAY 100%).
6. `docs/research/clocked-challenge-submissions.md` is private and gitignored. Optionally update the Paylock row there; it doesn't affect submission.

**Done when:** searching the README and the spec for "leans PAY" and "It said PAY" finds no claim about Marta's invoice; every PAY/HOLD statement matches the eval output; and the overrule demo named everywhere is `bad-math`.

---

## Fix 3: Keep Compare's reason to one readable line

**Problem:** on `substitution`, Compare returned the **entire purchase order** as its passage. `invoiceConflicts()` in `lib/policy.ts` builds the reason from the raw quotes, so the whole PO, line breaks and all, is printed as a reason and on the locked button. The UI's "Where the documents disagree" card reads from the same reasons (`app/page.tsx` around line 844), so it shows the dump too.

**Constraint:** `invoiceConflicts()` returns a `sentence` that `lib/paylock.ts` (around line 278) also puts into the **Fill request**. Changing `sentence` changes the Fill request body, which breaks replay. **Don't change `sentence`.**

**Steps:**
1. In `lib/policy.ts`, add a small exported helper, `shortQuote`, that turns a passage into one readable line:
   - split it into lines;
   - trim each line and strip the table pipes at either end;
   - drop empty lines;
   - prefer the line containing the same item code as the invoice side (item codes look like `BP-AVO-48`); otherwise take the first line;
   - cap it at about 120 characters, ending with "…" if cut.
2. Give each conflict that `invoiceConflicts()` returns a new `summary` field: the same sentence shape ("The invoice says "…"; the purchase order says "…".") built from the shortened quotes. Shorten the other document's quote using the invoice quote as the item-code hint.
3. In `decidePay()`, make the Compare reason use `summary` instead of `sentence`. Leave `lib/paylock.ts` untouched.
4. **Tests in `lib/policy.test.ts`:**
   - The existing invoice-vs-PO conflict test, with single-line quotes "60 ct case" and "48 ct case", must still produce exactly the same reason. Short quotes pass through unchanged.
   - Add a test that uses the real multi-line PO passage from the `substitution` recording (copy it from `recordings/compare-*.json`, or from the eval output). Expect the reason to read *The invoice says "BP-AVO-48 | Hass avocados, 60 ct case | 30 | 52.00 | 1,560.00"; the purchase order says "BP-AVO-48 | Hass avocados, 48 ct case | 30 | 52.00".* That is: no line breaks, no outer pipes, the matching row picked out.
   - Add a test that a passage longer than 120 characters on one line is cut and ends with "…".
5. Run the full check (see below). In the eval output, the `substitution` compare reason must now be one line naming 48 ct and 60 ct.
6. Open `pnpm dev`, load "Swapped avocado size", and check both the locked button's reason and the disagreement card show one short line.

**Done when:** tests pass (27 existing + 2 new), replay eval is still 8/8 with 0 credits, and the avocado reason fits on one line.

---

## Fix 4: Commit the test-results file (or fold it in)

`docs/TEST_RESULTS.md` records a **live** run: 8/8, 2 overrules, 493 credits, key not included. It's good evidence for the reproducibility score.
1. Open it and check it contains no key and no `.env.local` contents. Search it for `CLOCKED_API_KEY=` followed by anything other than empty.
2. Commit it, and link it from the README's Results section ("Live run on Nov 10: 8/8, 493 credits, see `docs/TEST_RESULTS.md`").

---

## Final check, then push

Run all of these and confirm each one passes:
1. `pnpm test`: all tests pass. (Lines like `kill EACCES` / "Timeout terminating forks worker" only appear in sandboxed agent shells; ignore them as long as the summary says all passed.)
2. `npx tsc --noEmit` and `pnpm lint`: no errors.
3. `CLOCKED_MODE=replay pnpm eval`: **8/8 · model PAY overruled 2× · 0 credits**.
4. Build with the key blanked out (`CLOCKED_API_KEY= pnpm build`): it must succeed, proving the replay-only deployment builds.
5. `git status --short`: no `,env`, no `.env.local`, no `docs/research/`, no `probe-output.json`.
6. Look at the staged diff before committing. It should only touch `README.md`, `lib/policy.ts`, `lib/policy.test.ts`, the spec doc, and `docs/TEST_RESULTS.md`, plus the image if you replaced it.

Then:
7. Commit with a message like "Match the README story to the eval, keep Compare reasons to one line, add live test results", and push to `origin` (`github.com/Nish344/paylock`).
8. Wait for the Vercel deploy. Open the live URL in a private window, run `bad-math`, `substitution` and `dock-count`, and confirm they match the eval. Edit any text and confirm the replay-only message appears.
9. On GitHub, confirm the repo is public and that `,env`, `.env.local` and `docs/research/` aren't in it.

## Deliberately not changing

- **`wrong-buyer` flags "Payment due upon receipt." as an unbacked vendor claim.** It's harmless: the button is REJECT because of Decide anyway, and Fix 3's rule against touching what's sent to Clocked applies.
- **Re-tuning to make Decide say PAY on `dock-count`.** That would mean rigging the prompt. The honest story (Fix 2) is stronger.
- **Re-recording.** Not needed for any of these fixes, and it would cost about 450 credits and risk different model answers the night before the deadline.
