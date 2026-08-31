# Changelog

All notable changes follow Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Added

- Pre-alpha `millctl` package foundation with exact-version lock enforcement.
- Stable human and JSON result envelopes.
- Compact executable schemas for repository, product, blueprint, scenario,
  outcome, configuration, and lock contracts.
- Non-executing PRD inspection, static repository adoption scan, and truthful
  mode-aware doctor command.
- Pinned least-privilege CI, CodeQL, dependency review, DCO, package smoke,
  coverage, and trusted-publishing release foundations.

### Changed

- None.

### Deprecated

- None.

### Removed

- None.

### Fixed

- Exact-version recovery, DCO parsing, per-job workflow bounds, JSON usage
  errors, malformed-contract classification, Node readiness, and valid `..name`
  paths now honor their documented contracts.

### Security

- Static inspection rejects path escape, symlink targets, oversized inputs,
  executable Git configuration, incomplete or over-budget trees, and
  repository-controlled command execution. Scan digests include Git hazard and
  truncation state.
