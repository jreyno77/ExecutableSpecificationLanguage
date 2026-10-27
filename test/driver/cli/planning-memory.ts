import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DOMParser } from '@xmldom/xmldom';
import ts from 'typescript';
import { onTestFinished, vi } from 'vitest';
import { build } from '../../../src/cli/cli-build.js';
import { checkManifest, type CheckedManifest } from '../../../src/cli/cli-check.js';
import { BuildJournal } from '../../../src/cli/cli-journal.js';
import { ProjectConnector, type ProjectContext, type ProjectSnapshot } from '../../../src/project/connection/project-connection.js';
import { Outputs, ProjectOutput, type OutputPlan } from '../../../src/project/output/output.js';
import { typescriptOutput } from '../../../src/project/typescript/output-typescript.js';
import { umlOutput } from '../../../src/project/output/uml-output.js';

type BuildResult = Awaited<ReturnType<typeof build>>;
export class PlanningMemory {
  private readonly outputs = new Outputs();
  private readonly plans: OutputPlan[] = [];
  private readonly journal: Parameters<BuildJournal['apply']>[] = [];
  private readonly restore: (() => void)[] = [];
  private checked!: CheckedManifest;
  private project!: ProjectContext;
  private building?: Promise<BuildResult>;
  result!: BuildResult;
  private constructor(private readonly directory: string, private readonly parent: string) {}
  static async create(source: string): Promise<PlanningMemory> {
    const parent = await fs.realpath(tmpdir()), directory = await fs.realpath(await fs.mkdtemp(join(parent, 'expec-planning-memory-')));
    const fixture = new PlanningMemory(directory, parent);
    onTestFinished(() => fixture.dispose());
    await fixture.file('spec/main.expec', source);
    await fixture.file('project/package.json', '{"name":"planning-memory","private":true,"type":"module"}');
    await fixture.file('project/src/existing.ts', 'export {};\n');
    await fixture.file('project/tsconfig.json', JSON.stringify({ compilerOptions: {
      target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [],
    }, include: ['src/**/*.ts'] }));
    fixture.outputs.register(typescriptOutput); fixture.outputs.register(umlOutput);
    await fixture.file('spec/expec.json', JSON.stringify({ formatVersion: 1, version: '1.0.0',
      project: { root: '../project' }, build: { entries: ['main.expec'] }, outputs: [
        { id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } },
        { id: 'uml', options: { directory: 'diagrams' } },
      ] }));
    fixture.checked = await checkManifest(join(directory, 'spec/expec.json'), fixture.outputs.profiles);
    if (!fixture.checked.specification || fixture.checked.problems.length || fixture.checked.syntax.length || fixture.checked.deferred.length)
      throw Error('Planning fixture did not compile: ' + JSON.stringify({ problems: fixture.checked.problems, syntax: fixture.checked.syntax, deferred: fixture.checked.deferred }));
    const connection = await new ProjectConnector(fixture.checked.manifest).connect(fixture.checked.configuration!);
    if (connection.value?.status !== 'connected' || connection.problems.length) throw Error('Planning fixture did not connect.');
    fixture.project = connection.value.context;
    return fixture;
  }
  private async file(path: string, text: string): Promise<void> {
    const target = join(this.directory, path); await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, text);
  }
  async generate(): Promise<void> {
    const owner = this, plan = ProjectOutput.prototype.plan, apply = BuildJournal.prototype.apply;
    const planned = vi.spyOn(ProjectOutput.prototype, 'plan').mockImplementation(async function (this: ProjectOutput, request, basedOn) {
      const result = await plan.call(this, request, basedOn);
      if (result.value) owner.plans.push(result.value);
      return result;
    });
    const applied = vi.spyOn(BuildJournal.prototype, 'apply').mockImplementation(function (this: BuildJournal, ...args) {
      owner.journal.push(args); return apply.apply(this, args);
    });
    this.restore.push(() => planned.mockRestore(), () => applied.mockRestore());
    this.building = build(this.checked, this.project, this.outputs, new Set(), new AbortController().signal);
    this.result = await this.building;
  }
  async typeField(name: string, field: string): Promise<string | undefined> {
    const path = 'src/' + name + '.ts', text = await fs.readFile(join(this.directory, 'project', path), 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === name);
    if (!declaration || !ts.isTypeLiteralNode(declaration.type)) return;
    const member = declaration.type.members.find(node => ts.isPropertySignature(node) && node.name.getText(source) === field);
    return member && ts.isPropertySignature(member) ? member.type?.getText(source) : undefined;
  }
  async diagramLabels(): Promise<readonly string[]> {
    const text = await fs.readFile(join(this.directory, 'project/diagrams/structure.svg'), 'utf8');
    const document = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (document.documentElement?.localName !== 'svg') throw Error('The generated diagram is not SVG.');
    return [...Array.from(document.getElementsByTagName('text')), ...Array.from(document.getElementsByTagName('tspan'))]
      .flatMap(node => (node.textContent ?? '').split(/\r?\n/).map(text => text.trim())).filter(Boolean);
  }
  private basis(output: string): ProjectSnapshot {
    const plan = this.plans.find(plan => plan.outputId === output);
    if (!plan) throw Error('No successful public plan for ' + output);
    return plan.basedOn;
  }
  changePublicFile(output: string, path: string, text: string): void {
    const file = this.basis(output).files.find(file => file.path === path);
    if (!file || Buffer.byteLength(text) !== file.bytes.byteLength) throw Error('Provide a same-length replacement for a captured file.');
    file.bytes.set(Buffer.from(text));
  }
  publicFile(output: string, path: string): string | undefined {
    const file = this.basis(output).files.find(file => file.path === path);
    return file && new TextDecoder().decode(file.bytes);
  }
  stageFile(path: string): string | undefined {
    const file = this.journal[0]?.[1].files.find(file => file.path === path);
    return file && new TextDecoder().decode(file.bytes);
  }
  privateBasisProperties(): boolean[] { return this.journal.flatMap(([, , plans]) => plans.map(plan => Object.hasOwn(plan, 'basedOn'))); }
  stageBasisFindings() { return this.journal.map(([, basis]) => ({ complete: basis.complete, problems: basis.problems })); }
  private async dispose(): Promise<void> {
    if (this.building) await Promise.allSettled([this.building]);
    for (const restore of this.restore.reverse()) restore();
    if (dirname(this.directory) !== this.parent || !this.directory.split(/[\\/]/).at(-1)?.startsWith('expec-planning-memory-')
      || await fs.realpath(this.directory) !== this.directory) throw Error('Refuse unowned planning fixture cleanup.');
    await fs.rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
