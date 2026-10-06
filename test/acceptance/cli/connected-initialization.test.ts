import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('choosing a connected project', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('returns an actionable noninteractive choice without creating a destination', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(3);
    project.expectStatus('action-required');
    project.expectMessageContains('expec init');
    await project.expectAllBytesUnchanged();
  }, 40_000);

  it('keeps explicit initialization actionable when declared packages need the missing connection', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.requirePackage('typescript', 'npm:typescript', '5.9.3', ['build']);
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(3);
    project.expectStatus('action-required');
    project.expectProblem('project-required');
    project.expectMessageContains('expec init');
    await project.expectAllBytesUnchanged();
    await project.run(['init', '--config', 'spec/expec.json', '--root', '../store-game', '--target', 'typescript', '--yes', '--json']);
    project.expectExit(0);
    await project.expectDeclaredPackage('typescript', 'npm:typescript', '5.9.3', ['build']);
    await project.expectNoDestinationFile('store-game/node_modules');
  }, 40_000);

  it('declines an interactive destination without writing the manifest or project', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.rememberAllBytes();
    await project.runInteractive(['build', '--config', 'spec/expec.json'], ['no']);
    project.expectExit(3);
    project.expectStatus('declined');
    await project.expectAllBytesUnchanged();
  }, 40_000);

  it('persists only the accepted connection without requiring source to compile', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.outputs([{ id: 'markdown', options: { directory: 'docs' } }]);
    await project.rememberManifestOutsideConnection();
    await project.run(['init', '--config', 'spec/expec.json', '--root', '../store-game', '--target', 'typescript', '--yes', '--json']);
    project.expectExit(0);
    project.expectStage('initialization', 'applied');
    project.expectStage('configuration', 'applied');
    project.expectByteReceipts();
    await project.expectManifestValue(['project', 'root'], '../store-game');
    await project.expectSelectedOutputs(['markdown', 'typescript']);
    await project.expectDeclaredPackage('typescript', 'npm:typescript', '5.9.3', ['build']);
    await project.expectRememberedManifestRegionsUnchanged();
    await project.expectDestinationText('store-game/src/index.ts', 'export {};\n');
    await project.expectNoDestinationFile('store-game/node_modules');
  }, 40_000);

  it('keeps accepted initialization explicit when the continued build needs its compiler installed', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.runInteractive(['build', '--config', 'spec/expec.json'], ['yes', '../store-game', 'typescript', 'yes']);
    project.expectExit(1);
    project.expectStage('initialization', 'applied');
    project.expectStage('configuration', 'applied');
    project.expectStage('contracts', 'not-run');
    project.expectMessageContains('expec install');
    await project.expectDestinationText('store-game/src/index.ts', 'export {};\n');
    await project.expectManifestValue(['project', 'root'], '../store-game');
    await project.expectNoDestinationFile('store-game/node_modules');
  }, 40_000);

  it('preserves created files and reports an unsaved connection if the manifest changes', async () => {
    project = await ConnectedBuild.create({ connected: false });
    project.afterInitializationBeforeManifestWrite({ version: '0.9.0' });
    await project.run(['init', '--config', 'spec/expec.json', '--root', '../store-game', '--target', 'typescript', '--yes', '--json']);
    project.expectExit(1);
    project.expectProblem('configuration-unsaved');
    project.expectStage('initialization', 'applied');
    await project.expectDestinationText('store-game/src/index.ts', 'export {};\n');
    await project.expectManifestValue(['version'], '0.9.0');
    await project.expectNoManifestProperty(['project']);
  }, 40_000);

  it('refuses a nonempty selected directory even when consent is explicit', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.destinationFile('store-game/notes.txt', 'keep my project');
    await project.run(['init', '--config', 'spec/expec.json', '--root', '../store-game', '--target', 'typescript', '--yes', '--json']);
    project.expectExit(1);
    project.expectProblem('initialization-root-not-empty');
    await project.expectDestinationText('store-game/notes.txt', 'keep my project');
    await project.expectNoDestinationFile('store-game/package.json');
  }, 40_000);

  it('requires explicit consent for a noninteractive initializer', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.rememberAllBytes();
    await project.run(['init', '--config', 'spec/expec.json', '--root', '../store-game', '--target', 'typescript', '--json']);
    project.expectExit(3);
    project.expectMessageContains('--yes');
    await project.expectAllBytesUnchanged();
  }, 40_000);

  it('requires explicit installation without disguising missing packages as compilation success', async () => {
    project = await ConnectedBuild.create();
    await project.file('package.json', '{ "name": "store-game", "private": true, "version": "1.0.0", "type": "module" }\n');
    await project.requirePackage('storage', 'npm:example-storage', '^1.0.0', ['runtime']);
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.rememberAllBytes();
    await project.run(['check', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    await project.expectNoDestinationFile('project/node_modules');
    await project.expectAllBytesUnchanged();

    await project.serveRealPackage('example-storage', '1.2.0');
    await project.run(['install', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStatus('installed');
    await project.expectActualInstalledVersion('example-storage', '1.2.0');
    await project.run(['check', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStatus('checked');
  }, 100_000);

  it('keeps an empty install independent of missing source and does not install a guessed compiler', async () => {
    project = await ConnectedBuild.create();
    await project.file('notes.txt', 'no native manifest or source yet');
    await project.rememberAllBytes();
    await project.run(['install', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStatus('nothing-to-install');
    project.expectStage('installation', 'not-run');
    await project.expectAllBytesUnchanged();
  }, 40_000);
  it('reconnects after explicit initialization and builds after actual compiler installation', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'markdown', options: { directory: 'docs' } }]);
    await project.run(['init', '--config', 'spec/expec.json', '--root', '../store-game', '--target', 'typescript', '--yes', '--json']);
    project.expectExit(0);
    await project.expectSelectedOutputs(['markdown', 'typescript']);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('unavailable-package');
    await project.expectNoDestinationFile('store-game/src/StoreGame.ts');
    await project.servePinnedCompiler('store-game');
    await project.run(['install', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectNativeClassIn('store-game', 'StoreGame');
    await project.expectNativeBuild('store-game');
  }, 100_000);

});
