import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, onTestFinished, vi } from 'vitest';
import { BuildContext } from '../../../src/cli/cli-context.js';
import { build } from '../../../src/cli/cli-build.js';
import { checkManifest } from '../../../src/cli/cli-check.js';
import { readTransition, retainTransition, transitionChange } from '../../../src/cli/cli-transition.js';
import { pendingPath, transitionPath } from '../../../src/cli/cli-identity.js';
import { Outputs, ProjectOutput } from '../../../src/project/output/output.js';
import { typescriptOutput } from '../../../src/project/typescript/output-typescript.js';
import { canonical } from '../../../src/model/identity-baseline.js';
import { ProjectConnector, type ProjectSnapshot } from '../../../src/project/connection/project-connection.js';
import { JournalDriver } from './journal-project.js';

/** A journal caller supplies policy metadata over real filesystem acquisitions. */
export async function policyJournal(paths?: readonly string[]) {
  const project = await JournalDriver.create({ 'notes.txt': 'Keep this handwritten note.' });
  const ordinary = project.context;
  let policy = paths === undefined ? undefined : [...paths], plans = 0;
  const withPolicy = (snapshot: ProjectSnapshot, paths = policy): ProjectSnapshot => ({ ...snapshot,
    ...(paths?.length ? { excludePaths: [...paths] } : {}) });
  project.context = { root: ordinary.root, readSnapshot: async () => withPolicy(await ordinary.readSnapshot()) };
  const outputs = new Outputs();
  for (const id of ['first', 'second']) outputs.register({ id, validate: () => [], open: () => ({ id,
    plan: async () => { plans++; throw Error('Pending intent must be resolved before new planning.'); },
    read: async () => { throw Error('Pending intent must be resolved before reading output.'); },
    search: async () => { throw Error('Pending intent must be resolved before searching output.'); },
  }) });
  return {
    project,
    configurePaths(paths: readonly string[]) { policy = [...paths]; },
    async interrupt() {
      await project.rememberOriginal(); project.stopAtWrite('Second.txt');
      await project.apply([project.plan([{ kind: 'write', path: 'First.txt', bytes: Buffer.from('First') },
        { kind: 'write', path: 'Second.txt', bytes: Buffer.from('Second') }])]);
      project.clearFailure();
      if (project.report.exitCode !== 1 || !(await project.pending()).plans.length)
        throw Error('The policy example needs an actual interrupted prefix and pending intent.');
    },
    async generate() {
      return build(project.checked, project.context, outputs, new Set(), new AbortController().signal);
    },
    expectNoPlanning() { expect(plans).toBe(0); },
    async pendingBytes() { return project.read(pendingPath); },
    async transition() {
      const snapshot = await project.context.readSnapshot(), tests = new Set(['second']);
      const retained = retainTransition(project.checked, snapshot, tests, undefined, project.identified);
      const change = transitionChange(retained);
      if (change.kind !== 'write') throw Error('The source example must retain both real output stages.');
      await project.write(transitionPath, change.bytes);
      return { read: async () => readTransition(project.checked, await project.context.readSnapshot(), tests), retained };
    },
    async captureAcrossNativePolicyChange() {
      let reads = 0;
      const context = new BuildContext({ root: ordinary.root, readSnapshot: async () =>
        withPolicy(await ordinary.readSnapshot(), ++reads === 2 || reads === 3 ? ['notes'] : ['dist']) },
      project.checked, [{ id: 'typescript', options: {} }]);
      return context.readSnapshot();
    },
  };
}

export async function completedPolicyConfirmation(paths: readonly string[]) {
  const project = await JournalDriver.completedConfirmation();
  const pending = await project.pending();
  pending.graph.excludePaths = [...paths];
  pending.facts = canonical({ ...JSON.parse(pending.facts), excludePaths: [...paths] });
  await project.write(pendingPath, JSON.stringify(pending));
  const ordinary = project.context;
  let policy = [...paths];
  project.context = { root: ordinary.root, readSnapshot: async () => ({ ...await ordinary.readSnapshot(), excludePaths: [...policy] }) };
  return { project, configurePaths(paths: readonly string[]) { policy = [...paths]; } };
}

export async function configuredPolicyBuild(options: { source: string; excludePaths: string[]; projectSource?: string; configFile?: string }) {
  const project = await JournalDriver.create({ 'src/existing.ts': 'export {};\n', 'tsconfig.json': JSON.stringify({
    compilerOptions: { target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext', types: [] }, include: ['src/**/*.ts'],
  }) });
  const source = options.projectSource ? project.path(options.projectSource) : join(dirname(project.checked.manifest), 'main.expec');
  await fs.mkdir(dirname(source), { recursive: true }); await fs.writeFile(source, options.source);
  await fs.writeFile(project.checked.manifest, JSON.stringify({ formatVersion: 1, version: '1.0.0',
    project: { root: '../project', excludePaths: [...options.excludePaths] },
    build: { entries: [options.projectSource ? '../project/' + options.projectSource : 'main.expec'],
      ...(options.projectSource ? { sourceRoots: ['../project/' + dirname(options.projectSource).split('\\').join('/')] } : {}) },
    outputs: [{ id: 'typescript', options: { directory: 'src', ...(options.configFile ? { configFile: options.configFile } : {}) } }],
  }));
  const outputs = new Outputs(); outputs.register(typescriptOutput);
  project.checked = await checkManifest(project.checked.manifest, outputs.profiles);
  if (!project.checked.configuration || !project.checked.specification || project.checked.problems.length || project.checked.syntax.length || project.checked.deferred.length)
    throw Error('The configured policy example must have actual checked source: ' + JSON.stringify(project.checked.problems));
  const connected = await new ProjectConnector(project.checked.manifest).connect(project.checked.configuration);
  if (connected.value?.status !== 'connected' || connected.problems.length) throw Error('The configured policy example must connect.');
  project.context = connected.value.context;
  const plan = ProjectOutput.prototype.plan;
  let planned = 0;
  const observed = vi.spyOn(ProjectOutput.prototype, 'plan').mockImplementation(function (this: ProjectOutput, ...args) { planned++; return plan.apply(this, args); });
  onTestFinished(() => observed.mockRestore());
  return { project, expectNoPlanning() { expect(planned).toBe(0); },
    changeSource: (text: string) => fs.writeFile(source, text),
    generate: () => build(project.checked, project.context, outputs, new Set(), new AbortController().signal),
  };
}
