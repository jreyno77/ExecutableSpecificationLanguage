import { describe, expect, it } from 'vitest';
import { QueryInspection } from '../support/query-inspection.js';

describe('inspection observations cannot imply work that has not run', () => {
  it('distinguishes uncollected capabilities from a collected empty result', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {}');

    expect(() => inspection.expectCapabilities([])).toThrow('Collect capabilities before checking them');

    inspection.collectCapabilities();
    inspection.expectCapabilities([]);
  });

  it('clears earlier observations when a new source is read', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame { capability save() }');
    inspection.collectCapabilities();
    inspection.expectCapabilityNames(['save']);

    inspection.sourceIs('store.expec', 'concept StoreGame {}');

    expect(() => inspection.expectCapabilityNames(['save'])).toThrow('Collect capabilities before checking them');
  });

  it('requires a type collection before claiming no named types', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {}');

    expect(() => inspection.expectNamedTypes([])).toThrow('Collect named types before checking them');
  });

  it('requires a promise collection before claiming no promises', () => {
    const inspection = new QueryInspection();
    inspection.sourceIs('store.expec', 'concept StoreGame {}');

    expect(() => inspection.expectPromises([])).toThrow('Collect promises before checking them');
  });

  it('requires a source read before asserting that it stayed unchanged', () => {
    const inspection = new QueryInspection();

    expect(() => inspection.expectSourceUnchanged()).toThrow('Read source before checking it');
  });
});

