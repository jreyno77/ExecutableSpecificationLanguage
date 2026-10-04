import { DOMParser, type Element } from '@xmldom/xmldom';

const core='https://schemas.opentest4j.org/reporting/core/0.2.0', events='https://schemas.opentest4j.org/reporting/events/0.2.0';
const java='https://schemas.opentest4j.org/reporting/java/0.2.0', junit='https://schemas.junit.org/open-test-reporting';
const states={SUCCESSFUL:'passed',FAILED:'failed',SKIPPED:'skipped',ABORTED:'aborted'} as const;
type Observation={id:string;parent:string|null;name:string;kind:string;selector?:string;state?:string;errors:string[]};
const elements=(element:Element)=>Array.from(element.childNodes).filter((node):node is Element=>node.nodeType===1);
const children=(element:Element,space:string,name:string)=>elements(element).filter(node=>node.namespaceURI===space&&node.localName===name);
function one(element:Element,space:string,name:string):Element {
  const found=children(element,space,name); if(found.length!==1) throw Error('Expected exactly one '+name+'.'); return found[0]!;
}
function attribute(element:Element,name:string):string {
  const value=element.getAttribute(name); if(!value) throw Error('Missing '+name+' on '+element.localName+'.'); return value;
}
const identity=(className:string,methodName:string,parameters:readonly string[])=>JSON.stringify([className,methodName,parameters]);

/** Interpret native JUnit events without launching tests or manufacturing missing observations. */
export function junitReport(xml: string, selected: readonly {id:string;file:string;title:string;className:string;methodName:string;parameters:readonly string[]}[]) {
  const report={tests:[] as {id:string;file:string;title:string;state:string;errors:string[]}[],errors:[] as string[],problems:[] as {code:string;message:string}[]};
  try {
    const selections=new Map(selected.map(item=>[identity(item.className,item.methodName,item.parameters),item]));
    if(!selected.length||selections.size!==selected.length||new Set(selected.map(item=>item.id)).size!==selected.length)
      throw Error('Select distinct native methods with distinct specification identities.');
    if(Buffer.byteLength(xml,'utf8')>16*1024*1024) throw Error('Native report exceeds the 16MiB observation limit.');
    const document=new DOMParser({onError:(_level,message)=>{throw Error(message);}}).parseFromString(xml,'application/xml');
    const root=document.documentElement;
    if(document.doctype||!root||root.namespaceURI!==events||root.localName!=='events') throw Error('Expected native events without a document type.');
    const observed=new Map<string,Observation>(),uniqueIds=new Set<string>();
    for(const event of elements(root)) {
      if(event.namespaceURI===core&&event.localName==='infrastructure') continue;
      if(event.namespaceURI!==events) throw Error('Unexpected native event namespace.');
      const id=attribute(event,'id');
      if(event.localName==='started') {
        const parent=event.getAttribute('parentId'),metadata=one(event,core,'metadata');
        if(observed.has(id)||parent&&(!observed.has(parent)||observed.get(parent)!.state)) throw Error('Duplicate event or unavailable parent.');
        const unique=one(metadata,junit,'uniqueId').textContent,kind=one(metadata,junit,'type').textContent;
        if(!unique||uniqueIds.has(unique)||kind!=='TEST'&&kind!=='CONTAINER') throw Error('Duplicate or unsupported native test identity.');
        if(kind==='TEST'&&!parent||parent&&observed.get(parent)!.kind!=='CONTAINER') throw Error('Ordinary tests require native container ancestry.');
        uniqueIds.add(unique);
        const value:Observation={id,parent,name:attribute(event,'name'),kind,errors:[]};
        if(kind==='TEST') {
          const source=one(one(event,core,'sources'),java,'methodSource'),parameters=source.getAttribute('methodParameterTypes');
          if(parameters===null) throw Error('Missing native method parameter signature.');
          value.selector=identity(attribute(source,'className'),attribute(source,'methodName'),parameters?parameters.split(',').map(item=>item.trim()):[]);
        }
        observed.set(id,value);
      } else if(event.localName==='finished') {
        const value=observed.get(id);
        if(!value||value.state||[...observed.values()].some(child=>child.parent===id&&!child.state)) throw Error('Unknown, duplicate or out-of-order completion.');
        const result=one(event,core,'result'),status=attribute(result,'status');
        if(!Object.hasOwn(states,status)) throw Error('Unknown native result status.');
        value.state=states[status as keyof typeof states];
        value.errors=elements(result).map(item=>{
          if(!(item.namespaceURI===java&&item.localName==='throwable'||item.namespaceURI===core&&item.localName==='reason')) throw Error('Unexpected native result payload.');
          return item.textContent??'';
        });
        if(value.state==='passed'&&value.errors.length) throw Error('Successful native result contains failure observations.');
      } else if(event.localName==='reported') {
        if(!observed.has(id)||observed.get(id)!.state) throw Error('Reported output belongs to an unavailable event.');
      } else throw Error('Unsupported native event '+event.localName+'.');
    }
    if(!observed.size||[...observed.values()].some(value=>!value.state)) throw Error('Native report is empty or unfinished.');
    const matched=new Set<string>();
    for(const value of observed.values()) {
      if(value.kind==='CONTAINER') {
        if(value.state!=='passed') report.errors.push(value.name+': '+value.state,...value.errors);
        continue;
      }
      const item=selections.get(value.selector!);
      if(!item||matched.has(value.selector!)) { report.problems.push({code:'generated-tests-not-executed',message:'Native execution reported an unexpected or duplicate selected method: '+value.name}); continue; }
      matched.add(value.selector!);
      report.tests.push({id:item.id,file:item.file,title:value.name,state:value.state!,errors:value.errors});
    }
    if(matched.size!==selected.length||report.errors.length||report.tests.some(item=>item.state!=='passed'))
      report.problems.push({code:'generated-tests-not-executed',message:'Every selected generated method must finish passing exactly once, without failed, aborted or skipped containers.'});
  } catch(error) {
    report.tests=[]; report.errors=[];
    report.problems=[{code:'invalid-native-report',message:String(error)}];
  }
  return report;
}
