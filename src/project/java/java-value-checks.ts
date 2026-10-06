import type { TypeCatalog } from '../../compiler/type-catalog.js';
import type { TypeId } from '../../compiler/types.js';
import type { Item } from '../../model/inspection-item.js';
import { JavaTypes } from './java-types.js';

/** Validate instantiated record fields at the native DSL boundary, including erased generic data. */
export class JavaValueChecks {
  private readonly methods = new Map<TypeId,{name:string;source:string}>();
  private nested = false;
  constructor(private readonly catalog:TypeCatalog,private readonly types:JavaTypes,private readonly field:(item:Item<'field'>)=>string) {}
  value(id:TypeId,expression:string,path:string):string|undefined {
    const type=this.catalog.describe(id);
    if(type.kind!=='declared') return;
    const record=this.catalog.inspection.read(type.declaration); if(record.kind!=='record-type-declaration') return;
    const nested=this.nested;
    let method=this.methods.get(id);
    if(!method) {
      method={name:'record'+this.methods.size,source:''}; this.methods.set(id,method);
      const native=this.types.name(id,record),shape=this.types.known(this.catalog.fields(id));
      if(shape.kind!=='available') throw new TypeError('Checked records require their field facts.');
      this.nested=true;
      try {
        const fields=shape.fields.map(slot=>{
          const field=this.catalog.inspection.read(slot.declaration,'field'),at='path + '+JSON.stringify('.'+field.name);
          const check=this.types.value(this.types.known(slot.type),'value.'+this.field(field)+'()',at,true);
          return '            try { '+check+'; } catch (ClassCastException failure) { throw new IllegalArgumentException('+at+' + ": declared data type required", failure); }';
        });
        method.source='    static '+native+' '+method.name+'('+native+' value, String path, java.util.IdentityHashMap<Object,Boolean> active) {\n'
          +'        if(value == null) throw new IllegalArgumentException(path + ": required data");\n'
          +'        if(active.put(value,Boolean.TRUE) != null) throw new IllegalArgumentException(path + ": cyclic data");\n'
          +'        try {\n'+fields.join('\n')+'\n            return value;\n        } finally { active.remove(value); }\n    }';
      } finally { this.nested=nested; }
    }
    return 'ExpecChecks.'+method.name+'('+expression+', '+path+', '+(nested?'active':'new java.util.IdentityHashMap<>()')+')';
  }
  source():string { return [...this.methods.values()].map(method=>method.source).join('\n'); }
}
