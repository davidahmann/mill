# Repository delivery contract

- Product behavior and invariants come from `product/contract.yaml`.
- Architecture decisions come from `architecture/blueprint.yaml`.
- Scenarios and their oracles come from `quality/scenarios.yaml`.
- Native commands in `package.json` remain authoritative.
- Change only paths granted by the active task packet.
- Do not push, merge, deploy, expose credentials, or rewrite acceptance oracles.
- Keep the repository operable without Mill.
