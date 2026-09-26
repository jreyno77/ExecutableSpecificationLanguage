import { expect } from 'vitest';
import { createSyntaxReader, inspect, type Inspection, type InspectionNode, type ReadResult } from '../../src/index.js';

type Position = { line: number; column: number };
type Capability = {
  name: string; inputs: string[]; sourceId: string;
  declarationAt: Position; nameAt: Position; nameEndsAt: Position;
};
type TypeUse = { name: string; at: Position; arguments: string[] };
type PromiseText = { text: string; clauseAt: Position; textAt: Position };

function position(point: Position): Position { return { line: point.line, column: point.column }; }

export class QueryInspection {
  private result!: ReadResult;
  private original!: ReadResult;
  private inspection: Inspection | undefined;
  private capabilities: Capability[] = [];
  private typeUses: TypeUse[] = [];
  private typeIds: string[] = [];
  private promises: PromiseText[] = [];

  sourceIs(sourceId: string, text: string): void {
    this.result = createSyntaxReader().read({ sourceId, text });
    this.original = structuredClone(this.result);
    this.inspection = this.result.status === 'accepted' ? inspect(this.result.description) : undefined;
  }

  collectCapabilities(): void {
    const source = this.acceptedInspection();
    this.capabilities = Array.from(source.nodes('capability'), capability => {
      const name = source.node(capability.payload.name, 'name');
      return {
        name: name.payload.decoded,
        inputs: capability.payload.parameters.map(id => {
          const parameter = source.node(id, 'parameter');
          const type = source.node(parameter.payload.declaredType, 'named-type');
          return `${source.name(parameter.payload.name)}: ${source.reference(type.payload.reference).join('.')}`;
        }),
        sourceId: capability.range.sourceId,
        declarationAt: position(capability.range.start),
        nameAt: position(name.range.start),
        nameEndsAt: position(name.range.end),
      };
    });
  }

  collectNamedTypes(): void {
    const source = this.acceptedInspection();
    this.typeIds = [];
    this.typeUses = Array.from(source.nodes('named-type'), type => {
      this.typeIds.push(JSON.stringify(type.id));
      const reference = source.node(type.payload.reference, 'reference');
      const name = source.node(reference.payload.segments[0]!, 'name');
      return {
        name: source.reference(reference.id).join('.'),
        at: position(name.range.start),
        arguments: type.payload.arguments.map(id => {
          const argument = source.node(id, 'named-type');
          return source.reference(argument.payload.reference).join('.');
        }),
      };
    });
  }

  collectPromises(): void {
    const source = this.acceptedInspection();
    this.promises = Array.from(source.nodes('promises'), clause => {
      const text = source.node(clause.payload.content, 'string-literal');
      return {
        text: text.payload.value,
        clauseAt: position(clause.range.start),
        textAt: position(text.range.start),
      };
    });
  }

  expectCapabilities(expected: Capability[]): void { expect(this.capabilities).toEqual(expected); }
  expectCapabilityNames(expected: string[]): void { expect(this.capabilities.map(item => item.name)).toEqual(expected); }
  expectNamedTypes(expected: TypeUse[]): void { expect(this.typeUses).toEqual(expected); }
  expectTypeNames(expected: string[]): void { expect(this.typeUses.map(item => item.name)).toEqual(expected); }
  expectDistinctTypeOccurrences(count: number): void {
    expect(this.typeIds).toHaveLength(count);
    expect(new Set(this.typeIds).size).toBe(count);
  }
  expectPromises(expected: PromiseText[]): void { expect(this.promises).toEqual(expected); }
  expectSourceUnchanged(): void { expect(this.result).toEqual(this.original); }
  expectRejectedWithDiagnostics(): void {
    expect(this.result.status).toBe('rejected');
    if (this.result.status !== 'rejected') throw new Error('Expected syntax rejection');
    expect(this.result.diagnostics.length).toBeGreaterThan(0);
    expect(this.inspection).toBeUndefined();
    expect(this.result.diagnostics).toEqual(this.original.status === 'rejected' ? this.original.diagnostics : []);
  }

  private acceptedInspection(): Inspection {
    if (!this.inspection) throw new Error('Expected syntactically accepted source');
    return this.inspection;
  }
}

/** Unit tests use the public reader too; no private-node search constructs their expectations. */
export function inspectText(text: string, sourceId = 'store.expec'): Inspection {
  const result = createSyntaxReader().read({ sourceId, text });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return inspect(result.description);
}

export function capabilityNames(inspection: Inspection, nodes: Iterable<InspectionNode<'capability'>>): string[] {
  return Array.from(nodes, node => inspection.name(node.payload.name));
}
