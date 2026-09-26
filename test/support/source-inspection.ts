import { expect } from 'vitest';
import { createSyntaxReader, type SourceDescription } from '../../src/index.js';

import { callbackCapabilities, queryCapabilities } from '../resources/inspection/capability-analyses.js';
import { callbackTypeUses, queryTypeUses } from '../resources/inspection/type-use-analyses.js';

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
    return this.option === 'callbacks' ? callbackCapabilities(this.description()) : queryCapabilities(this.description());
  }
  typeUses(): LocatedTypeUse[] {
    return this.option === 'callbacks' ? callbackTypeUses(this.description()) : queryTypeUses(this.description());
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

export function expectNoInspectableSource(text: string): void {
  const read = createSyntaxReader().read({ sourceId: 'author.expec', text });
  expect(read.status).toBe('rejected');
  expect(read).not.toHaveProperty('description');
}
