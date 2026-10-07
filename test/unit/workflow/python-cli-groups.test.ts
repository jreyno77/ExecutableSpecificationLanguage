import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createVitest } from 'vitest/node';

const file = 'test/acceptance/project/python/python-cli-test.test.ts';
const suite = 'the Python CLI executes the actual generated scenarios > ';
const selectedNames = [
  'builds and executes the Dune scenario without running an unrelated failing test',
  'reuses a project after native execution and an ordinary preexisting bytecode cache',
  'reports the real two-copy application failure against the authored one-copy expectation',
  'executes changed application source despite a valid-looking stale bytecode cache',
].map(name => suite + name);
const remainingNames = [
  'permits the real application to save runtime data outside its source roots',
  'retains completed native phases when execution changed an executable input',
  'fails when actual pytest collection removes the current generated case',
  'refuses a current scenario whose confirmed native association is missing',
  'does not overlook an executed root conftest outside the declared source roots',
].map(name => suite + name);

async function pythonCli(group?: string) {
  const previous = process.env.EXPEC_PYTHON_CLI_GROUP;
  if (group === undefined) delete process.env.EXPEC_PYTHON_CLI_GROUP;
  else process.env.EXPEC_PYTHON_CLI_GROUP = group;
  let runner: Awaited<ReturnType<typeof createVitest>> | undefined;
  try {
    runner = await createVitest({ config: 'vitest.python.config.ts', watch: false, reporters: [] });
    const collected = await runner.collect([file], { staticParse: true });
    expect(collected.unhandledErrors).toEqual([]);
    expect(collected.testModules).toHaveLength(1);
    const cases = [...collected.testModules[0]!.children.allTests()];
    return {
      names: cases.filter(test => test.result().state === 'pending').map(test => test.fullName),
      pattern: runner.config.testNamePattern,
    };
  } finally {
    await runner?.close();
    if (previous === undefined) delete process.env.EXPEC_PYTHON_CLI_GROUP;
    else process.env.EXPEC_PYTHON_CLI_GROUP = previous;
  }
}

const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const python = workflow.split('\n  python:\n')[1]!.split('\n  clean-consumer:\n')[0]!;
const step = (name: string) => python.split('\n      - name: ' + name + '\n')[1]?.split('\n      - ')[0] ?? '';
function pythonMatrix() {
  const source = python.split('\n      matrix:\n')[1]!.split('\n    steps:\n')[0]!;
  const axes: Record<string, (string | number)[]> = {}, included: Record<string, string | number>[] = [];
  const value = (text: string): string | number => {
    if (!/^(?:[a-z0-9.-]+|'[a-z0-9.-]+')$/.test(text)) throw Error('Expected a literal Python matrix value: ' + text);
    return /^\d+$/.test(text) ? Number(text) : text.replaceAll("'", '');
  };
  for (const line of source.trimEnd().split('\n')) {
    const axis = /^        (os|shard|group): \[(.+)\]$/.exec(line);
    const row = /^          - os: (.+)$/.exec(line);
    const property = /^            (python|shard|group): (.+)$/.exec(line);
    if (axis) axes[axis[1]!] = axis[2]!.split(', ').map(value);
    else if (row) included.push({ os: value(row[1]!) });
    else if (property && included.length) included[included.length - 1]![property[1]!] = value(property[2]!);
    else if (line !== '        include:') throw Error('Unsupported Python matrix line: ' + line);
  }
  return { axes, included };
}

