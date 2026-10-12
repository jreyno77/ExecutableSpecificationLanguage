import { readJson } from './json-data.js';
import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { SourceDocument } from '../../language/grammar/source.js';
import { validateConfiguration, type Configuration } from './configuration-schema.js';

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
    const problems: Diagnostic[] = [];
    const at = (path: readonly (string | number)[]) => ({ kind: 'dependency' as const, path: ['manifest', source.sourceId, ...path] });
    const problem = (code: string, message: string, path: readonly (string | number)[], related?: readonly (string | number)[]) => {
      problems.push({ code, message, at: at(path), related: related ? [at(related)] : [] });
    };
    const data = readJson(source.text, problem);
    if (problems.length) return { problems, deferred: [] };
    const checked = validateConfiguration(data, source.sourceId);
    if (!checked.value) return checked;
    checked.value.outputs.forEach((output, index) => {
      const validate = this.outputs.get(output.id);
      if (!validate) problem('unknown-output', `Output ${output.id} has no registered profile.`, ['outputs', index, 'id']);
      else for (const finding of validate(output.options)) {
        problem('invalid-output-options', finding.message, ['outputs', index, 'options', ...finding.path]);
      }
    });
    return { ...(!problems.length ? { value: checked.value } : {}), problems, deferred: [] };
  }
}
