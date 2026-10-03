import { it } from 'vitest';
import { DependencyExamples } from '../dsl/library-loading.js';

it('passes available packages into the real compiler without inventing undeclared aliases', async () => {
  const project = await DependencyExamples.withInstalledStorage('2.1.0');
  project.requirePackage('storage', 'npm:example-storage', '^2', ['runtime']);
  await project.source('main.expec', 'concept Store { requires package "storage" for runtime }');
  await project.loadAndCompile();
  project.expectChecked();
  await project.source('main.expec', 'concept Store { requires package "unknown" for runtime }');
  await project.loadAndCompile();
  project.expectUnavailablePackageAlias('unknown');
  project.expectNoNativeInstall();
}, 30000);
