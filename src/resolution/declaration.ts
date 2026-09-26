import type { SourceNodeId, SourceRange } from '../grammar/source.js';
import type { BuiltinName } from './builtins.js';

declare const identity: unique symbol;
/** Opaque identity owned by one resolution report, never a cross-build identifier. */
export type DeclarationId = { readonly [identity]: true };

// The supported declaration vocabulary, shared with supplied-module validation.
export const declarationKinds = [
  'concept', 'component', 'class', 'interface',
  'record-type', 'alias-type', 'opaque-type', 'type-parameter',
  'capability', 'function', 'setup', 'action', 'observation', 'check',
  'field', 'parameter', 'fixture', 'participant',
] as const;
export type DeclarationKind = typeof declarationKinds[number] | 'builtin-type';

export type DeclarationOrigin =
  | { readonly kind: 'source'; readonly node: SourceNodeId; readonly range: SourceRange }
  | { readonly kind: 'external'; readonly module: string; readonly declaration: string }
  | { readonly kind: 'builtin'; readonly name: BuiltinName };

export interface Declaration {
  readonly id: DeclarationId;
  readonly name: string;
  readonly kind: DeclarationKind;
  readonly owner?: DeclarationId;
  readonly origin: DeclarationOrigin;
}

export function declarationId(): DeclarationId {
  return Object.freeze({}) as DeclarationId;
}
