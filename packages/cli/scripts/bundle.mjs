// Bundle the CLI into a single self-contained dist/index.js for `npm pack`.
// ESM output needs a createRequire shim because bundled CJS deps (commander)
// call require() for node builtins. The shebang is injected here so the packed
// file is directly executable.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/index.js',
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __pcCreateRequire } from 'node:module';",
      'const require = __pcCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
