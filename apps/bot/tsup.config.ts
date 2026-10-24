import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  bundle: true,
  noExternal: [/.*/],
  // PGlite loads its WASM assets relative to its package; it is a dev-only driver and must stay unbundled.
  external: ["@electric-sql/pglite"],
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  // esbuild renames classes that clash with globals (AbortSignal -> AbortSignal2); node-fetch checks the class name,
  // so without this the bundled grammY client never sends a request and the bot hangs on startup.
  keepNames: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
