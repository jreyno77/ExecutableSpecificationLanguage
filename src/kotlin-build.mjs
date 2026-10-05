import spawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('./kotlin-native', import.meta.url));
const command = process.platform === 'win32' ? '.\\gradlew.bat' : 'sh';
const result = spawn.sync(command, [...process.platform === 'win32' ? [] : ['./gradlew'], '--no-daemon', '--console=plain', 'stageBridge'], { cwd, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
