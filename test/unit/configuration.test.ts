import { describe, expect, it } from 'vitest';
import { ConfigurationReader, type OutputProfile } from '../../src/project/connection/configuration.js';
import type { Check } from '../../src/compiler/checking.js';

const manifest = (settings: Record<string, unknown> = {}) => ({
  sourceId: 'expec.json', text: JSON.stringify({ formatVersion: 1, version: '0.2.0',
    build: { entries: ['store.expec'] }, ...settings }),
});
const read = (settings: Record<string, unknown> = {}, profiles: readonly OutputProfile[] = []) =>
  new ConfigurationReader(profiles).read(manifest(settings));
function problem(report: Check<unknown>, code: string, path: readonly (string | number)[]) {
  expect(report.value).toBeUndefined();
  expect(report.deferred).toEqual([]);
  const finding = report.problems.find(item => item.code === code && item.at.kind === 'dependency'
    && JSON.stringify(item.at.path) === JSON.stringify(['manifest', 'expec.json', ...path]));
  expect(finding, `${code} at ${path.join('.')}`).toBeDefined();
  return finding!;
}

describe('ConfigurationReader', () => {
  it('returns the authored version and explicit entries with empty optional lists', () => {
    expect(read()).toEqual({ value: { sourceId: 'expec.json', formatVersion: 1, version: '0.2.0',
      build: { entries: ['store.expec'] }, outputs: [], libraries: [], packages: [] }, problems: [], deferred: [] });
  });

  it('rejects comments instead of silently accepting JSON extensions', () => {
    const report = new ConfigurationReader([]).read({ sourceId: 'expec.json',
      text: '{"formatVersion":1,/* comment */"version":"0.2.0","build":{"entries":["store.expec"]}}' });
    problem(report, 'invalid-json', []);
  });

  it('rejects a trailing comma instead of recovering a configuration', () => {
    const report = new ConfigurationReader([]).read({ sourceId: 'expec.json',
      text: '{"formatVersion":1,"version":"0.2.0","build":{"entries":["store.expec",]}}' });
    problem(report, 'invalid-json', []);
  });

  it('recognizes duplicate keys after decoding their escapes', () => {
    const report = new ConfigurationReader([]).read({ sourceId: 'expec.json',
      text: String.raw`{"formatVersion":1,"version":"0.2.0","build":{"entries":["store.expec"]},"project":{"root":"first","\u0072oot":"second"}}` });
    problem(report, 'duplicate-key', ['project', 'root']);
  });

  it('rejects duplicate keys inside profile-owned options', () => {
    const report = new ConfigurationReader([{ id: 'typescript', validate: () => [] }]).read({ sourceId: 'expec.json',
      text: '{"formatVersion":1,"version":"0.2.0","build":{"entries":["store.expec"]},"outputs":[{"id":"typescript","options":{"directory":"src","directory":"app"}}]}' });
    problem(report, 'duplicate-key', ['outputs', 0, 'options', 'directory']);
  });

  it('requires an object rather than a root array', () => {
    problem(new ConfigurationReader([]).read({ sourceId: 'expec.json', text: '[]' }), 'invalid-setting', []);
  });

  it('does not coerce a textual manifest format into a number', () => {
    const report = read({ formatVersion: '1' });
    expect(report.value).toBeUndefined();
    expect(report.problems).toEqual(expect.arrayContaining([expect.objectContaining({
      at: { kind: 'dependency', path: ['manifest', 'expec.json', 'formatVersion'] },
    })]));
  });

  it('reports the missing build object', () => {
    problem(read({ build: undefined }), 'invalid-setting', ['build']);
  });

  it('requires an entries list instead of a single filename', () => {
    problem(read({ build: { entries: 'store.expec' } }), 'invalid-setting', ['build', 'entries']);
  });

  it('requires each entry to be text', () => {
    problem(read({ build: { entries: [42] } }), 'invalid-setting', ['build', 'entries', 0]);
  });

  it('rejects blank entries without trimming meaningful paths', () => {
    problem(read({ build: { entries: ['  '] } }), 'invalid-setting', ['build', 'entries', 0]);
  });

  it('rejects repeated entries and identifies the first occurrence', () => {
    const finding = problem(read({ build: { entries: ['store.expec', 'store.expec'] } }), 'invalid-setting', ['build', 'entries', 1]);
    expect(finding.related).toContainEqual({ kind: 'dependency', path: ['manifest', 'expec.json', 'build', 'entries', 0] });
  });

  it('requires literal filenames rather than wildcard entries', () => {
    problem(read({ build: { entries: ['specs/*.expec'] } }), 'invalid-setting', ['build', 'entries', 0]);
  });

  it('rejects question-mark, bracket and brace patterns in entries', () => {
    const report = read({ build: { entries: ['store?.expec', '[store].expec', '{store,cart}.expec'] } });
    problem(report, 'invalid-setting', ['build', 'entries', 0]);
    problem(report, 'invalid-setting', ['build', 'entries', 1]);
    problem(report, 'invalid-setting', ['build', 'entries', 2]);
  });

  it('preserves paths and identities exactly as authored', () => {
    const report = read({ project: { root: ' ../My Game ' }, build: { entries: [' specs/Store.expec '] },
      libraries: [{ module: ' Inventory ', version: '^1.0.0' }] });
    expect(report.value?.project?.root).toBe(' ../My Game ');
    expect(report.value?.build.entries).toEqual([' specs/Store.expec ']);
    expect(report.value?.libraries[0]?.module).toBe(' Inventory ');
  });

  it('rejects a blank project root', () => {
    problem(read({ project: { root: '\t' } }), 'invalid-setting', ['project', 'root']);
  });

  it('rejects null as a supplied project', () => {
    problem(read({ project: null }), 'invalid-setting', ['project']);
  });

  it('reports unknown root and build keys instead of stripping them', () => {
    const report = read({ destination: 'game', build: { entries: ['store.expec'], scripts: [] } });
    problem(report, 'invalid-setting', ['destination']);
    problem(report, 'invalid-setting', ['build', 'scripts']);
  });

  it('reports unknown library and package keys', () => {
    const report = read({ libraries: [{ module: 'inventory', version: '1.0.0', path: 'inventory.expec' }],
      packages: [{ alias: 'vite', name: 'npm:vite', version: '6.0.0', phases: ['build'], install: true }] });
    problem(report, 'invalid-setting', ['libraries', 0, 'path']);
    problem(report, 'invalid-setting', ['packages', 0, 'install']);
  });

  it('requires a list of outputs', () => {
    problem(read({ outputs: {} }), 'invalid-setting', ['outputs']);
  });

  it('rejects repeated output IDs with both authored locations', () => {
    const report = read({ outputs: [{ id: 'typescript' }, { id: 'typescript' }] }, [{ id: 'typescript', validate: () => [] }]);
    const finding = problem(report, 'invalid-setting', ['outputs', 1, 'id']);
    expect(finding.related).toContainEqual({ kind: 'dependency', path: ['manifest', 'expec.json', 'outputs', 0, 'id'] });
  });

  it('requires output options to be an object', () => {
    problem(read({ outputs: [{ id: 'typescript', options: [] }] }, [{ id: 'typescript', validate: () => [] }]),
      'invalid-setting', ['outputs', 0, 'options']);
  });

  it('preserves nested profile options without applying target defaults', () => {
    const options = { files: ['src', 'test'], format: { enabled: true, width: 80, extra: null } };
    const report = read({ outputs: [{ id: 'typescript', options }] }, [{ id: 'typescript', validate: () => [] }]);
    expect(report.value?.outputs[0]?.options).toEqual(options);
    expect(report.problems).toEqual([]);
  });

  it('preserves an own __proto__ option as ordinary profile data', () => {
    const report = new ConfigurationReader([{ id: 'typescript', validate: () => [] }]).read({ sourceId: 'expec.json',
      text: '{"formatVersion":1,"version":"0.2.0","build":{"entries":["store.expec"]},"outputs":[{"id":"typescript","options":{"__proto__":{"enabled":true},"nested":{"__proto__":"kept"}}}]}' });
    expect(report.value).toBeDefined();
    const options = report.value!.outputs[0]!.options;
    expect(Object.hasOwn(options, '__proto__')).toBe(true);
    expect(options['__proto__']).toEqual({ enabled: true });
    expect(options.nested).toEqual(JSON.parse('{"__proto__":"kept"}'));
  });

  it('does not allow a special key to bypass owned manifest fields', () => {
    const report = new ConfigurationReader([]).read({ sourceId: 'expec.json',
      text: '{"formatVersion":1,"version":"0.2.0","build":{"entries":["store.expec"]},"__proto__":{"project":{"root":"hidden"}}}' });
    problem(report, 'invalid-setting', ['__proto__']);
  });

  it('reports a numeric overflow at the supplied option rather than calling valid syntax invalid JSON', () => {
    const report = new ConfigurationReader([{ id: 'typescript', validate: () => [] }]).read({ sourceId: 'expec.json',
      text: '{"formatVersion":1,"version":"0.2.0","build":{"entries":["store.expec"]},"outputs":[{"id":"typescript","options":{"limits":[1e400]}}]}' });
    problem(report, 'invalid-setting', ['outputs', 0, 'options', 'limits', 0]);
    expect(report.problems.some(item => item.code === 'invalid-json')).toBe(false);
  });

  it('preserves canonical version build metadata', () => {
    expect(read({ version: '1.2.3-beta.1+build.42' }).value?.version).toBe('1.2.3-beta.1+build.42');
  });

  it('rejects a version prefix accepted by permissive package tooling', () => {
    problem(read({ version: 'v1.2.3' }), 'invalid-version', ['version']);
  });

  it('rejects whitespace around a concrete version', () => {
    problem(read({ version: ' 1.2.3 ' }), 'invalid-version', ['version']);
  });

  it('requires a complete version rather than a partial release', () => {
    problem(read({ version: '1.2' }), 'invalid-version', ['version']);
  });

  it('rejects leading zeroes in concrete version components', () => {
    problem(read({ version: '01.2.3' }), 'invalid-version', ['version']);
  });

  it('preserves supported wildcard, union, tilde and comparator ranges', () => {
    const libraries = [{ module: 'any', version: '*' }, { module: 'either', version: '^1.0.0 || ^2.0.0' },
      { module: 'patch', version: '~1.2.0' }, { module: 'bounded', version: '>=1.2.0 <2.0.0' }];
    expect(read({ libraries }).value?.libraries).toEqual(libraries);
  });

  it('rejects a blank dependency range rather than treating it as any version', () => {
    problem(read({ libraries: [{ module: 'inventory', version: '  ' }] }), 'invalid-version', ['libraries', 0, 'version']);
  });

  it('does not reinterpret URLs or Git references as version ranges', () => {
    const report = read({ libraries: [{ module: 'inventory', version: 'https://example.test/inventory.tgz' },
      { module: 'pricing', version: 'git+https://example.test/pricing#main' }] });
    problem(report, 'invalid-version', ['libraries', 0, 'version']);
    problem(report, 'invalid-version', ['libraries', 1, 'version']);
  });

  it('requires nonblank dependency identities', () => {
    const report = read({ libraries: [{ module: ' ', version: '1.0.0' }],
      packages: [{ alias: '', name: '\t', version: '1.0.0', phases: ['build'] }] });
    problem(report, 'invalid-setting', ['libraries', 0, 'module']);
    problem(report, 'invalid-setting', ['packages', 0, 'alias']);
    problem(report, 'invalid-setting', ['packages', 0, 'name']);
  });

  it('requires at least one package phase', () => {
    problem(read({ packages: [{ alias: 'vite', name: 'npm:vite', version: '6.0.0', phases: [] }] }),
      'invalid-setting', ['packages', 0, 'phases']);
  });

  it('rejects repeated package phases', () => {
    problem(read({ packages: [{ alias: 'vite', name: 'npm:vite', version: '6.0.0', phases: ['build', 'build'] }] }),
      'invalid-setting', ['packages', 0, 'phases', 1]);
  });

  it('rejects unsupported package phases', () => {
    problem(read({ packages: [{ alias: 'vite', name: 'npm:vite', version: '6.0.0', phases: ['deploy'] }] }),
      'invalid-setting', ['packages', 0, 'phases', 0]);
  });

  it('captures the registered profile IDs and validator methods', () => {
    const profile = { id: 'typescript', validate: () => [] as { path: string[]; message: string }[] };
    const profiles: OutputProfile[] = [profile];
    const reader = new ConfigurationReader(profiles);
    profile.id = 'markdown';
    profile.validate = () => [{ path: [], message: 'replacement must not run' }];
    profiles.length = 0;
    const report = reader.read(manifest({ outputs: [{ id: 'typescript' }] }));
    expect(report.value?.outputs).toEqual([{ id: 'typescript', options: {} }]);
    expect(report.problems).toEqual([]);
  });

  it('preserves the receiver of a class-based option validator', () => {
    class Profile {
      readonly id = 'typescript';
      private readonly directory = 'src';
      validate(options: Readonly<Record<string, unknown>>) {
        return options.directory === this.directory ? [] : [{ path: ['directory'], message: 'Expected src.' }];
      }
    }
    expect(read({ outputs: [{ id: 'typescript', options: { directory: 'src' } }] }, [new Profile()]).value).toBeDefined();
  });

  it('rejects duplicate registered profile IDs as a programming error', () => {
    expect(() => new ConfigurationReader([{ id: 'typescript', validate: () => [] }, { id: 'typescript', validate: () => [] }])).toThrow(TypeError);
  });

  it('rejects blank registered profile IDs as a programming error', () => {
    expect(() => new ConfigurationReader([{ id: ' ', validate: () => [] }])).toThrow(TypeError);
  });

  it('rejects a registered validator that cannot be called', () => {
    expect(() => new ConfigurationReader([{ id: 'typescript', validate: null } as unknown as OutputProfile])).toThrow(TypeError);
  });

  it('lets validator failures reach the caller', () => {
    const failure = new Error('Profile failed');
    expect(() => read({ outputs: [{ id: 'typescript' }] }, [{ id: 'typescript', validate: () => { throw failure; } }])).toThrow(failure);
  });

  it('prefixes nested option findings and copies their paths', () => {
    const path: (string | number)[] = ['files', 1, 'directory'];
    const report = read({ outputs: [{ id: 'typescript', options: { files: [{}, {}] } }] },
      [{ id: 'typescript', validate: () => [{ path, message: 'Choose a directory.' }] }]);
    const finding = problem(report, 'invalid-output-options', ['outputs', 0, 'options', 'files', 1, 'directory']);
    path[0] = 'changed';
    expect(finding.message).toContain('Choose a directory.');
    expect(finding.at).toEqual({ kind: 'dependency', path: ['manifest', 'expec.json', 'outputs', 0, 'options', 'files', 1, 'directory'] });
  });

  it('captures source identity and data independently across reads', () => {
    const reader = new ConfigurationReader([]);
    const source = manifest({ project: { root: '../first' } });
    const first = reader.read(source);
    expect(first.value?.project?.root).toBe('../first');
    source.sourceId = 'other.json';
    source.text = manifest({ project: { root: '../second' } }).text;
    const second = reader.read(source);
    expect(second.value?.sourceId).toBe('other.json');
    expect(second.value?.project?.root).toBe('../second');
    expect(first.value?.sourceId).toBe('expec.json');
    expect(first.value?.project?.root).toBe('../first');
  });
});
