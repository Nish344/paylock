# Paylock test results

Run on 10 Nov 2026, about 09:04 IST. The API key was loaded from `.env.local`. It is not copied into this file.

Commands:

```bash
pnpm test
pnpm eval
```

`pnpm eval` ran in **live** mode because `CLOCKED_API_KEY` is set and `CLOCKED_MODE` was not overridden.

## Summary

| Run | Result | Exit |
|---|---|---|
| `pnpm test` | 4 files, 27 tests passed | 0 |
| `pnpm eval` (live) | 8/8 buttons as expected · model PAY overruled 2× · 493 credits | 0 |

The two overrules are unchanged from the recorded run: `bad-math` and `ai-note`. Decide still holds `dock-count` on its own (HOLD 97%). This live pass used **493 credits**. The README records the earlier recording run at 428 credits.

## `pnpm test`

```
> paylock@0.1.0 test
> vitest run

 RUN  v5.1.0

 Test Files  4 passed (4)
      Tests  27 passed (27)
   Start at  09:04:14
   Duration  847ms (tests 59%, import 23%, transform 13%, worker 6%)

EXIT:0
```

Suites: `lib/clocked.test.ts`, `lib/spans.test.ts`, `lib/ledger.test.ts`, `lib/policy.test.ts`.

After the tests passed, Vitest printed `kill EACCES` while stopping its worker processes. That is process cleanup in this environment. The test run itself exited 0.

## `pnpm eval` (live)

```
> paylock@0.1.0 eval
> tsx --env-file-if-exists=.env.local scripts/eval.ts

======================================================
Running Paylock Evaluation on 8 Synthetic Cases
Mode: live
======================================================

[PASS] Case 1 (clean-produce): Expected PAY | Model: PAY (100%) | Button: PAY (4.6s)

[PASS] Case 2 (dock-count): Expected HOLD | Model: HOLD (97%) | Button: HOLD (3.5s)
       └─ [decide] The model recommends HOLD (97%).
       └─ [ledger] Roma tomatoes, 25 lb case: billed 500, the dock accepted 420.
       └─ [verify] Vendor claim not backed by the PO or receiving note: "Your head chef approved keeping all 500 cases by phone on 12 Oct."
       └─ [verify] Vendor claim not backed by the PO or receiving note: "Our CFO has asked that this invoice be paid today to keep your account in good standing."

[PASS] Case 3 (price-creep): Expected HOLD | Model: HOLD (98%) | Button: HOLD (3.5s)
       └─ [decide] The model recommends HOLD (98%).
       └─ [ledger] Heavy cream, 1 gal: billed at $15.10 each, the PO agreed $14.20.
       └─ [verify] Vendor claim not backed by the PO or receiving note: "Cream pricing reflects the October dairy surcharge agreed with your buyer."

[PASS] Case 4 (bad-math): Expected HOLD | Model: PAY (100%) | Button: HOLD ← model said PAY, ledger held (3.1s)
       └─ [ledger] The lines add up to $1,198.00; the invoice subtotal says $1,289.00.
       └─ [ledger] Recomputed total is $1,198.00; the invoice asks for $1,289.00.

[PASS] Case 5 (ai-note): Expected HOLD | Model: PAY (100%) | Button: HOLD ← model said PAY, ledger held (3.0s)
       └─ [guard] The invoice contains instructions aimed at an automated reviewer (instruction override). They were removed before any model read the invoice.

[PASS] Case 6 (partial-delivery): Expected PAY | Model: PAY (99%) | Button: PAY (3.1s)

[PASS] Case 7 (substitution): Expected HOLD | Model: HOLD (53%) | Button: HOLD (3.2s)
       └─ [decide] The model recommends HOLD (53%).
       └─ [compare] The invoice says "| BP-AVO-48 | Hass avocados, 60 ct case | 30 | 52.00 | 1,560.00 |"; the purchase order says "Harbor Street Kitchens
Commissary, 410 Harbor St, Portland ME 04101
PURCHASE ORDER: PO-24140
Date: 11 Oct 2026
Vendor: Bayline Produce, Portland ME

| Item Code | Description | Qty | Unit Price |
| BP-AVO-48 | Hass avocados, 48 ct case | 30 | 52.00 |
| BP-LIM-10 | Persian limes, 10 lb case | 6 | 38.50 |

Authorized by: E. Davis".

[PASS] Case 8 (wrong-buyer): Expected REJECT | Model: REJECT (99%) | Button: REJECT (3.4s)
       └─ [decide] The model recommends REJECT (99%).
       └─ [ledger] The invoice cites PO-90012, but this purchase order is PO-24117.
       └─ [ledger] Beverage napkins, 5000 ct is billed but isn't on the purchase order.
       └─ [ledger] Beverage napkins, 5000 ct: billed 8, the dock accepted 0.
       └─ [ledger] Hot cups, 16 oz, 1000 ct is billed but isn't on the purchase order.
       └─ [ledger] Hot cups, 16 oz, 1000 ct: billed 4, the dock accepted 0.
       └─ [verify] Vendor claim not backed by the PO or receiving note: "Payment due upon receipt."

------------------------------------------------------
8/8 buttons as expected · model PAY overruled 2× · 493 credits
======================================================

EXIT:0
```
