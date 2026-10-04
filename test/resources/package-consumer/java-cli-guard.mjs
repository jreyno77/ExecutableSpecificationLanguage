import assert from 'node:assert/strict';
import fs from 'node:fs';
import child from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';

// These are Node-host guards, not an operating-system sandbox for the native JVM.
assert.throws(() => fs.readFileSync(process.env.EXPEC_TEST_CHECKOUT_FILE), { code: 'ERR_ACCESS_DENIED' });
const denied = () => { throw Error('Java query/build/test must not acquire packages or use the network.'); };
net.connect = net.createConnection = http.request = http.get = https.request = https.get = denied;
globalThis.fetch = denied;
const home = process.env.EXPEC_TEST_JAVA_HOME ?? process.env.JAVA_HOME;
const allowed = new Set(['java', 'javac'].map(name => resolve(join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : '')))));
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = child[name];
  child[name] = function (command, args = [], ...rest) {
    if (!allowed.has(resolve(command)) || args.some(value => String(value).includes('GradleWrapperMain'))) return denied();
    return original.call(this, command, args, ...rest);
  };
}
child.exec = child.execSync = child.fork = denied;
syncBuiltinESMExports();
assert.throws(() => net.connect({ host: '127.0.0.1', port: 1 }), /must not acquire/);
assert.throws(() => child.spawn([...allowed][0], ['org.gradle.wrapper.GradleWrapperMain']), /must not acquire/);
process.stderr.write('JAVA-CLI-GUARDS:checkout-denied,network-denied,build-tool-denied\n');
