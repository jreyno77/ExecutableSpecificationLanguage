import { readFile, readdir, rm } from 'node:fs/promises';
import { relative } from 'node:path';
import ts from 'typescript';
import type { ArtifactAssociation, OutputWrite, ProjectSearch } from '../../../src/index.js';
import { InstalledPilotDriver } from './installed-pilot.js';

export interface StoreGameObservation {
  written?: OutputWrite;
  read?: { artifacts: { file: { path: string; text: string } }[]; coverage: { complete: boolean }; problems: unknown[] };
  search?: ProjectSearch;
  files: Record<string, string>;
  classes: { file: string; name: string; methods: { name: string; body?: string; start: number; end: number; private: boolean }[] }[];
  imports: { file: string; imported: string; local: string; from: string }[];
  declared: { name: string; origin: { module: string }; dependencies: string[] }[];
  ids: Record<string, string>; artifacts: ArtifactAssociation[]; baseline: string; packageUrl: string;
}
type Decision = { id: string; to: string } | { retire: string };

/** The maintainer's authored source and installed public recipe; no private product imports. */
export class StoreGamePilotDriver extends InstalledPilotDriver {
  observed!: StoreGameObservation;
  module = 'store.expec';
  saveName = 'save';
  includeSave = true;
  archive = false;
  dependency = '';
  promise = '';
  decisions: Decision[] = [];
  layout: 'original' | 'distributed' | 'generated' = 'original';
  native = { code: -1, stdout: '', stderr: '' };
  verification: { code: number; stdout: string; stderr: string; report: { success: boolean; testResults: { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] } } | undefined;
  private resource(name: string): Promise<string> { return readFile(new URL('../../resources/pilot/store-game-' + name, import.meta.url), 'utf8'); }
  async prepare(layout: 'original' | 'distributed' | 'generated'): Promise<void> {
    this.layout = layout; await this.install();
    await this.file('store-game-recipe.mjs', await this.resource('recipe.mjs'));
    await this.file('store-game-host.json', JSON.stringify({ layout }));
    await this.file('models.expec', 'opaque type SystemConfig\nopaque type PlayerStateSnapshot\n');
    if (layout === 'generated') {
      await this.file('main.expec', 'class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing\n}');
      await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] }, outputs: [{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }] }));
      await this.cli(['init', '--root', './project', '--target', 'typescript', '--yes']); this.requireCli();
      const config = JSON.parse(await this.text('project/tsconfig.json'));
      config.include = ['**/*.ts'];
      config.compilerOptions.rootDir = '.';
      await this.file('project/tsconfig.json', JSON.stringify(config));
      await this.cli(['install']); this.requireCli();
      await this.cli(['build']); this.requireCli(); await this.recipe('inspect'); return;
    }
    await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', project: { root: './project' }, build: { entries: ['main.expec'] }, outputs: [],
      packages: [{ alias: 'tests', name: 'npm:vitest', version: '5.0.2', phases: ['test'] }, { alias: 'node', name: 'npm:@types/node', version: '24.13.6', phases: ['test'] }] }));
    await this.file('project/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      lib: ['ES2022', 'DOM'], types: [], skipLibCheck: true }, include: ['**/*.ts'] }));
    await this.file('project/package.json', JSON.stringify({ private: true, type: 'module' }));
    await this.file('project/src/game.ts', await this.resource(layout === 'original' ? 'original.ts.txt' : 'distributed.ts.txt'));
    if (layout === 'distributed') {
      await this.file('project/src/models.ts', await this.resource('models.ts.txt'));
      await this.file('project/launcher.ts', await this.resource('launcher.ts.txt'));
    }
    await this.author();
  }
  async author(): Promise<void> {
    const models = this.module.includes('/') ? '../models.expec' : './models.expec';
    const names = ['startup', ...(this.includeSave ? [this.saveName] : []), 'delete', 'new', 'shutDown', ...(this.archive ? ['archive'] : [])];
    await this.file('main.expec', 'include "./' + this.module + '"\n');
    await this.file(this.module, `use SystemConfig from "${models}"
use PlayerStateSnapshot from "${models}"
${this.dependency ? `use ${this.dependency} from "${models}"` : ''}
class StoreGame {
  ${this.dependency ? 'depends on ' + this.dependency : ''}
  public ${names.join(', ')}
  capability startup(configurations: SystemConfig) returns Nothing
  ${this.includeSave ? `capability ${this.saveName}(snapshot: PlayerStateSnapshot) returns Nothing${this.promise ? ' { promises ' + JSON.stringify(this.promise) + ' }' : ''}` : ''}
  capability delete() returns Nothing
  capability new() returns PlayerStateSnapshot
  capability shutDown() returns Nothing
  ${this.archive ? 'capability archive() returns Nothing' : ''}
}`);
  }
  async recipe(command: string, subject?: string): Promise<void> {
    await this.file('store-game-request.json', JSON.stringify({ command, subject, decisions: this.decisions }));
    await this.run(['store-game-recipe.mjs']);
    if (this.result.code) throw Error('Installed StoreGame recipe failed: ' + this.result.stdout + this.result.stderr);
    this.observed = JSON.parse(await this.text('store-game-report.json'));
    if (this.observed.written?.receipt && this.observed.written.receipt.status !== 'stopped') this.decisions = [];
  }
  async moveSource(module: string, id: string): Promise<void> {
    const previous = this.module; this.module = module; this.decisions.push({ id, to: 'StoreGame' }); await this.author();
    // Explicit authored source relocation; the destination is inside this owned consumer.
    await rm(this.path(previous));
  }
  async verifyPersistence(text: string): Promise<void> {
    await this.cli(['install']); this.requireCli();
    const config = JSON.parse(await this.text('project/tsconfig.json'));
    config.compilerOptions.types = ['node'];
    await this.file('project/tsconfig.json', JSON.stringify(config));
    await this.file('main.expec', await this.text('main.expec') + '\nexamples for StoreGame { example "Supabase persistence": true => satisfies ' + JSON.stringify(text) + ' }\n');
    await this.file('project/vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig({test:{include:["test/acceptance/*.test.ts"],retry:0}});');
    await this.recipe('verification');
  }
  async runVerification(): Promise<void> {
    await this.run([this.path('project/node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', '--outputFile=verification.json'], 'project');
    this.verification = { ...this.result, report: JSON.parse(await this.text('project/verification.json')) };
  }
  async checkTypes(): Promise<void> {
    await this.run([this.path('node_modules/typescript/bin/tsc'), '--noEmit', '-p', this.path('project/tsconfig.json')]); this.native = this.result;
  }
  async editMethod(subject: string, edit: (body: string) => string): Promise<void> {
    const [owner, name] = subject.split('.'), found = this.observed.classes.find(item => item.name === owner)!;
    const path = 'project/' + found.file, text = await this.text(path), source = ts.createSourceFile(found.file, text, ts.ScriptTarget.Latest, true);
    const declaration = source.statements.filter(ts.isClassDeclaration).find(item => item.name?.text === owner)!;
    const method = declaration.members.filter(ts.isMethodDeclaration).find(item => item.name.getText(source) === name)!;
    if (!method?.body) throw Error('Missing actual native method ' + subject);
    await this.file(path, text.slice(0, method.body.getStart(source)) + edit(method.body.getText(source)) + text.slice(method.body.end));
  }
  async addPrivateHelper(name: string): Promise<void> {
    const path = 'project/src/StoreGame.ts', text = await this.text(path), source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(ts.isClassDeclaration)!;
    await this.file(path, text.slice(0, declaration.end - 1) + `  private ${name}(): void { if (false) throw new Error("not running"); }\n` + text.slice(declaration.end - 1));
  }
  async renameGeneratedRoot(name: string): Promise<void> {
    const id = this.observed.ids.StoreGame!;
    await this.file('main.expec', (await this.text('main.expec')).replace('class StoreGame', 'class ' + name));
    await this.file('changes.json', JSON.stringify({ format: 1, matches: [{ id, to: { source: 'main.expec', line: 1, column: 1 } }], retire: [] }));
  }
  async buildGenerated(): Promise<void> { await this.cli(['build', '--decisions', this.path('changes.json')]); this.requireCli(); await this.recipe('inspect'); }
  private requireCli(): void { if (this.result.code) throw Error(this.result.stdout + this.result.stderr); }
  async projectBytes(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const visit = async (path: string): Promise<void> => {
      for (const entry of await readdir(this.path(path), { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const child = path + '/' + entry.name;
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile()) result[relative(this.path('project'), this.path(child)).replaceAll('\\', '/')] = (await readFile(this.path(child))).toString('base64');
      }
    };
    await visit('project');
    if (this.layout !== 'generated') result['<host-baseline>'] = await this.text('store-game.identity.json');
    return result;
  }
}
