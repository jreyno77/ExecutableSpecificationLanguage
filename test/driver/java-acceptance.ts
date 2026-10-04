import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DOMParser } from '@xmldom/xmldom';
import { FileProjectWriter, Outputs, SpecificationIdentity, javaAcceptanceOutput } from '../../src/index.js';
import { JavaOutputDriver } from './java-output.js';

export class JavaAcceptanceDriver extends JavaOutputDriver {
  private readonly junit = process.env.EXPEC_TEST_JUNIT_CONSOLE!;
  private fixture: object | undefined;
  private selectedDriver: object | undefined;
  readonly outcomes: { title: string; status: string; failure: string }[] = [];
  async prepare(): Promise<void> {
    if (!this.junit) throw new Error('Supply the actual pinned JUnit 6.1.3 console JAR to this native test.');
    this.nativeOptions = { classPath: { main: [], test: [this.junit] } };
    await this.initialize(); await this.nativeProject();
  }
  async generate(options: Record<string, unknown> = {}): Promise<void> {
    const outputs = new Outputs(); outputs.register(javaAcceptanceOutput);
    const result = outputs.open('java-acceptance', { package: 'store.tests', domain: 'shopping', ...this.selectedDriver ? { driver: this.selectedDriver, adoptExisting: true } : {}, ...this.fixture ? { fixture: this.fixture } : {}, ...options }, this.context, new FileProjectWriter(this.context));
    this.written = result.value ? await result.value.create(this.current) : { problems: result.problems }; this.confirm(); await this.capture();
  }
  private confirm(): void {
    if(!this.written.artifacts) return;
    const result=new SpecificationIdentity(randomUUID).withArtifacts(this.current,[...this.current.baseline.artifacts.filter(item=>item.locator.outputId!=='java-acceptance'),...this.written.artifacts]);
    if(!result.value) throw new Error(JSON.stringify(result)); this.current=result.value;
  }
  async update(source: string): Promise<void> {
    const before=this.current,identity=new SpecificationIdentity(randomUUID); super.source(source);
    const after=identity.associate(this.current.specification,before.baseline); if(!after.value) throw new Error(JSON.stringify(after));
    const diff=identity.compare(before.baseline,after.value); if(!diff.value) throw new Error(JSON.stringify(diff));
    this.current=after.value; this.written=await this.acceptance().update(diff.value,this.current); this.confirm(); await this.capture();
  }
  async replaceText(path: string,before: string,after: string): Promise<void> {
    const source=await fs.readFile(join(this.root,path),'utf8'); if(!source.includes(before)) throw new Error('Expected authored fragment '+before);
    await this.file(path,source.replace(before,after));
  }
  private acceptance() {
    const outputs=new Outputs(); outputs.register(javaAcceptanceOutput);
    const opened=outputs.open('java-acceptance',{package:'store.tests',domain:'shopping',...this.selectedDriver?{driver:this.selectedDriver,adoptExisting:true}:{},...this.fixture?{fixture:this.fixture}:{}},this.context,new FileProjectWriter(this.context));
    if(!opened.value) throw new Error(JSON.stringify(opened)); return opened.value;
  }
  async readScenario(title: string): Promise<void> {
    const scenario=[...this.current.specification.inspection.query('scenario')].find(item=>item.title.value===title);
    if(!scenario) throw new Error('Missing authored scenario'); await this.capture(); this.readResult=await this.acceptance().read(this.current.id(scenario.id));
  }
  async searchOperation(name: string): Promise<void> {
    const operation=this.current.baseline.elements.find(item=>item.address.name===name);
    if(!operation) throw new Error('Missing authored operation'); await this.capture(); this.searchResult=await this.acceptance().search(operation.id);
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
    this.current = associated.value;
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
  async run(): Promise<void> {
    await this.capture(); const classes = join(this.directory, 'junit-classes'), reports = join(this.directory, 'junit-reports');
    await fs.mkdir(classes, { recursive: true }); await fs.mkdir(reports, { recursive: true });
    const execute = async (name: string, args: string[]) => {
      try { const result = await promisify(execFile)(join(process.env.JAVA_HOME!, 'bin', name + (process.platform === 'win32' ? '.exe' : '')), args,
        { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }); return { code: 0, stdout: result.stdout, stderr: result.stderr }; }
      catch (error) { const result = error as { code?: number; stdout?: string; stderr?: string }; return { code: result.code ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) }; }
    };
    this.native = await execute('javac', ['-proc:none','--release','21','-encoding','UTF-8','-cp',this.junit,'-d',classes,
      ...this.snapshot.files.filter(file => file.path.endsWith('.java')).map(file => join(this.root,file.path))]);
    if (this.native.code) return;
    this.native = await execute('java', ['-jar',this.junit,'execute','--class-path',classes,'--select-class','store.tests.acceptance.Examples',
      '--reports-dir',reports,'--disable-banner','--disable-ansi-colors']);
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
