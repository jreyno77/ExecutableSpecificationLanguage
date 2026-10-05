import { describe, expect, it } from 'vitest';
import type { Configuration } from '../../src/project/connection/configuration.js';
import { DependencyPlanner } from '../../src/project/dependencies/dependency-planner.js';
import { ExternalModel } from '../../src/model/external-model.js';
import type { Check } from '../../src/compiler/checking.js';

const configuration = (requirements: Partial<Pick<Configuration, 'libraries' | 'packages'>> = {}): Configuration => ({
  sourceId: 'expec.json', formatVersion: 1, version: '0.2.0', build: { entries: ['store.expec'] },
  outputs: [], libraries: [], packages: [], ...requirements,
});
const module = (locator: string) => new ExternalModel(locator, [{ kind: 'opaque-type', name: 'Book' }]);
function inventoryProblem(report: Check<unknown>, path: readonly (string | number)[]) {
  expect(report.value).toBeUndefined();
  expect(report.deferred).toEqual([]);
  const finding = report.problems.find(item => item.code === 'invalid-inventory' && item.at.kind === 'dependency'
    && JSON.stringify(item.at.path) === JSON.stringify(['inventory', ...path]));
  expect(finding, `invalid inventory at ${path.join('.')}`).toBeDefined();
  return finding!;
}

