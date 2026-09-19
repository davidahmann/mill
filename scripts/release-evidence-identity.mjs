/** Cross-document bindings are separate from JSON shape validation. */
export function assertReleaseIdentity(metadata, qualification, identity) {
  if (
    !Array.isArray(metadata.builders) ||
    metadata.builders.length !== 2 ||
    metadata.builders[0]?.builder === metadata.builders[1]?.builder ||
    metadata.builders[0]?.contentsDigest !==
      metadata.builders[1]?.contentsDigest
  ) {
    throw new Error(
      "release metadata does not contain two distinct equal-content builders",
    );
  }
  const selected = metadata.builders.find(
    (builder) => builder.builder === metadata.selectedArtifact?.builder,
  );
  if (
    selected === undefined ||
    ["filename", "sha256", "npmIntegrity", "contentsDigest"].some(
      (key) => selected[key] !== metadata.selectedArtifact[key],
    )
  ) {
    throw new Error(
      "selected release artifact is not one exact builder output",
    );
  }
  if (
    metadata.package.name !== qualification.package.name ||
    metadata.package.version !== qualification.package.version ||
    metadata.selectedArtifact.sha256 !== qualification.package.artifactDigest ||
    metadata.selectedArtifact.npmIntegrity !==
      qualification.package.npmIntegrity ||
    identity.packageName !== metadata.package.name ||
    identity.version !== metadata.package.version ||
    identity.tag !== `v${metadata.package.version}`
  ) {
    throw new Error(
      "release source, artifact, and qualification identities do not match",
    );
  }
  if (
    qualification.auditCandidate?.commit !== identity.tagCommit ||
    qualification.auditCandidate?.tree !== identity.mainTree
  ) {
    throw new Error(
      "qualification audit is not bound to the tagged main candidate",
    );
  }
  if (identity.reviewedCandidateTree !== identity.mainTree) {
    throw new Error(
      "release source identity chain is not tree and commit preserving",
    );
  }
}

/** Optional for historical evidence; when present, both channels must be proven. */
export function assertReleaseChannels(evidence) {
  const channels = evidence.channels;
  if (channels === undefined) return;
  const release = evidence.githubRelease;
  const generatedAt = Date.parse(evidence.generatedAt);
  const publishedAt = Date.parse(release?.publishedAt ?? "");
  if (
    evidence.state !== "verified" ||
    release?.state !== "published" ||
    channels.npm.latestVersion !== evidence.package.version ||
    channels.github.releaseId !== release.releaseId ||
    channels.github.tag !== evidence.package.tag ||
    !Number.isFinite(publishedAt) ||
    [channels.npm.observedAt, channels.github.observedAt].some((value) => {
      const observedAt = Date.parse(value);
      return (
        !Number.isFinite(observedAt) ||
        observedAt < publishedAt ||
        observedAt > generatedAt
      );
    })
  ) {
    throw new Error(
      "final release channels do not bind fresh npm latest and GitHub Latest observations",
    );
  }
}
