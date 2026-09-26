import { expect } from 'vitest';
import { createSyntaxReader, inspect, type Inspection, type InspectionNode, type ReadResult, type SourceNodeId } from '../../src/index.js';

type Position = { line: number; column: number };
type Capability = {
  name: string; inputs: string[]; sourceId: string;
  declarationAt: Position; nameAt: Position; nameEndsAt: Position;
};
type TypeUse = { name: string; at: Position; arguments: string[] };
type PromiseText = { text: string; clauseAt: Position; textAt: Position };

function position(point: Position): Position { return { line: point.line, column: point.column }; }

// Focused projection repair: this path currently accepts named types only.
function namedTypeDescription(source: Inspection, id: Readonly<SourceNodeId>): string {
  const type = source.node(id, 'named-type');
  const name = source.reference(type.payload.reference).join('.');
  const argumentsText = type.payload.arguments.map(argument => namedTypeDescription(source, argument));
  return name + (argumentsText.length ? `<${argumentsText.join(', ')}>` : '');
}


function recorded<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export class QueryInspection {
  private result: ReadResult | undefined;
  private original!: ReadResult;
  private inspection: Inspection | undefined;
  private capabilities: Capability[] | undefined;
  private typeUses: TypeUse[] | undefined;
  private typeIds: string[] = [];
  private promises: PromiseText[] | undefined;

  sourceIs(sourceId: string, text: string): void {
    this.capabilities = undefined;
    this.typeUses = undefined;
    this.typeIds = [];
    this.promises = undefined;
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
          return `${source.name(parameter.payload.name)}: ${namedTypeDescription(source, parameter.payload.declaredType)}`;
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

  expectCapabilities(expected: Capability[]): void { expect(recorded(this.capabilities, 'Collect capabilities before checking them')).toEqual(expected); }
  expectCapabilityNames(expected: string[]): void { expect(recorded(this.capabilities, 'Collect capabilities before checking them').map(item => item.name)).toEqual(expected); }
  expectNamedTypes(expected: TypeUse[]): void { expect(recorded(this.typeUses, 'Collect named types before checking them')).toEqual(expected); }
  expectTypeNames(expected: string[]): void { expect(recorded(this.typeUses, 'Collect named types before checking them').map(item => item.name)).toEqual(expected); }
  expectDistinctTypeOccurrences(count: number): void {
    recorded(this.typeUses, 'Collect named types before checking them');
    expect(this.typeIds).toHaveLength(count);
    expect(new Set(this.typeIds).size).toBe(count);
  }
  expectPromises(expected: PromiseText[]): void { expect(recorded(this.promises, 'Collect promises before checking them')).toEqual(expected); }
  expectSourceUnchanged(): void { expect(recorded(this.result, 'Read source before checking it')).toEqual(this.original); }
  expectRejectedWithDiagnostics(): void {
    const result = recorded(this.result, 'Read source before checking it');
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected syntax rejection');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(this.inspection).toBeUndefined();
    expect(result.diagnostics).toEqual(this.original.status === 'rejected' ? this.original.diagnostics : []);
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
