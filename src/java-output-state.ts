import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import { canonical, identifier, locatorSchema } from './identity-baseline.js';
import { hash, literal } from './project-files.js';
import { readJson } from './json-data.js';
import { javaData, javaTuple } from './java-types.js';
import { javaOptions, javaProblem } from './java-settings.js';
import { JavaProject } from './java-project.js';
import { javaMappingState } from './java-mappings.js';

/** Validate the generated-only baseline and actual native ownership for either Java output. */
export function readJavaOutputState(id: string, options: unknown, schema: z.ZodType, snapshot: ProjectSnapshot) {
  const statePath = '.expec/outputs/' + id + '.json';
  const stateSchema = z.strictObject({ format: z.literal(1), options: schema, mappings: javaMappingState.optional(), files: z.array(z.strictObject({
    path: z.string().refine(literal), generated: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/),
    artifacts: z.array(z.strictObject({ specId: identifier, locator: locatorSchema })),
    renderedArtifacts: z.array(z.strictObject({ specId: identifier, locator: locatorSchema })).optional(), adopted: z.array(identifier).optional(),
  })) });
  const problems: Diagnostic[] = [], file = snapshot.files.find(file => file.path === statePath);
  if (!file) return { problems };
  try {
    const value = readJson(new TextDecoder('utf8', { fatal: true }).decode(file.bytes), (_code, message, path) => problems.push(javaProblem('invalid-output-state', message, statePath, ...path)));
    const state = stateSchema.parse(value);
    if (state.files.some(file => Buffer.from(file.generated).toString('utf8') !== file.generated || hash(Buffer.from(file.generated)) !== file.hash
      || file.artifacts.some(item => item.locator.outputId !== id || (item.locator.value as { file?: string }).file !== file.path))
      || new Set(state.files.map(file => file.path)).size !== state.files.length) throw new Error('Recorded generation baseline is inconsistent.');
    const artifacts = state.files.flatMap(file => file.artifacts), rendered = state.files.flatMap(file => file.renderedArtifacts ?? file.artifacts);
    for (const item of [...artifacts, ...rendered]) if (item.locator.outputId !== id || !['java-symbol-1', 'java-file-1', 'java-alias-1'].includes(item.locator.format))
      throw new Error('Recorded native ownership uses an unsupported locator.');
    new JavaProject({ outputId: id }, artifacts); new JavaProject({ outputId: id }, rendered);
    for (const file of state.files) {
      if (file.adopted?.some(id => !file.artifacts.some(item => item.specId === id))
        || file.renderedArtifacts && (file.renderedArtifacts.length !== file.artifacts.length
          || canonical(file.renderedArtifacts.map(item => item.specId).sort()) !== canonical(file.artifacts.map(item => item.specId).sort())))
        throw new Error('Recorded adoption and generated correspondence disagree.');
    }
    if(state.mappings) {
      if(new Set(state.mappings.names.map(item=>item.id)).size!==state.mappings.names.length||new Set(state.mappings.imports.map(item=>item.id)).size!==state.mappings.imports.length)
        throw new Error('Native mapping correspondence has duplicate subjects.');
      for(const entry of state.mappings.names) {
        const names=artifacts.filter(item=>item.specId===entry.id&&item.locator.format==='java-symbol-1').flatMap(artifact=>{
          const at=artifact.locator.value as {type:string;member?:{kind:string;name:string};parameter?:number};
          return at.parameter!==undefined||at.member?.kind==='constructor'?[]:[at.member?.name??at.type.split('.').at(-1)];
        });
        if(names.length&&!names.includes(entry.name)) throw new Error('Native mapping correspondence disagrees with recorded ownership.');
      }
    }
    const layout=(value:unknown)=>Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!['names','imports'].includes(key)));
    if(options!==undefined&&(canonical(layout(state.options))!==canonical(layout(options))||!state.mappings&&canonical(state.options)!==canonical(options)))
      problems.push(javaProblem('output-options-changed','Java output settings require deliberate migration.',statePath));
    return { value: state, problems };
  } catch (error) { problems.push(javaProblem('invalid-output-state', String(error), statePath)); return { problems }; }
}

/** Reuse only exact generated support, never a same-named handwritten data accessor. */
export function javaTupleTypes(snapshot: ProjectSnapshot) {
  const stored=readJavaOutputState('java',undefined,javaOptions,snapshot), tuples=new Map<number,string>();
  if(stored.value&&!stored.problems.length) {
    const options=javaOptions.parse(stored.value.options),prefix=(options.directory??'src/main/java')+'/'+options.package.replaceAll('.','/')+'/';
    const support='package '+options.package+';\n\n'+javaData()+'\n';
    if(!snapshot.files.some(file=>file.path===prefix+'ExpecData.java'&&Buffer.from(file.bytes).equals(Buffer.from(support)))) return {tuples,problems:stored.problems};
    for(const file of stored.value.files) {
      const name=file.path.startsWith(prefix)?file.path.slice(prefix.length):'',match=/^Tuple([1-9][0-9]*)\.java$/.exec(name);
      if(!match) continue;
      const arity=Number(match[1]); if(arity>file.generated.length) continue;
      const expected='package '+options.package+';\n\n'+javaTuple(arity)+'\n';
      if(file.generated===expected&&snapshot.files.some(actual=>actual.path===file.path&&Buffer.from(actual.bytes).equals(Buffer.from(expected))))
        tuples.set(arity,options.package+'.Tuple'+arity);
    }
  }
  return {tuples,problems:stored.problems};
}