describe('two complementary Python CLI jobs', () => {
  it('assigns every authored case to exactly one nonempty job of at most five cases', async () => {
    const full = await pythonCli(), selected = await pythonCli('selected'), remaining = await pythonCli('remaining');
    expect(full.names).toEqual([...selectedNames, ...remainingNames]);
    expect(selected.names).toHaveLength(4);
    expect(selected.names).toEqual(selectedNames);
    expect(remaining.names).toEqual(remainingNames);
    expect([...selected.names, ...remaining.names].sort()).toEqual([...full.names].sort());
    expect(new Set([...selected.names, ...remaining.names]).size).toBe(9);
    for (const group of [selected, remaining]) {
      expect(group.names.length).toBeGreaterThan(0);
      expect(group.names.length).toBeLessThanOrEqual(5);
    }
  });

  it('keeps an ordinary manual Python run unfiltered', async () => {
    const full = await pythonCli();
    expect(full.pattern).toBeUndefined();
    expect(full.names).toEqual([...selectedNames, ...remainingNames]);
  });

  it('routes future full names and multiline names to exactly one complementary group', async () => {
    const selected = (await pythonCli('selected')).pattern!, remaining = (await pythonCli('remaining')).pattern!;
    for (const name of ['future suite reuses a project with another fixture', 'future suite\nexecutes changed application source']) {
      expect(selected.test(name)).toBe(true); expect(remaining.test(name)).toBe(false);
    }
    for (const name of ['future suite describes a new behavior', 'future suite keeps a new\nconsumer requirement']) {
      expect(selected.test(name)).toBe(false); expect(remaining.test(name)).toBe(true);
    }
  });

  it('rejects unknown and empty grouping values', async () => {
    await expect(pythonCli('typo')).rejects.toThrow('EXPEC_PYTHON_CLI_GROUP');
    await expect(pythonCli('')).rejects.toThrow('EXPEC_PYTHON_CLI_GROUP');
  });

  it('keeps five ordinary shards and adds only one complementary CLI job on each OS', () => {
    const { axes, included } = pythonMatrix();
    expect(axes).toEqual({ os: ['ubuntu-latest', 'windows-latest'], shard: [1, 2, 3, 4, 5, 'cli'], group: ['remaining'] });
    expect(included).toEqual([
      { os: 'ubuntu-latest', python: '3.12.14' }, { os: 'windows-latest', python: '3.12.10' },
      { os: 'ubuntu-latest', shard: 'cli', group: 'selected', python: '3.12.14' },
      { os: 'windows-latest', shard: 'cli', group: 'selected', python: '3.12.10' },
    ]);
    for (const os of axes.os!) {
      const ordinary = axes.shard!.filter(shard => shard !== 'cli');
      const cliGroups = [...axes.group!, ...included.filter(row => row.os === os && row.shard === 'cli').map(row => row.group)];
      expect(ordinary).toEqual([1, 2, 3, 4, 5]); expect(cliGroups).toEqual(['remaining', 'selected']);
      expect(ordinary.length + cliGroups.length).toBe(7);
    }
  });

  it('filters only CLI steps and retains separate required reports for their groups', () => {
    const cli = step('Run the Python CLI acceptance tests'), ordinary = step('Run the ordinary Python unit and acceptance tests');
    expect(cli).toContain("if: matrix.shard == 'cli'");
    expect(cli).toContain('EXPEC_PYTHON_CLI_GROUP: ${{ matrix.group }}');
    expect(workflow.match(/EXPEC_PYTHON_CLI_GROUP:/g)).toHaveLength(1);
    expect(ordinary).not.toContain('EXPEC_PYTHON_CLI_GROUP');
    expect(ordinary).toContain('--exclude=' + file);
    expect(ordinary).toContain('--shard=${{ matrix.shard }}/5');
    const suffix = "${{ matrix.shard == 'cli' && format('-{0}', matrix.group) || '' }}";
    expect(python).toContain('name: Python 3.12 / ${{ matrix.os }} / ${{ matrix.shard }}' + suffix + '\n');
    const report = python.split('\n      - ').find(part => part.includes('path: .local-docs/test-results.json'))!;
    expect(report).toContain('name: python-${{ matrix.os }}-${{ matrix.shard }}' + suffix + '\n');
    expect(report).toContain('if: always()'); expect(report).toContain('if-no-files-found: error');
    expect(python).toContain('timeout-minutes: 90');
    expect(python).toContain("if: needs.scope.outputs.python == 'true'");
  });
});