describe('DependencyPlanner', () => {
  it('returns an explicit empty compiler input when no dependency is declared', () => {
    expect(new DependencyPlanner().resolve(configuration(), { modules: [], packages: [] })).toEqual({
      value: { modules: [], packages: [] }, problems: [], deferred: [],
    });
  });

  it('preserves selected model identity and declaration order', () => {
    const inventory = module('inventory');
    const pricing = module('pricing');
    const report = new DependencyPlanner().resolve(configuration({ libraries: [
      { module: 'pricing', version: '^1.0.0' }, { module: 'inventory', version: '^1.0.0' },
    ] }), { modules: [{ model: inventory, version: '1.2.0' }, { model: pricing, version: '1.0.0' }], packages: [] });
    expect(report.value?.modules).toHaveLength(2);
    expect(report.value!.modules[0]).toBe(pricing);
    expect(report.value!.modules[1]).toBe(inventory);
    expect(report.problems).toEqual([]);
  });

  it('rejects a malformed unused package version', () => {
    const report = new DependencyPlanner().resolve(configuration(), { modules: [], packages: [{ name: 'npm:unused', version: 'latest' }] });
    inventoryProblem(report, ['packages', 0, 'version']);
  });

  it('rejects a malformed unused module version', () => {
    const report = new DependencyPlanner().resolve(configuration(), { modules: [{ model: module('inventory'), version: '1.0' }], packages: [] });
    inventoryProblem(report, ['modules', 0, 'version']);
  });

  it('rejects noncanonical concrete inventory versions', () => {
    const report = new DependencyPlanner().resolve(configuration(), { modules: [{ model: module('inventory'), version: 'v1.0.0' }],
      packages: [{ name: 'npm:vite', version: ' 6.0.0 ' }] });
    inventoryProblem(report, ['modules', 0, 'version']);
    inventoryProblem(report, ['packages', 0, 'version']);
  });

  it('accepts concrete build metadata while comparing its semantic version', () => {
    const report = new DependencyPlanner().resolve(configuration({ packages: [
      { alias: 'vite', name: 'npm:vite', version: '6.0.0', phases: ['build'] },
    ] }), { modules: [], packages: [{ name: 'npm:vite', version: '6.0.0+build.42' }] });
    expect(report.value?.packages).toEqual([{ alias: 'vite', phases: ['build'] }]);
    expect(report.problems).toEqual([]);
  });

  it('rejects an unused blank package identity', () => {
    inventoryProblem(new DependencyPlanner().resolve(configuration(), { modules: [], packages: [{ name: ' ', version: '1.0.0' }] }),
      ['packages', 0, 'name']);
  });

  it('rejects an unused blank module locator', () => {
    inventoryProblem(new DependencyPlanner().resolve(configuration(), { modules: [{ model: module(' '), version: '1.0.0' }], packages: [] }),
      ['modules', 0, 'model', 'locator']);
  });

  it('rejects duplicate unused package identities and identifies the first entry', () => {
    const report = new DependencyPlanner().resolve(configuration(), { modules: [], packages: [
      { name: 'npm:vite', version: '6.0.0' }, { name: 'npm:vite', version: '6.1.0' },
    ] });
    expect(inventoryProblem(report, ['packages', 1, 'name']).related).toContainEqual({
      kind: 'dependency', path: ['inventory', 'packages', 0, 'name'],
    });
  });

  it('rejects duplicate unused module locators and identifies the first entry', () => {
    const report = new DependencyPlanner().resolve(configuration(), { modules: [
      { model: module('inventory'), version: '1.0.0' }, { model: module('inventory'), version: '1.1.0' },
    ], packages: [] });
    expect(inventoryProblem(report, ['modules', 1, 'model', 'locator']).related).toContainEqual({
      kind: 'dependency', path: ['inventory', 'modules', 0, 'model', 'locator'],
    });
  });

  it('checks each alias for a shared package identity independently', () => {
    const report = new DependencyPlanner().resolve(configuration({ packages: [
      { alias: 'builder', name: 'npm:vite', version: '^6.0.0', phases: ['build'] },
      { alias: 'preview', name: 'npm:vite', version: '>=6.2.0 <7.0.0', phases: ['test'] },
    ] }), { modules: [], packages: [{ name: 'npm:vite', version: '6.10.0' }] });
    expect(report.value?.packages).toEqual([{ alias: 'builder', phases: ['build'] }, { alias: 'preview', phases: ['test'] }]);
    expect(report.problems).toEqual([]);
  });

  it('does not let a compatible alias hide another alias with an incompatible range', () => {
    const report = new DependencyPlanner().resolve(configuration({ packages: [
      { alias: 'builder', name: 'npm:vite', version: '^6.0.0', phases: ['build'] },
      { alias: 'preview', name: 'npm:vite', version: '^7.0.0', phases: ['test'] },
    ] }), { modules: [], packages: [{ name: 'npm:vite', version: '6.10.0' }] });
    expect(report.value).toBeUndefined();
    expect(report.problems).toEqual([expect.objectContaining({ code: 'incompatible-version',
      at: { kind: 'dependency', path: ['manifest', 'expec.json', 'packages', 1, 'version'] },
      related: [{ kind: 'dependency', path: ['inventory', 'packages', 0, 'version'] }],
    })]);
  });

  it('reports a missing library using the manifest identity location', () => {
    const report = new DependencyPlanner().resolve(configuration({ libraries: [{ module: 'inventory', version: '^1.0.0' }] }),
      { modules: [], packages: [] });
    expect(report.value).toBeUndefined();
    expect(report.problems).toEqual([expect.objectContaining({ code: 'unavailable-library',
      at: { kind: 'dependency', path: ['manifest', 'expec.json', 'libraries', 0, 'module'] },
    })]);
  });

  it('reports incompatible library versions with both supplied locations', () => {
    const report = new DependencyPlanner().resolve(configuration({ libraries: [{ module: 'inventory', version: '^1.0.0' }] }),
      { modules: [{ model: module('inventory'), version: '2.0.0' }], packages: [] });
    expect(report.value).toBeUndefined();
    expect(report.problems).toEqual([expect.objectContaining({ code: 'incompatible-version',
      at: { kind: 'dependency', path: ['manifest', 'expec.json', 'libraries', 0, 'version'] },
      related: [{ kind: 'dependency', path: ['inventory', 'modules', 0, 'version'] }],
    })]);
  });

  it('matches opaque package names exactly rather than removing their ecosystem prefix', () => {
    const report = new DependencyPlanner().resolve(configuration({ packages: [
      { alias: 'vite', name: 'npm:vite', version: '^6.0.0', phases: ['build'] },
    ] }), { modules: [], packages: [{ name: 'vite', version: '6.0.0' }] });
    expect(report.value).toBeUndefined();
    expect(report.problems).toEqual([expect.objectContaining({ code: 'unavailable-package',
      at: { kind: 'dependency', path: ['manifest', 'expec.json', 'packages', 0, 'name'] },
    })]);
  });

  it('copies availability collections while retaining supplied models', () => {
    const phases: ('build' | 'runtime' | 'test')[] = ['build'];
    const configured = configuration({ packages: [{ alias: 'vite', name: 'npm:vite', version: '^6.0.0', phases }] });
    const available = { modules: [], packages: [{ name: 'npm:vite', version: '6.0.0' }] };
    const planner = new DependencyPlanner();
    const first = planner.resolve(configured, available);
    expect(first.value?.packages).toEqual([{ alias: 'vite', phases: ['build'] }]);
    phases.push('runtime');
    available.packages[0]!.version = '7.0.0';
    const second = planner.resolve(configured, available);
    expect(second.value).toBeUndefined();
    expect(second.problems[0]?.code).toBe('incompatible-version');
    expect(first.value?.packages).toEqual([{ alias: 'vite', phases: ['build'] }]);
  });
});
