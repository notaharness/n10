import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('bundles the React bindings and their public contracts without Node capabilities', async () => {
  const result = await build({
    stdin: {
      contents:
        "export * from '@n10/app-core'; export * from '@n10/engine/contract';",
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  expect(result.errors).toEqual([]);
  expect(result.outputFiles[0].text).toContain('usePlanStore');
});
