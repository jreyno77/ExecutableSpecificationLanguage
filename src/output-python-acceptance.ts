import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { OutputRegistration } from './output.js';
import { failure, locatorSchema, success } from './identity-baseline.js';
import { pythonName, pythonOptions } from './python-declarations.js';
import { pythonPath, pythonConfiguration } from './python-profile.js';
import { PythonProject } from './python-project.js';
import { PythonExamples } from './python-examples.js';
import { inspectPython } from './python-inspection.js';
import { validDiff } from './output-contract.js';
import { hash } from './project-files.js';

export const pythonAcceptanceOptions = pythonOptions.omit({ module: true, directory: true }).extend({
  domain: z.string().refine(pythonName), testRoot: z.string().refine(pythonPath).default('test'),
  driver: locatorSchema.optional(), fixture: locatorSchema.optional(),
});
export const pythonAcceptanceOutput: OutputRegistration = {
  id: 'python-acceptance',
  validate(value) { const parsed = pythonAcceptanceOptions.safeParse(value); return parsed.success ? [] : parsed.error.issues.map(item => ({ path: item.path as (string | number)[], message: item.message })); },
  open(value, context) {
    const options = pythonAcceptanceOptions.parse(value), native = new PythonProject({ outputId: 'python-acceptance', ...options.configFile ? { configFile: options.configFile } : {} }, []);
    return { id: 'python-acceptance',
      async plan(request, snapshot) {
        if (request.operation === 'delete') return failure('unsupported-native-acceptance', 'Python acceptance retirement is not implemented.');
        if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Provide the actual specification transition.');
        if (options.driver || options.fixture) return failure('unsupported-native-acceptance', 'Explicit Python driver and fixture adoption are not implemented.');
        const inspected = await inspectPython(snapshot, options.configFile);
        if (inspected.problems.length) return { problems: inspected.problems, deferred: [] };
        const profile = pythonConfiguration(snapshot, options.configFile).value!;
        const examples = new PythonExamples(request.current, options, context, { facts: inspected.value!, roots: [...profile.sourceRoots.main, ...profile.sourceRoots.test] }), files = examples.files();
        if (examples.problems.length) return { problems: examples.problems, deferred: [] };
        files.unshift({ path: options.testRoot + '/dsl/comparison.py', text: await readFile(new URL('./python/comparison.py', import.meta.url), 'utf8') });
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
        return success({ outputId: 'python-acceptance', basedOn: snapshot, changes, artifacts: examples.artifacts, obligations: examples.obligations });
      },
      read: (id, snapshot) => native.read(id, snapshot), search: (id, snapshot) => native.search(id, snapshot),
    };
  },
};
