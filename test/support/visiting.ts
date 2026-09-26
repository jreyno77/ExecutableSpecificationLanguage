import { expect } from 'vitest';
import { createSyntaxReader, type ReadResult, type SourceDescription } from '../../src/index.js';
import { capabilitiesIn } from '../resources/visitors/capabilities.js';
import { typeUsesIn } from '../resources/visitors/type-uses.js';
import { promisesIn } from '../resources/visitors/promises.js';

type Capability = ReturnType<typeof capabilitiesIn>[number];
type TypeUse = ReturnType<typeof typeUsesIn>[number];
type PromiseFact = ReturnType<typeof promisesIn>[number];

export function readForVisit(text: string, sourceId = 'store.expec'): SourceDescription {
  const read = createSyntaxReader().read({ sourceId, text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return read.description;
}

/** Acceptance-test driver for the visitor API. Consumers collect facts through visit. */
export class Visiting {
  private result: ReadResult | undefined;
  private original: SourceDescription | undefined;
  private capabilities: Capability[] = [];
  private typeUses: TypeUse[] = [];
  private promises: PromiseFact[] = [];

  sourceIs(sourceId: string, text: string): void {
    this.result = createSyntaxReader().read({ sourceId, text });
    this.original = this.result.status === 'accepted' ? structuredClone(this.result.description) : undefined;
  }

  collectCapabilities(): void { this.capabilities = capabilitiesIn(this.description()); }
  collectTypeUses(): void { this.typeUses = typeUsesIn(this.description()); }
  collectPromises(): void { this.promises = promisesIn(this.description()); }

  expectCapabilities(expected: Capability[]): void { expect(this.capabilities).toEqual(expected); }
  expectCapabilityNames(expected: string[]): void { expect(this.capabilities.map(item => item.name)).toEqual(expected); }
  expectTypeUses(expected: Array<Omit<TypeUse, 'id'>>): void {
    expect(this.typeUses.map(({ id, ...fact }) => fact)).toEqual(expected);
  }
  expectTypeNames(expected: string[][]): void { expect(this.typeUses.map(item => item.segments)).toEqual(expected); }
  expectPromises(expected: PromiseFact[]): void { expect(this.promises).toEqual(expected); }
  expectDistinctTypeOccurrences(count: number): void {
    const identities = this.typeUses.map(item => JSON.stringify(item.id));
    expect(this.typeUses).toHaveLength(count);
    expect(new Set(identities).size).toBe(count);
  }
  expectSourceUnchanged(): void { expect(this.description()).toEqual(this.original); }
  expectRejectedSource(category: string, at: { line: number; column: number }): void {
    expect(this.result?.status).toBe('rejected');
    expect(this.result).not.toHaveProperty('description');
    if (this.result?.status !== 'rejected') throw new Error('Expected syntax rejection.');
    expect(this.result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ category, primaryRange: expect.objectContaining({ start: expect.objectContaining(at) }) }),
    ]));
  }
  private description(): SourceDescription {
    if (this.result?.status !== 'accepted') throw new Error('Read an accepted source before visiting.');
    return this.result.description;
  }
}
