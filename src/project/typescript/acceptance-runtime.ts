/** Private source shared by generated DSLs and the tests that execute them. */
export const acceptanceRuntime = String.raw`
import { isDeepStrictEqual, types } from 'node:util';
function comparisonFailure(operand: string, path: string, reason: string): never {
  throw new TypeError('Unsupported comparison data (' + operand + ') at ' + path + ': ' + reason + '.');
}
export function finiteNumber(value: unknown, operand: string, path = '$'): number {
  if (typeof value !== 'number') comparisonFailure(operand, path, 'expected number, received ' + typeof value);
  if (!Number.isFinite(value)) comparisonFailure(operand, path, String(value));
  return value === 0 ? 0 : value;
}
export function comparisonData(value: unknown, operand: string): unknown {
  const ancestors = new Set<object>();
  const visit = (value: unknown, path: string): unknown => {
    if (typeof value === 'number') return finiteNumber(value, operand, path);
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (value === null || typeof value !== 'object') return comparisonFailure(operand, path, value === null ? 'null' : typeof value);
    if (types.isProxy(value)) return comparisonFailure(operand, path, 'proxy');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return comparisonFailure(operand, path, 'nonplain object');
    if (ancestors.has(value)) return comparisonFailure(operand, path, 'cycle');
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key === 'symbol')) return comparisonFailure(operand, path, 'symbol key');
    const names = Object.keys(descriptors).filter(key => !array || key !== 'length').sort(), fields = new Map(Object.entries(descriptors));
    const at = (key: string): string => path + (/^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']');
    if (array) for (const key of names) {
      if (!Number.isInteger(Number(key)) || Number(key) < 0 || Number(key) >= value.length || String(Number(key)) !== key) comparisonFailure(operand, at(key), 'extra array property');
    }
    const result: unknown[] | Record<string, unknown> = array ? [] : {};
    ancestors.add(value);
    try {
      for (let index = 0, count = array ? value.length : names.length; index < count; index++) {
        const key = array ? String(index) : names.at(index)!;
        const position = array ? path + '[' + key + ']' : at(key), descriptor = fields.get(key);
        if (!descriptor) comparisonFailure(operand, position, 'array hole');
        if (!('value' in descriptor)) comparisonFailure(operand, position, 'accessor');
        if (!descriptor.enumerable) comparisonFailure(operand, position, 'nonenumerable property');
        Object.defineProperty(result, key, { value: visit(descriptor.value, position), enumerable: true, writable: true, configurable: true });
      }
    } finally { ancestors.delete(value); }
    return result;
  };
  return visit(value, '$');
}
export function comparisonEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(comparisonData(left, 'left'), comparisonData(right, 'right'));
}
`;
