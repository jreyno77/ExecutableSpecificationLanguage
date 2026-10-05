import { afterEach, expect, it } from 'vitest';
import { KotlinAcceptanceDriver } from '../driver/kotlin-acceptance.js';
import { kotlinDataCarriers, kotlinStatePath } from '../../src/project/kotlin/kotlin-output-state.js';
import { queryKotlin } from '../../src/project/kotlin/kotlin-query.js';
import { hash } from '../../src/project/connection/project-files.js';

const projects: KotlinAcceptanceDriver[] = [];
afterEach(async () => { for (const project of projects.splice(0)) await project.dispose(); });
async function data() {
  const project = new KotlinAcceptanceDriver(); projects.push(project); await project.prepare();
  project.source('type Device { system: "windows" | "linux" }');
  await project.contracts();
  const snapshot = await project.context.readSnapshot(), queried = await queryKotlin(snapshot, 'expec.kotlin.json');
  expect(queried.problems).toEqual([]);
  return { project, snapshot, native: queried.value! };
}

it('identifies the actual generated carrier separately from its stored property', async () => {
  const p = await data(), result = kotlinDataCarriers(p.snapshot, p.project.current, p.native);
  expect(result.problems).toEqual([]);
  expect(result.value!.carriers.map(item => ({ name: item.target.name, path: item.path, trusted: item.trusted })))
    .toEqual([{ name: 'DeviceSystem', path: '', trusted: true }]);
  expect(result.value!.companions.size).toBe(1);
}, 60_000);

it('checks actual carrier declaration bytes when a caller retains the old file version', async () => {
  const p = await data(), file = p.snapshot.files.find(file => file.path === 'src/main/kotlin/store/Device.kt')!;
  const version = file.version;
  const changed = { ...file, bytes: Buffer.from(new TextDecoder().decode(file.bytes).replace('Windows("windows")', 'Windows("linuuuux")')) };
  expect(file.version).toBe(version);
  const result = kotlinDataCarriers({ ...p.snapshot, files: p.snapshot.files.map(item => item === file ? changed : item) }, p.project.current, p.native);
  expect(result.value!.carriers.map(item => item.trusted)).toEqual([false]);
}, 60_000);

it('does not let an edited saved baseline confer fresh generated carrier ownership', async () => {
  const p = await data(), file = p.snapshot.files.find(file => file.path === kotlinStatePath)!;
  const saved = JSON.parse(new TextDecoder().decode(file.bytes));
  saved.files[0].generated = saved.files[0].generated.replace('Windows("windows")', 'Windows("linuuuux")');
  saved.files[0].hash = hash(Buffer.from(saved.files[0].generated));
  const bytes = Buffer.from(JSON.stringify(saved)), changed = { ...file, bytes, version: hash(bytes) };
  const result = kotlinDataCarriers({ ...p.snapshot, files: p.snapshot.files.map(item => item === file ? changed : item) }, p.project.current, p.native);
  expect(result.value!.companions.size).toBe(0);
  expect(result.value!.carriers).toEqual([]);
}, 60_000);
