import { expect, it } from 'vitest';
import { build } from 'esbuild';

it('bundles the chat and source conversation for browsers without Node dependencies', async () => {
  const result = await build({
    entryPoints: ['apps/reader/src/components/Chat.tsx', 'apps/reader/src/components/SourceAsk.tsx'],
    outdir: 'reader-test', bundle: true, platform: 'browser', write: false,
    loader: { '.css': 'empty' }, logLevel: 'silent'
  });
  expect(result.outputFiles).toHaveLength(2);
});
