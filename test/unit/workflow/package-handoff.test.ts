import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('hands the tested main archive to release without another build', () => {
  const root = new URL('../../../', import.meta.url);
  const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  const release = readFileSync(new URL('.github/workflows/release.yml', root), 'utf8');
  const installed = ci.split('\n  installed-package:\n')[1]!.split('\n  java:\n')[0]!;
  expect(installed).toContain('EXPEC_TEST_PACKAGE');
  expect(installed).toContain('package-delivery.ts record');
  expect(installed).toContain('package-delivery.ts verify');
  expect(installed.indexOf('name: Upload the tested package')).toBeGreaterThan(installed.indexOf('name: Verify retained release package'));
  expect(installed).toContain('name: tested-package');
  expect(installed).toContain('overwrite: true');
  expect(release).toContain('workflow_run:');
  expect(release).toContain('workflows: [Build and test]');
  expect(release).toContain('types: [completed]');
  expect(release).toContain('deliveryFor(');
  expect(release).toContain('run-id: ${{ github.event.workflow_run.id }}');
  expect(release).toContain('ref: ${{ github.event.workflow_run.head_sha }}');
  expect(release).toContain('package-delivery.ts verify');
  expect(release).not.toMatch(/npm (ci|install|run (build|release)|pack)|uses: \.\/\.github\/workflows\/ci.yml/);
  expect(release).toContain('cmp "$package" "$RUNNER_TEMP/verified-package/$name"');
  expect(release).toContain("statuses.some(status => status.state === 'success')");
});