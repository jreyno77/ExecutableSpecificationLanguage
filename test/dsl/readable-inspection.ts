import { expect } from 'vitest';
import type { ExternalDefinition, Inspection, Item, Origin } from '../../src/index.js';
import { ReadableInspectionDriver } from '../driver/readable-inspection.js';

type Position = { line: number; column: number; offset?: number };
type LocatedCapability = { name: string; inputs: { name: string; type: string[] }[];
  declarationAt: Position; nameAt: Position; nameEndsAt: Position };
type TypeOccurrence = { name: string[]; at: Position; arguments: string[][] };

function sourceOrigin(origin: Origin): Extract<Origin, { kind: 'source' }> {
  expect(origin.kind).toBe('source');
  if (origin.kind !== 'source') throw new Error('Expected an authored source location');
  return origin;
}
function namedType(item: Item): Item<'named-type'> {
  expect(item.kind).toBe('named-type');
  if (item.kind !== 'named-type') throw new Error('Expected an authored named type');
  return item;
}

function fieldDeclaration(item: Item<'field' | 'local'>): Item<'field'> {
  const field = item.kind === 'local' ? item.declaration : item;
  expect(field.kind).toBe('field');
  if (field.kind !== 'field') throw new Error('Expected a record field declaration');
  return field;
}

export class ReadableInspection {
  private readonly driver = new ReadableInspectionDriver();
  private resolved: Inspection | undefined;

  sourceIs(sourceId: string, text: string, locator?: string): void { this.driver.sourceIs(sourceId, text, locator); }
  externalContractIs(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalContractIs(locator, definitions); }
  replaceSourceArgument(text: string): void { this.driver.replaceSourceArgument(text); }
  resolveWith(dependency: ReadableInspection): void { this.resolved = this.driver.resolveWith(dependency.driver); }

