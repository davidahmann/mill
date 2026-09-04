# Brownfield discovery evaluation

Status: local deterministic fixture evaluation; not a new supported runtime
tuple or release qualification.

## Fixture

- Repository: `https://github.com/typicode/json-server`
- Commit: `89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea`
- Tree: `d305d02f13ab51efaa9af089c65881f276a5e97f`
- License observed: MIT
- Preconditions: clean source tree; no dependency installation, application
  execution, test execution, source write, or fixture modification.

## Invocation and result

The candidate `millctl` ran `discover . --changed src/app.ts` against that
checked-out root. The JSON envelope had SHA-256
`f059936ef8c0ccd36a6bdf65d72872f51fdbde80054e7837edd20e9888849804`.

The report bound the exact commit/tree above and made the following static-only
observations:

- it found six TypeScript test files, including
  `src/adapters/normalized-adapter.test.ts`;
- the literal `src/*.test.ts` selector matched five root tests, not the nested
  adapter test;
- the nested test's `./adapters/normalized-adapter.ts` and `./service.ts`
  imports remained unresolved from its own directory rather than being repaired
  or guessed;
- `src/app.ts` yielded direct importer leads for `src/app.test.ts` and
  `src/bin.ts`;
- executed coverage remained `unknown`.

This evidence confirms extraction behavior under a real clean TypeScript
repository. It does not claim that JSON Server is compatible with Mill's
adoption recipe, that its tests pass, or that a static graph proves runtime
behavior or delivery safety.
