import { z } from 'zod';
import type { OutputAdapter, OutputContext, OutputPlan, OutputRegistration, OutputRequest } from './output.js';
import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { FileChange } from './project-writer.js';
import { PythonDeclarations, pythonOptions, type PythonOptions } from './python-declarations.js';
import { PythonProject } from './python-project.js';
import { inspectPython } from './python-inspection.js';
import { canonical, identifier, locatorSchema, success, failure } from './identity-baseline.js';
import { outputProblem } from './output-documents.js';
import { validDiff } from './output-contract.js';
import { hash } from './project-files.js';
import { pythonPath } from './python-profile.js';
import { readJson } from './json-data.js';
import type { ArtifactAssociation } from './specification-identity.js';

const schema = z.strictObject({ format: z.literal(1), options: z.string(), path: z.string().refine(pythonPath), generated: z.string(),
  hash: z.string().regex(/^[a-f0-9]{64}$/), authored: z.array(identifier), artifacts: z.array(z.strictObject({ specId: identifier, locator: locatorSchema })) });
type State = z.infer<typeof schema>;
const statePath = '.expec/outputs/707974686f6e.json';
const placement = ({ adoptExisting: _permission, ...options }: PythonOptions): string => canonical(options);
const contract = ({ module: _module, directory: _directory, adoptExisting: _permission, ...options }: PythonOptions): string => canonical(options);
type Location = { file: string; declaration: { kind: string; name: string }[] };

/** Retained subjects keep their actual files; new members follow their mapped native owner. */
function locate(projected: readonly ArtifactAssociation[], existing: readonly ArtifactAssociation[]): ArtifactAssociation[] {
  const counts = new Map<string, number>(), placed: ArtifactAssociation[] = [];
  for (const artifact of projected) {
    const at = artifact.locator.value as Location, ordinal = counts.get(artifact.specId) ?? 0;
    counts.set(artifact.specId, ordinal + 1);
    const prior = existing.filter(item => item.specId === artifact.specId)[ordinal];
    const owner = [...placed].reverse().find(item => { const value = item.locator.value as Location;
      return value.declaration.length < at.declaration.length && value.declaration.every((part, index) => canonical(part) === canonical(at.declaration[index])); });
    placed.push({ ...artifact, locator: { ...artifact.locator, value: { ...at, file: ((prior ?? owner)?.locator.value as Location | undefined)?.file ?? at.file } } });
  }
  return placed;
}

export const pythonOutput: OutputRegistration = {
  id: 'python', validate: options => {
    const parsed = pythonOptions.safeParse(options);
    return parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message }));
  }, open: (options, context) => new PythonOutput(pythonOptions.parse(options), context),
};

