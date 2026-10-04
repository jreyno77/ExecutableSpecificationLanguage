import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from './output.js';
import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { ProjectRead, ProjectSearch } from './project-inspection.js';
import { KotlinDeclarations, kotlinOptions, type KotlinOptions } from './kotlin-declarations.js';
import { outputProblem } from './output-documents.js';
import { canonical, identifier, locatorSchema, success } from './identity-baseline.js';
import { z } from 'zod';
import { hash, literal } from './project-files.js';
import { KotlinProject } from './kotlin-project.js';
import { adoptKotlin } from './kotlin-adoption.js';
import { preserveKotlin } from './kotlin-preservation.js';
import { nativeInputs } from './native-inputs.js';
import { validDiff } from './output-contract.js';
import { kotlinConfiguration } from './kotlin-configuration.js';
import { readJson } from './json-data.js';

const statePath = '.expec/outputs/' + Buffer.from('kotlin').toString('hex') + '.json';
const state = z.strictObject({ format: z.literal(1), options: z.string(), subjects: z.array(identifier),
  mappings: z.array(z.strictObject({ id: identifier, kind: z.enum(['name', 'import']), name: z.string(), as: z.string().optional() })), files: z.array(z.strictObject({
  adopted: z.boolean().optional(), id: identifier, path: z.string().refine(literal), generated: z.string(), hash: z.string(),
  artifacts: z.array(z.strictObject({ specId: identifier, locator: locatorSchema })),
})) });

export const kotlinOutput: OutputRegistration = {
  id: 'kotlin', validate: options => {
    const result = kotlinOptions.safeParse(options);
    return result.success ? [] : result.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message }));
  },
  open: (options, context) => new KotlinOutput(kotlinOptions.parse(options), context),
};

