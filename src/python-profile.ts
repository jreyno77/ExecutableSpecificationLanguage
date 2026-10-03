import { z } from 'zod';
import { isAbsolute } from 'node:path';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import { readJson } from './json-data.js';
import { literal } from './project-files.js';
import { outputProblem } from './output-documents.js';

export const pythonPath = (value: string): boolean => literal(value) && !value.includes('\\') && !value.includes(':');
const path = z.string().refine(pythonPath), absolute = z.string().refine(value => isAbsolute(value) && !value.includes('\0'));
const schema = z.strictObject({ format: z.literal(1), python: absolute, uv: absolute,
  sourceRoots: z.strictObject({ main: z.array(path).min(1), test: z.array(path).min(1) }), environment: path,
  sourcePath: z.array(absolute).default([]),
});
export type PythonProfile = z.infer<typeof schema>;
export const pythonReportPath = '.expec/python/environment.json';
export function pythonConfiguration(snapshot: ProjectSnapshot, path = 'expec.python.json'): { value?: PythonProfile; problems: Diagnostic[] } {
  const problems: Diagnostic[] = [], file = snapshot.files.find(file => file.path === path);
  if (!file) return { problems: [outputProblem('missing-python-config', path, 'Provide ' + path + ' and run an explicit Python install.')] };
  let value: unknown;
  try { value = readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (code, message, at) => {
    problems.push({ code, message, at: { kind: 'dependency', path: ['project', path, ...at] }, related: [] });
  }); } catch { problems.push(outputProblem('invalid-python-config', path, 'Python configuration must be UTF-8 JSON.')); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) problems.push(...parsed.error.issues.map(issue => ({ code: 'invalid-python-config', message: issue.message,
    at: { kind: 'dependency' as const, path: ['project', path, ...issue.path as (string | number)[]] }, related: [] })));
  if (problems.length || !parsed.success) return { problems };
  const roots = [...parsed.data.sourceRoots.main, ...parsed.data.sourceRoots.test], key = (text: string) => process.platform === 'win32' ? text.toLowerCase() : text;
  for (const root of roots) {
    if (roots.some(other => other !== root && key(other).startsWith(key(root) + '/')) || roots.filter(other => key(other) === key(root)).length > 1
      || key(root) === key(parsed.data.environment) || key(root).startsWith(key(parsed.data.environment) + '/') || key(parsed.data.environment).startsWith(key(root) + '/')) {
      problems.push(outputProblem('invalid-python-config', path, 'Source roots and the environment must be distinct nonoverlapping directories.'));
    }
    if (root.split('/').some(part => snapshot.excludeNames.includes(part))) problems.push(outputProblem('excluded-python-input', root, 'A selected source root is excluded from the project capture.'));
  }
  for (const required of [path, pythonReportPath, 'pyproject.toml', 'uv.lock']) if (required.split('/').some(part => snapshot.excludeNames.includes(part))) {
    problems.push(outputProblem('excluded-python-input', required, 'The Python profile requires this captured configuration input.'));
  }
  return problems.length ? { problems } : { value: parsed.data, problems };
}
