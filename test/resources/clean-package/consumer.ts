import { Compiler } from 'executable-specification-language';

const result=new Compiler().compile({source:{sourceId:'store.expec',text:'class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }'},locator:'store',dependencies:{modules:[],packages:[]}});
if(!result.value)throw Error(JSON.stringify({problems:result.problems,syntax:result.syntax,deferred:result.deferred}));
console.log(JSON.stringify({capabilities:[...result.value.inspection.query('capability')].map(item=>item.name),problems:result.problems,syntax:result.syntax,deferred:result.deferred}));
