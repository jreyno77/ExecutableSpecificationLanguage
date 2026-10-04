import type { Check, Diagnostic } from './checking.js';
import type { Configuration } from './configuration.js';

/** Chooses the finite CLI target without changing public output composition. */
export function cliProfile(configuration: Configuration): Check<{
  target?: 'typescript' | 'java' | 'kotlin' | 'python'; configFile?: string;
}> {
  const targets = { typescript: 'typescript', acceptance: 'typescript', java: 'java', 'java-acceptance': 'java',
    kotlin: 'kotlin', 'kotlin-acceptance': 'kotlin', python: 'python', 'python-acceptance': 'python' } as const;
  let target: typeof targets[keyof typeof targets] | undefined, configFile: string | undefined;
  const problems: Diagnostic[] = [];
  const problem = (code: string, message: string, path: (string | number)[]) => problems.push({ code, message,
    at: { kind: 'dependency', path: ['manifest', configuration.sourceId, ...path] }, related: [] });
  configuration.outputs.forEach((output, index) => {
    const next = Object.hasOwn(targets, output.id) ? targets[output.id as keyof typeof targets] : undefined;
    if (!next) return;
    if (target && target !== next) {
      problem('conflicting-native-profile', 'Choose one executable CLI target; ' + next + ' conflicts with ' + target + '.', ['outputs', index, 'id']); return;
    }
    target = next;
    if (next === 'typescript') return;
    const selected = next === 'kotlin' ? 'expec.kotlin.json' : typeof output.options.configFile === 'string'
      ? output.options.configFile : 'expec.' + next + '.json';
    if (configFile && configFile !== selected) problem('conflicting-native-profile', 'Native outputs must select the same configuration file.', ['outputs', index, 'options', 'configFile']);
    else configFile = selected;
  });
  const ecosystem = target === 'python' ? 'pypi:' : target === 'java' || target === 'kotlin' ? 'maven:' : 'npm:';
  configuration.packages.forEach((item, index) => {
    if (item.name.startsWith(ecosystem)) return;
    const missing = !target && /^(pypi|maven):/.test(item.name);
    problem(missing ? 'unsupported-native-profile' : 'unsupported-package-ecosystem', missing
      ? 'Select an executable output for this native package requirement.' : 'The selected CLI target accepts ' + ecosystem + ' package identities.', ['packages', index, 'name']);
  });
  return { ...(!problems.length ? { value: { ...(target ? { target } : {}), ...(configFile ? { configFile } : {}) } } : {}), problems, deferred: [] };
}
