import { packageRoot } from '../resources.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { WriteResult } from '../project/connection/project-writer.js';
import type { Diagnostic } from '../compiler/checking.js';
import { checkManifest, readManifest, cliProblem } from './cli-check.js';
import { build } from './cli-build.js';
import { testProject } from './cli-test.js';
import { initialize, install } from './cli-project.js';
import { ProjectConnector } from '../project/connection/project-connection.js';
import { Outputs, contractListOutput, structureListOutput, type OutputRegistration } from '../project/output/output.js';
import { acceptanceOutput } from '../project/typescript/output-acceptance.js';
import { markdownOutput } from '../project/output/output-markdown.js';
import { typescriptOutput } from '../project/typescript/output-typescript.js';
import { umlOutput } from '../project/output/uml-output.js';
import { javaOutput } from '../project/java/output-java.js';
import { javaAcceptanceOutput } from '../project/java/output-java-acceptance.js';
import { javaCliExclusions } from '../project/java/cli-java.js';
import { kotlinOutput } from '../project/kotlin/output-kotlin.js';
import { kotlinAcceptanceOutput } from '../project/kotlin/output-kotlin-acceptance.js';
import { kotlinExclusions } from '../project/kotlin/cli-kotlin.js';
import { pythonOutput } from '../project/python/output-python.js';
import { pythonAcceptanceOutput } from '../project/python/output-python-acceptance.js';
import { pythonExclusions } from '../project/python/python-profile.js';
import { cliProfile } from './cli-profile.js';

export interface CliOutputs {
  readonly contracts?: readonly OutputRegistration[];
  readonly tests?: readonly OutputRegistration[];
}
const commands = ['check', 'build', 'test', 'init', 'install'];
const help = 'expec check|build|test|install [--config expec.json] [--json]\n'
  + 'expec build [--decisions changes.json]\nexpec init --root directory --target typescript|java|kotlin [--java-home path] [--yes] [--config expec.json] [--json]\n'
  + 'expec init --root directory --target python --python interpreter --uv executable [--yes] [--config expec.json] [--json]\n'
  + 'expec install --offline [--config expec.json] [--json] (Python only)\n'
  + 'expec --help\nexpec --version\n';
type Report = { format: 1; command: string; status: string; exitCode: number; manifest: string;
  project?: { path: string; identity: string }; version?: string; problems: readonly Diagnostic[]; syntax: readonly unknown[];
  deferred: readonly unknown[]; obligations: readonly Diagnostic[]; stages: readonly unknown[] };

