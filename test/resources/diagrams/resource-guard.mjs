import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { parentPort } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute, sep } from 'node:path';
const packageRoot = fileURLToPath(new URL('../../../node_modules/@d2lang/d2/', import.meta.url));
const denied = detail => { parentPort.postMessage({ expecResourceDenied: detail }); throw Error('Diagram resource denied: ' + detail); };
const read = path => {
  const target = resolve(path instanceof URL ? fileURLToPath(path) : String(path)), part = relative(packageRoot, target);
  if (part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) denied(target);
};
for (const api of [fs, fsp]) for (const key of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) {
  if (typeof api[key] !== 'function') continue;
  const original = api[key]; api[key] = function (path, ...args) { read(path); return original.call(this, path, ...args); };
}
globalThis.fetch = () => denied('fetch');
for (const api of [http, https]) { api.get = () => denied('http.get'); api.request = () => denied('http.request'); }
net.connect = () => denied('net.connect'); net.createConnection = () => denied('net.createConnection');
net.Socket.prototype.connect = () => denied('socket.connect');
syncBuiltinESMExports();