  expectCapabilityNames(names: string[]): void {
    expect(this.driver.capabilities().map(item => item.name), 'Names directly available on queried capabilities').toEqual(names);
  }
  expectCapabilityInputs(inputs: string[][]): void {
    expect(this.driver.capabilities().map(item => item.parameters.map(parameter => parameter.name)),
      'Names directly available on ordered capability inputs').toEqual(inputs);
  }
  expectCapabilities(expected: LocatedCapability[]): void {
    const actual = this.driver.capabilities();
    expect(actual).toHaveLength(expected.length);
    expected.forEach((wanted, index) => {
      const capability = actual[index]!;
      expect(capability.name).toBe(wanted.name);
      expect(capability.parameters.map(parameter => ({ name: parameter.name, type: namedType(parameter.declaredType).reference.segments }))).toEqual(wanted.inputs);
      expect(sourceOrigin(capability.origin).range.start).toMatchObject(wanted.declarationAt);
      expect(sourceOrigin(capability.nameOrigin).range.start).toMatchObject(wanted.nameAt);
      expect(sourceOrigin(capability.nameOrigin).range.end).toMatchObject(wanted.nameEndsAt);
      for (const parameter of capability.parameters) expect(namedType(parameter.declaredType).reference.resolution).toEqual({ status: 'not-analyzed' });
    });
  }
  expectNamedTypes(expected: TypeOccurrence[]): void {
    const actual = this.driver.namedTypes();
    expect(actual).toHaveLength(expected.length);
    expect(new Set(actual.map(item => item.id)).size).toBe(expected.length);
    expected.forEach((wanted, index) => {
      const type = actual[index]!;
      expect(type.reference.segments).toEqual(wanted.name);
      expect(sourceOrigin(type.reference.segmentOrigins[0]!).range.start).toMatchObject(wanted.at);
      expect(type.arguments.map(argument => namedType(argument).reference.segments)).toEqual(wanted.arguments);
      for (const argument of type.arguments) expect(actual.some(item => item.id === argument.id)).toBe(true);
    });
  }
  expectSeparateGenericArguments(): void {
    const types = this.driver.namedTypes();
    expect(types[0]!.arguments[0]!.id).toBe(types[1]!.id);
    expect(types[1]!.arguments[0]!.id).toBe(types[2]!.id);
    expect(types[3]!.arguments[0]!.id).toBe(types[4]!.id);
    expect(types[4]!.arguments[0]!.id).toBe(types[5]!.id);
    expect(types[0]!.arguments[0]!.id).not.toBe(types[3]!.arguments[0]!.id);
  }
  expectPromises(expected: { text: string; clauseAt: Position; textAt: Position }[]): void {
    const actual = this.driver.promises();
    expect(actual).toHaveLength(expected.length);
    expected.forEach((wanted, index) => {
      expect(actual[index]!.text).toBe(wanted.text);
      expect(sourceOrigin(actual[index]!.origin).range.start).toMatchObject(wanted.clauseAt);
      expect(sourceOrigin(actual[index]!.textOrigin).range.start).toMatchObject(wanted.textAt);
    });
  }
  expectIndependentCapabilityIterations(names: string[]): void {
    expect(this.driver.capabilityIterations()).toEqual([names, names, names]);
  }
  expectRecordContract(expected: { name: string; fields: { name: string; type: string[] }[] }[]): void {
    expect(this.driver.records().map(record => ({ name: record.name,
      fields: record.fields.map(fieldDeclaration).map(field => ({ name: field.name, type: namedType(field.declaredType).reference.segments })) }))).toEqual(expected);
  }
  expectSourceField(name: string, sourceId: string, at: Position): void {
    const field = this.driver.records().flatMap(record => record.fields.map(fieldDeclaration)).find(field => field.name === name)!;
    expect(sourceOrigin(field.origin).range).toMatchObject({ sourceId, start: at });
  }
  expectExternalField(name: string, module: string, path: (string | number)[]): void {
    const field = this.driver.records().flatMap(record => record.fields.map(fieldDeclaration)).find(field => field.name === name)!;
    expect(field.origin).toEqual({ kind: 'external', module, path });
    expect(field.origin).not.toHaveProperty('range');
  }
  expectOpaqueTypes(names: string[]): void { expect(this.driver.opaqueTypes().map(type => type.name)).toEqual(names); }
  expectCapabilityBody(kind: 'absent' | 'available' | 'unavailable'): void {
    expect(this.driver.capabilities()[0]!.body.kind).toBe(kind);
  }
  expectInputDefault(name: string, available: boolean, expression: object | undefined): void {
    const parameter = this.driver.capabilities()[0]!.parameters.find(parameter => parameter.name === name)!;
    expect(parameter.hasDefault).toBe(available);
    if (expression === undefined) expect(parameter.defaultValue).toBeUndefined();
    else expect(parameter.defaultValue).toMatchObject(expression);
  }
  expectOriginalReferenceUnanalyzed(spelling: string[]): void {
    const reference = this.driver.namedTypes().map(type => type.reference).find(reference => reference.segments.join('.') === spelling.join('.'))!;
    expect(reference.segments).toEqual(spelling);
    expect(reference.resolution).toEqual({ status: 'not-analyzed' });
  }
  expectResolvedReference(spelling: string[], targetName: string, targetModule: string): void {
    if (!this.resolved) throw new Error('Resolve the contract before reading binding facts');
    const reference = [...this.resolved.query('named-type')].map(type => type.reference).find(reference => reference.segments.join('.') === spelling.join('.'))!;
    expect(reference.segments).toEqual(spelling);
    expect(reference.resolution.status).toBe('bound');
    if (reference.resolution.status !== 'bound') throw new Error('Expected a bound authored reference');
    expect(this.resolved.read(reference.resolution.target)).toMatchObject({ name: targetName, origin: { module: targetModule } });
  }
  expectInvalidReference(spelling: string[], code: string): void {
    if (!this.resolved) throw new Error('Resolve the contract before reading binding facts');
    const reference = [...this.resolved.query('named-type')].map(type => type.reference).find(reference => reference.segments.join('.') === spelling.join('.'))!;
    expect(reference.resolution).toMatchObject({ status: 'invalid', problems: [expect.objectContaining({ code })] });
  }
  expectQuotedRecordName(name: string, sourceId: string, start: Position, end: Position): void {
    const record = this.driver.records()[0]!;
    expect(record.name).toBe(name);
    expect(sourceOrigin(record.nameOrigin).range).toEqual({ sourceId, start, end });
  }
  expectAccepted(): void { expect(this.driver.readResult().status).toBe('accepted'); }
  expectSyntaxRejection(sourceId: string): void {
    const result = this.driver.readResult();
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejected syntax');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.diagnostics) expect(diagnostic.primaryRange.sourceId).toBe(sourceId);
  }
}
