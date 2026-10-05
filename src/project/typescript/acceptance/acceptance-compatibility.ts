import ts from 'typescript';
import type { Diagnostic } from '../../../compiler/checking.js';
import type { ArtifactAssociation, IdentifiedSpecification } from '../../../model/specification-identity.js';
import type { TypeId } from '../../../compiler/types.js';
import type { AcceptanceOptions } from './acceptance-bindings.js';
import type { AcceptanceState } from './acceptance-state.js';
import { nativeFixture } from './acceptance-documents.js';
import { TypeScriptCapture, diagnostic } from '../typescript-capture.js';
import { nativeSelection, type Selector } from '../typescript-symbols.js';

/** Proves only the selected checked contracts against captured native types. */
export function nativeCompatibility(capture: TypeScriptCapture, options: AcceptanceOptions, state: AcceptanceState,
  current: IdentifiedSpecification, applications: readonly ArtifactAssociation[]): Diagnostic[] {
  const checker = capture.program?.getTypeChecker(), problems: Diagnostic[] = [], catalog = current.specification.types;
  if (!checker) return problems;
  const unproved = (type: ts.Type): boolean => !!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));
  const data = (type: ts.Type, expected: TypeId, input = false, ancestors: readonly (readonly [ts.Type, TypeId])[] = []): boolean => {
    if (unproved(type)) return false;
    if (type.flags & ts.TypeFlags.Never || ancestors.some(([native, source]) => native === type && source === expected)) return true;
    const next = [...ancestors, [type, expected] as const], shape = catalog.describe(expected);
    if (shape.kind === 'alias') return shape.target.status === 'known' && data(type, shape.target.value, input, next);
    if (type.isUnion() && !input) return type.types.every(item => data(item, expected, input, ancestors));
    if (shape.kind === 'union') return input ? shape.alternatives.every(item => data(type, item, input, next)) : shape.alternatives.some(item => data(type, item, input, next));
    if (type.isUnion()) return type.types.some(item => data(item, expected, input, ancestors));
    if (shape.kind === 'optional') return !!(type.flags & ts.TypeFlags.Undefined) || data(type, shape.inner, input, next);
    if (shape.kind === 'builtin') {
      const name = catalog.inspection.read(shape.declaration, 'builtin-type').name;
      if (name === 'List') { const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number); return !!element && data(element, shape.arguments[0]!, input, next); }
      return !!(type.flags & ({ Text: ts.TypeFlags.StringLike, Number: ts.TypeFlags.NumberLike, Boolean: ts.TypeFlags.BooleanLike,
        Nothing: ts.TypeFlags.Void | ts.TypeFlags.Undefined }[name] ?? 0));
    }
    if (shape.kind === 'parameter') return true;
    if (shape.kind === 'literal') {
      const source = catalog.inspection.read(shape.expression, 'literal-type'), value = source.value;
      const literal = value.kind === 'string-literal' ? checker.getStringLiteralType(value.value)
        : value.kind === 'number-literal' ? checker.getNumberLiteralType((source.negative ? -1 : 1) * Number(value.token)) : value.value ? checker.getTrueType() : checker.getFalseType();
      return input ? checker.isTypeAssignableTo(literal, type) : checker.isTypeAssignableTo(type, literal);
    }
    const slots = shape.kind === 'tuple' ? shape.elements.map((id, index) => ({ name: String(index), id })) : (() => {
      const fields = catalog.fields(expected); return fields.status === 'known' && fields.value.kind === 'available'
        ? fields.value.fields.flatMap(field => field.type.status === 'known' ? [{ name: catalog.inspection.read(field.declaration, 'field').name, id: field.type.value }] : []) : [];
    })();
    return slots.every(slot => {
      const property = type.getProperty(slot.name);
      return property ? data(checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? property.declarations![0]!), slot.id, input, next)
        : catalog.describe(slot.id).kind === 'optional';
    });
  };
  const callable = (signature: ts.Signature, id: string, at: ts.Node): boolean => {
    const expected = catalog.callable(current.node(id)), result = checker.getAwaitedType(checker.getReturnTypeOfSignature(signature))!;
    return !unproved(result) && expected.parameters.every((slot, index) => {
      const parameter = signature.parameters[index]; return !!parameter && slot.type.status === 'known'
        && data(checker.getTypeOfSymbolAtLocation(parameter, at), slot.type.value, true);
    }) && (expected.result.status !== 'known' || expected.result.value.kind !== 'value' || data(result, expected.result.value.type));
  };
  const problem = (kind: string, node: ts.Node): void => { problems.push(diagnostic('incompatible-' + kind,
    'The selected native ' + kind + ' needs proved parameter, result and domain types.', capture.projectPath(node.getSourceFile().fileName)!, node.getStart(), node.getWidth())); };
  const contracts = [...state.files.filter(file => file.container?.role === 'driver').flatMap(file => file.artifacts.map(item => ({ item, kind: 'driver' }))),
    ...applications.map(item => ({ item, kind: 'application' }))];
  for (const { item, kind } of contracts) {
    const location = item.locator.value as unknown as { file: string; declaration: Selector[] }, source = capture.program!.getSourceFile(capture.absolute(location.file));
    for (const node of source ? nativeSelection(source, location.declaration) : []) {
      if (!ts.isMethodDeclaration(node) && !ts.isFunctionDeclaration(node)) continue;
      const signature = checker.getSignatureFromDeclaration(node);
      if (!signature || !callable(signature, item.specId, node)) problem(kind, node);
    }
  }
  if (options.fixture) {
    const symbol = nativeFixture(capture, options), node = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (symbol && node) {
      const domains = checker.getTypeOfSymbolAtLocation(symbol, node).getCallSignatures().flatMap(signature => signature.parameters.flatMap(parameter => {
        const type = checker.getTypeOfSymbolAtLocation(parameter, node);
        return (type.isUnion() ? type.types : [type]).flatMap(part => part.getCallSignatures().flatMap(callback => {
          const context = callback.parameters[0], domain = context && checker.getTypeOfSymbolAtLocation(context, node).getProperty(options.domain);
          return domain ? [checker.getTypeOfSymbolAtLocation(domain, node)] : [];
        }));
      }));
      const members = state.files.filter(file => file.container?.role === 'dsl').flatMap(file => file.artifacts);
      if (!domains.length || domains.some(type => unproved(type) || members.some(member => {
        const name = (member.locator.value as unknown as { declaration: Selector[] }).declaration.at(-1)!.name,
          symbol = type.getProperty(name), actual = symbol && checker.getTypeOfSymbolAtLocation(symbol, node), source = catalog.inspection.read(current.node(member.specId));
        if (!actual || unproved(actual)) return true;
        if (source.kind === 'fixture') { const expected = catalog.typeOf(source.declaredType.id); return expected.status !== 'known' || !data(actual, expected.value); }
        return !actual.getCallSignatures().some(signature => callable(signature, member.specId, node));
      }))) problem('fixture', node);
    }
  }
  return problems;
}
