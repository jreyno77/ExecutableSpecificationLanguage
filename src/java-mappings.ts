import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { Item } from './inspection-item.js';
import type { IdentifiedSpecification } from './specification-identity.js';
import { canonical, identifier } from './identity-baseline.js';
import { javaName, javaOptions, javaProblem } from './java-settings.js';

export const javaMappingState=z.strictObject({
  names:z.array(z.strictObject({id:identifier,name:z.string().refine(javaName),explicit:z.boolean()})),
  imports:z.array(z.strictObject({id:identifier,name:z.string().min(1)})),
});
export type JavaMappingState=z.infer<typeof javaMappingState>;
/** Resolve readable options once and retain the actual names chosen for durable subjects. */
export class JavaMappings {
  private readonly names=new Map<string,string>();
  readonly imports=new Map<string,string>();
  private readonly effective=new Map<string,string>();
  constructor(private readonly current:IdentifiedSpecification,options:Pick<z.infer<typeof javaOptions>,'names'|'imports'>,private readonly problems:Diagnostic[]) {
    const path=(id:string):string[]=>{const item=current.baseline.elements.find(item=>item.id===id)!;return [...item.address.owner?path(item.address.owner):[],item.address.name??''];};
    for(const kind of ['names','imports'] as const) for(const [index,mapping] of (options[kind]??[]).entries()) {
      const matches=current.baseline.elements.filter(item=>'id' in mapping?item.id===mapping.id:(!mapping.module||item.address.module===mapping.module)&&canonical(path(item.id))===canonical(mapping.declaration));
      const map=kind==='names'?this.names:this.imports;
      if(matches.length!==1||map.has(matches[0]!.id)) problems.push(javaProblem('invalid-native-mapping','Select one distinct checked declaration for this Java mapping.','<options>',kind,index));
      else map.set(matches[0]!.id,mapping.name);
    }
  }
  name(item:Item,fallback?:string):string {
    const id=item.kind==='let'?undefined:this.current.id(item.id),name=(id&&this.names.get(id))??('name' in item?item.name:fallback??item.kind);
    if(!javaName(name)) this.problems.push({code:'invalid-native-name',message:'Provide an explicit Java name for this authored declaration.',at:item.origin,related:[]});
    if(id) this.effective.set(id,name); return name;
  }
  capture():JavaMappingState {
    return {names:[...this.effective].map(([id,name])=>({id,name,explicit:this.names.has(id)})),imports:[...this.imports].map(([id,name])=>({id,name}))};
  }
  check(previous:JavaMappingState|undefined):void {
    if(!previous) return;
    const retained=new Set(this.current.baseline.elements.map(item=>item.id));
    for(const prior of previous.names) if(retained.has(prior.id)) {
      const next=this.names.get(prior.id);
      if(next!==undefined&&next!==prior.name||prior.explicit&&next===undefined) this.changed(prior.id);
    }
    for(const prior of previous.imports) if(retained.has(prior.id)&&this.imports.get(prior.id)!==prior.name) this.changed(prior.id);
  }
  private changed(id:string):void { this.problems.push({code:'output-options-changed',message:'Retain the verified native mapping for this durable subject.',at:this.current.specification.inspection.read(this.current.node(id)).origin,related:[]}); }
}