export async function runCli(input: readonly string[], additional: CliOutputs = {}): Promise<number> {
  const args = [...input], supplied = { contracts: [...additional.contracts ?? []], tests: [...additional.tests ?? []] };
  const cwd = process.cwd();
  let command = '', manifest = resolve(cwd, 'expec.json'), json = args.includes('--json'), interrupted = false;
  const report = (status: string, exitCode: number, values: Partial<Report> = {}): number => {
    const result: Report = { format: 1, command, status, exitCode, manifest, problems: [], syntax: [], deferred: [],
      obligations: [], stages: [], ...values, ...(interrupted ? { status: 'cancelled', exitCode: 130 } : {}) };
    if (json) process.stdout.write(JSON.stringify(result, function (key, value: unknown) {
      const original = key ? this[key] as unknown : value;
      return original instanceof Uint8Array ? { encoding: 'base64', data: Buffer.from(original).toString('base64') } : value;
    }) + '\n');
    else {
      const stream = result.exitCode ? process.stderr : process.stdout;
      stream.write(result.status + ': ' + manifest + (result.version ? ' (specification ' + result.version + ')' : '') + '\n');
      if (result.project) stream.write('Project: ' + result.project.path + '\n');
      for (const stage of result.stages as { name: string; status: string; outputs?: string[]; receipt?: WriteResult; write?: WriteResult; initialization?: { write?: WriteResult }; tests?: { title: string; state: string; errors: unknown[] }[]; errors?: unknown[] }[]) {
        stream.write(stage.name + ': ' + stage.status + (stage.outputs?.length ? ' (' + stage.outputs.join(', ') + ')' : '') + '\n');
        for (const outcome of (stage.receipt ?? stage.write ?? stage.initialization?.write)?.outcomes ?? [])
          stream.write('  ' + outcome.state + ': ' + (outcome.change.kind === 'move' ? outcome.change.from + ' → ' + outcome.change.to : outcome.change.path) + '\n');
        for (const test of stage.tests ?? []) { stream.write('  ' + test.state + ': ' + test.title + '\n'); for (const error of test.errors) process.stderr.write(JSON.stringify(error) + '\n'); }
        for (const error of stage.errors ?? []) process.stderr.write(JSON.stringify(error) + '\n');
      }
      for (const obligation of result.obligations) stream.write(obligation.code + ': ' + obligation.message + ' ' + JSON.stringify(obligation.at) + '\n');
      for (const problem of result.problems) stream.write(problem.code + ': ' + problem.message + ' ' + JSON.stringify(problem.at) + '\n');
      for (const finding of [...result.syntax, ...result.deferred]) stream.write(JSON.stringify(finding) + '\n');
    }
    return result.exitCode;
  };
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    const parsed = parseArgs({ args, allowPositionals: true, tokens: true, strict: true, options: {
      config: { type: 'string' }, json: { type: 'boolean' }, decisions: { type: 'string' },
      root: { type: 'string' }, target: { type: 'string' }, yes: { type: 'boolean' },
      'java-home': { type: 'string' },
      python: { type: 'string' }, uv: { type: 'string' }, offline: { type: 'boolean' },
      help: { type: 'boolean' }, version: { type: 'boolean' },
    } });
    const seen = new Set<string>();
    for (const token of parsed.tokens) if (token.kind === 'option') {
      if (seen.has(token.name)) throw Error('Option --' + token.name + ' is repeated.'); seen.add(token.name);
    }
    values = parsed.values; json = values.json === true;
    if (values.help || values.version) {
      if (parsed.positionals.length || Object.keys(values).some(key => !['help', 'version', 'json'].includes(key))
        || values.help && (values.version || values.json)) throw Error('Use --help or --version separately.');
      if (values.help) { process.stdout.write(help); return 0; }
      command = 'version';
      const version = (JSON.parse(await readFile(new URL('../package.json', packageRoot), 'utf8')) as { version: string }).version;
      if (json) return report('version', 0, { version });
      process.stdout.write(version + '\n'); return 0;
    }
    for (const key of ['config', 'decisions', 'root', 'target', 'java-home', 'python', 'uv']) if (values[key] !== undefined && !(values[key] as string).trim()) throw Error('--' + key + ' requires a nonblank value.');
    command = parsed.positionals[0] ?? '';
    if (parsed.positionals.length !== 1 || !commands.includes(command)) throw Error('Choose check, build, test, init or install.');
    if (values.offline !== undefined && command !== 'install') throw Error('--offline is only available for install.');
    if (values.decisions !== undefined && command !== 'build') throw Error('--decisions is only available for build.');
    if (['root', 'target', 'yes', 'java-home'].some(key => values[key] !== undefined) && command !== 'init') throw Error('--root, --target, --java-home and --yes are only available for init.');
    if (values['java-home'] !== undefined && !['java', 'kotlin'].includes(values.target as string)) throw Error('--java-home is only available for Java or Kotlin targets.');
    if (['python', 'uv'].some(key => values[key] !== undefined) && (command !== 'init' || values.target !== 'python')) throw Error('--python and --uv are only available for Python initialization.');
    if (command === 'init' && (!values.root || !values.target)) throw Error('init requires --root and --target.');
    if (values.config !== undefined) manifest = resolve(cwd, values.config as string);
  } catch (error) { return report('usage-error', 2, { problems: [cliProblem('invalid-command', String(error), manifest)] }); }
  const controller = new AbortController(), cancel = () => { interrupted = true; controller.abort(); };
  process.once('SIGINT', cancel);
  try {
    const outputs = new Outputs();
    for (const registration of [typescriptOutput, markdownOutput, umlOutput, contractListOutput, structureListOutput,
      acceptanceOutput, javaOutput, javaAcceptanceOutput, kotlinOutput, kotlinAcceptanceOutput, pythonOutput, pythonAcceptanceOutput, ...supplied.contracts, ...supplied.tests]) outputs.register(registration);
    const selected = manifest;
    let checked = await (command === 'init' || command === 'install' ? readManifest : checkManifest)(manifest, outputs.profiles);
    manifest = checked.manifest;
    const interactive = !json && !!process.stdin.isTTY && !!process.stderr.isTTY;
    if (checked.configuration && (command === 'init' || command === 'install')) {
      if (command === 'install') {
        const profile = cliProfile(checked.configuration);
        if (!profile.value) return report('invalid', 1, { version: checked.configuration.version, problems: profile.problems });
        checked.profile = profile.value;
        if (values.offline && profile.value.target !== 'python') return report('invalid', 1, { problems: [cliProblem('unsupported-install-option', '--offline is currently supported only by the Python CLI profile.', manifest)] });
      }
      const result = command === 'init' ? await initialize(checked, selected, { root: values.root as string, target: values.target as string,
        ...(typeof values['java-home'] === 'string' ? { javaHome: values['java-home'] } : {}),
        ...(typeof values.python === 'string' ? { python: values.python } : {}), ...(typeof values.uv === 'string' ? { uv: values.uv } : {}) }, values.yes === true, interactive, controller.signal)
        : await install(checked, values.offline === true);
      return report(controller.signal.aborted ? 'cancelled' : result.status, controller.signal.aborted ? 130 : result.exitCode,
        { version: checked.configuration.version, ...result, ...(controller.signal.aborted ? { exitCode: 130, status: 'cancelled' } : {}) });
    }
    const details = { ...(checked.configuration ? { version: checked.configuration.version } : {}),
      ...(checked.project ? { project: checked.project } : {}), problems: checked.problems, syntax: checked.syntax, deferred: checked.deferred };
    if (!checked.specification) {
      if (command === 'build' && checked.problems.some(problem => problem.code === 'project-required')) return report('action-required', 3,
        { ...details, problems: [...details.problems, cliProblem('initialization-required', 'Run expec init --root <directory> --target typescript --yes, then expec install before this build can be checked.', manifest)] });
      return report('invalid', 1, details);
    }
    if (command === 'check') return report('checked', 0, details);
    if (command === 'test') {
      const connection = await new ProjectConnector(manifest, checked.profile?.target === 'java' ? { excludeNames: javaCliExclusions }
        : checked.profile?.target === 'kotlin' ? { excludeNames: kotlinExclusions }
        : checked.profile?.target === 'python' ? { excludeNames: pythonExclusions } : undefined).connect(checked.configuration!);
      if (connection.value?.status !== 'connected') return report('invalid', 1, { ...details, problems: [...connection.problems, cliProblem('project-required', 'Connect a generated project before executing tests.', manifest)] });
      const result = await testProject(checked, connection.value.context, outputs, controller.signal);
      return report(result.status, result.exitCode, { ...details, ...result });
    }
    if (command === 'build') {
      if (!checked.configuration!.outputs.length) return report('built', 0, { ...details, stages: [{ name: 'contracts', status: 'not-run' }, { name: 'tests', status: 'not-run' }] });
      let connection = await new ProjectConnector(manifest, checked.profile?.target === 'java' ? { excludeNames: javaCliExclusions }
        : checked.profile?.target === 'kotlin' ? { excludeNames: kotlinExclusions }
        : checked.profile?.target === 'python' ? { excludeNames: pythonExclusions } : undefined).connect(checked.configuration!);
      if (!connection.value) return report('invalid', 1, { ...details, problems: connection.problems });
      if (connection.value.status === 'unconnected') {
        const initialized = await initialize(checked, selected, undefined, false, interactive, controller.signal);
        if (initialized.exitCode) return report(initialized.status, initialized.exitCode, { ...details, ...initialized });
        checked = await checkManifest(manifest, outputs.profiles);
        if (!checked.specification) return report('invalid', 1, { ...(checked.configuration ? { version: checked.configuration.version } : {}), ...(initialized.project ? { project: initialized.project } : {}),
          stages: [...initialized.stages, { name: 'contracts', status: 'not-run' }, { name: 'tests', status: 'not-run' }], syntax: checked.syntax,
          deferred: checked.deferred, problems: [...checked.problems, cliProblem('installation-required', 'Run expec install explicitly before continuing this build.', manifest)] });
        connection = await new ProjectConnector(manifest, checked.profile?.target === 'java' ? { excludeNames: javaCliExclusions }
        : checked.profile?.target === 'kotlin' ? { excludeNames: kotlinExclusions }
        : checked.profile?.target === 'python' ? { excludeNames: pythonExclusions } : undefined).connect(checked.configuration!);
      }
      if (connection.value?.status === 'connected') {
        const result = await build(checked, connection.value.context, outputs, new Set(['acceptance', 'java-acceptance', 'kotlin-acceptance', 'python-acceptance', ...supplied.tests.map(output => output.id)]), controller.signal, typeof values.decisions === 'string' ? resolve(cwd, values.decisions) : undefined);
        return report(result.status, result.exitCode, { ...details, ...result });
      }
    }
    return report('not-implemented', 1, details);
  } catch (error) { return report(controller.signal.aborted ? 'cancelled' : 'failed', controller.signal.aborted ? 130 : 1, { problems: [cliProblem('host-failure', String(error), manifest)] }); }
  finally { process.removeListener('SIGINT', cancel); }
}
