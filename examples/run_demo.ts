/**
 * run_demo.ts — End-to-end demonstration of appeal-writer-mcp.
 *
 * Run with:  npx tsx examples/run_demo.ts
 *
 * This script:
 *  1. Initializes the KB store
 *  2. Ingests the sample KB documents (policy + prior accepted appeal)
 *  3. Loads the sample denial case
 *  4. Generates an appeal letter
 *  5. Prints the full text + missing evidence list
 */

import fs from "fs";
import path from "path";

// Bootstrap config (set defaults for demo)
process.env.STORAGE_PATH = process.env.STORAGE_PATH ?? "./data_demo";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

import { KBStore } from "../src/kb/store";
import { ingestDocuments } from "../src/kb/ingest";
import { generateAppealLetter } from "../src/appeal/generate";
import { runPlan } from "../src/appeal/plan";
import { DenialCase } from "../src/types";
import { config } from "../src/config";

const EXAMPLES_DIR = path.join(__dirname);

async function main() {
  console.log("=".repeat(60));
  console.log("appeal-writer-mcp DEMO");
  console.log("=".repeat(60));

  // 1. Init store
  const store = new KBStore(config.storagePath);
  store.init();
  console.log(`\n[1] KB store initialized at: ${config.storagePath}`);

  // 2. Ingest KB documents
  console.log("\n[2] Ingesting KB documents...");

  const policyText = fs.readFileSync(
    path.join(EXAMPLES_DIR, "sample_kb_policy.txt"),
    "utf-8"
  );
  const priorAppealText = fs.readFileSync(
    path.join(EXAMPLES_DIR, "sample_prior_appeal_accepted.txt"),
    "utf-8"
  );

  const ingestResults = await ingestDocuments(store, [
    {
      docId: "kb_policy_cpb045",
      filename: "sample_kb_policy.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(policyText).toString("base64"),
      meta: {
        payerName: "HEALTH INSURANCE COMPANY",
        docType: "policy",
        tags: ["physical-therapy", "CPB045", "session-limit", "medical-necessity"],
        createdAt: "2025-07-01T00:00:00Z",
      },
    },
    {
      docId: "kb_prior_appeal_pt_001",
      filename: "sample_prior_appeal_accepted.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(priorAppealText).toString("base64"),
      meta: {
        payerName: "HEALTH INSURANCE COMPANY",
        docType: "prior_appeal_accepted",
        tags: ["physical-therapy", "benefit-limit", "accepted"],
        createdAt: "2025-06-01T00:00:00Z",
      },
    },
  ]);

  for (const r of ingestResults) {
    console.log(`  ✓ Ingested: ${r.docId} — ${r.chunks} chunks`);
    if (r.warnings.length > 0) {
      r.warnings.forEach((w) => console.warn(`    ⚠ ${w}`));
    }
  }

  // 3. Load denial case
  console.log("\n[3] Loading sample denial case...");
  const denialCaseJson = fs.readFileSync(
    path.join(EXAMPLES_DIR, "sample_denial_case.json"),
    "utf-8"
  );
  const denialCase = JSON.parse(denialCaseJson) as DenialCase;
  console.log(`  ✓ Case ID: ${denialCase.caseId}`);
  console.log(`  ✓ Member: ${denialCase.memberName.value}`);
  console.log(`  ✓ Payer: ${denialCase.payerName.value}`);
  console.log(`  ✓ Denial category: ${denialCase.denialCategory.value}`);

  // 4. Run argument plan
  console.log("\n[4] Generating argument plan...");
  const planResult = runPlan(store, denialCase, {
    diagnosis: "Lumbar radiculopathy",
    requestedOutcome: "pay_claim",
  });
  console.log(`  ✓ Primary category: ${planResult.plan.primaryDenialCategory}`);
  console.log(`  ✓ Thesis: ${planResult.plan.thesis.slice(0, 100)}...`);
  console.log(`  ✓ Arguments: ${planResult.plan.arguments.length}`);
  console.log(`  ✓ Retrieved KB chunks: ${planResult.retrievedContext.length}`);
  if (planResult.missingEvidence.length > 0) {
    console.log(`  ⚠ Missing evidence (${planResult.missingEvidence.length}):`);
    planResult.missingEvidence.forEach((m) => console.log(`    - ${m}`));
  }

  // 5. Generate appeal letter
  console.log("\n[5] Generating appeal letter...");
  const letter = await generateAppealLetter(
    store,
    denialCase,
    {
      tone: "professional",
      includeCitationsInline: true,
      includePatientCoverPage: true,
    },
    {
      diagnosis: "Lumbar radiculopathy (ICD-10: M54.4)",
      requestedOutcome: "pay_claim",
      patientPhone: "555-867-5309",
    }
  );

  // 6. Print results
  console.log("\n" + "=".repeat(60));
  console.log("APPEAL LETTER");
  console.log("=".repeat(60));
  console.log(`Letter ID: ${letter.letterId}`);
  console.log(`Case ID:   ${letter.caseId}`);
  console.log(`Created:   ${letter.createdAt}`);
  console.log(`Tone:      ${letter.tone}`);
  console.log(`Sections:  ${letter.sections.length}`);
  console.log(`Total citations: ${letter.sections.reduce((n, s) => n + s.citations.length, 0)}`);
  console.log("\n--- FULL TEXT ---\n");
  console.log(letter.fullText);

  console.log("\n" + "=".repeat(60));
  console.log("ATTACHMENT CHECKLIST");
  console.log("=".repeat(60));
  letter.attachmentChecklist.forEach((a) => {
    console.log(`  [${a.required ? "REQUIRED" : "optional"}] ${a.item}`);
  });

  console.log("\n" + "=".repeat(60));
  console.log("MISSING EVIDENCE");
  console.log("=".repeat(60));
  if (letter.missingEvidence.length === 0) {
    console.log("  ✓ No missing evidence — letter is fully grounded.");
  } else {
    letter.missingEvidence.forEach((m) => console.log(`  ⚠ ${m}`));
  }

  console.log("\n" + "=".repeat(60));
  console.log("ACTION ITEMS");
  console.log("=".repeat(60));
  letter.actionItems.forEach((a) => {
    console.log(`  [${a.priority.toUpperCase()}] ${a.action}`);
  });

  // 7. Save letter to file
  const outputPath = path.join(EXAMPLES_DIR, "generated_letter_output.json");
  fs.writeFileSync(outputPath, JSON.stringify(letter, null, 2), "utf-8");
  console.log(`\n✓ Full letter saved to: ${outputPath}`);

  store.close();
  console.log("\nDemo complete.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
