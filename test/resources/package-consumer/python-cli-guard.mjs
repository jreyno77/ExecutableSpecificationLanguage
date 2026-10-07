import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import child from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// Node-host evidence only; this does not claim an operating-system sandbox for CPython.
const root = resolve(process.env.EXPEC_DENIED_CHECKOUT);
function check(value) {
  if (value instanceof URL) value = fileURLToPath(value);
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) return;
  const path = resolve(String(value)), part = relative(root, path);
  if (!part || !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)) throw Error('CHECKOUT_DENIED: ' + path);
}
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context); if (result.url.startsWith('file:')) check(new URL(result.url)); return result;
} });
for (const api of [fs, promises]) for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'readdir', 'readdirSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'realpath', 'realpathSync', 'access', 'accessSync', 'createReadStream']) {
  const original = api[name]; if (typeof original !== 'function') continue;
  const wrapped = function (...args) { check(args[0]); return original.apply(this, args); };
  if (original.native) wrapped.native = function (...args) { check(args[0]); return original.native.apply(this, args); };
  api[name] = wrapped;
}
const denied = () => { throw Error('Python build/test must not acquire dependencies or use the network.'); };
net.connect = net.createConnection = http.request = http.get = https.request = https.get = denied;
globalThis.fetch = denied;
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = child[name];
  const checkCommand = (command, args) => {
    if (resolve(command) === resolve(process.env.EXPEC_TEST_PYTHON)) return;
    if (resolve(command) === resolve(process.env.EXPEC_TEST_UV) && Array.isArray(args[0])
      && args[0].length === 1 && args[0][0] === '--version') return;
    return denied();
  };
  const wrapped = function (command, ...args) {
    checkCommand(command, args);
    return original.call(this, command, ...args);
  };
  if (original[promisify.custom]) wrapped[promisify.custom] = function (command, ...args) {
    checkCommand(command, args); return original[promisify.custom].call(this, command, ...args);
  };
  child[name] = wrapped;
}
child.exec = child.execSync = child.fork = denied;
syncBuiltinESMExports();
assert.throws(() => fs.readFileSync(process.env.EXPEC_TEST_CHECKOUT_FILE), /CHECKOUT_DENIED/);
await assert.rejects(() => import(pathToFileURL(process.env.EXPEC_TEST_CHECKOUT_FILE).href), /CHECKOUT_DENIED/);
assert.throws(() => net.connect({ host: '127.0.0.1', port: 1 }), /must not acquire/);
assert.throws(() => child.spawn(process.env.EXPEC_TEST_UV, ['sync']), /must not acquire/);
process.stderr.write('PYTHON-CLI-GUARDS:checkout-denied,import-denied,network-denied,acquisition-denied\n');
