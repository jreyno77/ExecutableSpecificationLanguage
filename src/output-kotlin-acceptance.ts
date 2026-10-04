import { z } from 'zod';
import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from './output.js';
import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { NodeId } from './model.js';
import { canonical, locatorSchema, success } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { readJson } from './json-data.js';
import { outputProblem } from './output-documents.js';
import { validDiff } from './output-contract.js';
import { KotlinExamples } from './kotlin-examples.js';
import { KotlinProject } from './kotlin-project.js';
import { kotlinOptions } from './kotlin-declarations.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';

const options = kotlinOptions.omit({ directory: true, concepts: true }).extend({
  testRoot: z.string().refine(path => literal(path) && !path.includes('\\')).default('src/test/kotlin'),
  domain: z.string().regex(/^[a-z][A-Za-z0-9]*$/), driver: locatorSchema.optional(), fixture: locatorSchema.optional(),
});
const statePath = '.expec/outputs/' + Buffer.from('kotlin-acceptance').toString('hex') + '.json';
const state = z.strictObject({ format: z.literal(1), options: z.string(), files: z.array(z.strictObject({
  id: z.string(), path: z.string().refine(literal), generated: z.string(), hash: z.string(), artifacts: z.array(z.strictObject({ specId: z.string(), locator: locatorSchema })),
})) });
export const kotlinAcceptanceOutput: OutputRegistration = {
  id: 'kotlin-acceptance', validate: value => { const parsed = options.safeParse(value); return parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message })); },
  open: (value, context) => new KotlinAcceptance(options.parse(value), context),
};

/** Coordinates captured native targets, checked examples and guarded output ownership. */
class KotlinAcceptance implements OutputAdapter {
  readonly id = 'kotlin-acceptance';
  constructor(private readonly settings: z.infer<typeof options>, private readonly context?: OutputContext) {}
  private state(snapshot: ProjectSnapshot): Check<z.infer<typeof state>> {
    const source = snapshot.files.find(file => file.path === statePath);
    if (!source) return { problems: [], deferred: [] };
    try {
      const stored = state.parse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes), (_code, message) => { throw Error(message); }));
      if (stored.files.some(file => hash(Buffer.from(file.generated)) !== file.hash || file.artifacts.some(item => item.locator.outputId !== this.id))) throw Error('Invalid generated baseline.');
      new KotlinProject({ outputId: this.id }, stored.files.flatMap(file => file.artifacts));
      return success(stored);
    } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'Recorded Kotlin acceptance ownership is invalid.')], deferred: [] }; }
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    const failure = (code: string, message: string, path = ''): Check<OutputPlan> => ({ problems: [outputProblem(code, path, message)], deferred: [] });
    const stored = this.state(snapshot); if (stored.problems.length) return { problems: stored.problems, deferred: [] };
    if (request.operation === 'delete') return failure('native-preservation-unavailable', 'Acceptance retirement requires native ownership reconciliation.');
    if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Supply the actual identity transition.');
    if (stored.value && stored.value.options !== canonical(this.settings)) return failure('output-options-changed', 'Native acceptance placement requires an explicit migration.');
    if (this.settings.driver || this.settings.fixture || this.settings.adoptExisting || this.settings.names.length || this.settings.imports.length) return failure('native-preservation-unavailable', 'These explicit mappings require native compatibility checking.');
    const native = await queryKotlin(snapshot, 'expec.kotlin.json');
    if (!native.value || native.problems.length) return { problems: native.problems, deferred: native.deferred };
    const targets = new Map<NodeId, KotlinQuery['declarations'][number]>();
    for (const association of request.current.baseline.artifacts.filter(item => item.locator.outputId !== this.id && item.locator.format === 'kotlin-symbol-1')) {
      const declarations = native.value.declarations.filter(item => canonical({ file: item.file, declaration: item.selector }) === canonical(association.locator.value));
      if (declarations.length !== 1) return failure('native-definition-unavailable', 'The executable native association must select one current declaration.');
      if (declarations[0]!.selector.some(item => item.name.startsWith('<anonymous@'))) return failure('invalid-native-mapping', 'Anonymous native owners cannot be adopted by a synthetic name.');
      const id = request.current.node(association.specId), before = targets.get(id);
      if (before && canonical(before) !== canonical(declarations[0])) return failure('ambiguous-native-target', 'Select one executable Kotlin target for this source declaration.');
      targets.set(id, declarations[0]!);
    }
    const rendered = new KotlinExamples(request.current, this.settings, targets, this.context), files = rendered.files();
    if (rendered.problems.length) return { problems: rendered.problems, deferred: [] };
    for (const file of files) {
      if (file.path.split('/').some(part => snapshot.excludeNames.includes(part))) return failure('excluded-kotlin-input', 'The output path intersects an excluded capture path.', file.path);
      const actual = snapshot.files.find(item => item.path === file.path), previous = stored.value?.files.find(item => item.path === file.path);
      if (actual && (!previous || actual.version !== previous.hash)) return failure('output-conflict', 'Current native acceptance text needs declaration-level preservation.', file.path);
    }
    const known = new Set([...request.current.baseline.elements.map(item => item.id), ...request.current.baseline.retired]);
    if (stored.value?.files.some(file => file.artifacts.some(item => !known.has(item.specId)))) return failure('unknown-output-identity', 'Current identity must recognize earlier native tests.');
    if (stored.value?.files.some(before => !files.some(file => file.path === before.path && file.text === before.generated))) return failure('native-preservation-unavailable', 'Changed acceptance contracts require native ownership reconciliation.');
    const generated = await queryKotlin({ ...snapshot, files: [...snapshot.files.filter(file => !files.some(after => after.path === file.path)), ...files.map(file => ({ path: file.path, bytes: Buffer.from(file.text), version: hash(Buffer.from(file.text)) }))] }, 'expec.kotlin.json');
    if (!generated.value || generated.problems.length) return { problems: generated.problems, deferred: generated.deferred };
    const next = { format: 1, options: canonical(this.settings), files: files.map(file => ({ id: file.id, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: file.artifacts })) };
    return success({ outputId: this.id, basedOn: snapshot, changes: [...files.map(file => ({ kind: 'write' as const, path: file.path, bytes: Buffer.from(file.text) })),
      { kind: 'write' as const, path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') }].filter(change => !snapshot.files.some(file => file.path === change.path && file.version === hash(change.bytes))),
      artifacts: files.flatMap(file => file.artifacts), obligations: rendered.obligations });
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const stored = this.state(snapshot);
    if (stored.problems.length) return { artifacts: [], problems: stored.problems, coverage: { scope: [], complete: false, limitations: stored.problems.map(problem => problem.message) } };
    return new KotlinProject({ outputId: this.id }, stored.value?.files.flatMap(file => file.artifacts) ?? []).read(id, snapshot);
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const stored = this.state(snapshot);
    if (stored.problems.length) {
      const coverage = { scope: [], complete: false, limitations: stored.problems.map(problem => problem.message) };
      return { definitions: [], problems: stored.problems, incoming: { subject: id, direction: 'incoming' as const, coverage, uses: [], unresolved: [] }, outgoing: { subject: id, direction: 'outgoing' as const, coverage, uses: [], unresolved: [] } };
    }
    return new KotlinProject({ outputId: this.id }, stored.value?.files.flatMap(file => file.artifacts) ?? []).search(id, snapshot);
  }
}
