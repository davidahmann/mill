function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

// This checks Mill's bounded update policy, not the entire Dependabot schema.
export function dependabotFailures(
  document,
  { requireMillIgnores = false } = {},
) {
  const config = record(document);
  const failures = [];
  if (config?.version !== 2 || !Array.isArray(config.updates)) {
    return ["expected version 2 and an updates array"];
  }
  const npmUpdates = config.updates.filter(
    (update) => record(update)?.["package-ecosystem"] === "npm",
  );
  if (npmUpdates.length === 0) failures.push("missing npm updates");
  for (const [index, rawUpdate] of config.updates.entries()) {
    const update = record(rawUpdate);
    if (!update) {
      failures.push(`updates[${index}] must be a mapping`);
      continue;
    }
    const prefix = `updates[${index}]`;
    const groups = record(update.groups);
    if (update.groups !== undefined && !groups) {
      failures.push(`${prefix}.groups must be a mapping`);
    }
    let developmentGroup = false;
    for (const [name, rawGroup] of Object.entries(groups ?? {})) {
      const group = record(rawGroup);
      if (!group) {
        failures.push(`${prefix}.groups.${name} must be a mapping`);
        continue;
      }
      const types = group["update-types"];
      if (
        types !== undefined &&
        (!Array.isArray(types) ||
          types.length === 0 ||
          types.some((type) => !["major", "minor", "patch"].includes(type)))
      ) {
        failures.push(`${prefix}.groups.${name}: invalid group update-types`);
      }
      if (group["dependency-type"] === "development") {
        developmentGroup = true;
        if (
          !Array.isArray(types) ||
          types.length !== 2 ||
          !types.includes("minor") ||
          !types.includes("patch")
        ) {
          failures.push(
            `${prefix}.groups.${name}: development groups must allow only minor and patch`,
          );
        }
      }
    }
    if (update["package-ecosystem"] === "npm" && !developmentGroup) {
      failures.push(`${prefix}: missing bounded development group`);
    }
    const ignores = update.ignore ?? [];
    if (!Array.isArray(ignores)) {
      failures.push(`${prefix}.ignore must be an array`);
      continue;
    }
    for (const ignore of ignores) {
      const entry = record(ignore);
      const types = entry?.["update-types"];
      if (
        !entry ||
        typeof entry["dependency-name"] !== "string" ||
        (types !== undefined &&
          (!Array.isArray(types) ||
            types.length === 0 ||
            types.some(
              (type) =>
                ![
                  "version-update:semver-major",
                  "version-update:semver-minor",
                  "version-update:semver-patch",
                ].includes(type),
            )))
      ) {
        failures.push(`${prefix}: invalid ignore entry or update-types`);
      }
    }
    if (requireMillIgnores && update["package-ecosystem"] === "npm") {
      for (const dependency of ["@types/node", "typescript"]) {
        if (
          !ignores.some(
            (entry) =>
              record(entry)?.["dependency-name"] === dependency &&
              Array.isArray(entry["update-types"]) &&
              entry["update-types"].includes("version-update:semver-major"),
          )
        ) {
          failures.push(
            `${prefix}: missing ${dependency} major-version ignore`,
          );
        }
      }
    }
  }
  return failures;
}
