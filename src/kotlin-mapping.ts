import type { Check } from './checking.js';
import type { Item } from './inspection-item.js';
import type { KotlinOptions } from './kotlin-declarations.js';
import type { IdentifiedSpecification } from './specification-identity.js';

/** Resolves authored selectors against the existing identity catalog, before native spelling is chosen. */
export function selectKotlinMapping(current: IdentifiedSpecification, rule: KotlinOptions['names'][number],
  eligible: (item: Item) => boolean, output: string): Check<Item> {
  const records = new Map(current.baseline.elements.map(record => [record.id, record]));
  const path = (id: string): readonly (string | null)[] => {
    const record = records.get(id)!; return [...(record.address.owner ? path(record.address.owner) : []), record.address.name];
  };
  const matches = current.baseline.elements.filter(record => 'id' in rule ? record.id === rule.id
    : (!rule.module || rule.module === record.address.module) && JSON.stringify(path(record.id)) === JSON.stringify(rule.declaration))
    .map(record => current.specification.inspection.read(current.node(record.id))).filter(eligible);
  return matches.length === 1 ? { value: matches[0]!, problems: [], deferred: [] } : { problems: [{
    code: 'invalid-native-mapping', message: 'A mapping must select exactly one eligible declaration.',
    at: { kind: 'dependency', path: ['outputs', output, 'id' in rule ? rule.id : rule.declaration.join('.')] }, related: matches.map(item => item.origin),
  }], deferred: [] };
}
