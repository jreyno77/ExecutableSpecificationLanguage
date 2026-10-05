import fs from 'node:fs';
import promises from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.EXPEC_DENIED_CHECKOUT);
export const denied = [];
function check(value) {
  if (value instanceof URL) value = fileURLToPath(value);
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) return;
  const path = resolve(String(value)), part = relative(root, path);
  if (!part || !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)) {
    denied.push(path); throw Error('CHECKOUT_DENIED: ' + path);
  }
}
registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); if (result.url.startsWith('file:')) check(new URL(result.url)); return result; } });
for (const api of [fs, promises]) for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'readdir', 'readdirSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'realpath', 'realpathSync', 'access', 'accessSync', 'createReadStream']) {
  const original = api[name]; if (typeof original !== 'function') continue;
  const wrapped = function (...args) { check(args[0]); return original.apply(this, args); };
  if (original.native) wrapped.native = function (...args) { check(args[0]); return original.native.apply(this, args); };
  api[name] = wrapped;
}
syncBuiltinESMExports();
