# Development

Use Node.js 24.18.1 and npm 11.16.0. Those exact versions match the pinned
Playwright verifier image.

```sh
npm ci --ignore-scripts
npm run dev
npm run check
```

The browser lane requires the Chromium revision bundled with Playwright 1.62.1.
Mill validation uses the exact pinned Playwright OCI image with no network. It
mounts repository source and `node_modules` read-only and provides only `.next`
and `.mill-output` as temporary writable trees. Native host development remains
ordinary npm usage and does not require Mill.
