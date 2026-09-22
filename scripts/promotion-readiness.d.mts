export type PromotionReadinessCode =
  | "VALIDATION_MISSING"
  | "VALIDATION_FAILED"
  | "VALIDATION_CANDIDATE_MISMATCH"
  | "REVIEW_MISSING"
  | "REVIEW_CANDIDATE_MISMATCH"
  | "REVIEW_SCOPE_MISMATCH"
  | "BLOCKING_REVIEW_FINDINGS";

export interface PromotionReadiness {
  ready: boolean;
  candidateCommit: string;
  reasonCodes: PromotionReadinessCode[];
}

export function evaluatePromotionReadiness(input: {
  candidateCommit: string;
  validation?: { passed: boolean; candidateCommit: string };
  review?: {
    candidateCommit: string;
    scopeDigest?: string;
    blockingFindingIds: readonly string[];
  };
  expectedScopeDigest?: string;
}): PromotionReadiness;
