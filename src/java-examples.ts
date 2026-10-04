import type { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { NodeId } from './model.js';
import type { ArtifactAssociation, IdentifiedSpecification } from './specification-identity.js';
import type { JavaFile } from './java-declarations.js';
import { javaAcceptanceOptions, javaName, javaProblem } from './java-settings.js';
import { JavaTypes } from './java-types.js';
import { canonical } from './identity-baseline.js';
import { decimal } from './decimal.js';
import { javaSymbol, type JavaFacts } from './java-analysis.js';
import { javaComparison } from './java-comparison.js';
import { JavaTestDriver } from './java-test-driver.js';

type Operation = Item<'setup' | 'action' | 'observation' | 'check'>;
/** Checked operation and scenario facts become native JUnit, DSL and driver declarations. */
export class JavaExamples {
  readonly problems: Diagnostic[] = [];
  private readonly names = new Map<string,string>();
  private readonly imports = new Map<string,string>();
  private readonly types: JavaTypes;
  private readonly records = new Map<string,{ item: Item<'record-type-declaration'>; type: string }>();
  private readonly domain: string;
  private readonly fixture: z.infer<typeof javaSymbol> | undefined;
  readonly driver: JavaTestDriver;
  constructor(private readonly current: IdentifiedSpecification, private readonly options: z.infer<typeof javaAcceptanceOptions>, private readonly facts: JavaFacts) {
    this.domain = options.domain[0]!.toUpperCase() + options.domain.slice(1);
    if (options.fixture) {
      const selected = javaSymbol.safeParse(options.fixture.value);
      if (options.fixture.format !== 'java-symbol-1' || !selected.success || selected.data.member
        || !selected.data.type.split('.').every(javaName)) this.problems.push(javaProblem('fixture-mapping-unavailable','Select one actual native Java fixture class.','<options>','fixture'));
      else this.fixture = selected.data;
    }
    this.driver=new JavaTestDriver(current,options,this.domain,facts); this.problems.push(...this.driver.problems);
    for (const mapping of options.names ?? []) {
      const matches = current.baseline.elements.filter(record => 'id' in mapping ? record.id === mapping.id
        : (!mapping.module || record.address.module === mapping.module) && canonical(this.path(record.id)) === canonical(mapping.declaration));
      if (matches.length !== 1 || this.names.has(matches[0]!.id)) throw new TypeError('Java name mapping needs one distinct checked declaration.');
      this.names.set(matches[0]!.id,mapping.name);
    }
    for (const mapping of options.imports ?? []) {
      const matches = current.baseline.elements.filter(record => record.address.module === mapping.module && canonical(this.path(record.id)) === canonical(mapping.declaration));
      if (matches.length !== 1 || this.imports.has(matches[0]!.id)) throw new TypeError('Java import mapping needs one distinct checked declaration.');
      this.imports.set(matches[0]!.id,mapping.name);
    }
    this.types = new JavaTypes(current.specification.types,options.package + '.dsl',item => {
      if (item.kind === 'type-parameter') return this.name(item);
      const candidates = current.baseline.artifacts.filter(artifact => artifact.specId === current.id(item.id) && artifact.locator.format === 'java-symbol-1')
        .flatMap(artifact => { const parsed = javaSymbol.safeParse(artifact.locator.value); return parsed.success && !parsed.data.member ? [parsed.data] : []; })
        .filter(at => facts.declarations.some(node => node.file === at.file && node.type === at.type && !node.member
          && (item.kind !== 'record-type-declaration' || (node.contract as { kind?: string }).kind === 'record')));
      const imported = this.imports.get(current.id(item.id)) ?? (candidates.length === 1 ? candidates[0]!.type : undefined);
      if (!imported) this.problem('missing-native-mapping','Supply the native type used by this test operation.',item);
      if (imported && item.kind === 'record-type-declaration') this.records.set(current.id(item.id),{ item, type: imported });
      return imported ?? 'java.lang.Object';
    },this.problem.bind(this));
  }
  private path(id: string): string[] { const item = this.current.baseline.elements.find(item => item.id === id)!; return [...item.address.owner ? this.path(item.address.owner) : [],item.address.name ?? '']; }
  private problem(code: string,message: string,item: Item): void { this.problems.push({code,message,at:item.origin,related:[]}); }
  private name(item: Item, fallback?: string): string {
    const name = (item.kind === 'let' ? undefined : this.names.get(this.current.id(item.id))) ?? ('name' in item ? item.name : fallback ?? item.kind);
    if (!javaName(name)) this.problem('invalid-native-name','Provide an explicit Java name for this authored declaration.',item);
    return name;
  }
  private operation(id: NodeId): Operation | undefined {
    const item = this.current.specification.inspection.read(id);
    return item.kind === 'setup' || item.kind === 'action' || item.kind === 'observation' || item.kind === 'check' ? item : undefined;
  }
  private expression(item: Item, receiver: string): string {
    const expression = (item: Item) => this.expression(item,receiver);
    switch (item.kind) {
      case 'string-literal': return JSON.stringify(item.value);
      case 'boolean-literal': return String(item.value);
      case 'number-literal': {
        const value = Number(item.token);
        if (!Number.isFinite(value) || decimal(item.token) !== decimal(String(value))) this.problem('unsupported-native-number','Java double cannot preserve this literal.',item);
        return Number.isInteger(value) ? value.toFixed(1) : String(value);
      }
      case 'grouped-expression': return '(' + expression(item.inner) + ')';
      case 'unary-expression': return item.operator === 'not' ? '!(' + expression(item.operand) + ')'
        : 'ExpecChecks.number(' + item.operator + expression(item.operand) + ')';
      case 'name-expression': {
        if (item.reference.resolution.status === 'bound') {
          const declaration = this.current.specification.inspection.read(item.reference.resolution.target);
          if (declaration.kind === 'parameter') return this.name(declaration);
        }
        return item.reference.segments.join('.');
      }
      case 'call-expression': {
        const called = this.current.specification.call(item.id).value, operation = called && this.operation(called);
        if (!operation) { this.problem('unsupported-native-call','This call needs an explicit compatible native operation.',item); return 'null'; }
        return receiver + this.name(operation) + '(' + item.arguments.map(expression).join(', ') + ')';
      }
      case 'binary-expression': {
        if (item.operator === '==' || item.operator === '!=') return (item.operator === '!=' ? '!' : '') + 'ExpecChecks.same(' + expression(item.left) + ', ' + expression(item.right) + ')';
        const operator = item.operator === 'and' ? '&&' : item.operator === 'or' ? '||' : item.operator;
        const value = '(' + expression(item.left) + ' ' + operator + ' ' + expression(item.right) + ')';
        return ['+','-','*','/','%'].includes(operator) ? 'ExpecChecks.number(' + value + ')' : value;
      }
      default: this.problem('unsupported-native-expression','This checked expression needs a supported native Java representation.',item); return 'null';
    }
  }
  private assertion(item: Item, receiver: string): string {
    if (item.kind === 'binary-expression' && item.operator === '==') return 'ExpecChecks.equal(' + this.expression(item.left,receiver) + ', ' + this.expression(item.right,receiver) + ');';
    return 'org.junit.jupiter.api.Assertions.assertTrue(' + this.expression(item,receiver) + ');';
  }
  private body(operation: Operation): string {
    const parameters = operation.parameters.map(item => this.name(item));
    const locals = operation.body.kind === 'available' ? operation.body.content.members.filter(item => item.kind === 'let').map(item => item.name) : [];
    let result = '__expecResult'; while ([...parameters,...locals].includes(result)) result += '_';
    const returnType = this.types.known(this.current.specification.types.callable(operation.id).result);
    const returned = (expression: string): string => returnType.kind === 'value' ? 'var ' + result + ' = ' + expression + ';\n        return '
      + this.types.value(returnType.type,result,JSON.stringify(operation.name + '.result')) + ';' : expression + ';';
    const checks = operation.parameters.map(item => this.name(item) + ' = ' + this.types.value(this.types.known(this.current.specification.types.typeOf(item.declaredType.id)),this.name(item),JSON.stringify(item.name)) + ';');
    const statements = operation.body.kind !== 'available'
      ? [returned('driver.' + this.driver.method(operation,this.name(operation)) + '(' + parameters.join(', ') + ')')]
      : operation.body.content.members.map(statement => {
        switch (statement.kind) {
          case 'let': return 'var ' + this.name(statement) + ' = ' + this.expression(statement.value,'this.') + ';';
          case 'assert': return this.assertion(statement.expression,'this.');
          case 'do': return this.expression(statement.expression,'this.') + ';';
          case 'return': return returned(this.expression(statement.expression,'this.'));
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
    const records: { type: string; fields: { name: string; accessor: string }[] }[] = [];
    for (const { item: record, type } of this.records.values()) {
      const fields = record.fields.flatMap(item => item.kind === 'field' ? [item] : item.kind === 'local' && item.declaration.kind === 'field' ? [item.declaration] : []);
      const native = this.facts.declarations.filter(node => node.type === type);
      if (!native.some(node => !node.member && (node.contract as { kind?: string }).kind === 'record')) {
        this.problem('unsupported-comparison-data','Only verified native record data can be compared.',record); continue;
      }
      const components = fields.map(field => {
        this.types.of(field.declaredType);
        const claimed = this.current.baseline.artifacts.filter(item => item.specId === this.current.id(field.id) && item.locator.format === 'java-symbol-1')
          .flatMap(item => { const at = javaSymbol.safeParse(item.locator.value); return at.success && at.data.type === type && at.data.member?.kind === 'field' ? [at.data.member.name] : []; });
        const name = claimed.length === 1 ? claimed[0]! : this.name(field);
        const accessor = native.filter(node => node.member?.kind === 'method' && node.member.name === name && !node.member.parameters.length && node.parameter === undefined);
        if (accessor.length !== 1 || accessor[0]!.syntax?.body) this.problem('unsupported-comparison-data','A handwritten accessor cannot define data comparison.',field);
        return { name: field.name, accessor: name };
      });
      if (native.filter(node => node.member?.kind === 'field').length !== components.length)
        this.problem('unsupported-comparison-data','The native record contains additional data beyond the checked components.',record);
      records.push({ type, fields: components });
    }
    return javaComparison(records);
  }
  files(): JavaFile[] {
    const inspection = this.current.specification.inspection, files: JavaFile[] = [], operations: Operation[] = [];
    const groups = [...inspection.query('examples')].filter(item => item.origin.kind === 'source');
    for (const group of groups) for (const item of group.members) { const operation = this.operation(item.id); if (operation) operations.push(operation); }
    const file = (layer: string,name: string,text: string,artifacts: ArtifactAssociation[]): JavaFile => ({path:(this.options.testRoot ?? 'src/test/java') + '/' + this.options.package.replaceAll('.','/') + '/' + layer + '/' + name + '.java',generated:'package ' + this.options.package + '.' + layer + ';\n\n' + text + '\n',artifacts});
    const artifacts = (item: Item,layer: string,type: string,member?: object): ArtifactAssociation => ({specId:this.current.id(item.id),locator:{outputId:'java-acceptance',format:'java-symbol-1',value:{file:(this.options.testRoot ?? 'src/test/java')+'/'+this.options.package.replaceAll('.','/')+'/'+layer+'/'+type+'.java',type:this.options.package+'.'+layer+'.'+type,...member ? {member} : {}} as ArtifactAssociation['locator']['value']}});
    const signatures = new Set<string>(), driver: string[] = [], dsl: string[] = [], driverArtifacts: ArtifactAssociation[] = [], dslArtifacts: ArtifactAssociation[] = [];
    for (const operation of operations) {
      const name = this.name(operation), parameters = operation.parameters.map(item => this.types.of(item.declaredType) + ' ' + this.name(item)).join(', ');
      const erased = operation.parameters.map(item => this.types.erased(this.types.known(this.current.specification.types.typeOf(item.declaredType.id)),item));
      const key = name + '(' + erased.join(',') + ')';
      if (signatures.has(key)) this.problem('native-name-conflict','Test operations need distinct native signatures in this domain.',operation); signatures.add(key);
      const member = {kind:'method',name,parameters:erased,static:false}, result = operation.returnType ? this.types.of(operation.returnType) : 'void';
      if (operation.body.kind !== 'available') {
        const nativeName=this.driver.method(operation,name);
        driver.push('public ' + result + ' ' + nativeName + '(' + parameters + ') { throw new java.lang.UnsupportedOperationException(' + JSON.stringify('Not implemented: '+operation.name) + '); }');
        driverArtifacts.push(artifacts(operation,'driver',this.domain+'Driver',{...member,name:nativeName}));
      }
      dsl.push('public ' + result + ' ' + name + '(' + parameters + ') {\n        ' + this.body(operation) + '\n    }');
      dslArtifacts.push(artifacts(operation,'dsl',this.domain,member));
    }
    files.push(this.driver.template({path:this.driver.path,generated:'    '+driver.join('\n    '),artifacts:driverArtifacts}));
    files.push(file('dsl',this.domain,'public class '+this.domain+' {\n    private final '+this.driver.type+' driver;\n    public '+this.domain+'('+this.driver.type+' driver) { this.driver=driver; }\n    '+dsl.join('\n    ')+'\n}',dslArtifacts));
    const names = new Set<string>();
    for (const group of groups) {
      const name = this.name(group,'Examples');
      if (names.has(name)) this.problem('native-name-conflict','Multiple example groups need explicit durable names.',group); names.add(name);
      const associated: ArtifactAssociation[] = [artifacts(group,'acceptance',name)], methods: string[] = [], methodsSeen = new Set<string>();
      for (const item of group.members) if (item.kind === 'scenario' || item.kind === 'example') {
        const method = this.name(item,'scenario'+Buffer.from(this.current.id(item.id)).toString('hex'));
        if (methodsSeen.has(method)) this.problem('native-name-conflict','Each scenario needs a distinct native method.',item); methodsSeen.add(method);
        associated.push(artifacts(item,'acceptance',name,{kind:'method',name:method,parameters:[],static:false}));
        const steps = item.kind === 'scenario' ? item.steps.map(step => {
          if (step.content.kind === 'prose-expectation') { this.problem('unbound-expectation','A prose expectation remains an implementation obligation.',step); return ''; }
          if (step.kind === 'then') {
            const call = step.content.kind === 'call-expression' ? this.current.specification.call(step.content.id).value : undefined;
            return call && this.operation(call)?.kind === 'check' ? this.expression(step.content,this.options.domain+'.')+';' : this.assertion(step.content,this.options.domain+'.');
          }
          return (step.capture ? 'var '+step.capture.decoded+' = ' : '')+this.expression(step.content,this.options.domain+'.')+';';
        }) : item.expected.kind === 'prose-expectation' ? [] : ['ExpecChecks.equal('+this.expression(item.actual,this.options.domain+'.')+', '+this.expression(item.expected,this.options.domain+'.')+');'];
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
