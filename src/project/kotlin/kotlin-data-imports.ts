import type { Check, Diagnostic } from '../../compiler/checking.js';
import type { Item } from '../../model/inspection-item.js';
import type { NodeId } from '../../model/model.js';
import type { OutputContext } from '../output/output.js';
import type { ProjectSnapshot } from '../connection/project-connection.js';
import type { IdentifiedSpecification } from '../../model/specification-identity.js';
import type { KotlinOptions } from './kotlin-declarations.js';
import { canonical, success } from '../../model/identity-baseline.js';
import { hash, problem } from '../connection/project-files.js';
import { KotlinData } from './kotlin-data.js';
import { kotlinName } from './kotlin-fixture.js';
import { selectKotlinMapping } from './kotlin-mapping.js';
import { queryKotlin, type KotlinQuery } from './kotlin-query.js';

type Import = { id: string; name: string; as?: string };
const kinds = new Set(['class', 'interface', 'concept', 'component', 'record-type-declaration', 'alias-type-declaration', 'opaque-type-declaration']);

/** Verifies mapped provider fields in K2 without adopting or executing their declarations. */
export async function kotlinDataImports(current: IdentifiedSpecification, options: Pick<KotlinOptions, 'imports'> & { testRoot: string },
  context: OutputContext | undefined, snapshot: ProjectSnapshot, native: KotlinQuery,
  existing: ReadonlyMap<NodeId, KotlinQuery['declarations'][number]>, tuples: ReadonlyMap<number, string | undefined>): Promise<Check<{
    targets: Map<NodeId, KotlinQuery['declarations'][number]>; imports: Import[];
  }>> {
  const targets = new Map(existing), imports: Import[] = [], problems: Diagnostic[] = [];
  const inspection = current.specification.inspection, types = current.specification.types;
  const modules = new Set([current.specification.entry, ...context?.workspaceModules ?? []]);
  const selected: { item: Item; target: KotlinQuery['declarations'][number] }[] = [];
  const fail = (item: Item, message: string, target?: KotlinQuery['declarations'][number]) => problems.push({
    code: 'native-signature-conflict', message, at: item.origin, related: target ? [{ kind: 'dependency', path: ['project', target.file, target.nameRange.start] }] : [],
  });
  for (const rule of options.imports) {
    const found = selectKotlinMapping(current, rule, item => kinds.has(item.kind)
      && (item.kind === 'opaque-type-declaration' || item.origin.kind !== 'source' || !modules.has(item.origin.module)), 'kotlin-acceptance');
    problems.push(...found.problems); if (!found.value) continue;
    const item = found.value, matches = native.declarations.filter(node => ['class', 'interface', 'object', 'typealias'].includes(node.kind)
      && node.selector.every(part => ['class', 'interface', 'object', 'typealias'].includes(part.kind)) && kotlinName(node) === rule.name);
    if (imports.some(before => before.id === current.id(item.id))) { fail(item, 'A provider type has more than one native mapping.'); continue; }
    const target = matches[0], parameters = 'typeParameters' in item ? item.typeParameters : [];
    if (matches.length !== 1 || !target || !['public', 'internal'].includes(target.visibility) || (target.typeParameters?.length ?? 0) !== parameters.length) {
      fail(item, 'Select one accessible native type with the declared generic arity.', target); continue;
    }
    const previous = targets.get(item.id);
    if (previous && canonical(previous) !== canonical(target)) { fail(item, 'The import conflicts with an existing native association.', target); continue; }
    targets.set(item.id, target); selected.push({ item, target });
    imports.push({ id: current.id(item.id), name: rule.name, ...rule.as ? { as: rule.as } : {} });
  }
  const checks: { item: Item; target: KotlinQuery['declarations'][number]; name: string; source: string }[] = [];
  for (const { item, target } of selected) {
    if (item.kind !== 'record-type-declaration') continue;
    const fields = types.fields(types.declaredType(item.id));
    if (fields.status !== 'known' || fields.value.kind !== 'available') { fail(item, 'The supplied catalog must describe the record fields.', target); continue; }
    if (target.readableProperties?.length !== fields.value.fields.length) { fail(item, 'The native record must expose exactly the declared data fields.', target); continue; }
    const names = new Map(item.typeParameters.map((parameter, index) => [parameter.id, '_Expec' + index]));
    const data = new KotlinData(types, targets, tuples, '', new Set(), names);
    const arguments_ = item.typeParameters.map(parameter => names.get(parameter.id)!);
    const generic = arguments_.length ? '<' + arguments_.join(', ') + '>' : '';
    const receiver = kotlinName(target) + generic, name = '__expec_type_' + checks.length;
    checks.push({ item, target, name, source: 'private fun ' + generic + (generic ? ' ' : '') + name + '(__value: ' + receiver + '): ' + receiver + ' = __value' });
    for (const field of fields.value.fields) {
      const declared = inspection.read(field.declaration, 'field'), associated = targets.get(field.declaration);
      const matches = native.declarations.filter(node => node.file === target.file && node.kind === 'property'
        && canonical(node.selector.slice(0, -1)) === canonical(target.selector)
        && (associated ? node.file === associated.file && canonical(node.selector) === canonical(associated.selector) : node.name === declared.name));
      const property = matches[0];
      if (matches.length !== 1 || !property || !['public', 'internal'].includes(property.visibility) || field.type.status !== 'known') {
        fail(declared, 'Each declared field needs one accessible property on the mapped native record.', target); continue;
      }
      targets.set(field.declaration, property);
      const name = '__expec_field_' + checks.length;
      checks.push({ item: declared, target: property, name,
        source: 'private fun ' + generic + (generic ? ' ' : '') + name + '(__value: ' + kotlinName(target) + generic + '): '
          + data.type(field.type.value, declared, true) + ' = __value.' + property.name });
    }
    problems.push(...data.problems);
  }
  if (problems.length) return { problems, deferred: [] };
  if (checks.length) {
    const path = options.testRoot + '/__expec_import_contract.kt';
    if (snapshot.files.some(file => file.path === path)) return { problems: [problem(snapshot.root, 'output-conflict', path, 'Native comparison requires an unused temporary source path.')], deferred: [] };
    const bytes = Buffer.from(checks.map(check => check.source).join('\n') + '\n');
    const compared = await queryKotlin({ ...snapshot, files: [...snapshot.files, { path, bytes, version: hash(bytes) }] }, 'expec.kotlin.json',
      checks.map(check => ({ file: path, name: check.name })));
    if (!compared.value) return { problems: compared.problems, deferred: compared.deferred };
    for (const check of checks) {
      const observed = compared.value.typeChecks?.filter(item => item.file === path && item.name === check.name);
      if (observed?.length !== 1 || observed[0]!.matches !== true) fail(check.item, 'The actual native field type differs from its complete declared type.', check.target);
    }
    for (const issue of compared.value.problems) {
      if (issue.file !== path) problems.push(problem(snapshot.root, 'kotlin-' + issue.code, issue.file, issue.message));
      else {
        const owner = compared.value.declarations.find(node => node.file === path && node.kind === 'function' && node.range.start <= issue.range.start && node.range.end >= issue.range.end);
        const check = checks.find(check => check.name === owner?.name) ?? checks[0]!;
        fail(check.item, 'The complete native field contract is invalid: ' + issue.message, check.target);
      }
    }
  }
  return problems.length ? { problems, deferred: [] } : success({ targets, imports });
}

