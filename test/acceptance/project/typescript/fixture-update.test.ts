import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../../../dsl/project/typescript/acceptance-generation.js';

describe('authored acceptance fixture data follows its specification', () => {
  it('updates a retained fixture and executes its new authored value', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(
      'examples { fixture title: Text = "Dune"\nexample "fixture title": title => "Dune" }');
    await project.capturePinnedNativeDeclarations();
    await project.generate({ domain: 'books' });
    project.revise('examples { fixture title: Text = "Hyperion"\nexample "fixture title": title => "Hyperion" }');
    await project.update();
    project.expectWriteStatus('applied');
    await project.expectFixtureValue('title', 'Hyperion');
    await project.runGeneratedVitest();
    project.expectTestsPassed(['fixture title']);
  }, 60_000);

  it('updates collection data while preserving handwritten driver work and comments', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(
      'examples { fixture titles: List<Text> = ["Dune"]\naction useTitles(titles: List<Text>) returns Nothing }');
    await project.generate({ domain: 'books' });
    await project.implementDriverBody('useTitles', '/* Keep my runtime work. */ void titles;');
    await project.addFixtureComment('titles', '// Keep the data explanation.');
    await project.rememberDriverBody('useTitles');
    project.revise('examples { fixture titles: List<Text> = ["Hyperion", "Dune"]\naction useTitles(titles: List<Text>) returns Nothing }');
    await project.update();
    project.expectWriteStatus('applied');
    await project.expectFixtureValue('titles', ['Hyperion', 'Dune']);
    await project.expectDriverBodyUnchanged('useTitles');
    await project.expectFixtureComment('titles', '// Keep the data explanation.');
  });

  it('refuses competing handwritten fixture data before writes', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { fixture title: Text = "Dune" }');
    await project.generate({ domain: 'books' });
    await project.replaceFixtureInitializer('title', '"Handwritten"');
    project.revise('examples { fixture title: Text = "Hyperion" }');
    await project.rememberFiles();
    await project.update();
    project.expectMappingProblem('handwritten-fixture-conflict');
    await project.expectProblemAtFixtureInitializer('title');
    await project.expectAllBytesUnchanged();
  });

  it('accepts an initializer already matching the new authored data', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { fixture title: Text = "Dune" }');
    await project.generate({ domain: 'books' });
    await project.replaceFixtureInitializer('title', '"Hyperion"');
    project.revise('examples { fixture title: Text = "Hyperion" }');
    await project.update();
    project.expectWriteStatus('applied');
    await project.expectFixtureValue('title', 'Hyperion');
  });

  it('replays completed authored data without byte churn', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { fixture titles: List<Text> = ["Dune"] }');
    await project.generate({ domain: 'books' });
    project.revise('examples { fixture titles: List<Text> = ["Hyperion"] }');
    await project.update();
    await project.rememberFiles();
    await project.update();
    project.expectWriteStatus('unchanged');
    await project.expectAllBytesUnchanged();
  }, 30_000);
});
