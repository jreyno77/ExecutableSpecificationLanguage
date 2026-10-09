import { createHash } from 'node:crypto';
import type { ProjectFile, ProjectSnapshot } from './project-connection.js';

const canonical = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;
export const packagePath = (path: string): boolean => path.split('/').some(part => canonical(part) === 'node_modules');
/** Shared namespace and tree checks for captured bytes or retained file facts. */
export function validateReadOnlyFacts(files: readonly Pick<ProjectFile, 'path'>[], supplemental: readonly Pick<ProjectFile, 'path'>[]): boolean {
  if (files.some(file => packagePath(file.path))) return false;
  const paths = files.map(file => canonical(file.path));
  for (const file of supplemental) {
    if (!file || typeof file.path !== 'string' || !file.path.startsWith('node_modules/') || /[:\\\0]/.test(file.path)
      || file.path.split('/').some((part: string) => !part || part === '.' || part === '..') || !/(?:\.d\.[cm]?ts|\.jsonc?)$/i.test(file.path)) return false;
    paths.push(canonical(file.path));
  }
  const names = new Set(paths);
  return names.size === paths.length && paths.every(path => path.split('/').slice(0, -1).every((_, index, parts) => !names.has(parts.slice(0, index + 1).join('/'))));
}
export function validateReadOnly(snapshot: ProjectSnapshot): boolean {
  const supplemental = snapshot.readOnlyFiles;
  if (supplemental !== undefined && !Array.isArray(supplemental)) return false;
  if ((supplemental ?? []).some(file => !file || !(file.bytes instanceof Uint8Array) || createHash('sha256').update(file.bytes).digest('hex') !== file.version)) return false;
  return validateReadOnlyFacts(snapshot.files, supplemental ?? []);
}
export function sameReadOnly(left: ProjectSnapshot, right: ProjectSnapshot): boolean {
  if (!validateReadOnly(left) || !validateReadOnly(right)) return false;
  const versions = new Map((left.readOnlyFiles ?? []).map(file => [file.path, file.version]));
  return versions.size === (right.readOnlyFiles ?? []).length && (right.readOnlyFiles ?? []).every(file => versions.get(file.path) === file.version);
}
