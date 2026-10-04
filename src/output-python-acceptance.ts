import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { OutputRegistration } from './output.js';
import type { Check } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import { canonical, failure, identifier, locatorSchema, success } from './identity-baseline.js';
import { pythonName, pythonOptions } from './python-declarations.js';
import { pythonPath, pythonConfiguration } from './python-profile.js';
import { PythonProject } from './python-project.js';
import { PythonExamples } from './python-examples.js';
import { inspectPython, type PythonFacts } from './python-inspection.js';
import { validDiff } from './output-contract.js';
import { hash } from './project-files.js';
import { readJson } from './json-data.js';

export const pythonAcceptanceOptions = pythonOptions.omit({ module: true, directory: true }).extend({
  domain: z.string().refine(pythonName), testRoot: z.string().refine(pythonPath).default('test'),
  driver: locatorSchema.optional(), fixture: locatorSchema.optional(),
});
const saved = z.strictObject({ format: z.literal(1), options: z.string(),
  files: z.array(z.strictObject({ file: z.string().refine(pythonPath), text: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), driver: z.boolean() })),
  artifacts: z.array(z.strictObject({ specId: identifier, locator: locatorSchema })),
});
type State = z.infer<typeof saved>;
const statePath = '.expec/outputs/707974686f6e2d616363657074616e6365.json';
const selectedDriver = z.strictObject({ file: z.string().refine(pythonPath), declaration: z.tuple([z.strictObject({ kind: z.literal('class'), name: z.string().refine(pythonName) })]) });
export const pythonAcceptanceOutput: OutputRegistration = {
  id: 'python-acceptance',
  validate(value) { const parsed = pythonAcceptanceOptions.safeParse(value); return parsed.success ? [] : parsed.error.issues.map(item => ({ path: item.path as (string | number)[], message: item.message })); },
  open(value, context) {
    const options = pythonAcceptanceOptions.parse(value), driverPath = options.testRoot + '/driver/' + options.domain + '_driver.py';
    const selected = options.driver && options.driver.outputId === 'python-acceptance' && options.driver.format === 'python-symbol-1'
      ? selectedDriver.safeParse(options.driver.value).data : undefined;
    const native = (state?: State) => new PythonProject({ outputId: 'python-acceptance', ...options.configFile ? { configFile: options.configFile } : {} }, state?.artifacts ?? []);
    const state = (snapshot: ProjectSnapshot): Check<State | undefined> => {
      const file = snapshot.files.find(file => file.path === statePath); if (!file) return success(undefined);
      try {
        const result = saved.parse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (_code, message) => { throw Error(message); }));
        if (result.options !== canonical(options)) return failure('output-options-changed', 'Python acceptance mappings require an explicit migration.', [statePath]);
        if (new Set(result.files.map(file => file.file)).size !== result.files.length || !result.files.length
          || result.files.some(file => hash(Buffer.from(file.text)) !== file.hash || file.driver !== (file.file === driverPath))) throw Error('Invalid native ownership.');
        native(result); return success(result);
      } catch { return failure('invalid-output-state', 'Recorded Python acceptance ownership is invalid.', [statePath]); }
    };
    const integrity = async (snapshot: ProjectSnapshot, current?: State) => current ? (await inspectPython(snapshot, options.configFile, { tests: current.files })).problems : [];
    return { id: 'python-acceptance',
      async plan(request, snapshot) {
        if (request.operation === 'delete') return failure('unsupported-native-acceptance', 'Python acceptance retirement is not implemented.');
        if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Provide the actual specification transition.');
        if (options.fixture) return failure('unsupported-native-acceptance', 'Explicit Python fixture adoption is not implemented.');
        if (options.driver && !selected) return failure('invalid-native-driver', 'Select one Python acceptance class by its actual native locator.');
        const previous = state(snapshot); if (previous.problems.length) return { problems: previous.problems, deferred: [] };
        const inspected = await inspectPython(snapshot, options.configFile, previous.value ? { tests: previous.value.files } : undefined);
        if (inspected.problems.length) return { problems: inspected.problems, deferred: [] };
        const profile = pythonConfiguration(snapshot, options.configFile).value!;
        const roots = [...profile.sourceRoots.main, ...profile.sourceRoots.test], root = selected && roots.find(root => selected.file.startsWith(root + '/'));
        const module = selected && root ? selected.file.slice(root.length + 1).replace(/\.py$/, '').replace(/\/__init__$/, '').replaceAll('/', '.') : '';
        if (selected && (!root || !selected.file.endsWith('.py') || !module.split('.').every(pythonName)
          || inspected.value!.declarations.filter(item => item.file === selected.file && canonical(item.declaration) === canonical(selected.declaration)).length !== 1))
          return failure('invalid-native-driver', 'The selected driver must have exactly one importable class definition.', [selected.file]);
        const target = selected && inspected.value!.declarations.find(item => item.file === selected.file && canonical(item.declaration) === canonical(selected.declaration))!.target;
        const imports = (facts: PythonFacts): Check<void> => {
          if (!target) return success(undefined);
          for (const file of [options.testRoot + '/dsl/' + options.domain + '.py', options.testRoot + '/dsl/' + options.domain + '_fixture.py']) {
            const scope = file.endsWith('_fixture.py') ? [{ kind: 'function', name: options.domain }]
              : [{ kind: 'class', name: options.domain[0]!.toUpperCase() + options.domain.slice(1) }, { kind: 'method', name: '__init__' }];
            const uses = facts.uses.filter(use => use.file === file && (!use.owner.length || canonical(use.owner) === canonical(scope))
              && (use.name === '_ExpecDriver' || use.name === selected!.declaration[0].name));
            if (!uses.length || uses.some(use => use.targets.length !== 1 || canonical(use.targets[0]) !== canonical(target)))
              return failure('invalid-native-driver', 'The generated import must resolve to the selected native class.', [file]);
          }
          return success(undefined);
        };
        const examples = new PythonExamples(request.current, options, context, { facts: inspected.value!, roots }, selected ? { file: selected.file, module, name: selected.declaration[0].name } : undefined);
        const files = examples.files(), consumer = examples.driverCheck();
        if (examples.problems.length) return { problems: examples.problems, deferred: [] };
        if (consumer) {
          const checked = await inspectPython(snapshot, options.configFile, { consumer, file: selected!.file, target: target! });
          if (checked.problems.length) return { problems: checked.problems, deferred: [] };
          examples.bindDriver(checked.value!.driver ?? []);
          if (examples.problems.length) return { problems: examples.problems, deferred: [] };
        }
        files.unshift({ path: options.testRoot + '/dsl/comparison.py', text: await readFile(new URL('./python/comparison.py', import.meta.url), 'utf8') });
        const next: State = { format: 1, options: canonical(options), files: files.map(file => ({ file: file.path, text: file.text, hash: hash(Buffer.from(file.text)), driver: file.path === driverPath })), artifacts: examples.artifacts };
        if (previous.value) {
          const bound = imports(inspected.value!); if (bound.problems.length) return { problems: bound.problems, deferred: [] };
          if (canonical(previous.value) === canonical(next)) return success({ outputId: 'python-acceptance', basedOn: snapshot, changes: [], artifacts: previous.value.artifacts, obligations: examples.obligations });
          if (request.operation !== 'update') return failure('use-update', 'Use update for changed existing Python examples.');
          const rewritten = await inspectPython(snapshot, options.configFile, { tests: previous.value.files, desiredTests: next.files });
          if (rewritten.problems.length || !rewritten.value?.rewritten) return { problems: rewritten.problems.length ? rewritten.problems
            : failure('python-preservation-unavailable', 'Native acceptance preservation returned no result.').problems, deferred: [] };
          const changes = rewritten.value.rewritten.flatMap(file => hash(Buffer.from(file.text)) === snapshot.files.find(item => item.path === file.file)?.version ? []
            : [{ kind: 'write' as const, path: file.file, bytes: Buffer.from(file.text) }]);
          changes.push({ kind: 'write', path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') });
          return success({ outputId: 'python-acceptance', basedOn: snapshot, changes, artifacts: next.artifacts, obligations: examples.obligations });
        }
        for (const file of files) {
          if (snapshot.files.some(existing => existing.path === file.path)) return failure('output-conflict', 'Existing Python acceptance files require native preserving reconciliation.', [file.path]);
          if (file.path.split('/').some(part => snapshot.excludeNames.includes(part))) return failure('output-conflict', 'The captured project excludes this acceptance destination.', [file.path]);
        }
        const changes = files.map(file => ({ kind: 'write' as const, path: file.path, bytes: Buffer.from(file.text) }));
        for (const layer of ['dsl', 'driver', 'acceptance']) {
          const path = options.testRoot + '/' + layer + '/__init__.py';
          if (!snapshot.files.some(file => file.path === path)) changes.unshift({ kind: 'write', path, bytes: Buffer.from('') });
        }
        const planned = await inspectPython({ ...snapshot, files: [...snapshot.files, ...changes.map(change => ({ path: change.path, bytes: change.bytes, version: hash(change.bytes) }))] }, options.configFile);
        if (planned.problems.length) return { problems: planned.problems, deferred: [] };
        const bound = imports(planned.value!); if (bound.problems.length) return { problems: bound.problems, deferred: [] };
        changes.push({ kind: 'write', path: statePath, bytes: Buffer.from(canonical(next, 2) + '\n') });
        return success({ outputId: 'python-acceptance', basedOn: snapshot, changes, artifacts: examples.artifacts, obligations: examples.obligations });
      },
      async read(id, snapshot) {
        const previous = state(snapshot), result = await native(previous.value).read(id, snapshot);
        const problems = [...previous.problems, ...result.problems, ...await integrity(snapshot, previous.value)];
        return { ...result, problems, coverage: { ...result.coverage, complete: result.coverage.complete && !problems.length,
          limitations: [...result.coverage.limitations, ...problems.map(problem => problem.message)] } };
      },
      async search(id, snapshot) {
        const previous = state(snapshot), result = await native(previous.value).search(id, snapshot);
        const problems = [...previous.problems, ...result.problems, ...await integrity(snapshot, previous.value)];
        const checked = (direction: 'incoming' | 'outgoing') => ({ ...result[direction], coverage: { ...result[direction].coverage,
          complete: result[direction].coverage.complete && !problems.length, limitations: [...result[direction].coverage.limitations, ...problems.map(problem => problem.message)] } });
        return { ...result, problems, incoming: checked('incoming'), outgoing: checked('outgoing') };
      },
    };
  },
};
