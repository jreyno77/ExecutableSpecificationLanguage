/** Fixed language primitives, shared by inspection input and resolution. */
export const builtinNames = ['Text', 'Number', 'Boolean', 'List', 'Nothing'] as const;
export type BuiltinName = typeof builtinNames[number];
