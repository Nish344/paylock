// scripts/eval.ts
import { FIXTURES } from "../lib/fixtures";
import { runPaylock } from "../lib/paylock";

async function main() {
  const mode = (process.env.CLOCKED_MODE as any) || undefined;
  console.log(`\n======================================================`);
  console.log(`Running Paylock Evaluation on 8 Synthetic Cases`);
  console.log(`Mode: ${mode || (process.env.CLOCKED_API_KEY ? "live" : "replay")}`);
  console.log(`======================================================\n`);

  let passedCount = 0;
  let overruledCount = 0;
  let totalCredits = 0;
  let anyFailed = false;

  for (let i = 0; i < FIXTURES.length; i++) {
    const f = FIXTURES[i];
    const caseStart = Date.now();
    try {
      const res = await runPaylock(f.invoice, f.po, f.receipt, { mode });
      const elapsed = ((Date.now() - caseStart) / 1000).toFixed(1);
      const decision = res.decision;
      totalCredits += decision.totalCredits;

      const isPass = decision.button === f.expected;
      if (isPass) {
        passedCount++;
      } else {
        anyFailed = true;
      }

      const rec = decision.modelRecommendation;
      const modelStr = rec
        ? `${rec.choice} (${Math.round(rec.probability * 100)}%)`
        : "NONE";
      const statusTag = isPass ? "PASS" : "FAIL";

      const overruledMarker =
        decision.overruled && rec?.choice === "PAY"
          ? " ← model said PAY, ledger held"
          : "";

      if (decision.overruled && rec?.choice === "PAY") {
        overruledCount++;
      }

      console.log(
        `[${statusTag}] Case ${i + 1} (${f.id}): Expected ${f.expected} | Model: ${modelStr} | Button: ${decision.button}${overruledMarker} (${elapsed}s)`
      );

      for (const r of decision.reasons) {
        console.log(`       └─ [${r.tag}] ${r.text}`);
      }
      console.log("");
    } catch (err: unknown) {
      anyFailed = true;
      console.error(
        `[FAIL] Case ${i + 1} (${f.id}): Exception thrown: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  console.log(`------------------------------------------------------`);
  const summaryLine = `${passedCount}/${FIXTURES.length} buttons as expected · model PAY overruled ${overruledCount}× · ${totalCredits} credits`;
  console.log(summaryLine);
  console.log(`======================================================\n`);

  if (anyFailed || passedCount !== FIXTURES.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Evaluation error:", err);
  process.exit(1);
});

