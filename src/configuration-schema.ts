import { valid, validRange } from 'semver';
import { z } from 'zod';

export const fullVersion = (value: unknown): value is string => typeof value === 'string'
  && value === value.trim() && /^\d/.test(value) && valid(value, { loose: false }) !== null;
const text = z.string().refine(value => value.trim().length > 0, 'Provide nonblank text.');
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

export const configurationSchema = z.strictObject({
  formatVersion: z.literal(1),
  version,
  project: z.strictObject({ root: text }).optional(),
  build: z.strictObject({ entries: z.array(text.refine(value => !/[*?\[\]{}]/.test(value), 'Provide a literal filename, without glob patterns.'))
    .min(1, 'Provide at least one source entry.').superRefine(unique(value => value)) }),
  outputs: z.array(z.strictObject({ id: text,
    options: z.custom<Record<string, unknown>>(value => value !== null && typeof value === 'object' && !Array.isArray(value),
      'Provide an options object.').default(() => ({})) })).superRefine(unique(value => value.id, ['id'])).default(() => []),
  libraries: z.array(z.strictObject({ module: text, version: range }))
    .superRefine(unique(value => value.module, ['module'], 'duplicate-module')).default(() => []),
  packages: z.array(z.strictObject({ alias: text, name: text, version: range,
    phases: z.array(z.enum(['build', 'runtime', 'test'])).min(1, 'Provide at least one package phase.')
      .superRefine(unique(value => value)) })).superRefine(unique(value => value.alias, ['alias'], 'duplicate-alias')).default(() => []),
});
type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;
export type Configuration = ReadonlyData<z.infer<typeof configurationSchema>> & { readonly sourceId: string };
