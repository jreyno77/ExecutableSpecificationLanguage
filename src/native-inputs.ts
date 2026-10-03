import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ProjectSnapshot } from './project-connection.js';

const key = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path;
/** Syntax-only evidence validation. The context owns actual file capture and hashing. */
export function nativeInputs(snapshot: ProjectSnapshot): Map<string, string> | undefined {
  const inputs = snapshot.nativeInputs, files = new Map<string, string>();
  if (inputs !== undefined && !Array.isArray(inputs)) return;
  try {
    for (const input of inputs ?? []) {
      if (!input || typeof input.uri !== 'string' || typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)) return;
      const url = new URL(input.uri), path = fileURLToPath(url);
      if (url.protocol !== 'file:' || url.host || url.username || url.password || url.search || url.hash || url.href !== input.uri
        || !isAbsolute(path) || path.includes('\0') || dirname(path) === path || url.pathname.endsWith('/')
        || pathToFileURL(path).href !== input.uri || files.has(key(path))) return;
      files.set(key(path), input.version);
    }
    return files;
  } catch { return; }
}
export function sameNativeInputs(left: ProjectSnapshot, right: ProjectSnapshot): boolean {
  const before = nativeInputs(left), after = nativeInputs(right);
  return !!before && !!after && before.size === after.size && [...before].every(([path, version]) => after.get(path) === version);
}
export function protectsNativeInput(snapshot: ProjectSnapshot, endpoint: string): boolean {
  const root = key(resolve(snapshot.root.path)), target = key(resolve(root, endpoint));
  return [...(nativeInputs(snapshot)?.keys() ?? [])].some(path => {
    const inside = relative(root, path);
    return !!inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)
      && (path === target || path.startsWith(target + sep) || target.startsWith(path + sep));
  });
}