/** Coordinates checked projection, native preserving edits and the ordinary guarded writer. */
class PythonOutput implements OutputAdapter {
  readonly id = 'python';
  constructor(private readonly options: PythonOptions, private readonly context?: OutputContext) {}
  private state(snapshot: ProjectSnapshot): Check<State | undefined> {
    const file = snapshot.files.find(file => file.path === statePath); if (!file) return success(undefined);
    try {
      const state = schema.parse(readJson(new TextDecoder('utf8', { fatal: true }).decode(file.bytes), (_code, message) => { throw Error(message); }));
      if (hash(Buffer.from(state.generated)) !== state.hash || state.artifacts.some(item => item.locator.format !== 'python-symbol-1')
        || new Set(state.authored).size !== state.authored.length
        || state.authored.some(id => !state.artifacts.some(item => item.specId === id))) throw Error('Invalid generated ownership.');
      new PythonProject({ outputId: this.id }, state.artifacts);
      return contract(pythonOptions.parse(JSON.parse(state.options))) === contract(this.options) ? success(state)
        : failure('output-options-changed', 'Python contract mappings require an explicit migration.', [statePath]);
    } catch { return failure('invalid-output-state', 'Recorded Python ownership or generated text is invalid.', [statePath]); }
  }
  async read(id: string, snapshot: ProjectSnapshot) {
    const state = this.state(snapshot), result = await new PythonProject({ outputId: this.id, ...this.options.configFile ? { configFile: this.options.configFile } : {} }, state.value?.artifacts ?? []).read(id, snapshot);
    const problems = [...state.problems, ...result.problems];
    return { ...result, problems, coverage: { ...result.coverage, complete: !problems.length && result.coverage.complete, limitations: [...result.coverage.limitations, ...state.problems.map(problem => problem.message)] } };
  }
  async search(id: string, snapshot: ProjectSnapshot) {
    const state = this.state(snapshot), result = await new PythonProject({ outputId: this.id, ...this.options.configFile ? { configFile: this.options.configFile } : {} }, state.value?.artifacts ?? []).search(id, snapshot);
    const problems = [...state.problems, ...result.problems], coverage = (direction: 'incoming' | 'outgoing') => ({ ...result[direction], coverage: {
      ...result[direction].coverage, complete: !problems.length && result[direction].coverage.complete,
      limitations: [...result[direction].coverage.limitations, ...state.problems.map(problem => problem.message)] } });
    return { ...result, problems, incoming: coverage('incoming'), outgoing: coverage('outgoing') };
  }
  async plan(request: OutputRequest, snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return { problems: [...snapshot.problems, outputProblem('incomplete-project', '', 'Python generation needs a complete capture.')], deferred: [] };
    if (snapshot.files.some(file => !pythonPath(file.path) || hash(file.bytes) !== file.version) || new Set(snapshot.files.map(file => process.platform === 'win32' ? file.path.toLowerCase() : file.path)).size !== snapshot.files.length)
      return failure('invalid-project-snapshot', 'Captured Python paths and byte versions must be valid and distinct.');
    const stored = this.state(snapshot); if (stored.problems.length) return { problems: stored.problems, deferred: [] };
    if (request.operation === 'delete') return failure('python-generation-unavailable', 'Python retirement is not implemented yet.');
    if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Provide the actual specification transition.');
    if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts'))))
      return failure('not-addition-only', 'Use update when existing Python contracts change.');
    const previous = stored.value, declarations = new PythonDeclarations(request.current, this.options, this.context), file = declarations.render();
    if (declarations.problems.length) return { problems: declarations.problems, deferred: [] };
    const supplied = request.current.baseline.artifacts.filter(item => item.locator.outputId === this.id);
    if (!previous && supplied.length && !this.options.adoptExisting) return failure('explicit-adoption-required', 'Enable adoption for the explicitly associated Python definitions.');
    const adopted: ArtifactAssociation[] = [];
    if (!previous && supplied.length) {
      try { new PythonProject({ outputId: this.id }, supplied); }
      catch { return failure('invalid-native-mapping', 'Provide valid exact Python declaration associations.'); }
      for (const projected of file.artifacts) {
        const matches = supplied.filter(item => item.specId === projected.specId && item.locator.format === 'python-symbol-1'
          && canonical((item.locator.value as Location).declaration) === canonical((projected.locator.value as Location).declaration));
        if (matches.length !== 1) return failure('invalid-native-mapping', 'Explicitly associate each projected declaration with one matching native selector; use names for different native names.');
        adopted.push(matches[0]!);
      }
    }
    const moving = previous && previous.path !== file.path;
    if (moving && request.operation !== 'update') return failure('use-update', 'Use update to move an existing Python module.');
    if (moving && (previous.authored.length || previous.artifacts.some(item => (item.locator.value as Location).file !== previous.path)
      || snapshot.files.find(item => item.path === previous.path)?.version !== previous.hash))
      return failure('output-conflict', 'Only an unchanged generated module can move; handwritten content stays in its existing file.', [previous.path]);
    if (moving && snapshot.files.some(item => item.path === file.path)) return failure('output-conflict', 'The requested Python module destination already exists.', [file.path]);
    const artifacts = moving ? [...file.artifacts] : locate(file.artifacts, previous?.artifacts ?? adopted);
    const next: State = { format: 1, options: placement(this.options), path: file.path, generated: file.text, hash: hash(Buffer.from(file.text)),
      authored: previous?.authored ?? [...new Set(adopted.map(item => item.specId))], artifacts };
    const changes: FileChange[] = [];
    if (previous) {
      const known = new Set([...request.current.baseline.elements.map(item => item.id), ...request.current.baseline.retired]);
      if (previous.artifacts.some(item => !known.has(item.specId))) return failure('unknown-output-identity', 'Current identity must retain or explicitly retire earlier subjects.');
      if (request.operation === 'create' && previous.hash !== next.hash) return failure('use-update', 'Use update for changed existing Python contracts.');
      const inspected = await inspectPython(snapshot, this.options.configFile, { before: previous.generated, after: next.generated,
        previous: previous.artifacts, next: next.artifacts, authored: previous.authored,
        ...(moving ? { move: { from: previous.path, to: next.path, old: pythonOptions.parse(JSON.parse(previous.options)).module, next: this.options.module } } : {}) });
      if (inspected.problems.length || !inspected.value?.rewritten) return { problems: inspected.problems.length ? inspected.problems : [outputProblem('python-preservation-unavailable', file.path, 'Native preservation returned no result.')], deferred: [] };
      for (const rewritten of inspected.value.rewritten) {
        const bytes = Buffer.from(rewritten.text), before = snapshot.files.find(item => item.path === rewritten.file);
        if (!before || before.version !== hash(bytes)) changes.push({ kind: 'write', path: rewritten.file, bytes });
      }
      if (moving) changes.push({ kind: 'remove', path: previous.path });
    } else if (supplied.length) {
      const inspected = await inspectPython(snapshot, this.options.configFile, { before: file.text, after: file.text, previous: artifacts, next: artifacts });
      if (inspected.problems.length || !inspected.value?.rewritten) return { problems: inspected.problems.length ? inspected.problems : [outputProblem('python-preservation-unavailable', file.path, 'Native adoption returned no result.')], deferred: [] };
      if (inspected.value.rewritten.some(item => hash(Buffer.from(item.text)) !== snapshot.files.find(file => file.path === item.file)?.version))
        return failure('output-conflict', 'Initial adoption must preserve every handwritten byte.');
    } else {
      if (snapshot.files.some(item => item.path === file.path)) return failure('output-conflict', 'Existing Python code needs explicit preserving adoption.', [file.path]);
      changes.push({ kind: 'write', path: file.path, bytes: Buffer.from(file.text) });
    }
    if (moving || !previous && !supplied.length) {
      const parts = file.path.split('/');
      for (let depth = 2; depth < parts.length; depth++) {
        const path = parts.slice(0, depth).join('/') + '/__init__.py';
        if (!snapshot.files.some(item => item.path === path)) changes.push({ kind: 'write', path, bytes: Buffer.from('') });
      }
    }
    for (const change of changes) if (change.kind === 'write' && change.path.split('/').some(part => snapshot.excludeNames.includes(part))) return failure('output-conflict', 'The captured project excludes an output destination.', [change.path]);
    const bytes = Buffer.from(canonical(next, 2) + '\n');
    if (!snapshot.files.some(file => file.path === statePath && file.version === hash(bytes))) changes.push({ kind: 'write', path: statePath, bytes });
    return success({ outputId: this.id, basedOn: snapshot, changes, artifacts: next.artifacts });
  }
}
