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
import { inspectPython } from './python-inspection.js';
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
export const pythonAcceptanceOutput: OutputRegistration = {
  id: 'python-acceptance',
  validate(value) { const parsed = pythonAcceptanceOptions.safeParse(value); return parsed.success ? [] : parsed.error.issues.map(item => ({ path: item.path as (string | number)[], message: item.message })); },
  open(value, context) {
    const options = pythonAcceptanceOptions.parse(value), driverPath = options.testRoot + '/driver/' + options.domain + '_driver.py';
    const native = (state?: State) => new PythonProject({ outputId: 'python-acceptance', ...options.configFile ? { configFile: options.configFile } : {} }, state?.artifacts ?? []);
    const state = (snapshot: ProjectSnapshot): Check<State | undefined> => {
      const file = snapshot.files.find(file => file.path === statePath); if (!file) return success(undefined);
      try {
        const result = saved.parse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (_code, message) => { throw Error(message); }));
        if (result.options !== canonical(options)) return failure('output-options-changed', 'Python acceptance mappings require an explicit migration.', [statePath]);
        if (new Set(result.files.map(file => file.file)).size !== result.files.length || !result.files.length
          || result.files.some(file => hash(Buffer.from(file.text)) !== file.hash || file.driver !== (file.file === driverPath))
          || result.artifacts.some(artifact => !result.files.some(file => file.file === (artifact.locator.value as { file?: string }).file))) throw Error('Invalid native ownership.');
        native(result); return success(result);
      } catch { return failure('invalid-output-state', 'Recorded Python acceptance ownership is invalid.', [statePath]); }
    };
    const integrity = async (snapshot: ProjectSnapshot, current?: State) => current ? (await inspectPython(snapshot, options.configFile, { tests: current.files })).problems : [];
    return { id: 'python-acceptance',
      async plan(request, snapshot) {
        if (request.operation === 'delete') return failure('unsupported-native-acceptance', 'Python acceptance retirement is not implemented.');
        if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Provide the actual specification transition.');
        if (options.driver || options.fixture) return failure('unsupported-native-acceptance', 'Explicit Python driver and fixture adoption are not implemented.');
        const previous = state(snapshot); if (previous.problems.length) return { problems: previous.problems, deferred: [] };
        const inspected = await inspectPython(snapshot, options.configFile, previous.value ? { tests: previous.value.files } : undefined);
        if (inspected.problems.length) return { problems: inspected.problems, deferred: [] };
        const profile = pythonConfiguration(snapshot, options.configFile).value!;
        const examples = new PythonExamples(request.current, options, context, { facts: inspected.value!, roots: [...profile.sourceRoots.main, ...profile.sourceRoots.test] }), files = examples.files();
        if (examples.problems.length) return { problems: examples.problems, deferred: [] };
        files.unshift({ path: options.testRoot + '/dsl/comparison.py', text: await readFile(new URL('./python/comparison.py', import.meta.url), 'utf8') });
        const next: State = { format: 1, options: canonical(options), files: files.map(file => ({ file: file.path, text: file.text, hash: hash(Buffer.from(file.text)), driver: file.path === driverPath })), artifacts: examples.artifacts };
        if (previous.value) {
          if (canonical(previous.value) !== canonical(next)) return failure('use-update', 'Changed Python examples require native preserving update.');
          return success({ outputId: 'python-acceptance', basedOn: snapshot, changes: [], artifacts: previous.value.artifacts, obligations: examples.obligations });
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
