import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const entry = join(root, '.github/ci/select-tests.ts');

describe('workflow selection boundary', () => {
  it('emits both owners for a real Git rename', () => {
    const repository = mkdtempSync(join(tmpdir(), 'expec-ci-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      mkdirSync(join(repository, 'src/language'), { recursive: true });
      mkdirSync(join(repository, 'src/model'), { recursive: true });
      writeFileSync(join(repository, 'src/language/example.ts'), 'export const example = true;');
      git('init', '-q');
      git('add', '.');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Before');
      const base = git('rev-parse', 'HEAD');
      renameSync(join(repository, 'src/language/example.ts'), join(repository, 'src/model/example.ts'));
      git('add', '-A');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'After');
      const output = join(repository, 'selection');
      execFileSync(process.execPath, [entry], { cwd: repository, env: { ...process.env,
        GITHUB_EVENT_NAME: 'pull_request', CHECK_REF: '', BASE_SHA: base, HEAD_SHA: git('rev-parse', 'HEAD'), GITHUB_OUTPUT: output } });
      const values = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {
        const [name, value] = line.split('='); return [name, JSON.parse(value!)];
      }));
      expect(values).toEqual({ core: ['test/unit/language', 'test/acceptance/language',
        'test/unit/model', 'test/acceptance/model'], java: false, kotlin: false, python: false, package: false,
        pilot: false, workflow: false, consumers: [], prepareConsumer: false, shards: [1], total: 1 });
    } finally { rmSync(repository, { recursive: true, force: true }); }
  });

  it('fails when a PR diff has no commit evidence', () => {
    const result = spawnSync(process.execPath, [entry], { cwd: root, encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', CHECK_REF: '', BASE_SHA: '', HEAD_SHA: '', GITHUB_OUTPUT: 'unused' } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('requires BASE_SHA and HEAD_SHA');
  });

  it('connects selected checks to job gates, test folders and shard counts', () => {
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    const job = (name: string) => workflow.split('\n  ' + name + ':\n')[1]?.split(/\n  [\w-]+:\n/)[0] ?? '';
    expect(job('scope')).toContain('run: node .github/ci/select-tests.ts');
    expect(job('scope')).toContain("CHECK_REF: ${{ inputs.ref }}");
    expect(job('scope')).toContain('fetch-depth: 0');
    expect(job('scope')).toContain('BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(job('scope')).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    for (const output of ['core', 'java', 'kotlin', 'python', 'package', 'pilot', 'workflow', 'consumers', 'prepareConsumer', 'shards', 'total'])
      expect(job('scope')).toContain(output + ': ${{ steps.select.outputs.' + output + ' }}');
    expect(job('check')).toContain("if: needs.scope.outputs.core != '[]'");
    expect(job('check')).toContain("join(fromJSON(needs.scope.outputs.core), ' ')");
    expect(job('check')).toContain('shard: ${{ fromJSON(needs.scope.outputs.shards) }}');
    expect(job('check')).toContain('--shard=${{ matrix.shard }}/${{ needs.scope.outputs.total }}');
    expect(job('check')).toContain('of ${{ needs.scope.outputs.total }}');
    for (const [name, output] of [['java', 'java'], ['kotlin', 'kotlin'], ['python', 'python'], ['installed-package', 'package'], ['project-pilot', 'pilot'], ['workflow', 'workflow']]) {
      expect(job(name!)).toContain('needs: scope');
      expect(job(name!)).toContain("if: needs.scope.outputs." + output + " == 'true'");
    }
    expect(readFileSync(join(root, 'vitest.core.config.ts'), 'utf8')).toContain('test/unit/project/kotlin/**');
    expect(readFileSync(join(root, 'vitest.core.config.ts'), 'utf8')).toContain('test/acceptance/project/kotlin/**');
    expect(readFileSync(join(root, 'vitest.kotlin.config.ts'), 'utf8')).toContain('test/unit/project/kotlin/kotlin-*.test.ts');
    expect(readFileSync(join(root, 'vitest.kotlin.config.ts'), 'utf8')).toContain('test/acceptance/project/kotlin/kotlin-*.test.ts');
    expect(readFileSync(join(root, 'vitest.kotlin-package.config.ts'), 'utf8')).toContain('test/acceptance/project/kotlin/installed-kotlin-package.test.ts');
    expect(readFileSync(join(root, 'vitest.core.config.ts'), 'utf8')).toContain('test/unit/project/python/**');
    expect(readFileSync(join(root, 'vitest.core.config.ts'), 'utf8')).toContain('test/acceptance/project/python/**');
    expect(readFileSync(join(root, 'vitest.python.config.ts'), 'utf8')).toContain('test/{unit,acceptance}/project/python/**/*.test.ts');
    expect(job('python')).toContain('EXPEC_TEST_PACKAGE=');
    expect(job('python')).toContain('npm run release -- --ignore-scripts --pack-destination');
    expect(job('python').match(/npm run build/g)).toHaveLength(1);
    const pythonStep = (name: string) => job('python')
      .split('\n      - name: ' + name + '\n')[1]?.split('\n      - ')[0] ?? '';
    expect(job('python')).toContain('shard: [1, 2, 3, 4, 5, cli]');
    const ordinary = pythonStep('Run the ordinary Python unit and acceptance tests');
    expect(ordinary).toContain("if: matrix.shard != 'cli'");
    expect(ordinary).toContain('--exclude=test/acceptance/project/python/python-cli-test.test.ts');
    expect(ordinary).toContain('--shard=${{ matrix.shard }}/5');
    expect(ordinary).toContain("EXPEC_CLEANUP_TIMINGS: '1'");
    expect(ordinary).toContain('--reporter=default --reporter=json --outputFile=.local-docs/test-results.json');
    const cli = pythonStep('Run the Python CLI acceptance tests');
    expect(cli).toContain("if: matrix.shard == 'cli'");
    expect(cli).toContain('npm test -- --config vitest.python.config.ts test/acceptance/project/python/python-cli-test.test.ts');
    expect(cli).toContain('--reporter=verbose --reporter=json --outputFile=.local-docs/test-results.json');
    expect(cli).not.toMatch(/--shard|--exclude/);
    expect(readFileSync(join(root, 'vitest.python.config.ts'), 'utf8')).toContain('maxWorkers: 1');
    expect(job('python')).toContain('timeout-minutes: 90');
    expect(job('workflow')).toContain('--config vitest.ci.config.ts');
    expect(job('workflow')).not.toMatch(/setup-java|npm run build|grammar:generate|java:build/);
    expect(readFileSync(join(root, 'vitest.ci.config.ts'), 'utf8')).not.toContain('globalSetup');
    expect(readFileSync(join(root, 'vitest.ci.config.ts'), 'utf8')).toContain('test/acceptance/workflow/**/*.test.ts');
    expect(readFileSync(join(root, 'vitest.core.config.ts'), 'utf8')).toContain('test/acceptance/workflow/**');
    expect(workflow).toMatch(/ref:\s+type: string\s+required: true/);
    expect(readFileSync(join(root, 'vitest.core.config.ts'), 'utf8')).toContain('test/unit/workflow/**');
  });
});