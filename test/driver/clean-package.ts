import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

/** Runs only from the separately staged consumer workspace; it never packs a checkout. */
export class CleanPackageDriver {
  readonly root = process.cwd();
  readonly require = createRequire(join(this.root, 'package.json'));
  readonly entry = fileURLToPath(import.meta.resolve('executable-specification-language'));
  readonly packageRoot = dirname(dirname(this.entry));
  result!: { code: number; stdout: string; stderr: string };
  metadata!: { version: string; sha256: string; artifact: string; commit: string };
  private executable = '';
  private directory = '';
  async prepare(): Promise<void> {
    this.metadata = JSON.parse(await readFile(join(this.root, 'delivery.json'), 'utf8'));
    const info = JSON.parse(await readFile(join(this.packageRoot, 'package.json'), 'utf8'));
    this.executable = resolve(this.packageRoot, info.bin.expec);
    this.directory = join(this.root, 'consumer-' + crypto.randomUUID()); await mkdir(this.directory);
  }
  async absent(path: string): Promise<boolean> { try { await stat(join(this.root, path)); return false; } catch (error) { if ((error as {code?:string}).code !== 'ENOENT') throw error; return true; } }
  async artifactDigest(): Promise<string> { return createHash('sha256').update(await readFile(join(this.root, this.metadata.artifact))).digest('hex'); }
  async forbiddenImports(): Promise<{ development: string; private: string }> {
    const importer = 'try { await import(process.argv[1]); process.exitCode=1; } catch(error) { console.log(error.code); }';
    await this.run(['--input-type=module', '-e', importer, './src/index.js'], this.root); const development = this.result.stdout.trim();
    await this.run(['--input-type=module', '-e', importer, 'executable-specification-language/dist/index.js'], this.root);
    return { development, private: this.result.stdout.trim() };
  }
  async installedPaths(): Promise<{ entry: string; within: string; version: string; grammar: string }> {
    const entry = await realpath(this.entry);
    const version = JSON.parse(await readFile(join(this.packageRoot, 'package.json'), 'utf8')).version;
    const grammar = await realpath(join(this.packageRoot, 'dist/language/langium/generated/grammar.js'));
    return { entry, within: relative(await realpath(join(this.root, 'node_modules')), entry), version, grammar };
  }
  get consumerDirectory(): string { return this.directory; }
  async run(args: string[], cwd=this.directory, deadline=180_000): Promise<void> {
    try { this.result = { code: 0, ...await promisify(execFile)(process.execPath,args,{cwd,windowsHide:true,timeout:deadline,maxBuffer:4*1024*1024,env:{...process.env,NODE_PATH:'',NODE_OPTIONS:''}}) }; }
    catch(error) { const failed=error as {code?:number|string;killed?:boolean;stdout?:string;stderr?:string}; if(typeof failed.code!=='number'||failed.killed)throw error; this.result={code:failed.code,stdout:failed.stdout??'',stderr:failed.stderr??''}; }
  }
  async command(args: string[], deadline=180_000): Promise<void> { await this.run([this.executable,...args], this.directory, deadline); }
  async publicConsumer(): Promise<unknown> {
    const source = await readFile(new URL('../resources/clean-package/consumer.ts', import.meta.url),'utf8');
    await writeFile(join(this.directory,'consumer.ts'),source);
    await writeFile(join(this.directory,'package.json'),'{"type":"module","private":true}');
    await this.run([this.require.resolve('typescript/bin/tsc'),'consumer.ts','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir','out']);
    if(this.result.code)throw Error('Public type consumer failed: '+this.result.stdout+this.result.stderr);
    await this.run(['out/consumer.js']);
    if(this.result.code)throw Error('Public compiled consumer failed: '+this.result.stdout+this.result.stderr);
    return JSON.parse(this.result.stdout);
  }
}
