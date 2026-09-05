export { runCli, createProgram, type CliIo } from "./cli-program.js";
export { auditRepository, type AuditReport } from "./audit/repository.js";
export {
  canonicalDigest,
  canonicalJson,
  type JsonValue,
} from "./contracts/canonical.js";
export {
  contractSchemas,
  repositoryIntelligenceSchema,
  type ContractKind,
} from "./contracts/schemas.js";
export {
  doctor,
  doctorReady,
  type DoctorMode,
  type DoctorReport,
} from "./doctor.js";
export { MillError, ExitCode } from "./errors.js";
export { inspectPrd, type PrdInspection } from "./intake/prd.js";
export {
  assessSpecificationProposal,
  loadPlanningSources,
  loadSpecificationProposal,
  promoteSpecificationProposal,
  semanticProposalDiff,
  type SourceManifest,
  type SpecificationAssessment,
  type SpecificationProposal,
} from "./planning/specification.js";
export {
  assessImpactManifest,
  buildSemanticEvidence,
  loadImpactPlanningInputs,
  type ImpactAssessment,
  type ImpactManifest,
  type SemanticEvidence,
} from "./planning/impact.js";
export {
  loadNodeWebRecipe,
  renderNodeWebRecipe,
  type FileOwnership,
  type RecipeFile,
  type RecipeManifest,
} from "./recipes/node-typescript-next-web.js";
export {
  assessPublicAlphaQualification,
  loadPublicAlphaQualification,
  type PublicAlphaQualification,
  type PublicAlphaQualificationAssessment,
} from "./qualification/public-alpha.js";
export {
  applyAdoptionIntegration,
  applyGreenfieldIntegration,
  planAdoptionIntegration,
  planDetach,
  planGreenfieldIntegration,
  type RepositoryIntegrationPlan,
} from "./repository/integration.js";
export { scanRepository, type RepositoryScan } from "./repository/scan.js";
export {
  assessDiscoveryFreshness,
  discoverRepository,
  type ChangeImpact,
  type ChangeLead,
  type DiscoverRepositoryInput,
  type DiscoveryFreshness,
  type ImportObservation,
  type ModuleObservation,
  type RepositoryIntelligence,
  type SourceLocation,
  type TestInventoryEntry,
  type TestSelection,
} from "./repository/intelligence.js";
export {
  dependencySnapshotDirectory,
  prepareDependencySnapshot,
  type DependencyPreparationResult,
} from "./runtime/dependencies.js";
export {
  finalizeDraftPr,
  observeDraftPr,
  openDraftPr,
  planDraftPr,
  reconcileDraftPr,
  type DeliveryRecord,
} from "./runtime/delivery.js";
export {
  cancelRun,
  codexAuthStatus,
  qualifyBaseline,
  resumeRun,
  reviewRun,
  runInventory,
  runStatus,
  startLocalRun,
  stateBackup,
  statePurge,
  stateRestore,
  supportBundle,
  verifyRun,
} from "./runtime/lifecycle.js";
export {
  continuationPacket,
  type ContinuationAction,
  type ContinuationUsage,
  type RunContinuationPacket,
} from "./runtime/continuation.js";
export {
  builderIsolationBoundary,
  requireBuilderIsolation,
  type BuilderIsolationBoundary,
  type BuilderIsolationRequest,
} from "./runtime/isolation.js";
export {
  createWorkerInvocation,
  type WorkerAdapter,
  type WorkerInvocation,
  type WorkerProfile,
} from "./runtime/worker.js";
export {
  nextReadyOutcome,
  prepareRepositoryDependencies,
  startNextReadyOutcome,
  startFounderDelivery,
  type NextOutcome,
} from "./workflows/founder.js";
export { MILL_PACKAGE, MILL_VERSION } from "./version.js";
export { planMerge, applyMerge, reconcileMerge } from "./runtime/merge.js";
export { compileChangeTasks, applyChangeTasks } from "./planning/tasks.js";
export {
  planNativeAdoption,
  applyNativeAdoption,
} from "./repository/native-adoption.js";
export { reconcileAuthorityPlans } from "./runtime/authority-plans.js";
export { planOutcomeClosure } from "./planning/closure.js";
