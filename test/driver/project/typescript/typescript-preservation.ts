import ts from 'typescript';
import { promises as fs } from 'node:fs';
import nativeFs from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { vi } from 'vitest';
import { TypeScriptOutputDriver } from './typescript-output.js';
import { FileProjectWriter, type ArtifactAssociation, type IdentityDecision, type OutputPlan, type Check, type ProjectSnapshot } from '../../../../src/index.js';

export interface Correspondence { rename?: [string, string][]; move?: [string, string][]; keep?: string[]; retire?: string[] }
type Callable = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration;

/** Arranges native implementations while every preservation action uses the real output. */
export class PreservationDriver extends TypeScriptOutputDriver {
  prepared?: Check<OutputPlan>;
  captured?: ProjectSnapshot;
  ambientAttempts: string[] = [];
  executed = 0;
  private restoreAmbient: (() => void)[] = [];
  private executionKey = '__expec_preservation_' + this.directory.replace(/\W/g, '_');
  renameTargets = new Map<string, string>();
  map(name: string, file: string, declaration: { kind: string; name: string; static?: boolean }[]): void {
    const association: ArtifactAssociation = { specId: this.subject(name), locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file, declaration } } };
    const mapped = this.identity.withArtifacts(this.current, [...this.current.baseline.artifacts, association]);
    if (!mapped.value) throw Error(JSON.stringify(mapped)); this.current = mapped.value;
  }
  async implement(name: string, text: string): Promise<void> {
    const node = this.native(name) as Callable;
    if (!node?.body) throw Error('No native body ' + name);
    const file = node.getSourceFile(); await this.file(file.fileName, file.text.slice(0, node.body.getStart()) + text + file.text.slice(node.body.end));
  }
  override native(name: string): ts.Declaration | undefined {
    if (name.endsWith('.constructor')) return (super.native(name.slice(0, -12)) as ts.ClassDeclaration | undefined)?.members.find(ts.isConstructorDeclaration);
    return super.native(name) ?? this.nativeFiles().flatMap(file => file.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])).find(node => node.name.getText() === name);
  }
  revise(text: string, decisions: Correspondence = {}): void {
    const specification = this.compile(text), proposed = this.identity.associate(specification);
    if (!proposed.value) throw Error(JSON.stringify(proposed));
    const pairs: [string, string][] = [...decisions.rename ?? [], ...decisions.move ?? [], ...(decisions.keep ?? []).map(name => [name, name] as [string, string])];
    const changes: IdentityDecision[] = pairs.map(([from, to]) => {
      const id = this.subject(from); this.originalIds.set(from, id); this.renameTargets.set(from, to);
      return { id, to: proposed.value!.node(this.subject(to, proposed.value)) };
    });
    for (const name of decisions.retire ?? []) changes.push({ retire: this.subject(name) });
    this.text = text; this.identify(specification, changes, true);
  }
  addCapability(owner: string, name: string, inputs: string[], result: string): void {
    const item = this.item(owner); if (item.origin.kind !== 'source') throw Error('Expected authored owner');
    const { start, end } = item.origin.range;
    let source = this.text.slice(start.offset, end.offset);
    source = /\bpublic\s+[^\n}]+/.test(source) ? source.replace(/\bpublic\s+[^\n}]+/, clause => clause + ', ' + name)
      : source.replace('{', '{ public ' + name + '\n');
    source = source.slice(0, source.lastIndexOf('}')) + '\ncapability ' + name + '(' + inputs.join(', ') + ') returns ' + result + '\n}';
    this.revise(this.text.slice(0, start.offset) + source + this.text.slice(end.offset));
  }
  rename(from: string, to: string): void {
    const item = this.item(from), oldName = from.split('.').at(-1)!, newName = to.split('.').at(-1)!;
    if (item.origin.kind !== 'source') throw Error('Expected source declaration');
    // Fixture authoring only: these examples deliberately contain no homonymous source names.
    const text = this.text.replace(new RegExp('\\b' + oldName + '\\b', 'g'), newName);
    this.revise(text, { rename: [[from, to]] });
  }
  async addMember(owner: string, text: string): Promise<void> {
    const node = this.native(owner)!; const file = node.getSourceFile();
    const end = ts.isTypeAliasDeclaration(node) ? node.type.end - 1 : node.end - 1;
    await this.file(file.fileName, file.text.slice(0, end) + '\n' + text + '\n' + file.text.slice(end));
  }
  async replaceSignature(name: string, text: string): Promise<void> {
    const node = this.native(name) as Callable, file = node.getSourceFile();
    await this.file(file.fileName, file.text.slice(0, node.getStart()) + text + ' ' + file.text.slice(node.body!.getStart()));
  }
  documentation(name: string): string[] {
    const node = this.native(name)! as ts.Declaration & { jsDoc?: readonly ts.JSDoc[] };
    return (node.jsDoc ?? []).map(comment => comment.getText());
  }
  async document(name: string, text: string, inside = false): Promise<void> {
    const node = this.native(name)! as ts.Declaration & { jsDoc?: readonly ts.JSDoc[] }, file = node.getSourceFile();
    const at = inside ? node.jsDoc?.at(-1)?.end : node.getStart();
    if (at === undefined) throw Error('No generated documentation');
    await this.file(file.fileName, inside ? file.text.slice(0, at - 2) + ' * ' + text + '\n */' + file.text.slice(at)
      : file.text.slice(0, at) + text + '\n' + file.text.slice(at));
  }
  async plan(kind: 'update' | 'delete', name?: string): Promise<void> {
    this.prepared = await this.output.plan(kind === 'update' ? { operation: kind, current: this.current, diff: this.diff } : { operation: kind, id: this.subject(name!) }, this.captured ?? await this.context.readSnapshot());
  }
  async applyPrepared(): Promise<void> {
    if (!this.prepared?.value) throw Error('No applicable plan: ' + JSON.stringify(this.prepared));
    const receipt = await new FileProjectWriter(this.context).apply(this.prepared.value);
    this.written = { receipt, problems: receipt.problems, ...(receipt.status !== 'stopped' ? { artifacts: this.prepared.value.artifacts } : {}) }; await this.capture();
  }
  failWrite(file: string): void {
    const nativeOpen = fs.open.bind(fs), path = join(this.root, file);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (selected, flags, mode) => {
      if (String(selected) === path && ['wx', 'r+'].includes(String(flags))) throw Object.assign(Error('Fixture refuses selected write'), { code: 'EACCES' });
      return nativeOpen(selected, flags, mode);
    }); this.restoreFailure = () => spy.mockRestore();
  }
  async denyAmbientAccess(): Promise<void> {
    (globalThis as Record<string, unknown>)[this.executionKey] = () => { this.executed++; };
    await this.append('src/StoreGame.ts', '\n(globalThis as any)[' + JSON.stringify(this.executionKey) + ']?.();\n');
    this.captured = await this.context.readSnapshot();
    const inside = (path: unknown) => typeof path === 'string' && (resolve(path) === this.root || resolve(path).startsWith(this.root + sep));
    for (const method of ['readFile', 'readdir', 'stat', 'lstat', 'realpath', 'open', 'writeFile', 'appendFile', 'rename', 'unlink', 'mkdir', 'rm'] as const) {
      const original = fs[method].bind(fs) as (...args: unknown[]) => Promise<unknown>;
      const spy = vi.spyOn(fs, method).mockImplementation(((...args: unknown[]) => {
        if (inside(args[0])) { this.ambientAttempts.push(method + ':' + String(args[0])); throw Error('Planning accessed live project'); }
        return original(...args);
      }) as never); this.restoreAmbient.push(() => spy.mockRestore());
    }
    for (const method of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'realpathSync', 'existsSync', 'openSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'mkdirSync', 'rmSync'] as const) {
      const original = nativeFs[method].bind(nativeFs) as (...args: unknown[]) => unknown;
      const spy = vi.spyOn(nativeFs, method).mockImplementation(((...args: unknown[]) => {
        if (inside(args[0])) { this.ambientAttempts.push(method + ':' + String(args[0])); throw Error('Planning accessed live project'); }
        return original(...args);
      }) as never); this.restoreAmbient.push(() => spy.mockRestore());
    }
    for (const method of ['readFile', 'fileExists', 'directoryExists', 'readDirectory', 'getDirectories', 'realpath'] as const) {
      if (!ts.sys[method]) continue;
      const original = ts.sys[method]!.bind(ts.sys) as (...args: unknown[]) => unknown;
      const spy = vi.spyOn(ts.sys, method).mockImplementation(((...args: unknown[]) => {
        if (inside(args[0])) { this.ambientAttempts.push('ts.sys.' + method + ':' + String(args[0])); throw Error('Planning accessed live project'); }
        return original(...args);
      }) as never); this.restoreAmbient.push(() => spy.mockRestore());
    }
  }
  restoreAccess(): void { for (const restore of this.restoreAmbient.reverse()) restore(); this.restoreAmbient = []; }
  async runExpression(expression: string): Promise<void> {
    const imports = this.nativeFiles().flatMap(file => file.statements.flatMap(statement => {
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
      const names = ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(node => node.name.getText())
        : (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) && statement.name ? [statement.name.text] : [];
      return names.filter(name => new RegExp('\\b' + name + '\\b').test(expression)).map(name => 'import { ' + name + ' } from "./' + file.fileName.replace(/\.ts$/, '.js') + '";');
    }));
    await this.run(imports.join('\n') + '\n' + expression + ';');
  }
  override async dispose(): Promise<void> { this.restoreAccess(); delete (globalThis as Record<string, unknown>)[this.executionKey]; await super.dispose(); }
}

