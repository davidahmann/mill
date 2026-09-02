# MILL_PRODUCT_TITLE_MARKDOWN_TOKEN

This repository is independently operable with ordinary npm commands.

```sh
npm ci --ignore-scripts
npm run check
```

Mill coordinates approved product work but is not the build system. See
`product/contract.yaml`, `architecture/blueprint.yaml`, and
`quality/scenarios.yaml` for approved product truth.

The exact repository runtime is Node.js 24.18.1 with npm 11.16.0. Generated
build and browser artifacts stay under `.next` and `.mill-output`; neither path
is product source or delivery evidence.
