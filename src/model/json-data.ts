import { parseTree, type Node, type ParseError } from 'jsonc-parser';

/** Strict finite JSON preserves authored keys and diagnoses duplicate properties. */
export function readJson(text: string, problem: (code: string, message: string, path: readonly (string | number)[]) => void): unknown {
  const errors: ParseError[] = [], tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) { problem('invalid-json', 'Provide a complete JSON document without comments or trailing commas.', []); return undefined; }
  const value = (node: Node, path: (string | number)[]): unknown => {
    if (node.type === 'object') {
      const seen = new Set<string>();
      return Object.fromEntries(node.children!.map(property => {
        const key = property.children![0]!.value as string, at = [...path, key];
        if (seen.has(key)) problem('duplicate-key', `Property ${key} occurs more than once.`, at);
        seen.add(key); return [key, value(property.children![1]!, at)];
      }));
    }
    if (node.type === 'array') return node.children!.map((child, index) => value(child, [...path, index]));
    if (node.type === 'number' && !Number.isFinite(node.value)) problem('invalid-setting', 'Use a finite number.', path);
    return node.value as unknown;
  };
  return value(tree, []);
}
