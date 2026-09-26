import { declarationId, type Declaration } from './declaration.js';

export const builtinNames = ['Text', 'Number', 'Boolean', 'List', 'Nothing'] as const;
export type BuiltinName = typeof builtinNames[number];

/** Each resolution owns fresh identities for the fixed language builtin profile. */
export function builtins(): readonly Declaration[] {
  return builtinNames.map(name => ({
    id: declarationId(), name, kind: 'builtin-type', origin: { kind: 'builtin', name },
  }));
}
