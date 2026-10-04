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
import type { FileChange } from './project-writer.js';
import { preserveKotlin, retireKotlin } from './kotlin-preservation.js';
import { checkKotlinDriver, kotlinDriver, kotlinDriverBindings } from './kotlin-test-driver.js';
import { KotlinExamples } from './kotlin-examples.js';
import { KotlinProject } from './kotlin-project.js';
import { checkKotlinTests } from './kotlin-test-contract.js';
import { compatibleKotlinFixture, migrateKotlinFixture, selectedKotlinFixture } from './kotlin-fixture.js';
import { kotlinOptions } from './kotlin-declarations.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';

const options = kotlinOptions.omit({ directory: true, concepts: true }).extend({
  testRoot: z.string().refine(path => literal(path) && !path.includes('\\')).default('src/test/kotlin'),
  domain: z.string().regex(/^[a-z][A-Za-z0-9]*$/), driver: locatorSchema.optional(), fixture: locatorSchema.optional(),
});
const statePath = '.expec/outputs/' + Buffer.from('kotlin-acceptance').toString('hex') + '.json';
const association = z.strictObject({ specId: z.string(), locator: locatorSchema });
const state = z.strictObject({ format: z.literal(1), options: z.string(), deleted: z.array(z.string()).default([]), fixture: association.optional(), driver: association.optional(), bindings: z.array(association).optional(), files: z.array(z.strictObject({
  id: z.string(), path: z.string().refine(literal), generated: z.string(), hash: z.string(), artifacts: z.array(association),
})) });
export const kotlinAcceptanceOutput: OutputRegistration = {
  id: 'kotlin-acceptance', validate: value => { const parsed = options.safeParse(value); return parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message })); },
  open: (value, context) => new KotlinAcceptance(options.parse(value), context),
};

