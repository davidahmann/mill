import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { format } from "prettier";
import { z } from "zod";

import { contractSchemas } from "../dist/contracts/schemas.js";

const root = path.resolve(import.meta.dirname, "..");
const definitions = {
  auditReport: ["audit-report.schema.json", "AuditReport"],
  blueprint: ["blueprint.schema.json", "Blueprint"],
  contextManifest: ["context-manifest.schema.json", "ContextManifest"],
  deliveryRecord: ["delivery-record.schema.json", "DeliveryRecord"],
  impactManifest: ["impact-manifest.schema.json", "ImpactManifest"],
  managedRepository: ["managed-repository.schema.json", "ManagedRepository"],
  millConfig: ["mill-config.schema.json", "MillConfig"],
  millLock: ["mill-lock.schema.json", "MillLock"],
  outcomePlan: ["outcome-plan.schema.json", "OutcomePlan"],
  productContract: ["product-contract.schema.json", "ProductContract"],
  publicAlphaQualification: [
    "public-alpha-qualification.schema.json",
    "PublicAlphaQualification",
  ],
  recipeManifest: ["recipe-manifest.schema.json", "RecipeManifest"],
  releaseEvidence: ["release-evidence.schema.json", "ReleaseEvidence"],
  repositoryIntegrationPlan: [
    "repository-integration-plan.schema.json",
    "RepositoryIntegrationPlan",
  ],
  reviewResult: ["review-result.schema.json", "ReviewResult"],
  scenarioSet: ["scenario-set.schema.json", "ScenarioSet"],
  sourceManifest: ["source-manifest.schema.json", "SourceManifest"],
  supportTuple: ["support-tuple.schema.json", "SupportTuple"],
  specificationProposal: [
    "specification-proposal.schema.json",
    "SpecificationProposal",
  ],
  taskPacket: ["task-packet.schema.json", "TaskPacket"],
  validationEvidence: ["validation-evidence.schema.json", "ValidationEvidence"],
  workerInvocation: ["worker-invocation.schema.json", "WorkerInvocation"],
  workerProfile: ["worker-profile.schema.json", "WorkerProfile"],
};

const check = process.argv.includes("--check");
for (const [kind, [file, title]] of Object.entries(definitions)) {
  const schema = z.toJSONSchema(contractSchemas[kind], { io: "input" });
  const output = await format(
    JSON.stringify({
      ...schema,
      $id: `https://github.com/davidahmann/mill/schemas/${file}`,
      title,
    }),
    { parser: "json" },
  );
  const destination = path.join(root, "schemas", file);
  if (check) {
    const existing = await readFile(destination, "utf8");
    if (existing !== output) {
      throw new Error(`${file} is not generated from its runtime schema`);
    }
  } else {
    await writeFile(destination, output, "utf8");
  }
}

process.stdout.write(
  check ? "schema generation check passed\n" : "schemas generated\n",
);
