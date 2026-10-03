import type { OutputRegistration } from './output.js';
import { PythonDeclarations, pythonOptions } from './python-declarations.js';
import { outputProblem } from './output-documents.js';
import type { FileChange } from './project-writer.js';

/** The Python target is accepted through the same connected-project output contract. */
export const pythonOutput: OutputRegistration = {
  id: 'python', validate: options => {
    const parsed = pythonOptions.safeParse(options);
    return parsed.success ? [] : parsed.error.issues.map(issue => ({ path: issue.path as (string | number)[], message: issue.message }));
  }, open: (options, context) => ({
    id: 'python',
    plan: async (request, snapshot) => {
      if (request.operation !== 'create') return { problems: [outputProblem('python-generation-unavailable', '', 'Python updates are not implemented yet.')], deferred: [] };
      const declarations = new PythonDeclarations(request.current, pythonOptions.parse(options), context), file = declarations.render();
      if (declarations.problems.length) return { problems: declarations.problems, deferred: [] };
      if (snapshot.files.some(item => item.path === file.path)) return { problems: [outputProblem('output-conflict', file.path, 'Existing Python code needs explicit preserving adoption.')], deferred: [] };
      const changes: FileChange[] = [], parts = file.path.split('/');
      for (let depth = 2; depth < parts.length; depth++) {
        const path = parts.slice(0, depth).join('/') + '/__init__.py';
        if (!snapshot.files.some(item => item.path === path)) changes.push({ kind: 'write', path, bytes: Buffer.from('') });
      }
      changes.push({ kind: 'write', path: file.path, bytes: Buffer.from(file.text) });
      return { value: { outputId: 'python', basedOn: snapshot, changes, artifacts: file.artifacts }, problems: [], deferred: [] };
    },
    read: async () => { throw new Error('Python read is not implemented yet.'); },
    search: async () => { throw new Error('Python search is not implemented yet.'); },
  }),
};
