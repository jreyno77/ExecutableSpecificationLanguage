import { ExpressionChecker, type ValueScope } from '../../compiler/expression-checker.js';
import type { Item } from '../../model/inspection-item.js';
import type { IdentifiedSpecification } from '../../model/specification-identity.js';
import type { TypeId } from '../../compiler/types.js';
import { decimal } from '../../compiler/decimal.js';
import { JavaTypes } from './java-types.js';

type Operation = Item<'setup' | 'action' | 'observation' | 'check'>;
/** Lower checked values with their expected types; no fixture or application expression is executed here. */
export class JavaExpressions {
  readonly locals = new Map<string,TypeId>();
  private readonly checking: ExpressionChecker;
  constructor(private readonly current: IdentifiedSpecification, private readonly types: JavaTypes,
    private readonly name: (item: Item) => string, private readonly field: (item: Item<'field'>) => string,
    private readonly problem: (code:string,message:string,item:Item) => void,
    private readonly construct: (type:string,item:Item)=>void = ()=>{}) { this.checking=new ExpressionChecker(current.specification.types); }
  private readonly scope: ValueScope = reference => {
    if(reference.resolution.status==='bound') {
      const item=this.current.specification.inspection.read(reference.resolution.target);
      if(item.kind==='fixture'||item.kind==='parameter') return {value:this.types.known(this.current.specification.types.typeOf(item.declaredType.id)),problems:[],deferred:[]};
    }
    const type=this.locals.get(reference.segments.join('.')); return type ? {value:type,problems:[],deferred:[]} : undefined;
  };
  type(item: Item): TypeId | undefined {
    const result=this.checking.typeOf(item.id,this.scope);
    if(!result.value) this.problem('unsupported-native-expression','The checked value has no concrete native type in this scope.',item);
    return result.value;
  }
  private shape(id:TypeId) {
    let value=this.current.specification.types.describe(id);
    while(value.kind==='alias') value=this.current.specification.types.describe(this.types.known(value.target));
    return value;
  }
  operation(id: Item['id']): Operation | undefined {
    const item=this.current.specification.inspection.read(id);
    return item.kind==='setup'||item.kind==='action'||item.kind==='observation'||item.kind==='check' ? item : undefined;
  }
  expression(item:Item,receiver:string,expected?:TypeId):string {
    const shape=expected&&this.shape(expected);
    if(shape&&shape.kind==='optional') {
      const actual=this.checking.typeOf(item.id,this.scope).value;
      if(!actual||this.shape(actual).kind!=='optional') return 'java.util.Optional.of('+this.expression(item,receiver,shape.inner)+')';
    }
    const expression=(node:Item,type?:TypeId)=>this.expression(node,receiver,type);
    switch(item.kind) {
      case 'string-literal': return JSON.stringify(item.value);
      case 'boolean-literal': return String(item.value);
      case 'number-literal': {
        const value=Number(item.token);
        if(!Number.isFinite(value)||decimal(item.token)!==decimal(String(value))) this.problem('unsupported-native-number','Java double cannot preserve this literal.',item);
        return Number.isInteger(value)?value.toFixed(1):String(value);
      }
      case 'grouped-expression': return '('+expression(item.inner,expected)+')';
      case 'unary-expression': return item.operator==='not'?'!('+expression(item.operand)+')':'ExpecChecks.number('+item.operator+expression(item.operand)+')';
      case 'name-expression': {
        if(item.reference.resolution.status==='bound') {
          const declaration=this.current.specification.inspection.read(item.reference.resolution.target);
          if(declaration.kind==='fixture') return receiver+this.name(declaration);
          if(declaration.kind==='parameter') return this.name(declaration);
        }
        return item.reference.segments.join('.');
      }
      case 'list-expression': {
        const id=expected??this.type(item),meaning=id&&this.shape(id);
        const values=item.elements.map((value,index)=>expression(value,meaning?.kind==='tuple'?meaning.elements[index]:meaning?.kind==='builtin'?meaning.arguments[0]:undefined));
        return meaning?.kind==='tuple'?'new '+this.types.name(id!,item)+'('+values.join(', ')+')':'java.util.List.of('+values.join(', ')+')';
      }
      case 'record-expression': {
        const id=item.declaredType?this.types.known(this.current.specification.types.typeOf(item.declaredType.id)):expected;
        if(!id) break;
        const fields=this.types.known(this.current.specification.types.fields(id)); if(fields.kind!=='available') break;
        const type=this.types.name(id,item); this.construct(type.replace(/<.*>$/,''),item);
        return 'new '+type+'('+fields.fields.map(slot=>{
          const field=this.current.specification.inspection.read(slot.declaration,'field'),value=item.entries.find(entry=>entry.name===field.name),type=this.types.known(slot.type);
          if(value) return expression(value.value,type);
          if(this.shape(type).kind==='optional') return 'java.util.Optional.empty()';
          this.problem('unsupported-native-default','Data construction requires explicit field values.',item); return 'null';
        }).join(', ')+')';
      }
      case 'member-expression': {
        const id=this.type(item.receiver); if(!id) break;
        const fields=this.types.known(this.current.specification.types.fields(id)); if(fields.kind!=='available') break;
        const field=fields.fields.map(slot=>this.current.specification.inspection.read(slot.declaration,'field')).find(field=>field.name===item.member.segments[0]);
        if(field) return '('+expression(item.receiver)+').'+this.field(field)+'()';
        break;
      }
      case 'call-expression': {
        const called=this.current.specification.call(item.id).value,operation=called&&this.operation(called);
        if(!operation) { this.problem('unsupported-native-call','This call needs an explicit compatible native operation.',item); return 'null'; }
        const args=[...item.arguments,...operation.parameters.slice(item.arguments.length).flatMap(parameter=>parameter.defaultValue?[parameter.defaultValue]:[])];
        return receiver+this.name(operation)+'('+args.map((value,index)=>expression(value,this.types.known(this.current.specification.types.typeOf(operation.parameters[index]!.declaredType.id)))).join(', ')+')';
      }
      case 'binary-expression': {
        if(item.operator==='=='||item.operator==='!=') return (item.operator==='!='?'!':'')+'ExpecChecks.same('+expression(item.left)+', '+expression(item.right)+')';
        const operator=item.operator==='and'?'&&':item.operator==='or'?'||':item.operator;
        const value='('+expression(item.left)+' '+operator+' '+expression(item.right)+')';
        return ['+','-','*','/','%'].includes(operator)?'ExpecChecks.number('+value+')':value;
      }
    }
    this.problem('unsupported-native-expression','This checked expression needs a supported native Java representation.',item); return 'null';
  }
}
