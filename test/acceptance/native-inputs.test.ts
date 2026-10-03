import { describe, it } from 'vitest';
import { NativeInputProject } from '../dsl/native-inputs.js';

describe('planned writes depend on captured native input bytes', () => {
  it('retains both files when a native input changes after a move copy but before source removal', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.writeProjectFile('old/Game.java', 'class Game {}');
    await project.planMove('old/Game.java', 'new/Game.java');
    project.replaceNativeAfterMoveCopy('new/Game.java', 'catalog.jar', 'version-two');
    await project.applyPlan();
    project.expectStopped('stale-project');
    project.expectMoveState('uncertain');
    await project.expectFile('old/Game.java', 'class Game {}');
    await project.expectFile('new/Game.java', 'class Game {}');
    await project.expectNativeFile('catalog.jar', 'version-two');
  });

  it('applies a project edit while its actual native library is unchanged', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrite('src/Game.java', 'class Game {}');
    await project.applyPlan();
    project.expectStatus('applied');
    await project.expectFile('src/Game.java', 'class Game {}');
    await project.expectNativeFile('catalog.jar', 'version-one');
  });

  it('refuses same-length replacement bytes before the first project write', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrite('src/Game.java', 'class Game {}');
    await project.replaceNativeFile('catalog.jar', 'version-two');
    await project.applyPlan();
    project.expectStopped('stale-project');
    project.expectChangeState('src/Game.java', 'not-applied');
    await project.expectFileAbsent('src/Game.java');
    await project.expectNativeFile('catalog.jar', 'version-two');
  });

  it('retains the first actual effect when a native input changes before the second', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrites({ 'first.txt': 'first', 'second.txt': 'second' });
    project.beforeGuard(2, () => project.replaceNativeFile('catalog.jar', 'version-two'));
    await project.applyPlan();
    project.expectStopped('stale-project');
    project.expectChangeState('first.txt', 'applied');
    project.expectChangeState('second.txt', 'not-applied');
    await project.expectFile('first.txt', 'first');
    await project.expectFileAbsent('second.txt');
  });

  it('reports a failed final guard without denying the completed effect', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrite('result.txt', 'written');
    project.beforeGuard(2, () => project.replaceNativeFile('catalog.jar', 'version-two'));
    await project.applyPlan();
    project.expectStopped('stale-project');
    project.expectChangeState('result.txt', 'applied');
    await project.expectFile('result.txt', 'written');
  });

  it('guards a plan even when it contains no file changes', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrites({});
    await project.replaceNativeFile('catalog.jar', 'version-two');
    await project.applyPlan();
    project.expectStopped('stale-project');
    await project.expectNoFileEffects();
  });

  it('does not let a context silently drop required evidence', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrite('result.txt', 'written');
    project.usePlainProjectContext();
    await project.applyPlan();
    project.expectStopped('stale-project');
    await project.expectFileAbsent('result.txt');
  });

  it('stops when the context adds a newly required native input', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrite('result.txt', 'written');
    await project.addNativeFile('runtime.bin', 'runtime');
    await project.applyPlan();
    project.expectStopped('stale-project');
    await project.expectFileAbsent('result.txt');
  });

  it('accepts the same evidence in a different order', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.addNativeFile('runtime.bin', 'runtime');
    await project.planWrite('result.txt', 'written');
    project.reverseNativeEvidenceOrder();
    await project.applyPlan();
    project.expectStatus('applied');
    await project.expectFile('result.txt', 'written');
  });

  it('does not turn a native fingerprint into permission to replace an in-root library', async () => {
    const project = await NativeInputProject.withIncludedLibrary('lib/catalog.jar', 'version-one');
    await project.planWrites({ 'first.txt': 'first', 'lib/catalog.jar': 'replacement' });
    await project.applyPlan();
    project.expectStopped('invalid-change');
    await project.expectFileAbsent('first.txt');
    await project.expectFile('lib/catalog.jar', 'version-one');
  });

  it('refuses malformed supplied evidence before writing', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.planWrite('result.txt', 'written');
    project.replacePlanEvidence([{ uri: 'https://example.test/catalog.jar', version: '1.0.0' }]);
    await project.applyPlan();
    project.expectStopped('invalid-change');
    await project.expectFileAbsent('result.txt');
  });

  it('keeps the ordinary context compatible when evidence is absent or empty', async () => {
    const project = await NativeInputProject.withoutNativeInputs();
    await project.planWrite('result.txt', 'written');
    project.returnEmptyNativeEvidence();
    await project.applyPlan();
    project.expectStatus('applied');
    await project.expectFile('result.txt', 'written');
  });
});

describe('outputs retain native-input guards', () => {
  it('rejects an independent adapter that strips the captured evidence from its plan', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.registerOutputThatDropsNativeEvidence();
    await project.createThroughOutput('function save() returns Nothing');
    project.expectOutputContractError('snapshot');
    await project.expectFileAbsent('contracts.txt');
  });

  it('keeps malformed native evidence out of complete read and search answers', async () => {
    const project = await NativeInputProject.withLibrary('catalog.jar', 'version-one');
    await project.registerCurrentFileOutput();
    project.returnMalformedNativeEvidence();
    await project.readThroughOutput();
    project.expectOutputContractError('native');
    await project.searchThroughOutput();
    project.expectOutputContractError('native');
    await project.expectNoFileEffects();
  });
});
