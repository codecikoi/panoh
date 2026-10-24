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
  // Keep class names intact: libraries that check constructor names break when esbuild renames them.
  keepNames: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
