import type { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { IdentifiedSpecification } from './specification-identity.js';
import type { JavaFile } from './java-declarations.js';
import type { ProjectSnapshot } from './project-connection.js';
import { javaSymbol, type JavaFacts } from './java-analysis.js';
import { javaAcceptanceOptions, javaName, javaProblem } from './java-settings.js';
import { canonical } from './identity-baseline.js';

type Symbol = z.infer<typeof javaSymbol>;
/** Explicit operation associations authorize adoption within one native driver class. */
export class JavaTestDriver {
  readonly problems: Diagnostic[] = [];
  readonly type: string;
  readonly path: string;
  private readonly selected: Symbol | undefined;
  constructor(private readonly current: IdentifiedSpecification, options: z.infer<typeof javaAcceptanceOptions>, domain: string, private readonly facts: JavaFacts) {
    this.type=options.package+'.driver.'+domain+'Driver';
    this.path=(options.testRoot??'src/test/java')+'/'+this.type.replaceAll('.','/')+'.java';
    if(!options.driver) return;
    const parsed=javaSymbol.safeParse(options.driver.value);
    if(options.driver.format!=='java-symbol-1'||!parsed.success||parsed.data.member||parsed.data.parameter!==undefined||!parsed.data.type.split('.').every(javaName)) {
      this.problems.push(javaProblem('driver-mapping-unavailable','Select one actual native Java driver class.','<options>','driver')); return;
    }
    this.selected=parsed.data; this.type=parsed.data.type; this.path=parsed.data.file;
    if(!options.adoptExisting) this.problems.push(javaProblem('native-mapping-required','Creating tests over an existing driver needs explicit adoption.',this.path));
    const classes=facts.declarations.filter(node=>node.file===this.path&&node.type===this.type&&!node.member);
    if(classes.length!==1||(classes[0]!.contract as {kind?:string}).kind!=='class')
      this.problems.push(javaProblem('driver-mapping-unavailable','Select exactly one actual native driver class.',this.path));
  }
  private mappings(id: string) {
    return this.current.baseline.artifacts.filter(item=>item.specId===id&&item.locator.outputId==='java-acceptance'&&item.locator.format==='java-symbol-1')
      .flatMap(item=>{const parsed=javaSymbol.safeParse(item.locator.value);return parsed.success&&parsed.data.file===this.path&&parsed.data.type===this.type&&parsed.data.member?.kind==='method'&&parsed.data.parameter===undefined?[parsed.data]:[];});
  }
  method(operation: Item, fallback: string): string {
    const mappings=this.mappings(this.current.id(operation.id));
    if(mappings.length>1) this.problems.push(javaProblem('ambiguous-native-symbol','This operation has multiple driver mappings.',this.path));
    return mappings.length===1 ? (mappings[0]!.member as {name:string}).name : fallback;
  }
  template(file: JavaFile): JavaFile {
    const name=this.type.split('.').at(-1)!,pkg=this.type.slice(0,-name.length-1);
    return {...file,path:this.path,generated:'package '+pkg+';\n\npublic class '+name+' {\n'+file.generated+'\n}\n',
      artifacts:file.artifacts.map(item=>({...item,locator:{...item.locator,value:{...(item.locator.value as object),file:this.path,type:this.type}}}))};
  }
  comparison(file: JavaFile,snapshot: ProjectSnapshot): string {
    if(!this.selected) return file.generated;
    const node=this.facts.declarations.find(node=>node.file===this.path&&node.type===this.type&&!node.member), source=snapshot.files.find(item=>item.path===this.path);
    if(!node||!source) return file.generated;
    const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(source.bytes),start=file.generated.indexOf('public class');
    return text.slice(0,node.nodeStart)+file.generated.slice(start).trimEnd()+text.slice(node.nodeStart+node.nodeLength);
  }
  adopt(file: JavaFile,expected: JavaFacts,snapshot: ProjectSnapshot): string {
    if(!this.selected) return file.generated;
    const owner=this.facts.declarations.find(node=>node.file===this.path&&node.type===this.type&&!node.member), source=snapshot.files.find(item=>item.path===this.path);
    if(!owner||!source) return file.generated;
    const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(source.bytes), comparison=this.comparison(file,snapshot), added:string[]=[];
    for(const artifact of file.artifacts) {
      const at=javaSymbol.parse(artifact.locator.value), mappings=this.mappings(artifact.specId);
      const found=this.facts.declarations.filter(node=>node.file===this.path&&node.type===this.type&&canonical(node.member)===canonical(at.member)&&node.parameter===undefined);
      const wanted=expected.declarations.filter(node=>node.file===this.path&&node.type===this.type&&canonical(node.member)===canonical(at.member)&&node.parameter===undefined);
      if(mappings.length) {
        if(mappings.length!==1||found.length!==1||wanted.length!==1||canonical(mappings[0]!.member)!==canonical(at.member)||canonical(found[0]!.contract)!==canonical(wanted[0]!.contract))
          this.problems.push(javaProblem('native-contract-conflict','The mapped driver method must match this exact checked signature.',this.path,found[0]?.start??owner.start));
      } else if(found.length) this.problems.push(javaProblem('native-mapping-required','An existing same-named method needs an explicit operation association.',this.path,found[0]!.start));
      else if(wanted.length!==1) this.problems.push(javaProblem('native-contract-conflict','The generated driver operation has no unique native signature.',this.path));
      else added.push(comparison.slice(wanted[0]!.nodeStart,wanted[0]!.nodeStart+wanted[0]!.nodeLength));
    }
    const close=owner.nodeStart+owner.nodeLength-1;
    return added.length ? text.slice(0,close)+'\n    '+added.join('\n    ')+'\n'+text.slice(close) : text;
  }
}
