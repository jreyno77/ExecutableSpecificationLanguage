import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Diagnostic } from './checking.js';
import { checkManifest, cliProblem } from './cli-check.js';
import { Outputs, contractListOutput, structureListOutput, type OutputRegistration } from './output.js';
import { acceptanceOutput } from './output-acceptance.js';
import { markdownOutput } from './output-markdown.js';
import { typescriptOutput } from './output-typescript.js';
import { umlOutput } from './uml-output.js';

export interface CliOutputs {
  readonly contracts?: readonly OutputRegistration[];
  readonly tests?: readonly OutputRegistration[];
}
const commands = ['check', 'build', 'test', 'init', 'install'];
const help = 'expec check|build|test|install [--config expec.json] [--json]\n'
  + 'expec build [--decisions changes.json]\nexpec init --root directory --target typescript [--yes] [--config expec.json] [--json]\n'
  + 'expec --help\nexpec --version\n';
type Report = { format: 1; command: string; status: string; exitCode: number; manifest: string;
  project?: unknown; version?: string; problems: readonly Diagnostic[]; syntax: readonly unknown[];
  deferred: readonly unknown[]; obligations: readonly Diagnostic[]; stages: readonly unknown[] };

export async function runCli(input: readonly string[], additional: CliOutputs = {}): Promise<number> {
  const args = [...input], supplied = { contracts: [...additional.contracts ?? []], tests: [...additional.tests ?? []] };
  const cwd = process.cwd();
  let command = '', manifest = resolve(cwd, 'expec.json'), json = args.includes('--json');
  const report = (status: string, exitCode: number, values: Partial<Report> = {}): number => {
    const result: Report = { format: 1, command, status, exitCode, manifest, problems: [], syntax: [], deferred: [],
      obligations: [], stages: [], ...values };
    if (json) process.stdout.write(JSON.stringify(result) + '\n');
    else {
      const stream = exitCode ? process.stderr : process.stdout;
      stream.write(status + ': ' + manifest + (result.version ? ' (specification ' + result.version + ')' : '') + '\n');
      for (const problem of result.problems) stream.write(problem.code + ': ' + problem.message + ' ' + JSON.stringify(problem.at) + '\n');
      for (const finding of [...result.syntax, ...result.deferred]) stream.write(JSON.stringify(finding) + '\n');
    }
    return exitCode;
  };
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    const parsed = parseArgs({ args, allowPositionals: true, tokens: true, strict: true, options: {
      config: { type: 'string' }, json: { type: 'boolean' }, decisions: { type: 'string' },
      root: { type: 'string' }, target: { type: 'string' }, yes: { type: 'boolean' },
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
      const version = (JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
      if (json) return report('version', 0, { version });
      process.stdout.write(version + '\n'); return 0;
    }
    for (const key of ['config', 'decisions', 'root', 'target']) if (values[key] !== undefined && !(values[key] as string).trim()) throw Error('--' + key + ' requires a nonblank value.');
    command = parsed.positionals[0] ?? '';
    if (parsed.positionals.length !== 1 || !commands.includes(command)) throw Error('Choose check, build, test, init or install.');
    if (values.decisions !== undefined && command !== 'build') throw Error('--decisions is only available for build.');
    if (['root', 'target', 'yes'].some(key => values[key] !== undefined) && command !== 'init') throw Error('--root, --target and --yes are only available for init.');
    if (command === 'init' && (!values.root || !values.target)) throw Error('init requires --root and --target.');
    if (values.config !== undefined) manifest = resolve(cwd, values.config as string);
  } catch (error) { return report('usage-error', 2, { problems: [cliProblem('invalid-command', String(error), manifest)] }); }
  try {
    const outputs = new Outputs();
    for (const registration of [typescriptOutput, markdownOutput, umlOutput, contractListOutput, structureListOutput,
      acceptanceOutput, ...supplied.contracts, ...supplied.tests]) outputs.register(registration);
    const checked = await checkManifest(manifest, outputs.profiles); manifest = checked.manifest;
    const details = { ...(checked.configuration ? { version: checked.configuration.version } : {}),
      ...(checked.project ? { project: checked.project } : {}), problems: checked.problems, syntax: checked.syntax, deferred: checked.deferred };
    if (!checked.specification) return report('invalid', 1, details);
    if (command === 'check') return report('checked', 0, details);
    return report('not-implemented', 1, details);
  } catch (error) { return report('failed', 1, { problems: [cliProblem('host-failure', String(error), manifest)] }); }
}
