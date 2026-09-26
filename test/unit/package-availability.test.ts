import { describe, expect, it } from 'vitest';
import { PackageAvailability, type DependencyPackage } from '../../src/resolution/package-availability.js';

describe('configured package availability', () => {
  it('checks supplied aliases and authored phases without claiming installation', () => {
    const packages = new PackageAvailability([{ alias: 'vite', phases: ['build'] }]);

    expect(packages.check('vite', 'build')).toEqual([]);
    expect(packages.check('vite')).toEqual([]);
    expect(packages.check('vite', 'runtime')).toEqual([expect.objectContaining({ code: 'unavailable-package' })]);
    expect(packages.check('supabase')).toEqual([expect.objectContaining({ code: 'unavailable-package' })]);
  });

  it('rejects duplicate aliases and phases at their supplied locations', () => {
    const packages = new PackageAvailability([
      { alias: 'vite', phases: ['build', 'build'] },
      { alias: 'vite', phases: ['runtime'] },
    ]);

    expect(packages.problems.map(problem => problem.at)).toEqual(expect.arrayContaining([
      { kind: 'dependency', path: ['packages', 0, 'phases', 1] },
      { kind: 'dependency', path: ['packages', 1, 'alias'] },
    ]));
    expect(packages.check('vite')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-dependency-catalog' }),
    ]));
  });

  it('reports an unknown configured phase as invalid metadata', () => {
    const malformed = [{ alias: 'vite', phases: ['development'] }] as unknown as readonly DependencyPackage[];
    const packages = new PackageAvailability(malformed);

    expect(packages.problems).toEqual([expect.objectContaining({
      code: 'invalid-dependency-catalog',
      at: { kind: 'dependency', path: ['packages', 0, 'phases', 0] },
    })]);
    expect(packages.check('vite')).toEqual(packages.problems);
  });

  it('keeps configuration findings and earlier outcomes unchanged by later availability checks', () => {
    const packages = new PackageAvailability([{ alias: 'vite', phases: ['build'] }]);
    const first = packages.check('supabase');
    const firstBefore = structuredClone(first);

    expect(packages.check('vite', 'runtime')).toEqual([expect.objectContaining({
      code: 'unavailable-package',
      at: { kind: 'dependency', path: ['packages', 0, 'phases'] },
    })]);
    expect(packages.check('vite', 'build')).toEqual([]);
    expect(packages.problems).toEqual([]);
    expect(first).toEqual(firstBefore);
  });
});
