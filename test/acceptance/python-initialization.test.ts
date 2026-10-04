import { describe, it } from 'vitest';
import { InitializationExamples } from '../dsl/project-initialization.js';

describe('a Python project starts at the chosen destination', () => {
  it('retains a configured three-part release as the actual native project version', async () => {
    const project = await InitializationExamples.withManifest({ formatVersion: 1, version: '2.3.4', build: { entries: ['store.expec'] } });
    await project.preparePython('../store'); await project.apply(true);
    project.expectStatus('applied'); await project.expectPythonProjectVersion('2.3.4');
  });
  it('refuses an unspecified native mapping for a prerelease version', async () => {
    const project = await InitializationExamples.withManifest({ formatVersion: 1, version: '2.3.4-preview.1', build: { entries: ['store.expec'] } });
    await project.preparePython('../store');
    project.expectProblem('unsupported-native-version'); project.expectNoPlan(); await project.expectDestinationAbsent();
  });
  it('keeps an installed environment and caches outside the returned editable capture', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.preparePython('../store'); await project.apply(true);
    await project.writeImplementation('.venv/library.py', 'pass\n');
    await project.writeImplementation('.pytest_cache/notes', 'native cache\n');
    await project.expectReturnedCaptureExcludes(['.venv/library.py', '.pytest_cache/notes']);
  });
  it('previews ordinary Python files and leaves a declined project absent', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.preparePython('../store');
    project.expectPlannedRoot('../store');
    project.expectPlannedPaths(['pyproject.toml', 'expec.python.json', 'src/__init__.py', 'test/__init__.py', '.gitignore']);
    await project.expectDestinationAbsent(); await project.apply(false);
    project.expectStatus('declined'); await project.expectDestinationAbsent(); await project.expectManifestUnchanged();
  });
  it('creates the Python starter without installing an environment or a second manifest', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.preparePython('../store'); await project.apply(true);
    project.expectStatus('applied'); project.expectConnectedRoot('../store'); project.expectReturnedProjectRoot('../store');
    await project.expectExactStarterFiles(['pyproject.toml', 'expec.python.json', 'src/__init__.py', 'test/__init__.py', '.gitignore']);
    await project.expectJsonProperty('expec.python.json', ['sourceRoots'], { main: ['src'], test: ['test'] });
    await project.expectJsonProperty('expec.python.json', ['environment'], '.venv');
    await project.expectAbsentFiles(['.venv', 'uv.lock', 'expec.json']); await project.expectManifestUnchanged();
    project.expectReturnedOutputs([{ id: 'python', options: { module: 'store.contracts' } }, { id: 'python-acceptance', options: { domain: 'shopping' } }]);
  });
  it('reports an unavailable explicit interpreter before creating the project', async () => {
    const project = await InitializationExamples.withUnconnectedManifest();
    await project.preparePythonWithoutInterpreter('../store');
    project.expectProblem('native-toolchain-unavailable'); project.expectNoPlan(); await project.expectDestinationAbsent();
  });
});
