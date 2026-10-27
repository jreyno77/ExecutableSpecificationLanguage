import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as turn } from 'node:timers/promises';

const [checkout, source] = process.argv.slice(2);
if (!checkout || !source || typeof global.gc !== 'function') throw Error('Provide the compiled checkout, source and diagnostic GC capability.');
const moduleAt = path => import(pathToFileURL(join(checkout, 'dist', path)).href);
const [{ build }, { checkManifest }, { ProjectConnector }, { Outputs, ProjectOutput }, { typescriptOutput }, { BuildContext }] = await Promise.all([
  moduleAt('cli/cli-build.js'), moduleAt('cli/cli-check.js'), moduleAt('project/connection/project-connection.js'),
  moduleAt('project/output/output.js'), moduleAt('project/typescript/output-typescript.js'), moduleAt('cli/cli-context.js'),
]);
const parent = await fs.realpath(tmpdir()), directory = await fs.realpath(await fs.mkdtemp(join(parent, 'expec-phase-lifetime-')));
const file = async (path, text) => { const target = join(directory, path); await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, text); };
const buffer = snapshot => {
  const file = snapshot.files.find(file => file.path === 'opaque.bin');
  if (!file || file.bytes.byteLength !== 65_536) throw Error('The actual stage capture must contain its opaque fixture bytes.');
  return file.bytes.buffer;
};
const collect = async () => { await turn(); global.gc(); await turn(); global.gc(); await turn(); };
const read = BuildContext.prototype.readSnapshot, plan = ProjectOutput.prototype.plan;
let initial, transition, atPlanning;
try {
  await file('spec/main.expec', source);
  await file('project/package.json', '{"name":"phase-lifetime","private":true,"type":"module"}');
  await file('project/src/existing.ts', 'export {};\n');
  await file('project/opaque.bin', new Uint8Array(65_536));
  await file('project/tsconfig.json', JSON.stringify({ compilerOptions: {
    target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [],
  }, include: ['src/**/*.ts'] }));
  const manifest = join(directory, 'spec/expec.json');
  await file('spec/expec.json', JSON.stringify({ formatVersion: 1, version: '1.0.0', project: { root: '../project' },
    build: { entries: ['main.expec'] }, outputs: [{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }] }));
  const outputs = new Outputs(); outputs.register(typescriptOutput);
  const checked = await checkManifest(manifest, outputs.profiles);
  if (!checked.specification || checked.problems.length || checked.syntax.length || checked.deferred.length)
    throw Error('The lifetime fixture must compile before its resource observation.');
  const connected = await new ProjectConnector(manifest).connect(checked.configuration);
  if (connected.value?.status !== 'connected' || connected.problems.length) throw Error('The lifetime fixture must connect to its actual project.');
  const raw = connected.value.context;
  const project = { root: raw.root, readSnapshot: () => raw.readSnapshot(), captureSnapshot: async () => {
    const captured = await raw.captureSnapshot(); initial ??= new WeakRef(buffer(captured)); return captured;
  } };
  BuildContext.prototype.readSnapshot = async function (...args) {
    const captured = await read.apply(this, args); transition ??= new WeakRef(buffer(captured)); return captured;
  };
  ProjectOutput.prototype.plan = async function (...args) {
    if (!atPlanning) {
      if (!initial || !transition) throw Error('Planning must follow the actual recovery and transition acquisitions.');
      const stage = new WeakRef(buffer(args[1]));
      await collect();
      atPlanning = { initialAlive: !!initial.deref(), transitionAlive: !!transition.deref(), stageAlive: !!stage.deref() };
    }
    return plan.apply(this, args);
  };
  const result = await build(checked, project, outputs, new Set(), new AbortController().signal);
  process.stdout.write(JSON.stringify({ result: { status: result.status, exitCode: result.exitCode, problems: result.problems }, atPlanning }));
} finally {
  BuildContext.prototype.readSnapshot = read; ProjectOutput.prototype.plan = plan;
  if (dirname(directory) !== parent || !directory.split(/[\\/]/).at(-1)?.startsWith('expec-phase-lifetime-')
    || await fs.realpath(directory) !== directory) throw Error('Refuse unowned lifetime fixture cleanup.');
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
