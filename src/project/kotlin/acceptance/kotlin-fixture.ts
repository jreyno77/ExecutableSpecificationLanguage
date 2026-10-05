import type { ArtifactLocator } from '../../../model/specification-identity.js';
import type { ProjectSnapshot } from '../../connection/project-connection.js';
import type { KotlinQuery } from '../kotlin-query.js';
import { canonical } from '../../../model/identity-baseline.js';

type Declaration = KotlinQuery['declarations'][number];
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const kotlinName = (node: Declaration): string => node.packageName + '.' + node.selector.map(item => item.name).join('.');

/** A native base supplies an ordinary readable DSL property; JUnit owns its lifecycle. */
export function selectedKotlinFixture(native: KotlinQuery, locator: ArtifactLocator): Declaration | undefined {
  if (locator.format !== 'kotlin-symbol-1') return undefined;
  const selected = native.declarations.filter(node => node.kind === 'class' && !node.synthetic
    && same(locator.value, { file: node.file, declaration: node.selector }));
  return selected.length === 1 ? selected[0] : undefined;
}
export function compatibleKotlinFixture(fixture: Declaration, domain: string, type: string): boolean {
  if (!fixture.zeroArgumentConstruction || fixture.typeParameters?.length || fixture.visibility === 'private') return false;
  const properties = fixture.readableProperties?.filter(property => property.name === domain) ?? [];
  return properties.length === 1 && properties[0]!.type === type;
}

/** Changes only the PSI supertype that still resolves to the recorded default fixture. */
export function migrateKotlinFixture(snapshot: ProjectSnapshot, native: KotlinQuery, file: string, previous: string, fixture: Declaration): string | undefined {
  const source = snapshot.files.find(item => item.path === file);
  if (!source) return undefined;
  const candidates = native.declarations.filter(node => node.file === file && node.kind === 'class' && node.selector.length === 1)
    .flatMap(node => node.superTypeRanges ?? []).filter(range => native.references.some(reference => reference.file === file
      && reference.range.start >= range.start && reference.range.end <= range.end && native.declarations.some(target =>
        target.file === reference.targetFile && same(target.selector, reference.target)
        && (kotlinName(target) === previous || target.kind === 'constructor' && kotlinName({ ...target, selector: target.selector.slice(0, -1) }) === previous))));
  if (candidates.length !== 1) return undefined;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes), range = candidates[0]!;
  return text.slice(0, range.start) + kotlinName(fixture) + text.slice(range.end);
}
