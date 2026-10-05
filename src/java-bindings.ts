import type { Diagnostic } from './checking.js';
import type { JavaFacts } from './java-analysis.js';
import { javaProblem } from './java-settings.js';
import type { JavaFile } from './java-declarations.js';
import { canonical } from './identity-baseline.js';
import { javaSymbol } from './java-analysis.js';

export interface JavaEdit { start: number; end: number; content: string; name: boolean }

/** Recheck native targets at every surviving source site, including callers the edit did not touch. */
export function survivingJavaBindings(before: JavaFacts, after: JavaFacts, edits: ReadonlyMap<string, readonly JavaEdit[]>, moves: ReadonlyMap<string, string>, invalidBodies: readonly { file: string; start: number; length: number }[] = [], correspondence: ReadonlyMap<string, readonly string[]> = new Map()): Diagnostic[] {
  const problems: Diagnostic[] = [];
  const position = (site: { file: string; start: number; length: number }) => {
    const changes = edits.get(site.file) ?? [];
    if (changes.some(edit => edit.start < site.start + site.length && edit.end > site.start
      && !(edit.name && edit.start === site.start && edit.end === site.start + site.length))) return undefined;
    return site.start + changes.filter(edit => edit.end <= site.start).reduce((total, edit) => total + edit.content.length - edit.end + edit.start, 0);
  };
  const targets = (key: string) => correspondence.has(key) ? after.declarations.filter(node => correspondence.get(key)!.includes(node.key)) : before.declarations.filter(node => node.key === key).flatMap(node => {
    const start = position(node);
    return start === undefined ? [] : after.declarations.filter(next => next.file === (moves.get(node.file) ?? node.file)
      && next.start === start && next.member?.kind === node.member?.kind && next.parameter === node.parameter);
  });
  for (const use of before.uses) {
    const start = position(use);
    if (start === undefined || invalidBodies.some(body => body.file === (moves.get(use.file) ?? use.file) && start >= body.start && start < body.start + body.length)) continue;
    const found = after.uses.filter(next => next.file === (moves.get(use.file) ?? use.file) && next.start === start && next.role === use.role);
    const source = before.declarations.some(node => node.key === use.key), expected = targets(use.key);
    let retained = source ? expected.length > 0 && found.some(next => expected.some(node => node.key === next.key))
      : found.some(next => next.key === use.key && next.external === use.external);
    if (!retained && !source && !use.external && use.member) {
      // Synthetic record/enum methods and implicit constructors have no declaration token.
      // Their JDT keys may include the temporary source directory; use the actual owning declaration.
      const owner = before.declarations.find(node => node.type === use.type && !node.member);
      const types = owner ? targets(owner.key) : [], member = JSON.stringify(use.member);
      retained = found.some(next => !next.external && types.some(type => type.type === next.type) && JSON.stringify(next.member) === member);
    }
    if (!retained) problems.push(javaProblem('native-binding-conflict', 'The edit would change or lose the native target of this surviving reference.', use.file, use.start, use.length));
  }
  return problems;
}

/** Whole generated modules keep only explicitly retained subjects or unchanged native support declarations. */
export function generatedJavaCorrespondence(before: JavaFacts, after: JavaFacts, previous: readonly JavaFile[], desired: readonly JavaFile[]): ReadonlyMap<string, readonly string[]> {
  const claims = (files: readonly JavaFile[]) => files.flatMap(file => file.artifacts.filter(item => item.locator.format === 'java-symbol-1')
    .map(item => ({ id: item.specId, at: javaSymbol.parse(item.locator.value) })));
  const old = claims(previous), next = claims(desired), result = new Map<string, readonly string[]>();
  const selects = (node: JavaFacts['declarations'][number], at: typeof old[number]['at']) => node.file === at.file && node.type === at.type
    && canonical(node.member) === canonical(at.member) && node.parameter === at.parameter;
  for (const node of before.declarations.filter(node => previous.some(file => file.path === node.file))) {
    const owned = old.filter(item => selects(node, item.at));
    const candidates = owned.length ? next.filter(item => owned.some(prior => item.id === prior.id
      && item.at.member?.kind === prior.at.member?.kind && item.at.parameter === prior.at.parameter))
      .flatMap(item => after.declarations.filter(found => selects(found, item.at)))
      : after.declarations.filter(found => desired.some(file => file.path === found.file) && found.file === node.file && found.type === node.type
        && canonical(found.member) === canonical(node.member) && found.parameter === node.parameter && canonical(found.contract) === canonical(node.contract));
    result.set(node.key, candidates.length === 1 ? [candidates[0]!.key] : []);
  }
  return result;
}
