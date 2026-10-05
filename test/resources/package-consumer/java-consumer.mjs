import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Compiler, SpecificationIdentity, ConfigurationReader, ProjectInitializer, ProjectConnector,
  JavaContext, JavaProject, FileProjectWriter, Outputs, javaOutput } from 'executable-specification-language';

const packageUrl=import.meta.resolve('executable-specification-language'), execute=promisify(execFile);
const input=JSON.parse(await readFile('java-input.json','utf8')),root=join(process.cwd(),'project');
const javaHome=process.env.EXPEC_TEST_JAVA_HOME??process.env.JAVA_HOME;
if(!javaHome) throw Error('Supply a real JDK21 for the installed Java consumer.');
const bin=name=>join(javaHome,'bin',name+(process.platform==='win32'?'.exe':''));
const native=async(name,args)=>{try {return {code:0,...await execute(bin(name),args,{cwd:root,windowsHide:true,timeout:90_000,maxBuffer:4*1024*1024})};}
  catch(error){if(typeof error.code!=='number')throw error;return {code:error.code,stdout:error.stdout,stderr:error.stderr};}};
const known=result=>{if(!result.value)throw Error(JSON.stringify(result));return result.value;};
const options={package:'store',adoptExisting:true},outputs=new Outputs(); outputs.register(javaOutput);
const configuration=known(new ConfigurationReader(outputs.profiles).read({sourceId:'settings',text:JSON.stringify({formatVersion:1,version:'0.1.0',project:{root:'project'},build:{entries:['main.expec']}})}));
const initializer=new ProjectInitializer(join(process.cwd(),'expec.json'),configuration);
const starter=known(await initializer.prepare({root:'project',target:'java',javaHome}));
known(await initializer.apply(starter,true));
// This compatible native project independently exports its actual empty classpaths.
// The installed CLI dependency-acquisition flow is a separate acceptance obligation.
await writeFile(join(root,'build.gradle'),await readFile('java-capture.gradle','utf8'));
const acquired=await native('java',['-cp',join(root,'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain','--no-daemon','--offline','-p',root,'captureClasspaths','--write-locks']);
if(acquired.code)throw Error(acquired.stdout+acquired.stderr);
const reportPath=join(root,'.expec/java/classpath.json'),report=JSON.parse(await readFile(reportPath,'utf8'));
report.inputs=await Promise.all(['expec.java.json','settings.gradle','build.gradle','gradlew','gradlew.bat','gradle/wrapper/gradle-wrapper.jar',
  'gradle/wrapper/gradle-wrapper.properties','.expec/java/dependencies.gradle','gradle.lockfile'].map(async path=>({path,version:createHash('sha256').update(await readFile(join(root,path))).digest('hex')})));
await writeFile(reportPath,JSON.stringify(report));
await mkdir(join(root,'src/main/java/store'),{recursive:true});
await writeFile(join(root,'src/main/java/store/StoreGame.java'),input.implementation);
await writeFile(join(root,'src/main/java/Caller.java'),input.caller);
const connection=known(await new ProjectConnector(join(process.cwd(),'expec.json'),{excludeNames:['.git','node_modules','.gradle','build']}).connect(configuration));
if(connection.status!=='connected')throw Error('Expected the actual Java project.');
const context=new JavaContext(connection.context), snapshot=await context.readSnapshot();
if(!snapshot.complete)throw Error(JSON.stringify(snapshot.problems));
const output=known(outputs.open('java',options,context,new FileProjectWriter(context),{workspaceModules:['main']}));
const compile=text=>known(new Compiler().compile({locator:'main',source:{sourceId:'main.expec',text},dependencies:{modules:[],packages:[]}}));
let next=0;const identities=new SpecificationIdentity(()=>'java-preserved-'+ ++next),specification=compile(input.source),current=known(identities.associate(specification));
const owner=[...specification.inspection.query('class')].find(item=>item.name==='StoreGame'),method=[...specification.inspection.query('capability')].find(item=>item.name==='save');
const saveId=current.id(method.id),at={file:'src/main/java/store/StoreGame.java',type:'store.StoreGame'};
const mapped=known(identities.withArtifacts(current,[{specId:current.id(owner.id),locator:{outputId:'java',format:'java-symbol-1',value:at}},
  {specId:saveId,locator:{outputId:'java',format:'java-symbol-1',value:{...at,member:{kind:'method',name:'save',parameters:['java.lang.String'],static:false}}}}]));
const adopted=await output.create(mapped),preservation={adopted,original:input.implementation,afterAdoption:await readFile(join(root,at.file),'utf8'),generatedDuplicate:(await readdir(join(root,'src'),{recursive:true})).filter(path=>path.endsWith('StoreGame.java')).length!==1};
const confirmed=known(identities.withArtifacts(mapped,adopted.artifacts??[])),revisedSpecification=compile(input.revised);
const renamed=[...revisedSpecification.inspection.query('capability')].find(item=>item.name==='saveGame');
const revised=known(identities.associate(revisedSpecification,confirmed.baseline,[{id:saveId,to:renamed.id}]));
preservation.updated=await output.update(known(identities.compare(confirmed.baseline,revised)),revised);
preservation.retainedIdentity=revised.id(renamed.id)===saveId;
preservation.source=await readFile(join(root,at.file),'utf8'); preservation.caller=await readFile(join(root,'src/main/java/Caller.java'),'utf8');
const final=known(identities.withArtifacts(revised,preservation.updated.artifacts??[])),project=new JavaProject({outputId:'java'},final.baseline.artifacts),capture=await context.readSnapshot();
const read=await project.read(saveId,capture),search=await project.search(saveId,capture);
await mkdir(join(root,'build/classes'),{recursive:true});
const checked=await native('javac',['-proc:none','--release','21','-d','build/classes',at.file,'src/main/java/Caller.java']);
preservation.diagnostics=checked.code?[checked.stderr]:[];
if(!checked.code)preservation.runtime=await native('java',['-cp','build/classes','Caller']);
await writeFile(join(root,'src/main/java/Wrong.java'),'public class Wrong { void run() { new store.StoreGame().saveGame(64); } }');
const wrong=await native('javac',['-proc:none','--release','21','-cp','build/classes','-d','build/classes','src/main/java/Wrong.java']);
process.stdout.write(JSON.stringify({packageUrl,preservation,java:{complete:capture.complete,problems:capture.problems,search,
  read:{...read,artifacts:read.artifacts.map(item=>({at:item.at,path:item.file.path,text:new TextDecoder().decode(item.file.bytes)}))},wrong}}));
