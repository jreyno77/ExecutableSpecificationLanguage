import type { OutputRegistration, OutputAdapter, OutputRequest, OutputPlan } from './output.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { Check } from './checking.js';
import type { z } from 'zod';
import { canonical, failure, success } from './identity-baseline.js';
import { JavaProject } from './java-project.js';
import { javaAcceptanceOptions, javaProblem, optionProblems } from './java-settings.js';
import { JavaExamples } from './java-examples.js';
import { analyzeJava } from './java-analysis.js';
import { hash } from './project-files.js';
import { validDiff } from './output-contract.js';
import { readJavaOutputState } from './java-output-state.js';

export const javaAcceptanceOutput: OutputRegistration = {
  id:'java-acceptance', validate:value=>optionProblems(javaAcceptanceOptions,value),
  open:options=>new JavaAcceptanceOutput(javaAcceptanceOptions.parse(options)),
};
class JavaAcceptanceOutput implements OutputAdapter {
  readonly id='java-acceptance';
  constructor(private readonly options:z.infer<typeof javaAcceptanceOptions>) {}
  private project(snapshot:ProjectSnapshot) {
    const state=readJavaOutputState(this.id,this.options,javaAcceptanceOptions,snapshot);
    return {state,project:new JavaProject({outputId:this.id,configFile:this.options.configFile??'expec.java.json'},state.value?.files.flatMap(file=>file.artifacts)??[])};
  }
  async read(id:string,snapshot:ProjectSnapshot) {
    const {state,project}=this.project(snapshot),result=await project.read(id,snapshot);
    return {...result,problems:[...state.problems,...result.problems],coverage:{...result.coverage,complete:!state.problems.length&&result.coverage.complete,
      limitations:[...result.coverage.limitations,...state.problems.map(problem=>problem.message)]}};
  }
  async search(id:string,snapshot:ProjectSnapshot) {
    const {state,project}=this.project(snapshot),result=await project.search(id,snapshot);
    const direction=(value:typeof result.incoming)=>({...value,coverage:{...value.coverage,complete:!state.problems.length&&value.coverage.complete,
      limitations:[...value.coverage.limitations,...state.problems.map(problem=>problem.message)]}});
    return {...result,problems:[...state.problems,...result.problems],incoming:direction(result.incoming),outgoing:direction(result.outgoing)};
  }
  async plan(request:OutputRequest,snapshot:ProjectSnapshot):Promise<Check<OutputPlan>> {
    if (!snapshot.complete || snapshot.problems.length) return {problems:snapshot.problems,deferred:[]};
    const stored=readJavaOutputState(this.id,this.options,javaAcceptanceOptions,snapshot); if(stored.problems.length) return {problems:stored.problems,deferred:[]};
    if (request.operation==='delete') return failure('unsupported-native-removal','Acceptance deletion needs established native ownership.');
    if ('diff' in request && !validDiff(request.diff,request.current)) return failure('inconsistent-diff','The transition disagrees with current checked identity.');
    const actual=await analyzeJava(snapshot,this.options.configFile??'expec.java.json');
    const prerequisites=actual.problems.filter(problem=>!problem.code.startsWith('java-'));
    if(prerequisites.length) return {problems:prerequisites,deferred:[]};
    const projection=new JavaExamples(request.current,this.options,actual.facts),files=projection.files(),problems=[...projection.problems];
    for (const file of files) if(snapshot.files.some(current=>current.path===file.path)&&!(this.options.driver&&file.path===projection.driver.path)) problems.push(javaProblem('output-conflict','Existing native test source needs preservation.',file.path));
    if(problems.length) return {problems,deferred:[]};
    const comparison=files.map(file=>({path:file.path,bytes:Buffer.from(file.path===projection.driver.path?projection.driver.comparison(file,snapshot):file.generated),version:hash(Buffer.from(file.generated))}));
    const desired=await analyzeJava({...snapshot,files:[...snapshot.files.filter(file=>!comparison.some(item=>item.path===file.path)),...comparison]},this.options.configFile??'expec.java.json');
    projection.validateFixture(desired.facts);
    if(desired.problems.length||projection.problems.length) return {problems:[...projection.problems,...desired.problems],deferred:[]};
    const additions=files.map(file=>{const bytes=Buffer.from(file.path===projection.driver.path?projection.driver.adopt(file,desired.facts,snapshot):file.generated);return {path:file.path,bytes,version:hash(bytes)};});
    if(projection.driver.problems.length) return {problems:projection.driver.problems,deferred:[]};
    const analyzed=await analyzeJava({...snapshot,files:[...snapshot.files.filter(file=>!additions.some(item=>item.path===file.path)),...additions]},this.options.configFile??'expec.java.json');
    if(analyzed.problems.length || projection.problems.length) return {problems:[...projection.problems,...analyzed.problems],deferred:[]};
    const state=Buffer.from(canonical({format:1,options:this.options,files:files.map(file=>({...file,hash:hash(Buffer.from(file.generated))}))},2)+'\n');
    return success({outputId:this.id,basedOn:snapshot,artifacts:files.flatMap(file=>file.artifacts),changes:[
      ...additions.map(file=>({kind:'write' as const,path:file.path,bytes:file.bytes})),{kind:'write',path:'.expec/outputs/java-acceptance.json',bytes:state},
    ]});
  }
}
