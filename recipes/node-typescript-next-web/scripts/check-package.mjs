import { access } from "node:fs/promises";

await access(new URL("../.next/standalone/server.js", import.meta.url));
