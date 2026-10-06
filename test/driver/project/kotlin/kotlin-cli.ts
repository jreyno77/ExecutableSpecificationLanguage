import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigurationReader, ProjectInitializer, Outputs, SpecificationIdentity, kotlinOutput } from '../../../../src/index.js';
import { ConnectedBuildDriver } from '../../cli/connected-build.js';

export class KotlinCliDriver extends ConnectedBuildDriver {
  static prepare = ConnectedBuildDriver.prepare;
  get javaHome(): string {
    const home = process.env.EXPEC_TEST_JAVA_HOME;
    if (!home) throw Error('Supply the explicit ordinary JDK21 used by native CLI acceptance.');
    return resolve(home);
  }
  async starter(): Promise<void> {
    const outputs = new Outputs(); outputs.register(kotlinOutput);
    const manifest = this.path('spec/expec.json'), text = await fs.readFile(manifest, 'utf8');
    const configuration = new ConfigurationReader(outputs.profiles).read({ sourceId: manifest, text });
    if (!configuration.value) throw Error(JSON.stringify(configuration));
    const initializer = new ProjectInitializer(manifest, configuration.value);
    const preview = await initializer.prepare({ root: '../project', target: 'kotlin', javaHome: this.javaHome });
    if (!preview.value) throw Error(JSON.stringify(preview));
    const result = await initializer.apply(preview.value, true);
    if (!result.value) throw Error(JSON.stringify(result));
    const { sourceId: _source, ...value } = result.value.configuration;
    this.manifest = value;
    await this.saveManifest();
  }
  async nativeReport(): Promise<any> { return JSON.parse(await fs.readFile(this.path('project/.expec/kotlin/classpath.json'), 'utf8')); }
  async text(path: string): Promise<string> { return fs.readFile(this.path('project/' + path), 'utf8'); }
  async absent(path: string): Promise<boolean> {
    try { await fs.lstat(this.path('project/' + path)); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
  }
  async acceptance(): Promise<void> {
    this.manifest.outputs = [...this.manifest.outputs as {id:string;options:object}[],
      { id: 'kotlin-acceptance', options: { package: 'generated.tests', domain: 'shopping' } }];
    await this.saveManifest();
  }
  async implement(body: string): Promise<void> {
    const path = this.path('project/src/main/kotlin/generated/multiply.kt'), text = await fs.readFile(path, 'utf8');
    const old = text.includes('return a * b') ? 'return a * b' : 'throw NotImplementedError("Not implemented: multiply")';
    if (!text.includes(old)) throw Error('The arranged native application has no expected original body.');
    await fs.writeFile(path, text.replace(old, body));
  }
  async neighbor(): Promise<void> {
    const path = this.path('project/src/test/kotlin/generated/tests/acceptance/ShoppingAcceptance.kt'), text = await fs.readFile(path, 'utf8');
    const end = text.lastIndexOf('}'); if(end < 0) throw Error('Missing actual native test class.');
    await fs.writeFile(path, text.slice(0,end) + '  @org.junit.jupiter.api.Test fun eightSquaredNeighbor() { error("NEIGHBOR_RAN") }\n' + text.slice(end));
  }
  async forgetExampleArtifact(title: string): Promise<void> {
    const path = this.path('project/.expec/identity.json'), record = JSON.parse(await fs.readFile(path, 'utf8'));
    const identities = new SpecificationIdentity(() => { throw Error('Reading existing identity must not allocate.'); });
    const read = identities.read({ sourceId: path, text: JSON.stringify(record.baseline) });
    if (!read.value) throw Error(JSON.stringify(read.problems));
    const selected = read.value.elements.filter(item => item.address.kind === 'example' && item.address.name === title);
    if (selected.length !== 1) throw Error('Select one actual confirmed example identity.');
    const baseline = { ...read.value, artifacts: read.value.artifacts.filter(item => item.specId !== selected[0]!.id || item.locator.outputId !== 'kotlin-acceptance') };
    if (baseline.artifacts.length === read.value.artifacts.length) throw Error('The selected example had no artifact to withdraw.');
    const written = identities.write(baseline); if (!written.value) throw Error(JSON.stringify(written.problems));
    await fs.writeFile(path, JSON.stringify({ ...record, baseline: JSON.parse(written.value) }, null, 2));
  }
  async disableExample(): Promise<void> {
    const path = this.path('project/src/test/kotlin/generated/tests/acceptance/ShoppingAcceptance.kt');
    const text = await fs.readFile(path, 'utf8'), marker = '  @org.junit.jupiter.api.Test';
    if (!text.includes(marker)) throw Error('The generated native case has no actual Test annotation.');
    await fs.writeFile(path, text.replace(marker, '  @org.junit.jupiter.api.Disabled("Awaiting implementation")\n' + marker));
  }
  nativeCommands: string[] = [];
  async command(command: string, args: string[] = []): Promise<void> {

    const observed = this.path('native-processes.jsonl'), preload = this.path('observe-native.mjs');
    await fs.writeFile(observed, '');
    await fs.writeFile(preload, 'import child from "node:child_process"; import {appendFileSync} from "node:fs"; import {syncBuiltinESMExports} from "node:module"; import {promisify} from "node:util";\n'
      + 'for(const name of ["execFile","spawn","exec","fork"]){ const original=child[name]; const record=(args)=>appendFileSync('
      + JSON.stringify(observed) + ',JSON.stringify([name,...args.slice(0,2)])+"\\n"); child[name]=function(...args){ record(args); return original.apply(this,args); }; if(name==="execFile"||name==="exec") Object.defineProperty(child[name],promisify.custom,{value:function(...args){record(args);return promisify(original).apply(this,args);}}); } syncBuiltinESMExports();\n');
    const entry = fileURLToPath(new URL('../../../../dist/cli-entry.js', import.meta.url));
    try { this.result = { code: 0, ...await promisify(execFile)(process.execPath, ['--import', pathToFileURL(preload).href, entry, command, '--config', 'spec/expec.json', '--json', ...args],
      { cwd: this.directory, timeout: 360_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_PATH: '' } }) }; }
    catch(error) {
      const result = error as {code?:number;stdout?:string;stderr?:string};
      if(typeof result.code !== 'number') throw error;
      this.result = {code:result.code,stdout:result.stdout ?? '',stderr:result.stderr ?? ''};
    }
    if (!this.result.stdout.trim()) throw Error('CLI returned no JSON: ' + this.result.stderr);
    this.report = JSON.parse(this.result.stdout);
    this.nativeCommands = (await fs.readFile(observed,'utf8')).trim().split('\n').filter(Boolean);

  }
}