// The original user's complete implementation; native aliases and private code remain unowned.
export const originalStoreGame = `type Pair<T> = [T, T];

type SystemConfig = {
  os: "windows";
  gameroot: URL;
  brightness: number;
};

type ShoppingCart = {
  items: unknown[];
};

type PlayerStateSnapshot = {
  characterPosition: Pair<number>;
  shoppingCart: ShoppingCart;
};

class StoreGame {
  private config: SystemConfig | null = null;
  private currentSnapshot: PlayerStateSnapshot | null = null;
  private running = false;

  startup(configurations: SystemConfig): void {
    this.config = configurations;
    this.running = true;

    console.log("Store Game starting...");
    console.log("Game root:", configurations.gameroot.toString());

    document.body.innerHTML = \`
      <main id="store-game">
        <h1>Store Game</h1>
        <button id="new-game">New Game</button>
      </main>
    \`;
  }

  save(snapshot: PlayerStateSnapshot): void {
    this.assertRunning();

    this.currentSnapshot = snapshot;

    localStorage.setItem(
      "store-game-save",
      JSON.stringify(snapshot)
    );
  }

  delete(): void {
    this.assertRunning();

    this.currentSnapshot = null;
    localStorage.removeItem("store-game-save");
  }

  new(): PlayerStateSnapshot {
    this.assertRunning();

    const snapshot: PlayerStateSnapshot = {
      characterPosition: [0, 0],
      shoppingCart: {
        items: [],
      },
    };

    this.currentSnapshot = snapshot;

    return snapshot;
  }

  shutDown(): void {
    this.running = false;
    this.config = null;
    this.currentSnapshot = null;

    document.body.innerHTML = "";
  }

  private assertRunning(): void {
    if (!this.running) {
      throw new Error("Store Game is not running.");
    }
  }
}

export const storeGame = new StoreGame();
`;
