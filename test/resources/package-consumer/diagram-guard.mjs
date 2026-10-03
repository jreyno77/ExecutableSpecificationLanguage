import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';
import workers from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url)), resources = resolve(directory, 'node_modules/@d2lang/d2');
let active = !workers.isMainThread;
const reads = [], denied = [], exits = [];
let created = 0, exited = 0;
const record = (kind, detail) => {
  if (workers.isMainThread) (kind === 'read' ? reads : denied).push(detail);
  else workers.parentPort.postMessage({ expecGuard: true, kind, detail });
};
const reject = detail => { record('denied', detail); throw Error('INSTALLED GUARD denied ' + detail); };
const allowed = value => {
  if (value instanceof URL) value = fileURLToPath(value);
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) return reject('non-path filesystem access');
  const path = resolve(String(value)), inside = relative(resources, path);
  if (path === fileURLToPath(import.meta.url) || !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)) {
    record('read', path); return;
  }
  reject('filesystem ' + path);
};
for (const api of [fs, fsp]) {
  for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream', 'readdir', 'readdirSync',
    'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'realpath', 'realpathSync', 'readlink', 'readlinkSync', 'existsSync']) {
    if (typeof api[name] !== 'function') continue;
    const original = api[name], wrapped = function (...args) {
      if (active) {
        if ((name === 'open' || name === 'openSync') && args[1] !== undefined && args[1] !== 'r') reject('filesystem write-open');
        allowed(args[0]);
      }
      return original.apply(this, args);
    };
    if (original.native) wrapped.native = function (...args) { if (active) allowed(args[0]); return original.native.apply(this, args); };
    api[name] = wrapped;
  }
  for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync',
    'unlink', 'unlinkSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'createWriteStream']) {
    if (typeof api[name] !== 'function') continue;
    const original = api[name];
    api[name] = function (...args) { if (active) reject('filesystem mutation ' + name); return original.apply(this, args); };
  }
}
const fetch = globalThis.fetch;
globalThis.fetch = function (...args) { if (active) reject('network fetch'); return fetch.apply(this, args); };
for (const [api, names] of [[http, ['get', 'request']], [https, ['get', 'request']],
  [net, ['connect', 'createConnection']], [net.Socket.prototype, ['connect']],
  [childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']]]) {
  for (const name of names) {
    const original = api[name];
    api[name] = function (...args) { if (active) reject('external operation ' + name); return original.apply(this, args); };
  }
}
if (workers.isMainThread) {
  const Worker = workers.Worker;
  workers.Worker = class extends Worker {
    constructor(...args) {
      super(...args); created++;
      exits.push(new Promise(resolve => this.once('exit', code => { exited++; resolve(code); })));
    }
    emit(event, ...args) {
      if (event === 'message' && args[0]?.expecGuard) { record(args[0].kind, args[0].detail); return true; }
      return super.emit(event, ...args);
    }
  };
}
syncBuiltinESMExports();
export async function guarded(action) {
  const previous = active; active = true;
  try { return await action(); } finally { active = previous; }
}
export async function proveGuards(canary, unrelatedPackage) {
  const failures = [];
  for (const operation of [() => fs.readFileSync(canary), () => fs.readFileSync(unrelatedPackage), () => fs.writeFileSync(canary, 'changed'),
    () => globalThis.fetch('https://example.invalid/expec-canary')]) {
    try { await guarded(operation); failures.push(false); }
    catch (error) { failures.push(error.message.startsWith('INSTALLED GUARD denied ')); }
  }
  const observed = { failures, denied: [...denied] };
  reads.length = 0; denied.length = 0;
  return observed;
}
export async function observations() {
  await Promise.all(exits);
  return { reads, denied, workers: { created, exited } };
}
