// scripts/probe.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { getFixture, FIXTURES } from "../lib/fixtures";
import { runPaylock } from "../lib/paylock";
import type { ClockedMode } from "../lib/clocked";

async function main() {
  const caseId = process.argv[2] || "dock-count";
  const fixture = getFixture(caseId);

  if (!fixture) {
    console.error(`Unknown fixture case: "${caseId}". Available cases:`);
    for (const f of FIXTURES) {
      console.error(`  - ${f.id} (${f.title})`);
    }
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`Probing case: ${fixture.id} (${fixture.title})`);
  console.log(`Expected Button: ${fixture.expected}`);
  console.log(`========================================\n`);

  const startTime = Date.now();
  const result = await runPaylock(fixture.invoice, fixture.po, fixture.receipt, {
    mode: (process.env.CLOCKED_MODE as ClockedMode) || "live",
  });
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // Write full raw result to probe-output.json
  const outputPath = path.join(process.cwd(), "probe-output.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");

  // Print required probe fields
  console.log(`--- GUARD VERDICT ---`);
  if (result.checks.guard.ok) {
    console.log(
      `Verdict: ${result.checks.guard.data.verdict} (injection score: ${result.checks.guard.data.injection}, category: ${result.checks.guard.data.category})`
    );
    if (result.removedSpans.length > 0) {
      console.log(`Removed spans:`, result.removedSpans);
    }
  } else {
    console.log(`Guard failed: ${result.checks.guard.error}`);
  }

  console.log(`\n--- LEDGER FINDINGS ---`);
  if (result.ledger) {
    console.log(`Payable cents: ${result.ledger.payableCents}`);
    if (result.ledger.findings.length === 0) {
      console.log(`(No findings - clean match)`);
    } else {
      for (const f of result.ledger.findings) {
        console.log(`[${f.rule}] ${f.sentence}`);
      }
    }
  } else {
    console.log(`(Ledger could not be built)`);
  }

  console.log(`\n--- DECIDE RECOMMENDATION ---`);
  if (result.checks.decide.ok) {
    const rec = result.decision.modelRecommendation;
    if (rec) {
      console.log(
        `Model choice: ${rec.choice} (${Math.round(rec.probability * 100)}% probability)`
      );
    } else {
      console.log(`(No recommendation found)`);
    }
  } else {
    console.log(`Decide failed: ${result.checks.decide.error}`);
  }

  console.log(`\n--- VENDOR CLAIMS & VERIFY ---`);
  if (result.vendorClaims.length === 0) {
    console.log(`(No vendor claims extracted)`);
  } else {
    for (const vc of result.vendorClaims) {
      console.log(`- Claim: "${vc.text}"`);
      console.log(`  Span in invoice: ${JSON.stringify(vc.span)}`);
      console.log(`  Verify verdict: ${vc.verdict || "not checked"}`);
    }
  }

  console.log(`\n--- CLERK NOTE ---`);
  console.log(result.clerkNote || "(None)");

  console.log(`\n--- VENDOR QUESTION ---`);
  console.log(result.vendorQuestion || "(None)");

  console.log(`\n--- POLICY DECISION ---`);
  console.log(`Final Button: ${result.decision.button} (Expected: ${fixture.expected})`);
  console.log(`Overruled: ${result.decision.overruled}`);
  console.log(`Total Credits: ${result.decision.totalCredits}`);
  console.log(`Reasons (${result.decision.reasons.length}):`);
  for (const r of result.decision.reasons) {
    console.log(`  [${r.tag}] ${r.text}`);
  }

  console.log(`\nProbe finished in ${elapsedSec}s. Raw output saved to probe-output.json\n`);
}

main().catch((err) => {
  console.error("Probe error:", err);
  process.exit(1);
});