class KotlinOutput implements OutputAdapter {
  readonly id = 'kotlin';
  constructor(private readonly options: KotlinOptions, private readonly context?: OutputContext) {}
  private state(snapshot: ProjectSnapshot): Check<z.infer<typeof state>> {
    const source = snapshot.files.find(file => file.path === statePath);
    if (!source) return { problems: [], deferred: [] };
    try {
      const parse = (text: string) => readJson(text, (_code, message) => { throw new Error(message); });
      const stored = state.parse(parse(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes)));
      kotlinOptions.parse(parse(stored.options));
      if (stored.files.some(file => hash(Buffer.from(file.generated)) !== file.hash || Buffer.from(file.generated).toString('utf8') !== file.generated
        || file.artifacts.some(item => item.locator.outputId !== this.id || (item.locator.value as { file: string }).file !== file.path))) throw new Error('Invalid generated Kotlin baseline.');
      new KotlinProject({ outputId: this.id }, stored.files.flatMap(file => file.artifacts));
      return success(stored);
    } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'Recorded Kotlin text, options or associations are invalid.')], deferred: [] }; }
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return { problems: [...snapshot.problems, outputProblem('incomplete-project', '', 'A complete captured project is required.')], deferred: [] };
    if (!nativeInputs(snapshot) || !snapshot.nativeInputs?.length) return { problems: [outputProblem('native-inputs-unavailable', '', 'Supply captured Kotlin native inputs before planning.')], deferred: [] };
    const configuration = kotlinConfiguration(snapshot, 'expec.kotlin.json');
    if (!configuration.value) return { problems: configuration.problems, deferred: [] };
    if (request.operation === 'delete') return { problems: [outputProblem('native-preservation-unavailable', '', 'Safe retirement is not available yet.')], deferred: [] };
    const stored = this.state(snapshot);
    if (stored.problems.length) return { problems: stored.problems, deferred: [] };
    const previous = stored.value;
    const missing = previous?.files.filter(file => !snapshot.files.some(current => current.path === file.path)) ?? [];
    if (missing.length) return { problems: missing.map(file => outputProblem('output-conflict', file.path, 'The recorded generated Kotlin file is missing.')), deferred: [] };
    const known = new Set([...request.current.baseline.elements.map(item => item.id), ...request.current.baseline.retired]);
    if (previous?.files.some(file => file.artifacts.some(item => !known.has(item.specId)))) return { problems: [outputProblem('unknown-output-identity', statePath, 'Current identity does not recognize earlier Kotlin output subjects.')], deferred: [] };
    if ('diff' in request && !validDiff(request.diff, request.current)) return { problems: [outputProblem('inconsistent-diff', '', 'The supplied transition disagrees with current identity facts.')], deferred: [] };
    if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts')))) return { problems: [outputProblem('not-addition-only', '', 'Use update when existing contracts change.')], deferred: [] };
    const declarations = new KotlinDeclarations(request.current, this.options, this.context);
    let files = declarations.render().map(file => {
      const adopted = previous?.files.find(old => old.id === file.id && old.adopted);
      return adopted ? { ...file, adopted: true, path: adopted.path, artifacts: file.artifacts.map(item => ({ ...item, locator: { ...item.locator,
        value: { ...item.locator.value as { file: string }, file: adopted.path },
      } })) } : file;
    });
    if (!previous && this.options.adoptExisting && !declarations.problems.length) {
      const adopted = await adoptKotlin(snapshot, files, request.current.baseline.artifacts, this.options.package);
      if (!adopted.value) return { problems: adopted.problems, deferred: adopted.deferred }; files = adopted.value;
    }
    const mappings = declarations.mapping(), problems = [...declarations.problems];
    if (previous) {
      const fixed = ({ names: _names, imports: _imports, ...options }: KotlinOptions) => canonical(options);
      const changed = new Set([...previous.mappings, ...mappings].map(rule => rule.id));
      const unsafe = [...changed].some(id => previous!.subjects.includes(id)
        && canonical(previous!.mappings.filter(rule => rule.id === id)) !== canonical(mappings.filter(rule => rule.id === id))
        && (previous!.mappings.some(rule => rule.id === id && rule.kind === 'import') || mappings.some(rule => rule.id === id && rule.kind === 'import')
          || !('diff' in request && request.diff.changes.some(change => change.id === id && change.kinds.some(kind => kind === 'rename' || kind === 'move')))));
      if (fixed(kotlinOptions.parse(JSON.parse(previous.options))) !== fixed(this.options) || unsafe) {
        return { problems: [outputProblem('output-options-changed', statePath, 'Retained native mappings and placement require an actual corresponding transition.')], deferred: [] };
      }
    }
    if (request.operation === 'create' && previous?.files.some(before => !files.some(file => file.id === before.id && file.path === before.path && file.text === before.generated))) return { problems: [outputProblem('use-update', statePath, 'Existing Kotlin contracts changed; use update.')], deferred: [] };
    for (const file of files) {
      const existing = snapshot.files.find(existing => existing.path === file.path), before = previous?.files.find(before => before.path === file.path);
      if (request.operation === 'create' && existing && !before && !file.adopted) problems.push(outputProblem('output-conflict', file.path, 'Existing native file needs explicit ownership before changing it.'));
      if (file.path.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(outputProblem('excluded-kotlin-input', file.path, 'The captured scope excludes this output destination.'));
    }
    const next = { format: 1, options: canonical(this.options), subjects: request.current.baseline.elements.map(item => item.id), mappings, files: files.map(file => ({ ...(file.adopted ? { adopted: true } : {}), id: file.id, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: file.artifacts })) };
    if (problems.length) return { problems, deferred: [] };
    const unchanged = previous && canonical(next) === canonical(previous);
    const preserved = unchanged ? success([]) : request.operation === 'create' && !previous ? undefined : await preserveKotlin(snapshot, previous?.files ?? [], files, declarations.constraints);
    if (preserved?.problems.length) problems.push(...preserved.problems);
    const changes = [...(preserved?.value ?? files.filter(file => !file.adopted).map(file => ({ kind: 'write' as const, path: file.path, bytes: Buffer.from(file.text) }))), { kind: 'write' as const, path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') }]
      .filter(change => change.kind !== 'write' || !snapshot.files.some(file => file.path === change.path && file.version === hash(change.bytes)));
    return problems.length ? { problems, deferred: [] } : success({ outputId: this.id, basedOn: snapshot, changes, artifacts: files.flatMap(file => file.artifacts) });
  }
  async read(id: string, snapshot: ProjectSnapshot): Promise<ProjectRead> {
    const stored = this.state(snapshot);
    if (stored.problems.length) return { artifacts: [], problems: stored.problems, coverage: {
      scope: [], complete: false, limitations: stored.problems.map(problem => problem.message),
    } };
    return new KotlinProject({ outputId: this.id }, stored.value?.files.flatMap(file => file.artifacts) ?? []).read(id, snapshot);
  }
  async search(id: string, snapshot: ProjectSnapshot): Promise<ProjectSearch> {
    const stored = this.state(snapshot);
    if (stored.problems.length) {
      const coverage = { scope: [], complete: false, limitations: stored.problems.map(problem => problem.message) };
      return { definitions: [], problems: stored.problems,
        incoming: { subject: id, direction: 'incoming', coverage, uses: [], unresolved: [] },
        outgoing: { subject: id, direction: 'outgoing', coverage, uses: [], unresolved: [] } };
    }
    return new KotlinProject({ outputId: this.id }, stored.value?.files.flatMap(file => file.artifacts) ?? []).search(id, snapshot);
  }
}
