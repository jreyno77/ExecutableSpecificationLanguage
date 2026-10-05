import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DOMParser } from '@xmldom/xmldom';
import { FileProjectWriter, Outputs, SpecificationIdentity, javaAcceptanceOutput, type ProjectSnapshot } from '../../src/index.js';
import { JavaOutputDriver } from './java-output.js';

export class JavaAcceptanceDriver extends JavaOutputDriver {
  files: ProjectSnapshot['files'] = [];
  async observeFiles(): Promise<void> {
    const snapshot = await this.ordinary.readSnapshot();
    if (!snapshot.complete || snapshot.problems.length) throw new Error(JSON.stringify(snapshot.problems));
    this.files = snapshot.files;
  }
  private readonly junit = process.env.EXPEC_TEST_JUNIT_CONSOLE!;
  private fixture: object | undefined;
  private readonly names: {id:string;name:string}[]=[];
  private selectedDriver: object | undefined;
  readonly outcomes: { title: string; status: string; failure: string }[] = [];
  async prepare(): Promise<void> {
    if (!this.junit) throw new Error('Supply the actual pinned JUnit 6.1.3 console JAR to this native test.');
    this.nativeOptions = { classPath: { main: [], test: [this.junit] } };
    await this.initialize(); await this.nativeProject(); await this.observeFiles();
  }
  async generate(options: Record<string, unknown> = {}): Promise<void> {
    const outputs = new Outputs(); outputs.register(javaAcceptanceOutput);
    const result = outputs.open('java-acceptance', { package: 'store.tests', domain: 'shopping', ...this.names.length?{names:this.names}:{}, ...this.selectedDriver ? { driver: this.selectedDriver, adoptExisting: true } : {}, ...this.fixture ? { fixture: this.fixture } : {}, ...options }, this.context, new FileProjectWriter(this.context), this.workspaceModules ? {workspaceModules:this.workspaceModules} : undefined);
    this.written = result.value ? await result.value.create(this.current) : { problems: result.problems }; this.confirm(); await this.observeFiles();
  }
  private confirm(): void {
    if(!this.written.artifacts) return;
    const result=new SpecificationIdentity(randomUUID).withArtifacts(this.current,[...this.current.baseline.artifacts.filter(item=>item.locator.outputId!=='java-acceptance'),...this.written.artifacts]);
    if(!result.value) throw new Error(JSON.stringify(result)); this.current=result.value;
  }
  async update(source: string,retired:string[]=[]): Promise<void> {
    const before=this.current,identity=new SpecificationIdentity(randomUUID),ids=retired.map(title=>before.id(this.scenario(title).id)); super.source(source);
    const after=identity.associate(this.current.specification,before.baseline,ids.map(retire=>({retire}))); if(!after.value) throw new Error(JSON.stringify(after));
    const diff=identity.compare(before.baseline,after.value); if(!diff.value) throw new Error(JSON.stringify(diff));
    for(let index=this.names.length-1;index>=0;index--) if(ids.includes(this.names[index]!.id)) this.names.splice(index,1);
    this.current=after.value; this.written=await this.acceptance().update(diff.value,this.current); this.confirm(); await this.observeFiles();
  }
  async replaceText(path: string,before: string,after: string): Promise<void> {
    const source=await fs.readFile(join(this.root,path),'utf8'); if(!source.includes(before)) throw new Error('Expected authored fragment '+before);
    await this.file(path,source.replace(before,after));
  }
  async planGeneration(options: Record<string, unknown>): Promise<void> {
    await this.capture(); this.planned = await this.acceptance(options).plan({ operation: 'create', current: this.current }, this.snapshot);
  }
  private acceptance(options: Record<string, unknown> = {}) {
    const outputs=new Outputs(); outputs.register(javaAcceptanceOutput);
    const opened=outputs.open('java-acceptance',{package:'store.tests',domain:'shopping',...this.names.length?{names:this.names}:{},...this.selectedDriver?{driver:this.selectedDriver,adoptExisting:true}:{},...this.fixture?{fixture:this.fixture}:{},...options},this.context,new FileProjectWriter(this.context), this.workspaceModules ? {workspaceModules:this.workspaceModules} : undefined);
    if(!opened.value) throw new Error(JSON.stringify(opened)); return opened.value;
  }
  private scenario(title: string) {
    const inspection=this.current.specification.inspection;
    const item=[...inspection.query('scenario'),...inspection.query('example')].find(item=>item.title.value===title);
    if(!item) throw Error('Missing authored case '+title); return item;
  }
  nameScenario(title:string,name:string):void { this.names.push({id:this.current.id(this.scenario(title).id),name}); }
  async deleteScenario(title:string):Promise<void> { this.written=await this.acceptance().delete(this.current.id(this.scenario(title).id)); this.confirm(); await this.observeFiles(); }
  async deleteGroup(index:number):Promise<void> {
    const group=[...this.current.specification.inspection.query('examples')][index]; if(!group) throw Error('Missing authored group');
    this.written=await this.acceptance().delete(this.current.id(group.id)); this.confirm(); await this.observeFiles();
  }
  nameGroup(index:number|string,name:string,scenarioName?:string):void {
    const groups=[...this.current.specification.inspection.query('examples')];
    const group=typeof index==='number'?groups[index]:groups.find(item=>item.origin.kind==='source'&&item.origin.module===index); if(!group) throw new Error('Missing examples group');
    this.names.push({id:this.current.id(group.id),name});
    for(const item of group.members) if(scenarioName&&item.kind==='scenario') this.names.push({id:this.current.id(item.id),name:scenarioName});
  }
  scenarioSelectors():{file:string;type:string;method:string;title:string}[] {
    return [...this.current.specification.inspection.query('scenario'),...this.current.specification.inspection.query('example')].flatMap(scenario=>(this.written.artifacts??[]).filter(artifact=>artifact.specId===this.current.id(scenario.id))
      .map(artifact=>{const at=artifact.locator.value as {file:string;type:string;member:{name:string}};return {file:at.file,type:at.type,method:at.member.name,title:scenario.title.value};}));
  }
  async readScenario(title: string): Promise<void> {
    await this.observeFiles(); this.readResult=await this.acceptance().read(this.current.id(this.scenario(title).id));
  }
  async searchScenario(title:string):Promise<void> { await this.observeFiles(); this.searchResult=await this.acceptance().search(this.current.id(this.scenario(title).id)); }
  async searchOperation(name: string): Promise<void> {
    const operation=this.current.baseline.elements.find(item=>item.address.name===name);
    if(!operation) throw new Error('Missing authored operation'); await this.observeFiles(); this.searchResult=await this.acceptance().search(operation.id);
  }
  async corruptState(): Promise<void> {
    const path='.expec/outputs/java-acceptance.json',source=await fs.readFile(join(this.root,path),'utf8');
    await this.file(path,source.replace('"format": 1','"format": 1, "format": 1'));
  }
  async removeFile(path: string): Promise<void> { await fs.unlink(join(this.root,path)); }
  selectDriver(file: string, type: string): void { this.selectedDriver = { outputId: 'java-acceptance', format: 'java-symbol-1', value: { file,type } }; }
  mapOperation(name: string,file: string,type: string,method: string,parameters: string[]): void {
    const record=this.current.baseline.elements.find(item=>item.address.name===name);
    if(!record) throw new Error('Missing checked operation '+name);
    const result=new SpecificationIdentity(randomUUID).withArtifacts(this.current,[...this.current.baseline.artifacts,{specId:record.id,
      locator:{outputId:'java-acceptance',format:'java-symbol-1',value:{file,type,member:{kind:'method',name:method,parameters,static:false}}}}]);
    if(!result.value) throw new Error(JSON.stringify(result)); this.current=result.value;
  }
  async partialBasket(): Promise<void> {
    const file='src/test/java/store/tests/driver/BasketDriver.java',type='store.tests.driver.BasketDriver';
    await this.file(file,`package store.tests.driver;
public class BasketDriver {
  // This actual basket implementation must survive adoption.
  private final java.util.Set<String> catalog=new java.util.HashSet<>();
  private final java.util.Map<String,Double> basket=new java.util.HashMap<>();
  public void catalogContains(String title) { catalog.add(title); }
  public void put(String title) { if(!catalog.contains(title)) throw new IllegalStateException("Unavailable book"); basket.merge(title,1.0,Double::sum); System.out.println("BASKET:"+title+":"+basket.get(title)); }
}`);
    this.selectDriver(file,type); this.mapOperation('available',file,type,'catalogContains',['java.lang.String']); this.mapOperation('add',file,type,'put',['java.lang.String']);
  }
  async implementQuantity(): Promise<void> {
    const file='src/test/java/store/tests/driver/BasketDriver.java',path=join(this.root,file),source=await fs.readFile(path,'utf8');
    const stub='throw new java.lang.UnsupportedOperationException("Not implemented: quantity");';
    if(!source.includes(stub)) throw new Error('Expected actual unfinished quantity implementation.');
    await this.file(file,source.replace(stub,'return basket.getOrDefault(title,0.0);'));
  }
  selectFixture(file: string, type: string): void { this.fixture = { outputId: 'java-acceptance', format: 'java-symbol-1', value: { file, type } }; }
  async resourceFixture(setupFails: boolean): Promise<void> {
    const file = 'src/test/java/store/tests/ResourceFixture.java';
    await this.file(file, `package store.tests;
public class ResourceFixture {
  private java.net.ServerSocket socket;
  @org.junit.jupiter.api.BeforeEach public void acquire() throws Exception {
    socket = new java.net.ServerSocket(0); System.out.println("ACQUIRED:"+socket.getLocalPort());
    ${setupFails ? 'throw new IllegalStateException("setup failed");' : ''}
  }
  @org.junit.jupiter.api.AfterEach public void release() throws Exception {
    if (socket != null) { socket.close(); System.out.println("SOCKET-CLOSED:"+socket.isClosed()); }
    throw new IllegalStateException("cleanup failed");
  }
  protected store.tests.driver.ShoppingDriver createDriver() { return new store.tests.driver.ShoppingDriver(); }
}`);
    this.selectFixture(file,'store.tests.ResourceFixture');
  }
  async contracts(): Promise<void> {
    await this.create({ package: 'store' });
    if (!this.written.artifacts) throw new Error(JSON.stringify(this.written));
    const associated = new SpecificationIdentity(randomUUID).withArtifacts(this.current, this.written.artifacts);
    if (!associated.value) throw new Error(JSON.stringify(associated));
    this.current = associated.value; await this.observeFiles();
  }
  async methods(source: string): Promise<void> {
    await this.file('src/test/java/store/tests/driver/ShoppingDriver.java', 'package store.tests.driver; public class ShoppingDriver { ' + source + ' }');
  }
  async basket(copiesPerAdd: number): Promise<void> {
    await this.file('src/test/java/store/tests/driver/ShoppingDriver.java', `package store.tests.driver;
public class ShoppingDriver {
  private final java.util.Set<String> catalog = new java.util.HashSet<>();
  private final java.util.Map<String,Double> basket = new java.util.HashMap<>();
  public void available(String title) { System.out.println("TEST-BODY-RAN"); catalog.add(title); }
  public void add(String title) { if (!catalog.contains(title)) throw new IllegalStateException("Unavailable book"); basket.merge(title, ${copiesPerAdd}.0, Double::sum); }
  public double quantity(String title) { double actual = basket.getOrDefault(title, 0.0); System.out.println("BASKET:" + title + ":" + actual); return actual; }
}`);
  }
  async barrierBasket(): Promise<void> { await this.file('src/test/java/store/tests/driver/ShoppingDriver.java',await fs.readFile(new URL('../resources/java-project/BarrierBasketDriver.java',import.meta.url),'utf8')); }
  async run(parallel=false,selectedClasses=['store.tests.acceptance.Examples']): Promise<void> {
    await this.observeFiles(); const classes = join(this.directory, 'junit-classes'), reports = join(this.directory, 'junit-reports');
    await fs.mkdir(classes, { recursive: true }); await fs.mkdir(reports, { recursive: true });
    const execute = async (name: string, args: string[]) => {
      try { const result = await promisify(execFile)(join(process.env.JAVA_HOME!, 'bin', name + (process.platform === 'win32' ? '.exe' : '')), args,
        { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }); return { code: 0, stdout: result.stdout, stderr: result.stderr }; }
      catch (error) { const result = error as { code?: number; stdout?: string; stderr?: string }; return { code: result.code ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) }; }
    };
    this.native = await execute('javac', ['-proc:none','--release','21','-encoding','UTF-8','-cp',this.junit,'-d',classes,
      ...this.files.filter(file => file.path.endsWith('.java')).map(file => join(this.root,file.path))]);
    if (this.native.code) return;
    this.native = await execute('java', ['-jar',this.junit,'execute','--class-path',classes,...selectedClasses.flatMap(type=>['--select-class',type]),
      '--reports-dir',reports,'--disable-banner','--disable-ansi-colors',...parallel ? ['--config','junit.jupiter.execution.parallel.enabled=true','--config','junit.jupiter.execution.parallel.mode.default=concurrent',
        '--config','junit.jupiter.execution.parallel.config.strategy=fixed','--config','junit.jupiter.execution.parallel.config.fixed.parallelism=2','--config','junit.jupiter.execution.parallel.config.fixed.max-pool-size=2'] : []]);
    this.outcomes.length = 0;
    for (const name of await fs.readdir(reports)) if (name.endsWith('.xml')) {
      const document = new DOMParser().parseFromString(await fs.readFile(join(reports,name),'utf8'),'text/xml');
      for (const item of Array.from(document.getElementsByTagName('testcase'))) {
        const failed = [...Array.from(item.getElementsByTagName('failure')), ...Array.from(item.getElementsByTagName('error'))];
        this.outcomes.push({ title: item.getAttribute('name') ?? '', status: failed.length ? 'failed' : item.getElementsByTagName('skipped').length ? 'skipped' : 'passed',
          failure: failed.map(item => item.textContent).join('\n') });
      }
    }
  }
}
