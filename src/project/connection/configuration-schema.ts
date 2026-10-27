import { valid, validRange } from 'semver';
import { z } from 'zod';
import { nativePath } from './source-files.js';
import type { Check, Diagnostic } from '../../compiler/checking.js';

export const fullVersion = (value: unknown): value is string => typeof value === 'string'
  && value === value.trim() && /^\d/.test(value) && valid(value, { loose: false }) !== null;
const text = z.string().refine(value => value.trim().length > 0, 'Provide nonblank text.');
export const bareModule = (value: string): boolean => !!value.trim() && !value.includes('\\') && !/^(?:\.{1,2}\/|\/|[a-z][a-z\d+.-]*:)/i.test(value);
const version = z.string().refine(fullVersion, { message: 'Use a complete SemVer version, such as 1.2.3.', params: { code: 'invalid-version' } });
const range = z.string().refine(value => value.trim().length > 0 && validRange(value, { loose: false }) !== null,
  { message: 'Use a SemVer range, such as ^1.2.3.', params: { code: 'invalid-version' } });

function unique<T>(key: (value: T) => string, field: string[] = [], code = 'invalid-setting') {
  return (values: T[], context: z.RefinementCtx): void => {
    const seen = new Map<string, number>();
    values.forEach((value, index) => {
      const name = key(value), previous = seen.get(name);
      if (previous === undefined) seen.set(name, index);
      else context.addIssue({ code: 'custom', path: [index, ...field], message: `${name} is declared more than once.`,
        params: { code, related: [previous, ...field], width: field.length + 1 } });
    });
  };
}

const packageRequirements = {
  build: z.array(text).superRefine(unique(value => value)).optional(),
  runtime: z.array(text).superRefine(unique(value => value)).optional(),
  test: z.array(text).superRefine(unique(value => value)).optional(),
};
export const scopePath = (value: unknown): value is string => typeof value === 'string'
  && !/[\\:*?\[\]{}\0]/.test(value) && value.split('/').every(part => !!part && part !== '.' && part !== '..');
const sourceRequirements = z.strictObject({ path: text.refine(scopePath, 'Provide a literal manifest-relative path using / separators.'), ...packageRequirements });

export const configurationSchema = z.strictObject({
  formatVersion: z.literal(1),
  version,
  project: z.strictObject({ root: text }).optional(),
  build: z.strictObject({ entries: z.array(text.refine(value => !/[*?\[\]{}]/.test(value), 'Provide a literal filename, without glob patterns.'))
    .min(1, 'Provide at least one source entry.').superRefine(unique(value => value)),
    sourceRoots: z.array(text.refine(value => !/[*?\[\]{}]/.test(value), 'Provide a literal directory without glob patterns.'))
      .superRefine(unique(value => value)).optional() }),
  outputs: z.array(z.strictObject({ id: text,
    options: z.custom<Record<string, unknown>>(value => value !== null && typeof value === 'object' && !Array.isArray(value),
      'Provide an options object.').default(() => ({})) })).superRefine(unique(value => value.id, ['id'])).default(() => []),
  libraries: z.array(z.strictObject({ module: text.refine(bareModule, 'Provide a bare library identity, not a local path or URI.'), version: range,
    source: text.refine(value => nativePath(value) && !/[*?\[\]{}]/.test(value) && !/^[a-z]:(?![/\\])/i.test(value), 'Provide a literal native library root.').optional() }))
    .superRefine(unique(value => value.module, ['module'], 'duplicate-module')).default(() => []),
  requirements: z.strictObject({
    project: z.strictObject(packageRequirements).optional(),
    folders: z.array(sourceRequirements).superRefine(unique(value => value.path, ['path'])).optional(),
    files: z.array(sourceRequirements).superRefine(unique(value => value.path, ['path'])).optional(),
  }).optional(),
  packages: z.array(z.strictObject({ alias: text, name: text, version: range,
    phases: z.array(z.enum(['build', 'runtime', 'test'])).min(1, 'Provide at least one package phase.')
      .superRefine(unique(value => value)) })).superRefine(unique(value => value.alias, ['alias'], 'duplicate-alias')).default(() => []),
}).superRefine((configuration, context) => {
  const requirements = configuration.requirements;
  if (!requirements) return;
  const scopes = [
    { value: requirements.project, path: ['requirements', 'project'] },
    ...(['folders', 'files'] as const).flatMap(kind => (requirements[kind] ?? []).map((value, index) =>
      ({ value, path: ['requirements', kind, index] }))),
  ];
  for (const scope of scopes) for (const phase of ['build', 'runtime', 'test'] as const) {
    for (const [index, alias] of (scope.value?.[phase] ?? []).entries()) {
      const packageIndex = configuration.packages.findIndex(item => item.alias === alias);
      const path = [...scope.path, phase, index];
      if (packageIndex < 0) context.addIssue({ code: 'custom', path, message: 'Unknown package alias ' + alias + '.',
        params: { code: 'unknown-package-alias' } });
      else if (!configuration.packages[packageIndex]!.phases.includes(phase)) context.addIssue({ code: 'custom', path,
        message: 'Package ' + alias + ' does not declare the ' + phase + ' phase.',
        params: { code: 'unavailable-package', related: ['packages', packageIndex, 'phases'], width: path.length } });
    }
  }
});
type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;
export type Configuration = ReadonlyData<z.infer<typeof configurationSchema>> & { readonly sourceId: string };

/** Shared structural and scoped validation for parsed manifests and supplied metadata. */
export function validateConfiguration(data: unknown, sourceId: string): Check<Configuration> {
  const checked = configurationSchema.safeParse(data), problems: Diagnostic[] = [];
  const at = (path: readonly (string | number)[]) => ({ kind: 'dependency' as const, path: ['manifest', sourceId, ...path] });
  if (checked.success) return { value: { ...checked.data, sourceId }, problems, deferred: [] };
  for (const issue of checked.error.issues) {
    const path = issue.path as (string | number)[];
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) problems.push({ code: 'invalid-setting', message: 'Unknown setting ' + key + '.', at: at([...path, key]), related: [] });
    } else {
      const details = issue.code === 'custom' ? issue.params : undefined;
      const code = details?.code ?? (path.length === 1 && path[0] === 'formatVersion' ? 'unsupported-format' : 'invalid-setting');
      problems.push({ code, message: code === 'unsupported-format' ? 'Supported manifest formatVersion is 1.' : issue.message, at: at(path),
        related: details?.related ? [at([...path.slice(0, -details.width), ...details.related])] : [] });
    }
  }
  return { problems, deferred: [] };
}
