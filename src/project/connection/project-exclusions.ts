import { z } from 'zod';
import type { ProjectSnapshot } from './project-connection.js';

type Policy = { readonly excludePaths?: readonly string[] | undefined };
const key = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;
const contains = (parent: string, path: string): boolean => path === parent || path.startsWith(parent + '/');
const literal = (path: string): boolean => path.length > 0 && path === path.trim() && !/[\\:*?\[\]{}\0]/.test(path)
  && Buffer.from(path).toString() === path && path.split('/').every(part => !!part && part !== '.' && part !== '..')
  && !contains('.expec', key(path));

/** Authored root-relative boundaries; configuration may supply an empty list. */
export const excludePathsSchema = z.array(z.string().refine(literal, 'Provide a literal root-relative path outside root .expec coordination.'))
  .superRefine((paths, context) => {
    const seen = new Map<string, number>();
    paths.forEach((path, index) => {
      const previous = seen.get(key(path));
      if (previous === undefined) seen.set(key(path), index);
      else context.addIssue({ code: 'custom', path: [index], message: path + ' is declared more than once.',
        params: { code: 'invalid-setting', related: [previous], width: 1 } });
    });
  });

/** Copies optional policy without changing legacy snapshot or canonical-record shape. */
export function pathPolicy(policy: Policy): { excludePaths?: string[] } {
  return policy.excludePaths?.length ? { excludePaths: [...policy.excludePaths] } : {};
}
/** Whether an entry is covered by a declared unobserved subtree. */
export function excludesPath(policy: Policy, path: string): boolean {
  return (policy.excludePaths ?? []).some(boundary => contains(key(boundary), key(path)));
}
/** File effects and required native scopes cannot overlap either side of a boundary. */
export function protectsExcludedPath(policy: Policy, path: string): boolean {
  return (policy.excludePaths ?? []).some(boundary => path === '.' || contains(key(boundary), key(path)) || contains(key(path), key(boundary)));
}
/** Supplied snapshot policy must be nonempty and agree with all editable evidence. */
export function validPathPolicy(snapshot: Pick<ProjectSnapshot, 'files' | 'excludePaths'>): boolean {
  return snapshot.excludePaths === undefined || Array.isArray(snapshot.excludePaths) && snapshot.excludePaths.length > 0
    && excludePathsSchema.safeParse(snapshot.excludePaths).success && Array.isArray(snapshot.files)
    && snapshot.files.every(file => file && typeof file.path === 'string' && !excludesPath(snapshot, file.path));
}
