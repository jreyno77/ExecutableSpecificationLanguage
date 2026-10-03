import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { IdentifiedSpecification } from './specification-identity.js';
import type { NodeId } from './model.js';
import { identifier, locatorSchema } from './identity-baseline.js';
import { literal } from './project-files.js';
import { nativeIdentifier, typescriptOptions } from './typescript-declarations.js';

const stem = (text: string): boolean => literal(text) && !/[/:\\*?<>|.]/.test(text) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(text);
const selector = z.union([z.strictObject({ id: identifier, name: z.string() }),
  z.strictObject({ declaration: z.array(z.string().min(1)).min(1), module: z.string().min(1).optional(), name: z.string() })]);
export const acceptanceOptions = z.strictObject({ domain: z.string().refine(nativeIdentifier),
  testRoot: z.string().refine(value => literal(value) && !value.split('/').some(part => part.toLowerCase() === '.expec')).default('test'),
  configFile: z.string().refine(literal).optional(), adoptExisting: z.boolean().default(false),
  names: z.array(selector).default([]), imports: typescriptOptions.shape.imports,
  driver: locatorSchema.optional(), fixture: locatorSchema.optional() });
export type AcceptanceOptions = z.infer<typeof acceptanceOptions>;

/** Source identity owns naming; native placement remains an explicit association. */
export class AcceptanceBindings {
  readonly problems: Diagnostic[] = [];
  private readonly names = new Map<NodeId, string>();
  constructor(private readonly current: IdentifiedSpecification, readonly options: AcceptanceOptions) {
    const path = (id: string): string[] => { const record = current.baseline.elements.find(item => item.id === id)!;
      return [...record.address.owner ? path(record.address.owner) : [], ...record.address.name === null ? [] : [record.address.name]]; };
    for (const rule of options.names) {
      const matches = current.baseline.elements.filter(item => 'id' in rule ? item.id === rule.id
        : (rule.module === undefined || item.address.module === rule.module) && JSON.stringify(path(item.id)) === JSON.stringify(rule.declaration));
      const item = matches.length === 1 ? current.specification.inspection.read(current.node(matches[0]!.id)) : undefined;
      if (!item || !['examples', 'setup', 'action', 'observation', 'check', 'parameter', 'type-parameter', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration', 'concept', 'component', 'class', 'interface'].includes(item.kind)) {
        this.problem('invalid-native-mapping', item, 'A name selector must identify exactly one eligible group or declaration.'); continue;
      }
      if (this.names.has(item.id) || !(item.kind === 'examples' ? stem(rule.name) : nativeIdentifier(rule.name))) this.problem('invalid-native-name', item, 'Duplicate or unsupported native name: ' + rule.name);
      else this.names.set(item.id, rule.name);
    }
  }
  problem(code: string, item: Item | undefined, message: string): void { this.problems.push({ code, message, at: item?.origin ?? { kind: 'dependency', path: ['outputs', 'acceptance', 'options'] }, related: [] }); }
  name(item: Item): string {
    const name = this.names.get(item.id) ?? ('name' in item ? item.name : item.kind);
    if (!nativeIdentifier(name)) this.problem('invalid-native-name', item, 'Provide an explicit native identifier for ' + name + '.');
    return name;
  }
  group(item: Item<'examples'>): string {
    const subject = item.subject?.resolution;
    return this.names.get(item.id) ?? (subject?.status === 'bound' ? this.name(this.current.specification.inspection.read(subject.target)) : this.options.domain);
  }
}
