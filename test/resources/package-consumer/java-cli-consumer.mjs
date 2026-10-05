import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { tmpdir, homedir } from 'node:os';

const packageUrl=import.meta.resolve('executable-specification-language'), packageRoot=dirname(dirname(fileURLToPath(packageUrl)));
const metadata=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8')), executable=resolve(packageRoot,metadata.bin.expec);
const input=JSON.parse(await readFile('java-cli-input.json','utf8')), commands=[];
const temporary=await realpath(tmpdir()), gradleHome=process.env.GRADLE_USER_HOME??join(homedir(),'.gradle');
const javaHome=process.env.EXPEC_TEST_JAVA_HOME??process.env.JAVA_HOME, canonicalJavaHome=await realpath(javaHome);
const jdkReads=new Set([javaHome, canonicalJavaHome]), visited=new Set();
// The selected distribution may link its truststore outside javaHome. Grant only its actual selected targets.
const selectedJdk=async(path)=>{
  const actual=await realpath(path), within=relative(canonicalJavaHome,actual);
  if(within==='..'||within.startsWith('..'+sep)||isAbsolute(within))jdkReads.add(actual);
  if(visited.has(actual))return; visited.add(actual);
  if((await stat(actual)).isDirectory())for(const name of await readdir(actual))await selectedJdk(join(actual,name));
};
for(const name of ['release','bin','lib','conf'])await selectedJdk(join(javaHome,name));
const command=async(name,extra=[])=>{
  let native;
  const guarded = name === 'build' || name === 'test';
  const env={...process.env,TMP:temporary,TEMP:temporary,TMPDIR:temporary,NODE_PATH:'',EXPEC_TEST_CHECKOUT_FILE:input.checkoutFile}; delete env.EXPEC_TEST_GRADLE;
  const permission=guarded?['--permission','--allow-fs-read='+temporary,'--allow-fs-read='+process.cwd(),
    ...[...jdkReads].map(path=>'--allow-fs-read='+path),'--allow-fs-read='+gradleHome,
    '--allow-fs-write='+temporary,'--allow-fs-write='+process.cwd(),'--allow-child-process','--import','./java-cli-guard.mjs']:[];
  try { native={code:0,...await promisify(execFile)(process.execPath,[...permission,executable,name,'--config','spec/expec.json','--json',...extra],{timeout:180_000,maxBuffer:8*1024*1024,windowsHide:true,env})}; }
  catch(error){if(typeof error.code!=='number'||error.killed)throw error;native={code:error.code,stdout:error.stdout,stderr:error.stderr};}
  const observed={command:name,...native,report:JSON.parse(native.stdout)}; commands.push(observed); return observed;
};
const required=async(name,extra=[])=>{const observed=await command(name,extra);if(observed.code)throw Error(JSON.stringify(observed));return observed;};
await mkdir('spec'); await writeFile('spec/main.expec',input.source);
await writeFile('spec/expec.json',JSON.stringify({formatVersion:1,version:'1.0.0',build:{entries:['main.expec']},outputs:[]}));
await required('init',['--root','../project','--target','java','--java-home',process.env.EXPEC_TEST_JAVA_HOME??process.env.JAVA_HOME,'--yes']);
await required('install'); await required('build');
const game='project/src/main/java/generated/StoreGame.java', driver='project/src/test/java/generated/tests/driver/ShoppingDriver.java';
await writeFile(game,`package generated;
public class StoreGame {
  // Handwritten basket state must survive the contract rename.
  private final java.util.Set<String> catalog=new java.util.HashSet<>();
  private final java.util.Map<String,Double> basket=new java.util.HashMap<>();
  public void available(String title) { catalog.add(title); }
  public void save(String title) { if(!catalog.contains(title)) throw new IllegalStateException("Unavailable book"); basket.merge(title,1.0,Double::sum); }
  public double quantity(String title) { return basket.getOrDefault(title,0.0); }
}
`);
await writeFile(driver,`package generated.tests.driver;
public class ShoppingDriver {
  private final generated.StoreGame game=new generated.StoreGame();
  public void available(String title) { game.available(title); }
  public void add(String title) { game.save(title); }
  public double quantity(String title) { double actual=game.quantity(title); System.out.println("ACTUAL-BASKET:"+title+":"+actual); return actual; }
}
`);
const first=await required('test');
const identity=JSON.parse(await readFile('project/.expec/identity.json','utf8'));
const selected=identity.baseline.elements.filter(item=>item.address.name==='save'); if(selected.length!==1)throw Error('Select the actual prior capability identity.');
await writeFile('spec/main.expec',input.revised);
await writeFile('changes.json',JSON.stringify({format:1,matches:[{id:selected[0].id,to:{source:'main.expec',line:2,column:1}}],retire:[]}));
await required('build',['--decisions','changes.json']);
const renamed=await required('test'), source=await readFile(game,'utf8'), caller=await readFile(driver,'utf8');
const tests=await readdir('project/src/test/java/generated/tests/acceptance');
const readable=await readFile(join('project/src/test/java/generated/tests/acceptance',tests.find(file=>file.endsWith('.java'))),'utf8');
await writeFile(game,source.replace('basket.merge(title,1.0,Double::sum)','basket.merge(title,2.0,Double::sum)'));
const wrong=await command('test');
console.log(JSON.stringify({packageUrl,javaCli:{executable,commands,first,renamed,wrong,source,caller,readable}}));
