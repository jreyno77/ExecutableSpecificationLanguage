import type { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { OutputContext } from './output.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { ArtifactAssociation, IdentifiedSpecification } from './specification-identity.js';
import type { JavaFile } from './java-declarations.js';
import { javaAcceptanceOptions, javaName, javaProblem } from './java-settings.js';
import type { ProjectSnapshot } from './project-connection.js';
import { JavaTypes, javaRecordBody, javaData } from './java-types.js';
import { JavaMappings } from './java-mappings.js';
import { JavaExpressions } from './java-expressions.js';
import { JavaValueChecks } from './java-value-checks.js';
import { javaSymbol, type JavaFacts } from './java-analysis.js';
import { javaComparison } from './java-comparison.js';
import { JavaTestDriver } from './java-test-driver.js';

type Operation = Item<'setup' | 'action' | 'observation' | 'check'>;
/** Checked operation and scenario facts become native JUnit, DSL and driver declarations. */
export class JavaExamples {
  readonly problems: Diagnostic[] = [];
  readonly obligations: Diagnostic[] = [];
  readonly mappings: JavaMappings;
  private readonly types: JavaTypes;
  private readonly values: JavaExpressions;
  private readonly checks: JavaValueChecks;
  private readonly records = new Map<string,{ item: Item<'record-type-declaration'>; type: string }>();
  private readonly domain: string;
  private readonly fixture: z.infer<typeof javaSymbol> | undefined;
  readonly driver: JavaTestDriver;
  constructor(private readonly current: IdentifiedSpecification, private readonly options: z.infer<typeof javaAcceptanceOptions>, private readonly facts: JavaFacts, sharedTuples:ReadonlyMap<number,string>=new Map(),private readonly snapshot?:ProjectSnapshot,private readonly context?:OutputContext) {
    this.mappings=new JavaMappings(current,options,this.problems);
    this.domain = options.domain[0]!.toUpperCase() + options.domain.slice(1);
    if (options.fixture) {
      const selected = javaSymbol.safeParse(options.fixture.value);
      if (options.fixture.format !== 'java-symbol-1' || !selected.success || selected.data.member
        || !selected.data.type.split('.').every(javaName)) this.problems.push(javaProblem('fixture-mapping-unavailable','Select one actual native Java fixture class.','<options>','fixture'));
      else this.fixture = selected.data;
    }
    this.driver=new JavaTestDriver(current,options,this.domain,facts); this.problems.push(...this.driver.problems);
    this.types = new JavaTypes(current.specification.types,options.package + '.dsl',item => {
      if (item.kind === 'type-parameter') return this.name(item);
      const candidates = current.baseline.artifacts.filter(artifact => artifact.specId === current.id(item.id) && artifact.locator.format === 'java-symbol-1')
        .flatMap(artifact => { const parsed = javaSymbol.safeParse(artifact.locator.value); return parsed.success && !parsed.data.member ? [parsed.data] : []; })
        .filter(at => facts.declarations.some(node => node.file === at.file && node.type === at.type && !node.member
          && (item.kind !== 'record-type-declaration' || (node.contract as { kind?: string }).kind === 'record')));
      const imported = this.mappings.imports.get(current.id(item.id)) ?? (candidates.length === 1 ? candidates[0]!.type : undefined);
      if (!imported) this.problem('missing-native-mapping','Supply the native type used by this test operation.',item);
      if (imported && item.kind === 'record-type-declaration') this.records.set(current.id(item.id),{ item, type: imported });
      return imported ?? 'java.lang.Object';
    },this.problem.bind(this),sharedTuples,(id,expression,path)=>this.checks.value(id,expression,path));
    this.checks=new JavaValueChecks(current.specification.types,this.types,this.fieldName.bind(this));
    this.values=new JavaExpressions(current,this.types,this.name.bind(this),this.fieldName.bind(this),this.problem.bind(this),this.construction.bind(this));
  }
  private construction(type: string, expression: Item): void {
    const nodes=this.facts.declarations.filter(node=>node.type===type),record=nodes.find(node=>!node.member);
    const shape=record?.contract as {kind?:string;initialization?:boolean}|undefined;
    const constructors=nodes.filter(node=>node.member?.kind==='constructor'&&node.parameter===undefined
      &&(node.contract as {canonical?:boolean}).canonical);
    if(shape?.kind==='record'&&shape.initialization===false) {
      if(!constructors.length) return;
      const source=this.snapshot?.files.find(file=>file.path===record!.file),item=[...this.records.values()].find(item=>item.type===type)?.item;
      if(source&&item&&constructors.length===1&&constructors[0]!.syntax?.body) {
        const packageName=type.slice(0,type.lastIndexOf('.')),types=new JavaTypes(this.current.specification.types,packageName,node=>this.name(node),this.problem.bind(this));
        const fields=item.fields.flatMap(field=>field.kind==='field'?[field]:field.kind==='local'&&field.declaration.kind==='field'?[field.declaration]:[]);
        const body=javaRecordBody(fields.map(field=>this.fieldName(field)+' = '+types.value(types.known(this.current.specification.types.typeOf(field.declaredType.id)),this.fieldName(field),JSON.stringify(field.name))+';'));
        const span=constructors[0]!.syntax!.body!,text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(source.bytes);
        const support=nodes.length&&this.facts.declarations.find(node=>node.type===packageName+'.ExpecData'&&!node.member);
        if(text.slice(span.start,span.start+span.length)===body&&support&&this.snapshot!.files.some(file=>file.path===support.file
          &&Buffer.from(file.bytes).equals(Buffer.from('package '+packageName+';\n\n'+javaData()+'\n')))) return;
      }
    }
    this.problem('unsupported-fixture-data','Explicit data construction requires an implicit record constructor or unchanged generated validation without application normalization.',expression);
  }
  private problem(code: string,message: string,item: Item): void { this.problems.push({code,message,at:item.origin,related:[]}); }
  private name(item:Item,fallback?:string):string { return this.mappings.name(item,fallback); }
  private operation(id: NodeId): Operation | undefined {
    const item = this.current.specification.inspection.read(id);
    return item.kind === 'setup' || item.kind === 'action' || item.kind === 'observation' || item.kind === 'check' ? item : undefined;
  }
  private fieldName(field: Item<'field'>): string {
    const claims=this.current.baseline.artifacts.filter(item=>item.specId===this.current.id(field.id)&&item.locator.format==='java-symbol-1')
      .flatMap(item=>{const at=javaSymbol.safeParse(item.locator.value);return at.success&&at.data.member?.kind==='field'?[at.data.member.name]:[];});
    return claims.length===1?claims[0]!:this.name(field);
  }
  private expression(item:Item,receiver:string):string { return this.values.expression(item,receiver); }
  private assertion(item: Item, receiver: string): string {
    if (item.kind === 'binary-expression' && item.operator === '==') return 'ExpecChecks.equal(' + this.expression(item.left,receiver) + ', ' + this.expression(item.right,receiver) + ');';
    return 'org.junit.jupiter.api.Assertions.assertTrue(' + this.expression(item,receiver) + ');';
  }
  private verification(item:Item<'prose-expectation'>):string {
    const message='Verification required: '+item.text.value;
    this.obligations.push({code:'unimplemented-verification',message,at:item.origin,related:[]});
    return 'throw new java.lang.UnsupportedOperationException('+JSON.stringify(message)+');';
  }
  private body(operation: Operation): string {
    if(operation.kind==='check'&&operation.body.kind!=='available') {
      const message='Not implemented: '+operation.name;
      this.obligations.push({code:'implementation-required',message,at:operation.origin,related:[]});
      return 'throw new java.lang.UnsupportedOperationException('+JSON.stringify(message)+');';
    }
    this.values.locals.clear();
    const parameters = operation.parameters.map(item => this.name(item));
    const locals = operation.body.kind === 'available' ? operation.body.content.members.filter(item => item.kind === 'let').map(item => item.name) : [];
    let result = '__expecResult'; while ([...parameters,...locals].includes(result)) result += '_';
    const returnType = this.types.known(this.current.specification.types.callable(operation.id).result);
    const returned = (expression: string): string => returnType.kind === 'value' ? 'var ' + result + ' = ' + expression + ';\n        return '
      + this.types.value(returnType.type,result,JSON.stringify(operation.name + '.result')) + ';' : expression + ';';
    const checks = operation.parameters.map(item => this.name(item) + ' = ' + this.types.value(this.types.known(this.current.specification.types.typeOf(item.declaredType.id)),this.name(item),JSON.stringify(item.name)) + ';');
    const statements = operation.body.kind !== 'available'
      ? [returned('this.driver.' + this.driver.method(operation,this.name(operation)) + '(' + parameters.join(', ') + ')')]
      : operation.body.content.members.map(statement => {
        switch (statement.kind) {
          case 'let': { const expression=this.expression(statement.value,'this.'),type=this.values.type(statement.value); if(type) this.values.locals.set(statement.name,type); return 'var '+this.name(statement)+' = '+expression+';'; }
          case 'assert': return this.assertion(statement.expression,'this.');
          case 'do': return this.expression(statement.expression,'this.') + ';';
          case 'return': return returned(this.values.expression(statement.expression,'this.',returnType.kind==='value'?returnType.type:undefined));
          default: this.problem('unsupported-native-statement','This operation statement cannot be emitted as native Java.',statement); return '';
        }
      });
    return [...checks,...statements].join('\n        ');
  }
  validateFixture(facts: JavaFacts): void {
    if (!this.fixture) return;
    const at = this.fixture, types = facts.declarations.filter(node=>node.file===at.file && node.type===at.type && !node.member);
    if (types.length !== 1 || (types[0]!.contract as {kind?:string}).kind !== 'class') {
      this.problems.push(javaProblem('fixture-mapping-unavailable','Select exactly one native fixture class.',at.file)); return;
    }
    const methods = facts.declarations.filter(node=>node.file===at.file && node.type===at.type && node.member?.kind==='method'
      && node.member.name==='createDriver' && !node.member.static && !node.member.parameters.length && node.parameter===undefined);
    const result = methods.length===1 ? (methods[0]!.contract as {result?:string}).result : undefined;
    if (result !== this.driver.type) this.problems.push(javaProblem('incompatible-driver-factory',
      'Fixture createDriver() must return '+this.driver.type+'; native result is '+(result??'unavailable')+'.',at.file,methods[0]?.start??types[0]!.start));
  }
  private comparison(): string {
    const records: { type: string; fields: { name: string; expression: string }[] }[] = [];
    for (const { item: record, type } of this.records.values()) {
      const fields = record.fields.flatMap(item => item.kind === 'field' ? [item] : item.kind === 'local' && item.declaration.kind === 'field' ? [item.declaration] : []);
      const native = this.facts.declarations.filter(node => node.type === type);
      if (!native.some(node => !node.member && (node.contract as { kind?: string }).kind === 'record')) {
        this.problem('unsupported-comparison-data','Only verified native record data can be compared.',record); continue;
      }
      const components = fields.map(field => {
        const nativeType=this.types.of(field.declaredType).replace(/\s/g,'');
        const claimed = this.current.baseline.artifacts.filter(item => item.specId === this.current.id(field.id) && item.locator.format === 'java-symbol-1')
          .flatMap(item => { const at = javaSymbol.safeParse(item.locator.value); return at.success && at.data.type === type && at.data.member?.kind === 'field' ? [at.data.member.name] : []; });
        const name = claimed.length === 1 ? claimed[0]! : this.name(field);
        const accessor = native.filter(node => node.member?.kind === 'method' && node.member.name === name && !node.member.parameters.length && node.parameter === undefined);
        if (accessor.length !== 1 || accessor[0]!.syntax?.body) this.problem('unsupported-comparison-data','A handwritten accessor cannot define data comparison.',field);
        const slot=native.filter(node=>node.member?.kind==='field'&&node.member.name===name);
        if(slot.length!==1||(slot[0]!.contract as {type?:string}).type?.replace(/\s/g,'')!==nativeType
          ||(accessor[0]?.contract as {result?:string}|undefined)?.result?.replace(/\s/g,'')!==nativeType)
          this.problem('native-contract-conflict','The native record field must retain its checked type.',field);
        return {name:field.name,expression:'item.'+name+'()'};
      });
      if (native.filter(node => node.member?.kind === 'field').length !== components.length)
        this.problem('unsupported-comparison-data','The native record contains additional data beyond the checked components.',record);
      records.push({ type, fields: components });
    }
    return javaComparison(records,[...this.types.tuples].map(arity=>({type:this.types.tuple(arity),arity})),this.checks.source());
  }
  files(): JavaFile[] {
    const inspection = this.current.specification.inspection, files: JavaFile[] = [], operations: Operation[] = [];
    const workspace=new Set([this.current.baseline.entry,...this.context?.workspaceModules??[]]);
    const groups = [...inspection.query('examples')].filter(item => item.origin.kind === 'source'&&workspace.has(item.origin.module));
    for (const group of groups) for (const item of group.members) { const operation = this.operation(item.id); if (operation) operations.push(operation); }
    const file = (layer: string,name: string,text: string,artifacts: ArtifactAssociation[]): JavaFile => ({path:(this.options.testRoot ?? 'src/test/java') + '/' + this.options.package.replaceAll('.','/') + '/' + layer + '/' + name + '.java',generated:'package ' + this.options.package + '.' + layer + ';\n\n' + text + '\n',artifacts});
    const artifacts = (item: Item,layer: string,type: string,member?: object): ArtifactAssociation => ({specId:this.current.id(item.id),locator:{outputId:'java-acceptance',format:'java-symbol-1',value:{file:(this.options.testRoot ?? 'src/test/java')+'/'+this.options.package.replaceAll('.','/')+'/'+layer+'/'+type+'.java',type:this.options.package+'.'+layer+'.'+type,...member ? {member} : {}} as ArtifactAssociation['locator']['value']}});
    const signatures = new Set<string>(), driver: string[] = [], dsl: string[] = [], driverArtifacts: ArtifactAssociation[] = [], dslArtifacts: ArtifactAssociation[] = [];
    for (const operation of operations) {
      const bindings=new Set<string>();
      for(const item of [...operation.parameters,...operation.body.kind==='available' ? operation.body.content.members.filter(item=>item.kind==='let') : []]) {
        const name=this.name(item); if(bindings.has(name)) this.problem('native-name-conflict','Distinct parameters and locals need distinct native bindings.',item); bindings.add(name);
      }
      const name = this.name(operation), parameters = operation.parameters.map(item => this.types.of(item.declaredType) + ' ' + this.name(item)).join(', ');
      const erased = operation.parameters.map(item => this.types.erased(this.types.known(this.current.specification.types.typeOf(item.declaredType.id)),item));
      const key = name + '(' + erased.join(',') + ')';
      if (signatures.has(key)) this.problem('native-name-conflict','Test operations need distinct native signatures in this domain.',operation); signatures.add(key);
      const member = {kind:'method',name,parameters:erased,static:false}, result = operation.returnType ? this.types.of(operation.returnType) : 'void';
      if (operation.body.kind !== 'available'&&operation.kind!=='check') {
        const nativeName=this.driver.method(operation,name);
        driver.push('public ' + result + ' ' + nativeName + '(' + parameters + ') { throw new java.lang.UnsupportedOperationException(' + JSON.stringify('Not implemented: '+operation.name) + '); }');
        driverArtifacts.push(artifacts(operation,'driver',this.domain+'Driver',{...member,name:nativeName}));
      }
      dsl.push('public ' + result + ' ' + name + '(' + parameters + ') {\n        ' + this.body(operation) + '\n    }');
      dslArtifacts.push(artifacts(operation,'dsl',this.domain,member));
    }
    const fixtures: string[]=[],visited=new Set<NodeId>(),fixtureNames=new Set<string>(['driver']);
    const fixture=(item:Item<'fixture'>):void=>{
      if(visited.has(item.id)) return; visited.add(item.id);
      const dependencies=(node:Item):void=>{
        if(node.kind==='reference'&&node.resolution.status==='bound') { const target=inspection.read(node.resolution.target); if(target.kind==='fixture') fixture(target); }
        for(const child of inspection.children(node.id)) dependencies(child);
      };
      dependencies(item.value); const name=this.name(item);
      if(fixtureNames.has(name)) this.problem('native-name-conflict','Fixture data needs distinct native fields in this domain.',item); fixtureNames.add(name);
      const type=this.types.known(this.current.specification.types.typeOf(item.declaredType.id));
      fixtures.push('public final '+this.types.name(type,item)+' '+name+' = '+this.values.expression(item.value,'this.',type)+';');
      dslArtifacts.push(artifacts(item,'dsl',this.domain,{kind:'field',name,static:false}));
    };
    this.values.locals.clear(); for(const group of groups) for(const item of group.members) if(item.kind==='fixture') fixture(item);
    files.push(this.driver.template({path:this.driver.path,generated:'    '+driver.join('\n    '),artifacts:driverArtifacts}));
    files.push(file('dsl',this.domain,'public class '+this.domain+' {\n    private final '+this.driver.type+' driver;\n    public '+this.domain+'('+this.driver.type+' driver) { this.driver=driver; }\n    '+fixtures.join('\n    ')+'\n    '+dsl.join('\n    ')+'\n}',dslArtifacts));
    const names = new Set<string>();
    for (const group of groups) {
      const name = this.name(group,'Examples');
      if (names.has(name)) this.problem('native-name-conflict','Multiple example groups need explicit durable names.',group); names.add(name);
      const associated: ArtifactAssociation[] = [artifacts(group,'acceptance',name)], methods: string[] = [], methodsSeen = new Set<string>();
      for (const item of group.members) if (item.kind === 'scenario' || item.kind === 'example') {
        const method = this.name(item,'scenario'+Buffer.from(this.current.id(item.id)).toString('hex'));
        if (methodsSeen.has(method)) this.problem('native-name-conflict','Each scenario needs a distinct native method.',item); methodsSeen.add(method);
        associated.push(artifacts(item,'acceptance',name,{kind:'method',name:method,parameters:[],static:false}));
        this.values.locals.clear();
        const receiver='this.'+this.options.domain+'.';
        const steps = item.kind === 'scenario' ? item.steps.map(step => {
          this.values.locals.clear();
          for(const capture of this.current.specification.step(step.id).value!.available)
            this.values.locals.set(inspection.read(capture.name,'name').decoded,capture.type);
          if('capture' in step&&step.capture&&!javaName(step.capture.decoded))
            this.problem('invalid-native-name','The ordered capture needs a valid native Java binding.',step);

          if (step.content.kind === 'prose-expectation') return this.verification(step.content);
          if (step.kind === 'then') {
            const call = step.content.kind === 'call-expression' ? this.current.specification.call(step.content.id).value : undefined;
            return call && this.operation(call)?.kind === 'check' ? this.expression(step.content,receiver)+';' : this.assertion(step.content,receiver);
          }
          return (step.capture ? 'var '+step.capture.decoded+' = ' : '')+this.expression(step.content,receiver)+';';
        }) : item.expected.kind === 'prose-expectation' ? [(item.actual.kind==='call-expression'?'':'var __expecActual = ')+this.expression(item.actual,receiver)+';',this.verification(item.expected)] : ['ExpecChecks.equal('+this.expression(item.actual,receiver)+', '+this.values.expression(item.expected,receiver,this.values.type(item.actual))+');'];
        methods.push('@org.junit.jupiter.api.Test\n    @org.junit.jupiter.api.DisplayName('+JSON.stringify(item.title.value)+')\n    public void '+method+'() {\n        '+steps.join('\n        ')+'\n    }');
      }
      const domain = this.options.package+'.dsl.'+this.domain;
      const setup = this.fixture ? 'private '+domain+' '+this.options.domain+';\n    @org.junit.jupiter.api.BeforeEach\n    void __expecCreateDomain() { '+this.options.domain+' = new '+domain+'(createDriver()); }'
        : 'private final '+domain+' '+this.options.domain+' = new '+domain+'(new '+this.driver.type+'());';
      if (this.fixture && methodsSeen.has('__expecCreateDomain')) this.problem('native-name-conflict','The selected test method conflicts with native fixture initialization.',group);
      files.push(file('acceptance',name,'import '+this.options.package+'.dsl.ExpecChecks;\n\n@org.junit.jupiter.api.TestInstance(org.junit.jupiter.api.TestInstance.Lifecycle.PER_METHOD)\npublic class '+name
        +(this.fixture?' extends '+this.fixture.type:'')+' {\n    '+setup+'\n    '+methods.join('\n    ')+'\n}',associated));
    }
    files.push(file('dsl','ExpecChecks',this.comparison(),[]), ...this.types.support().map(item => file('dsl',item.name,item.text,[]))); this.problems.push(...this.driver.problems); return files;
  }
}
