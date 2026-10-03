import type { Configuration } from './configuration.js';
import type { FileChange } from './project-writer.js';
import { reject } from './initialization-destination.js';

export function initialConfiguration(configuration: Configuration, root: string): Configuration {
  const output = configuration.outputs.find(output => output.id === 'typescript');
  if (output && (output.options.directory !== 'src' || output.options.configFile !== undefined && output.options.configFile !== 'tsconfig.json')) {
    reject('unsupported-initialization-options', root, 'This starter requires TypeScript directory src and tsconfig.json.');
  }
  return { ...structuredClone(configuration), project: { root }, outputs: structuredClone(output ? configuration.outputs
    : [...configuration.outputs, { id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }]) };
}
export function starter(version: string): readonly FileChange[] {
  const json = (data: unknown) => JSON.stringify(data, null, 2) + '\n';
  return Object.entries({
    'package.json': json({ private: true, version, type: 'module', scripts: { build: 'tsc --project tsconfig.json' }, devDependencies: { typescript: '5.9.3' } }),
    'tsconfig.json': json({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      rootDir: 'src', outDir: 'dist', declaration: true, noEmitOnError: true }, include: ['src/**/*.ts'] }),
    'src/index.ts': 'export {};\n', '.gitignore': 'node_modules/\ndist/\n',
  }).map(([path, text]) => ({ kind: 'write' as const, path, bytes: new TextEncoder().encode(text) }));
}
