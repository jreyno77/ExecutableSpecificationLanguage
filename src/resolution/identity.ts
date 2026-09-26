import type { BuiltinName, Declaration, DeclarationId } from './contracts.js';
export function declarationId(): DeclarationId { return Object.freeze({}) as DeclarationId; }
export function builtins(): readonly Declaration[] {
  const names: readonly BuiltinName[] = ['Text', 'Number', 'Boolean', 'List', 'Nothing'];
  return names.map(name => Object.freeze({ id: declarationId(), name, kind: 'builtin-type' as const, origin: Object.freeze({ kind: 'builtin' as const, name }) }));
}

