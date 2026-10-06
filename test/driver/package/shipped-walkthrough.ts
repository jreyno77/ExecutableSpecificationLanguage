import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import { PackageDriver } from './installed-package.js';

/** Reads the actual installed README and follows its files through the installed CLI. */
export class ShippedWalkthroughDriver {
  readonly package = new PackageDriver();
  readonly files = new Map<string, string>();
  result!: { code: number; stdout: string; stderr: string };
  report!: { status: string; problems: { code: string; message: string; at?: { range?: { sourceId: string; start: { offset: number; line: number; column: number }; end: { offset: number } } } }[]; stages: {
    name: string; status: string; tests?: { title: string; state: string; errors: { message: string; actual?: string; expected?: string }[] }[];
  }[] };
  version = '';
  answered = false;
  private executable = '';
  private before: Record<string, string> = {};
  path(path: string): string { return join(this.package.root, path); }
  async prepare(walkthrough = 'shopping'): Promise<void> {
    await this.package.install();
    const root = this.path('node_modules/executable-specification-language');
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    this.executable = join(root, metadata.bin.expec); this.version = metadata.version;
    const readme = await readFile(join(root, 'README.md'), 'utf8');
    for (const match of readme.matchAll(new RegExp('<!-- expec-example: ' + walkthrough + '/([^\\r\\n]+) -->\\s*```[^\\r\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n```', 'g'))) {
      if (this.files.has(match[1]!)) throw Error('Duplicate shipped walkthrough file: ' + match[1]);
      this.files.set(match[1]!, match[2]! + '\n');
    }
  }
  async file(path: string, text: string): Promise<void> { await mkdir(dirname(this.path(path)), { recursive: true }); await writeFile(this.path(path), text); }
  async createConnectedDirectory(): Promise<void> { await mkdir(this.path('game')); }
  async nativeDesign(): Promise<{ shapes: { id: string; label: string; methods?: { name: string; return: string }[] }[];
    connections: { src: string; dst: string; srcArrow: string; dstArrow: string; label: string }[] }> {
    await cp(new URL('../../resources/package-consumer/design-observations.mjs', import.meta.url), this.path('design-observations.mjs'));
    const result = await promisify(execFile)(process.execPath, ['design-observations.mjs'], { cwd: this.package.root,
      windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    return JSON.parse(result.stdout);
  }
  text(path: string): Promise<string> { return readFile(this.path(path), 'utf8'); }
  async copy(paths: readonly string[]): Promise<void> { for (const path of paths) { const text = this.files.get(path); if (text === undefined) throw Error('Missing shipped file ' + path); await this.file(path, text); } }
  async command(args: string[]): Promise<void> {
    try { this.result = { code: 0, ...await promisify(execFile)(process.execPath, [this.executable, ...args, '--config', this.path('expec.json'), '--json'], {
      cwd: this.package.root, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    }) }; }
    catch (error) {
      const failed = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
      if (typeof failed.code !== 'number' || failed.killed) throw error;
      this.result = { code: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
    if (!this.result.stdout.trim()) throw Error('Installed CLI returned no JSON: ' + JSON.stringify(this.result));
    this.report = JSON.parse(this.result.stdout);
  }
  async removePackageRequirements(): Promise<void> { const config=JSON.parse(await this.text('expec.json')); config.packages=[]; await this.file('expec.json',JSON.stringify(config)); }
  async useTypeScriptOutput(): Promise<void> {
    const config = JSON.parse(await this.text('expec.json'));
    config.outputs = [{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }];
    await this.file('expec.json', JSON.stringify(config));
  }
  async method(name: string): Promise<{ path: string; text: string; body: ts.Block; source: ts.SourceFile }> {
    const found = [];
    for (const path of Object.keys(await this.projectFiles()).filter(path => path.endsWith('.ts'))) {
      const text = await this.text(path), source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      for (const declaration of source.statements.filter(ts.isClassDeclaration)) if (declaration.name?.text === 'StoreGame') {
        for (const member of declaration.members.filter(ts.isMethodDeclaration)) if (member.name.getText(source) === name && member.body) found.push({ path, text, body: member.body, source });
      }
    }
    if (found.length !== 1) throw Error('Expected one actual StoreGame.' + name + ' implementation.');
    return found[0]!;
  }
  async implementSave(body: string): Promise<void> {
    const method = await this.method('save'), start = method.body.getStart(method.source);
    await this.file(method.path, method.text.slice(0, start) + '{ ' + body + ' }' + method.text.slice(method.body.end));
  }
  async decisionFile(id: string, line: number, column: number): Promise<void> {
    await this.file('changes.json', JSON.stringify({ format: 1, matches: [{ id, to: { source: 'main.expec', line, column } }], retire: [] }));
  }
  async declineInitialization(): Promise<void> {
    const terminal='Object.defineProperty(process.stdin,"isTTY",{value:true});Object.defineProperty(process.stderr,"isTTY",{value:true});';
    this.result=await new Promise((done,reject)=>{
      const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(terminal),this.executable,'build','--config',this.path('expec.json')],{cwd:this.package.root,windowsHide:true,stdio:'pipe',env:{...process.env,NODE_PATH:'',NODE_OPTIONS:''}});
      let stdout='',stderr=''; const timer=setTimeout(()=>{child.kill();reject(Error('The installed interactive command did not finish.'));},30_000);
      child.stdout.on('data',chunk=>{stdout+=String(chunk);});
      child.stderr.on('data',chunk=>{stderr+=String(chunk);if(!this.answered&&stderr.includes('Initialize a project (yes/no)? ')){this.answered=true;child.stdin.write('no\n');}});
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);done({code:code??130,stdout,stderr});});
    });
  }
  async breakBasket(): Promise<void> {
    const path = 'game/src/basket.ts', text = await this.text(path), insertion = 'this.contents.set(title, this.quantity(title) + 1);';
    if (text.split(insertion).length !== 2) throw Error('The actual documented basket must contain exactly one insertion.');
    await this.file(path, text.replace(insertion, 'void title;'));
  }
  async projectFiles(root='game'): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const walk = async (path: string): Promise<void> => {
      for (const item of await readdir(this.path(path), { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        const child = path + '/' + item.name;
        if (item.isDirectory()) await walk(child);
        else if (item.isFile()) files[child] = (await readFile(this.path(child))).toString('base64');
        else throw Error('Unexpected linked consumer input.');
      }
    };
    await walk(root); return files;
  }
  async remember(root='game'): Promise<void> { this.before = await this.projectFiles(root); }
  async unchanged(root='game'): Promise<boolean> { const files = await this.projectFiles(root); return Object.keys(files).length === Object.keys(this.before).length && Object.entries(files).every(([path, bytes]) => this.before[path] === bytes); }
}
