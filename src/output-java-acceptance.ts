import type { OutputRegistration, OutputAdapter, OutputRequest, OutputPlan, OutputContext } from './output.js';
import type { ProjectSnapshot } from './project-connection.js';
import type { Check, Diagnostic } from './checking.js';
import type { FileChange } from './project-writer.js';
import type { JavaFile } from './java-declarations.js';
import { JavaPreservation, type JavaBaseline } from './java-preservation.js';
import type { z } from 'zod';
import { canonical, failure, success } from './identity-baseline.js';
import { JavaProject } from './java-project.js';
import { javaAcceptanceOptions, javaProblem, optionProblems } from './java-settings.js';
import { JavaExamples } from './java-examples.js';
import { analyzeJava } from './java-analysis.js';
import { hash } from './project-files.js';
import { validDiff } from './output-contract.js';
import { readJavaOutputState, javaTupleTypes } from './java-output-state.js';
import type { JavaMappingState } from './java-mappings.js';

export const javaAcceptanceOutput: OutputRegistration = {
  id:'java-acceptance', validate:value=>optionProblems(javaAcceptanceOptions,value),
  open:(options,context)=>new JavaAcceptanceOutput(javaAcceptanceOptions.parse(options),context),
};
class JavaAcceptanceOutput implements OutputAdapter {
  readonly id='java-acceptance';
  constructor(private readonly options:z.infer<typeof javaAcceptanceOptions>,private readonly context?:OutputContext) {}
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
    if(request.operation==='insert' && (request.diff.contextChanged || request.diff.changes.some(change=>change.kinds.some(kind=>kind!=='add'&&kind!=='artifacts'))))
      return failure('not-addition-only','Use update for existing test contracts.');
    const actual=await analyzeJava(snapshot,this.options.configFile??'expec.java.json');
    const prerequisites=actual.problems.filter(problem=>!problem.code.startsWith('java-'));
    if(prerequisites.length) return {problems:prerequisites,deferred:[]};
    const shared=javaTupleTypes(snapshot); if(shared.problems.length) return {problems:shared.problems,deferred:[]};
    const projection=new JavaExamples(request.current,this.options,actual.facts,shared.tuples,snapshot,this.context),files=projection.files(); projection.mappings.check(stored.value?.mappings); const problems=[...projection.problems];
    if(stored.value) return this.update(stored.value.files,files,projection,snapshot);
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
    const baselines=files.map(file=>({...file,hash:hash(Buffer.from(file.generated)),renderedArtifacts:structuredClone(file.artifacts),adopted:file.path===projection.driver.path&&this.options.driver
      ? file.artifacts.filter(item=>request.current.baseline.artifacts.some(prior=>prior.specId===item.specId&&canonical(prior.locator)===canonical(item.locator))).map(item=>item.specId) : []}));
    return this.changed(snapshot,baselines,additions.map(file=>({kind:'write',path:file.path,bytes:file.bytes})),projection.mappings.capture(),projection.obligations);
  }
  private async update(previous: readonly JavaBaseline[],desired: readonly JavaFile[],projection: JavaExamples,snapshot: ProjectSnapshot): Promise<Check<OutputPlan>> {
    const driver=projection.driver.path,problems=[...projection.problems];
    for(const record of previous.filter(file=>file.path!==driver)) {
      const actual=snapshot.files.find(file=>file.path===record.path);
      if(!actual||!Buffer.from(actual.bytes).equals(Buffer.from(record.generated))) problems.push(javaProblem('generated-test-drift',
        'The generated test module was changed or removed; restore its reviewed generated bytes before regenerating.',record.path));
    }
    for(const file of desired) if(!previous.some(record=>record.path===file.path)&&snapshot.files.some(record=>record.path===file.path))
      problems.push(javaProblem('output-conflict','This native test file is not owned by the output.',file.path));
    if(problems.length) return {problems,deferred:[]};
    const preservation=new JavaPreservation(snapshot,this.options.configFile??'expec.java.json');
    const retained=await preservation.update(previous.filter(file=>file.path===driver),desired.filter(file=>file.path===driver));
    if(preservation.problems.length) return {problems:preservation.problems,deferred:[]};
    const changes=new Map(retained.changes.map(change=>[change.path,change]));
    for(const file of previous) if(file.path!==driver&&!desired.some(next=>next.path===file.path)) changes.set(file.path,{kind:'remove',path:file.path});
    for(const file of desired) if(file.path!==driver) changes.set(file.path,{kind:'write',path:file.path,bytes:Buffer.from(file.generated)});
    const planned={...snapshot,files:[...snapshot.files.filter(file=>!changes.has(file.path)),...Array.from(changes.values()).flatMap(change=>change.kind==='write'
      ? [{path:change.path,bytes:change.bytes,version:hash(change.bytes)}] : [])]};
    const final=await analyzeJava(planned,this.options.configFile??'expec.java.json'); projection.validateFixture(final.facts);
    if(final.problems.length||projection.problems.length) return {problems:[...projection.problems,...final.problems],deferred:[]};
    const files=desired.map(file=>file.path===driver ? retained.files.find(record=>record.path===driver)! : {...file,hash:hash(Buffer.from(file.generated)),renderedArtifacts:structuredClone(file.artifacts),adopted:[]});
    return this.changed(snapshot,files,[...changes.values()],projection.mappings.capture(),projection.obligations);
  }
  private changed(snapshot: ProjectSnapshot,files: readonly JavaBaseline[],changes: readonly FileChange[],mappings:JavaMappingState,obligations:readonly Diagnostic[]=[]): Check<OutputPlan> {
    const state=Buffer.from(canonical({format:1,options:this.options,files,mappings},2)+'\n');
    return success({outputId:this.id,basedOn:snapshot,...obligations.length?{obligations}:{},artifacts:files.flatMap(file=>file.artifacts),changes:[...changes,
      {kind:'write' as const,path:'.expec/outputs/java-acceptance.json',bytes:state}].filter(change=>change.kind!=='write'
        ||!snapshot.files.some(file=>file.path===change.path&&Buffer.from(file.bytes).equals(Buffer.from(change.bytes))))});
  }

}
