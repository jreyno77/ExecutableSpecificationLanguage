import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import spawn from 'cross-spawn';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = join(root, 'src/java-native');
const child = spawn(join(native, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), ['--no-daemon', 'stageNative'], {
  cwd: native, stdio: 'inherit', windowsHide: true,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', async code => {
  if (code !== 0) { process.exitCode = code ?? 1; return; }
  try {
    await mkdir(join(root, 'dist/java'), { recursive: true });
    await cp(join(root, 'src/java'), join(root, 'dist/java'), { recursive: true });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
