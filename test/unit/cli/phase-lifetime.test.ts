import { expect, it } from 'vitest';
import { generationCaptureLifetime } from '../../driver/cli/phase-lifetime.js';

it('releases obsolete captures before planning the current stage', async () => {
  const generation = await generationCaptureLifetime('type Book { title: Text }');

  expect(generation.result).toEqual({ status: 'built', exitCode: 0, problems: [] });
  expect(generation.atPlanning).toEqual({ initialAlive: false, transitionAlive: false, stageAlive: true });
}, 30_000);
