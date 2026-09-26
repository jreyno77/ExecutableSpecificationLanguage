import { expect } from 'vitest';
import { createSyntaxReader, inspectSource, visitSource, type SourceDescription } from '../../src/index.js';

export type InspectionOption = 'callbacks' | 'queries';
export type LocatedName = { name: string; line: number; column: number };
export type LocatedTypeUse = { segments: readonly string[]; line: number; column: number };

export function readSpecification(text: string): SourceDescription {
  const read = createSyntaxReader().read({ sourceId: 'author.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return read.description;
}

export class SourceAnalyses {
  private source: SourceDescription | undefined;
  constructor(private readonly option: InspectionOption) {}
  sourceIs(text: string): void { this.source = readSpecification(text); }
  private description(): SourceDescription {
    if (!this.source) throw new Error('Supply source before inspecting it.');
    return this.source;
  }
  capabilities(): LocatedName[] {
    const result: LocatedName[] = [];
    if (this.option === 'callbacks') {
      visitSource(this.description(), {
        capability(node, source) {
          result.push({ name: source.name(node.payload.name), line: node.range.start.line, column: node.range.start.column });
        },
      });
    } else {
      const source = inspectSource(this.description());
      for (const node of source.nodes('capability')) {
        result.push({ name: source.name(node.payload.name), line: node.range.start.line, column: node.range.start.column });
      }
    }
    return result;
  }
  typeUses(): LocatedTypeUse[] {
    const result: LocatedTypeUse[] = [];
    if (this.option === 'callbacks') {
      visitSource(this.description(), {
        'named-type'(node, source) {
          result.push({ segments: source.reference(node.payload.reference), line: node.range.start.line, column: node.range.start.column });
        },
      });
    } else {
      const source = inspectSource(this.description());
      for (const node of source.nodes('named-type')) {
        result.push({ segments: source.reference(node.payload.reference), line: node.range.start.line, column: node.range.start.column });
      }
    }
    return result;
  }
  expectCapabilities(expected: LocatedName[]): void { expect(this.capabilities()).toEqual(expected); }
  expectTypeUses(expected: LocatedTypeUse[]): void { expect(this.typeUses()).toEqual(expected); }
  expectAnalysesIndependent(): void {
    const before = structuredClone(this.description());
    const capabilities = this.capabilities();
    const uses = this.typeUses();
    expect(this.typeUses()).toEqual(uses);
    expect(this.capabilities()).toEqual(capabilities);
    expect(this.description()).toEqual(before);
  }
}
