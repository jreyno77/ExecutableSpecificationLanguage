import { readFile } from 'node:fs/promises';
import { defineConfig } from 'rolldown';
import license from 'rollup-plugin-license';

export default defineConfig({
  input: 'dist/cli-entry.js', platform: 'node', treeshake: false,
  external: [/^node:/, /^(?:typescript|@d2lang\/d2|cross-spawn|jsonc-parser)(?:\/|$)/],
  plugins: [license({ thirdParty: { multipleVersions: true, output: 'dist/cli-licenses.txt' } })],
  output: { file: 'dist/cli-entry.js', format: 'esm', codeSplitting: false,
    banner: async () => '/*!\n' + await readFile(new URL('./node_modules/rolldown/LICENSE', import.meta.url), 'utf8')
      + '\n' + await readFile(new URL('./node_modules/rolldown/THIRD-PARTY-LICENSE', import.meta.url), 'utf8') + '\n*/',
    keepNames: true, strictExecutionOrder: true, sourcemap: true },
});