/** Coordinates captured native targets, checked examples and guarded output ownership. */
class KotlinAcceptance implements OutputAdapter {
  readonly id = 'kotlin-acceptance';
  constructor(private readonly settings: z.infer<typeof options>, private readonly context?: OutputContext) {}
  private artifacts(stored?: z.infer<typeof state>) {
    return [...stored?.files.flatMap(file => file.artifacts) ?? [], ...stored?.fixture ? [stored.fixture] : [],
      ...stored?.driver ? [stored.driver] : [], ...stored?.bindings ?? []].filter(item => !stored?.deleted.includes(item.specId));
  }
  private state(snapshot: ProjectSnapshot): Check<z.infer<typeof state>> {
    const source = snapshot.files.find(file => file.path === statePath);
    if (!source) return { problems: [], deferred: [] };
    try {
      const stored = state.parse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(source.bytes), (_code, message) => { throw Error(message); }));
      if (stored.files.some(file => hash(Buffer.from(file.generated)) !== file.hash || file.artifacts.some(item => item.locator.outputId !== this.id))) throw Error('Invalid generated baseline.');
      if (canonical(options.parse(JSON.parse(stored.options))) !== stored.options) throw Error('Invalid recorded options.');
      new KotlinProject({ outputId: this.id }, [...stored.files.flatMap(file => file.artifacts), ...stored.fixture ? [stored.fixture] : [], ...stored.driver ? [stored.driver] : [], ...stored.bindings ?? []]);
      return success(stored);
    } catch { return { problems: [outputProblem('invalid-output-state', statePath, 'Recorded Kotlin acceptance ownership is invalid.')], deferred: [] }; }
  }
  private async integrity(snapshot: ProjectSnapshot, stored?: z.infer<typeof state>): Promise<Check> {
    if (!stored) return { problems: [], deferred: [] };
    const settings = options.parse(JSON.parse(stored.options)), name = settings.domain[0]!.toUpperCase() + settings.domain.slice(1);
    const driver = settings.testRoot + '/' + settings.package.replaceAll('.', '/') + '/driver/' + name + 'Driver.kt';
    if (stored.files.every(file => file.path === driver || snapshot.files.some(actual => actual.path === file.path && actual.version === hash(Buffer.from(file.generated))))) return { problems: [], deferred: [] };
    const native = await queryKotlin(snapshot, 'expec.kotlin.json');
    return native.value && !native.problems.length ? checkKotlinTests(snapshot, native.value, stored.files, driver) : { problems: native.problems, deferred: native.deferred };
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    const failure = (code: string, message: string, path = ''): Check<OutputPlan> => ({ problems: [outputProblem(code, path, message)], deferred: [] });
    const stored = this.state(snapshot); if (stored.problems.length) return { problems: stored.problems, deferred: [] };
    if (request.operation === 'delete') return this.delete(request.id, snapshot, stored.value);
    if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Supply the actual identity transition.');
    const beforeOptions = stored.value && options.parse(JSON.parse(stored.value.options));
    const fixed = ({ fixture: _fixture, ...settings }: z.infer<typeof options>) => canonical(settings);
    const migrating = request.operation === 'update' && beforeOptions && !beforeOptions.fixture && this.settings.fixture && fixed(beforeOptions) === fixed(this.settings);
    if (stored.value && stored.value.options !== canonical(this.settings) && !migrating) return failure('output-options-changed', 'Native acceptance placement requires an explicit migration.');
    if (this.settings.adoptExisting || this.settings.names.length || this.settings.imports.length) return failure('native-preservation-unavailable', 'These explicit mappings require native compatibility checking.');
    const native = await queryKotlin(snapshot, 'expec.kotlin.json');
    if (!native.value || native.problems.length && !this.settings.fixture) return { problems: native.problems, deferred: native.deferred };
    const className = this.settings.domain[0]!.toUpperCase() + this.settings.domain.slice(1), prefix = this.settings.testRoot + '/' + this.settings.package.replaceAll('.', '/');
    const testFile = prefix + '/acceptance/' + className + 'Acceptance.kt';
    const intact = await checkKotlinTests(snapshot, native.value, stored.value?.files ?? [], prefix + '/driver/' + className + 'Driver.kt');
    if (intact.problems.length) return { problems: intact.problems, deferred: intact.deferred };
    const fixture = this.settings.fixture && selectedKotlinFixture(native.value, this.settings.fixture);
    if (this.settings.fixture && !fixture) return failure('invalid-native-fixture', 'Select one actual native fixture class.');
    const driver = this.settings.driver && kotlinDriver(native.value, this.settings.driver);
    if (this.settings.driver && (!driver || driver.typeParameters?.length || !['public', 'internal'].includes(driver.visibility) || !fixture && !driver.zeroArgumentConstruction)) return failure('invalid-native-driver', 'Select an accessible native class; a required constructor dependency must come from a custom fixture.');
    const targets = new Map<NodeId, KotlinQuery['declarations'][number]>();
    for (const association of request.current.baseline.artifacts.filter(item => item.locator.outputId !== this.id && item.locator.format === 'kotlin-symbol-1')) {
      const declarations = native.value.declarations.filter(item => canonical({ file: item.file, declaration: item.selector }) === canonical(association.locator.value));
      if (declarations.length !== 1) return failure('native-definition-unavailable', 'The executable native association must select one current declaration.');
      if (declarations[0]!.selector.some(item => item.name.startsWith('<anonymous@'))) return failure('invalid-native-mapping', 'Anonymous native owners cannot be adopted by a synthetic name.');
      const id = request.current.node(association.specId), before = targets.get(id);
      if (before && canonical(before) !== canonical(declarations[0])) return failure('ambiguous-native-target', 'Select one executable Kotlin target for this source declaration.');
      targets.set(id, declarations[0]!);
    }
    const mapped = driver ? kotlinDriverBindings(request.current, targets) : { value: [], problems: [], deferred: [] };
    if (!mapped.value) return { problems: mapped.problems, deferred: mapped.deferred };
    const bindings = mapped.value;
    if (stored.value?.bindings?.some(before => !bindings.some(after => before.specId === after.specId && canonical(before.locator) === canonical(after.locator)))) return failure('output-options-changed', 'A retained native operation binding cannot silently change.');
    const rendered = new KotlinExamples(request.current, this.settings, targets, this.context, fixture, driver), files = rendered.files();
    if (rendered.problems.length) return { problems: rendered.problems, deferred: [] };
    const known = new Set([...request.current.baseline.elements.map(item => item.id), ...request.current.baseline.retired]);
    if (stored.value?.files.some(file => file.artifacts.some(item => !known.has(item.specId))) || [stored.value?.fixture, stored.value?.driver, ...stored.value?.bindings ?? []].some(item => item && !known.has(item.specId))) return failure('unknown-output-identity', 'Current identity must recognize earlier native tests.');
    if (stored.value?.files.some(before => !files.some(file => file.path === before.path))) return failure('native-preservation-unavailable', 'Acceptance retirement requires native ownership reconciliation.');
    const changes: FileChange[] = [], proposed = new Map(snapshot.files.map(file => [file.path, file]));
    for (const file of files) {
      if (file.path.split('/').some(part => snapshot.excludeNames.includes(part))) return failure('excluded-kotlin-input', 'The output path intersects an excluded capture path.', file.path);
      const actual = snapshot.files.find(item => item.path === file.path), previous = stored.value?.files.find(item => item.path === file.path);
      if (actual && !previous) return failure('output-conflict', 'Current native acceptance text needs declaration-level ownership.', file.path);
      if (previous && !actual) return failure('output-conflict', 'Previously owned native acceptance text is missing.', file.path);
      let bytes = actual?.bytes ?? Buffer.from(file.text);
      if (previous && previous.generated !== file.text && migrating) {
        if (!migrating || !fixture || file.path !== testFile) return failure('native-preservation-unavailable', 'Changed acceptance contracts require native ownership reconciliation.', file.path);
        const text = migrateKotlinFixture(snapshot, native.value, file.path, this.settings.package + '.dsl.' + className + 'Fixture', fixture);
        if (text === undefined) return failure('output-conflict', 'The test no longer extends its recorded default fixture.', file.path);
        bytes = Buffer.from(text);
      }
      const version = hash(bytes);
      proposed.set(file.path, { path: file.path, bytes, version });
      if (actual?.version !== version) changes.push({ kind: 'write', path: file.path, bytes });
    }
    if (stored.value && !migrating) {
      const helpers = prefix + '/dsl/ExpecChecks.kt';
      if (stored.value.files.some(before => before.path === helpers && files.find(file => file.path === helpers)?.text !== before.generated)) return failure('native-preservation-unavailable', 'Changed data comparisons require native runtime ownership reconciliation.', helpers);
      const ownedBodies = new Set([...request.current.specification.inspection.query('example'), ...request.current.specification.inspection.query('scenario'),
        ...request.current.specification.inspection.query('fixture'), ...request.current.specification.inspection.query('setup'), ...request.current.specification.inspection.query('action'),
        ...request.current.specification.inspection.query('observation'), ...request.current.specification.inspection.query('check')].filter(item => !('body' in item) || item.body.kind === 'available').map(item => request.current.id(item.id)));
      const preserved = await preserveKotlin(snapshot, stored.value.files.filter(file => file.path !== helpers), files.filter(file => file.path !== helpers), ownedBodies);
      if (!preserved.value) return { problems: preserved.problems, deferred: preserved.deferred };
      changes.length = 0; changes.push(...preserved.value.changes);
      proposed.clear(); for (const file of snapshot.files) proposed.set(file.path, file);
      for (const change of changes) {
        if (change.kind === 'remove') proposed.delete(change.path);
        else { if (change.kind === 'move') proposed.delete(change.from); const path = change.kind === 'move' ? change.to : change.path;
          proposed.set(path, { path, bytes: change.bytes!, version: hash(change.bytes!) }); }
      }
    }
    const generated = await queryKotlin({ ...snapshot, files: [...proposed.values()] }, 'expec.kotlin.json');
    if (!generated.value) return { problems: generated.problems, deferred: generated.deferred };
    if (driver) {
      const adapter = files.find(file => file.path === prefix + '/driver/' + className + 'Driver.kt');
      if (!adapter) return failure('invalid-native-driver', 'The driver requires a checked example group.');
      const compatible = checkKotlinDriver(request.current, generated.value, adapter, bindings);
      if (compatible.problems.length) return compatible;
    }
    if (generated.problems.length) return { problems: generated.problems, deferred: generated.deferred };
    if (fixture && (!this.settings.fixture || !compatibleKotlinFixture(generated.value, selectedKotlinFixture(generated.value, this.settings.fixture)!, this.settings.domain,
      this.settings.package + '.dsl.' + className, [testFile]))) {
      return failure('invalid-native-fixture', 'The selected native base needs accessible zero-argument construction and its protected/public readable DSL property.', fixture.file);
    }
    const next = { format: 1, options: canonical(this.settings), ...fixture && files[0] ? { fixture: { specId: files[0].id, locator: { ...this.settings.fixture!, outputId: this.id } } } : {}, ...driver && files[0] ? { driver: { specId: files[0].id, locator: { ...this.settings.driver!, outputId: this.id } }, bindings } : {}, files: files.map(file => ({ id: file.id, path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)), artifacts: file.artifacts })) };
    return success({ outputId: this.id, basedOn: snapshot, changes: [...changes,
      { kind: 'write' as const, path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') }].filter(change => change.kind !== 'write' || !snapshot.files.some(file => file.path === change.path && file.version === hash(change.bytes))),
      artifacts: [...files.flatMap(file => file.artifacts), ...next.fixture ? [next.fixture] : [], ...next.driver ? [next.driver] : [], ...next.bindings ?? []], obligations: rendered.obligations });
  }
  private async delete(id: string, snapshot: ProjectSnapshot, stored?: z.infer<typeof state>): Promise<Check<OutputPlan>> {
    const failure = (code: string, message: string): Check<OutputPlan> => ({ problems: [outputProblem(code, statePath, message)], deferred: [] });
    if (!stored) return failure('output-not-found', 'No owned generated Kotlin test exists.');
    if (stored.options !== canonical(this.settings)) return failure('output-options-changed', 'Reopen the recorded options before deleting a generated test.');
    const intact = await this.integrity(snapshot, stored); if (intact.problems.length) return intact;
    if (stored.deleted.includes(id)) return success({ outputId: this.id, basedOn: snapshot, changes: [], artifacts: this.artifacts(stored) });
    const prefix = this.settings.testRoot + '/' + this.settings.package.replaceAll('.', '/') + '/acceptance/';
    const selected = stored.files.filter(file => file.path.startsWith(prefix) && file.artifacts.some(item => item.specId === id && item.locator.format === 'kotlin-symbol-1'));
    if (selected.length !== 1) return failure('output-not-found', 'Select exactly one owned generated example or examples group.');
    const retired = await retireKotlin(snapshot, selected, id);
    if (!retired.value) return { problems: retired.problems, deferred: retired.deferred };
    const preserved = await preserveKotlin(snapshot, selected, retired.value.files, new Set());
    if (!preserved.value) return { problems: preserved.problems, deferred: preserved.deferred };
    const files = stored.files.flatMap(file => file !== selected[0] ? [file] : retired.value!.files.map(next => ({
      id: next.id, path: next.path, generated: next.text, hash: hash(Buffer.from(next.text)), artifacts: [...next.artifacts],
    })));
    const next = { ...stored, deleted: [...new Set([...stored.deleted, ...retired.value.removed])].sort(), files };
    return success({ outputId: this.id, basedOn: snapshot, changes: [...preserved.value.changes,
      { kind: 'write', path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') }], artifacts: this.artifacts(next), obligations: preserved.value.obligations });
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const stored = this.state(snapshot);
    if (stored.problems.length) return { artifacts: [], problems: stored.problems, coverage: { scope: [], complete: false, limitations: stored.problems.map(problem => problem.message) } };
    const result = await new KotlinProject({ outputId: this.id }, this.artifacts(stored.value)).read(id, snapshot);
    const problems = [...result.problems, ...(result.problems.length ? [] : (await this.integrity(snapshot, stored.value)).problems)];
    return { ...result, problems, coverage: { ...result.coverage, complete: result.coverage.complete && !problems.length,
      limitations: [...result.coverage.limitations, ...problems.map(item => item.message)] } };
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const stored = this.state(snapshot);
    if (stored.problems.length) {
      const coverage = { scope: [], complete: false, limitations: stored.problems.map(problem => problem.message) };
      return { definitions: [], problems: stored.problems, incoming: { subject: id, direction: 'incoming' as const, coverage, uses: [], unresolved: [] }, outgoing: { subject: id, direction: 'outgoing' as const, coverage, uses: [], unresolved: [] } };
    }
    const result = await new KotlinProject({ outputId: this.id }, this.artifacts(stored.value)).search(id, snapshot);
    const problems = [...result.problems, ...(result.problems.length ? [] : (await this.integrity(snapshot, stored.value)).problems)];
    const direction = (key: 'incoming' | 'outgoing') => ({ ...result[key], coverage: { ...result[key].coverage,
      complete: result[key].coverage.complete && !problems.length, limitations: [...result[key].coverage.limitations, ...problems.map(item => item.message)] } });
    return { ...result, problems, incoming: direction('incoming'), outgoing: direction('outgoing') };
  }
}
