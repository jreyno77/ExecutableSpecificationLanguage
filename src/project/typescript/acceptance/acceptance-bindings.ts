import { z } from 'zod';
import type { Diagnostic } from '../../../compiler/checking.js';
import type { Item } from '../../../model/inspection-item.js';
import type { IdentifiedSpecification, SpecDiff } from '../../../model/specification-identity.js';
import type { NodeId } from '../../../model/model.js';
import { canonical, identifier } from '../../../model/identity-baseline.js';
import { literal } from '../../connection/project-files.js';
import { nativeIdentifier, typescriptOptions } from '../typescript-declarations.js';

const stem = (text: string): boolean => literal(text) && !/[/:\\*?<>|.]/.test(text) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(text);
const portable = (text: string): boolean => literal(text) && !/[\\:*?<>|\[\]{}]/.test(text);
const selector = z.union([z.strictObject({ id: identifier, name: z.string() }),
  z.strictObject({ declaration: z.array(z.string().min(1)).min(1), module: z.string().min(1).optional(), name: z.string() })]);
const placement = (kind: 'class' | 'variable') => z.strictObject({ outputId: z.literal('acceptance'), format: z.literal('typescript-symbol-1'),
  value: z.strictObject({ file: z.string().refine(portable), declaration: z.tuple([z.strictObject({ kind: z.literal(kind), name: z.string().refine(nativeIdentifier) })]) }) });
export const acceptanceOptions = z.strictObject({ domain: z.string().refine(nativeIdentifier),
  testRoot: z.string().refine(value => portable(value) && !value.split('/').some(part => part.toLowerCase() === '.expec')).default('test'),
  configFile: z.string().refine(portable).optional(), adoptExisting: z.boolean().default(false),
  names: z.array(selector).default([]), imports: typescriptOptions.shape.imports,
  driver: placement('class').optional(), fixture: placement('variable').optional() });
export type AcceptanceOptions = z.infer<typeof acceptanceOptions>;
export const mappingSchema = z.strictObject({ id: z.string(), name: z.string(), explicit: z.boolean(), imported: z.string() });
export type AcceptanceMapping = z.infer<typeof mappingSchema>;

/** Source identity owns naming; native placement remains an explicit association. */
export class AcceptanceBindings {
  readonly problems: Diagnostic[] = [];
  private readonly names = new Map<NodeId, string>();
  private readonly imports = new Map<NodeId, AcceptanceOptions['imports'][number]>();
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
    for (const rule of options.imports) {
      const matches = current.baseline.elements.filter(item => item.address.module === rule.module && JSON.stringify(path(item.id)) === JSON.stringify(rule.declaration));
      const item = matches.length === 1 ? current.specification.inspection.read(current.node(matches[0]!.id)) : undefined;
      if (!item || !['record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration', 'concept', 'component', 'class', 'interface'].includes(item.kind)
        || !nativeIdentifier(rule.name) || rule.as && !nativeIdentifier(rule.as) || this.imports.has(item.id)) this.problem('invalid-native-mapping', item, 'Select one declared type with an unambiguous native import.');
      else this.imports.set(item.id, rule);
    }
  }
  imported(item: Item): AcceptanceOptions['imports'][number] | undefined { return this.imports.get(item.id); }
  mappings(): AcceptanceMapping[] {
    return this.current.baseline.elements.flatMap(record => {
      const item = this.current.specification.inspection.read(this.current.node(record.id));
      if (item.kind !== 'examples' && !('name' in item)) return [];
      return [{ id: record.id, name: this.names.get(item.id) ?? (item.kind === 'examples' ? this.group(item) : item.name),
        explicit: this.names.has(item.id), imported: canonical(this.imports.get(item.id) ?? null) }];
    });
  }
  retain(previous: readonly AcceptanceMapping[], diff?: SpecDiff): void {
    for (const after of this.mappings()) {
      const before = previous.find(item => item.id === after.id); if (!before) continue;
      const item = this.current.specification.inspection.read(this.current.node(after.id)), subject = item.kind === 'examples' && item.subject?.resolution;
      const renamed = diff?.changes.some(change => change.kinds.includes('rename') && (change.id === after.id || subject && subject.status === 'bound' && change.id === this.current.id(subject.target)));
      if (before.imported !== after.imported || before.name !== after.name && !(renamed && !before.explicit && !after.explicit))
        this.problem('native-mapping-conflict', item, 'The effective mapping of an established subject cannot change implicitly.');
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
