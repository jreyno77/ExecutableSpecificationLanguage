import { describe, expect, it } from 'vitest';
import { Compiler, SpecificationIdentity, reconcileRelationships, type IdentifiedSpecification, type RelationshipObservation } from '../../src/index.js';

function current(): IdentifiedSpecification {
  const compiled = new Compiler().compile({ source: { sourceId: 'game.expec', text: 'opaque type A\nopaque type B\nconcept Store {}' },
    locator: 'game', dependencies: { modules: [], packages: [] } });
  expect(compiled.value).toBeDefined();
  let count = 0;
  const check = new SpecificationIdentity(() => 'identity-' + ++count).associate(compiled.value!);
  expect(check.value).toBeDefined();
  return check.value!;
}
function id(specification: IdentifiedSpecification, name: string): string {
  return specification.baseline.elements.find(record => record.address.name === name)!.id;
}
const at = (value: string) => ({ outputId: 'ts', format: 'symbol-v1', value });
function observation(specification: IdentifiedSpecification): RelationshipObservation {
  return { subject: id(specification, 'Store'), direction: 'outgoing',
    coverage: { complete: true, scope: [at('src/store.ts')], limitations: [] }, uses: [], unresolved: [] };
}

describe('comparing supplied relationship observations', () => {
  it('keeps an expectation unobserved when no project scope could be inspected', () => {
    const specification = current(), observed = observation(specification);
    const result = reconcileRelationships(specification, [id(specification, 'A')], { ...observed,
      coverage: { complete: false, scope: [], limitations: ['No project files were readable.'] } });
    expect(result.problems).toEqual([]);
    expect(result.value?.unobserved).toEqual([id(specification, 'A')]);
    expect(result.value?.observation.coverage).toEqual({ complete: false, scope: [], limitations: ['No project files were readable.'] });
  });

  it('rejects a claim of complete coverage without a declared scope', () => {
    const specification = current(), observed = observation(specification);
    const result = reconcileRelationships(specification, [], { ...observed, coverage: { ...observed.coverage, scope: [] } });
    expect(result.value).toBeUndefined();
    expect(result.problems[0]?.code).toBe('identity-observation');
  });

  it('does not let completeness hide an unresolved use', () => {
    const specification = current(), observed = observation(specification);
    const result = reconcileRelationships(specification, [], { ...observed,
      unresolved: [{ at: at('dynamic()'), reason: 'Dynamic receiver' }] });
    expect(result.value).toBeUndefined();
    expect(result.problems[0]?.code).toBe('identity-observation');
  });

  it('does not treat a coincidentally equal project label as a specification identity', () => {
    const specification = current(), expected = id(specification, 'A');
    const use = { target: { kind: 'project' as const, id: expected }, at: at('src/custom.ts:call') };
    const result = reconcileRelationships(specification, [expected], { ...observation(specification), uses: [use] });
    expect(result.value?.matched).toEqual([]);
    expect(result.value?.unobserved).toEqual([expected]);
    expect(result.value?.observedOnly).toEqual([use]);
  });

  it('reports a known specified dependency that was not expected', () => {
    const specification = current(), extra = { target: { kind: 'specified' as const, id: id(specification, 'B') }, at: at('b') };
    const result = reconcileRelationships(specification, [id(specification, 'A')], { ...observation(specification), uses: [extra] });
    expect(result.value?.observedOnly).toEqual([extra]);
    expect(result.value?.unobserved).toEqual([id(specification, 'A')]);
  });

  it('keeps every location of a matching use in observed order', () => {
    const specification = current(), target = { kind: 'specified' as const, id: id(specification, 'A') };
    const uses = [{ target, at: at('second.ts:a') }, { target, at: at('first.ts:a') }];
    const result = reconcileRelationships(specification, [target.id], { ...observation(specification), uses });
    expect(result.value?.matched).toEqual([{ id: target.id, uses }]);
  });

  it('captures supplied observations so later caller edits do not change earlier reports', () => {
    const specification = current(), use = { target: { kind: 'project' as const, id: 'Launcher' }, at: at('launcher.ts') };
    const uses = [use], limitations = ['Only startup files inspected'];
    const result = reconcileRelationships(specification, [], { ...observation(specification), uses,
      coverage: { complete: false, scope: [at('launcher.ts')], limitations } });
    expect(result.value).toBeDefined();
    use.at.value = 'different.ts'; uses.length = 0; limitations.push('new restriction');
    expect(result.value?.observedOnly[0]?.at.value).toBe('launcher.ts');
    expect(result.value?.observation.coverage.limitations).toEqual(['Only startup files inspected']);
  });

  it('rejects unknown specified targets without allocating new identities', () => {
    const specification = current(), before = JSON.stringify(specification.baseline);
    const result = reconcileRelationships(specification, [], { ...observation(specification),
      uses: [{ target: { kind: 'specified', id: 'not-issued' }, at: at('a') }] });
    expect(result.value).toBeUndefined();
    expect(result.problems[0]?.code).toBe('identity-observation');
    expect(JSON.stringify(specification.baseline)).toBe(before);
  });
});

