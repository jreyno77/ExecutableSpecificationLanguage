import { it } from 'vitest';
import { KotlinInputs } from '../../../dsl/project/kotlin/kotlin-inputs.js';

it('refuses an old supplied snapshot after its actual dependency JAR is replaced', async () => {
  const project = await KotlinInputs.connect();
  await project.capture();
  await project.replaceLibrary();
  await project.expectCapturedQueryRefused();
}, 120_000);

it('refuses a planned write after the selected dependency changes at the same path', async () => {
  const project = await KotlinInputs.connect();
  await project.planTwoContracts();
  await project.replaceLibrary();
  await project.apply();
  project.expectStoppedWithPrefix([]);
}, 120_000);

it('retains only the actual first contract when native evidence changes between writes', async () => {
  const project = await KotlinInputs.connect();
  await project.planTwoContracts();
  await project.replaceLibraryAfterFirstWrite();
  project.expectStoppedWithPrefix(['src/main/kotlin/store/First.kt']);
}, 120_000);

it('does not stale a native output plan for bytes in an already excluded cache', async () => {
  const project = await KotlinInputs.connect();
  await project.changeUnrelatedCache();
  await project.planTwoContracts();
  await project.changeUnrelatedCache();
  await project.expectPlanApplied();
}, 120_000);

it('returns corrupt native bytes without interpreting them as valid Kotlin source', async () => {
  const project = await KotlinInputs.connect();
  await project.expectCorruptSourceReturnedUnchanged();
}, 120_000);
