import { parseTree, type Node, type ParseError } from 'jsonc-parser';
import type { Check, Diagnostic } from './checking.js';
import type { SourceDocument } from './grammar/source.js';
import { configurationSchema, type Configuration } from './configuration-schema.js';

export type { Configuration } from './configuration-schema.js';
export interface OutputProfile {
  readonly id: string;
  validate(options: Readonly<Record<string, unknown>>): readonly OptionProblem[];
}
export interface OptionProblem { readonly path: readonly (string | number)[]; readonly message: string }

export class ConfigurationReader {
  private readonly outputs = new Map<string, OutputProfile['validate']>();
  constructor(outputs: readonly OutputProfile[]) {
    for (const output of outputs) {
      if (typeof output.id !== 'string' || !output.id.trim() || this.outputs.has(output.id) || typeof output.validate !== 'function') {
        throw new TypeError('Each output profile needs a unique nonblank ID and a callable validator.');
      }
      this.outputs.set(output.id, output.validate.bind(output));
    }
  }
  read(source: Readonly<SourceDocument>): Check<Configuration> {
    const problems: Diagnostic[] = [], errors: ParseError[] = [];
    const at = (path: readonly (string | number)[]) => ({ kind: 'dependency' as const, path: ['manifest', source.sourceId, ...path] });
    const problem = (code: string, message: string, path: readonly (string | number)[], related?: readonly (string | number)[]) => {
      problems.push({ code, message, at: at(path), related: related ? [at(related)] : [] });
    };
    const tree = parseTree(source.text, errors, { disallowComments: true, allowTrailingComma: false });
    if (!tree || errors.length) {
      problem('invalid-json', 'Provide a complete JSON document without comments or trailing commas.', []);
      return { problems, deferred: [] };
    }
    const data = jsonValue(tree, [], problem);
    if (problems.length) return { problems, deferred: [] };
    const checked = configurationSchema.safeParse(data);
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        const path = issue.path as (string | number)[];
        if (issue.code === 'unrecognized_keys') {
          for (const key of issue.keys) problem('invalid-setting', `Unknown setting ${key}.`, [...path, key]);
        } else {
          const details = issue.code === 'custom' ? issue.params : undefined;
          const code = details?.code ?? (path.length === 1 && path[0] === 'formatVersion' ? 'unsupported-format' : 'invalid-setting');
          problem(code, code === 'unsupported-format' ? 'Supported manifest formatVersion is 1.' : issue.message, path,
            details?.related ? [...path.slice(0, -details.width), ...details.related] : undefined);
        }
      }
      return { problems, deferred: [] };
    }
    checked.data.outputs.forEach((output, index) => {
      const validate = this.outputs.get(output.id);
      if (!validate) problem('unknown-output', `Output ${output.id} has no registered profile.`, ['outputs', index, 'id']);
      else for (const finding of validate(output.options)) {
        problem('invalid-output-options', finding.message, ['outputs', index, 'options', ...finding.path]);
      }
    });
    return { ...(!problems.length ? { value: { ...checked.data, sourceId: source.sourceId } } : {}), problems, deferred: [] };
  }
}

/** Retain every authored option key while detecting ambiguity before validation. */
function jsonValue(node: Node, path: (string | number)[], problem: (code: string, message: string, path: (string | number)[]) => void): unknown {
  if (node.type === 'object') {
    const seen = new Set<string>();
    return Object.fromEntries(node.children!.map(property => {
      const key = property.children![0]!.value as string, at = [...path, key];
      if (seen.has(key)) problem('duplicate-key', `Property ${key} occurs more than once.`, at);
      seen.add(key);
      return [key, jsonValue(property.children![1]!, at, problem)];
    }));
  }
  if (node.type === 'array') return node.children!.map((child, index) => jsonValue(child, [...path, index], problem));
  if (node.type === 'number' && !Number.isFinite(node.value)) problem('invalid-setting', 'Use a finite number.', path);
  return node.value as unknown;
}
