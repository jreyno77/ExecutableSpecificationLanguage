import type { OutputRegistration } from '../output/output.js';
import { canonical, failure, success } from '../../model/identity-baseline.js';
import { AcceptanceProjection, type AcceptanceTarget } from './acceptance-projection.js';
import { hash } from '../connection/project-files.js';
import { TypeScriptCapture, diagnostic } from './typescript-capture.js';
import { TypeScriptSymbols, nativeSelection, type Selector } from './typescript-symbols.js';
import ts from 'typescript';
import { AcceptanceBindings, acceptanceOptions as options } from './acceptance-bindings.js';
import { acceptanceState, acceptanceStatePath, initialFixtureSelection } from './acceptance-state.js';
import { AcceptancePreservation } from './acceptance-preservation.js';
import { validDiff } from '../output/output-contract.js';
import { AcceptanceDocuments, nativeFixture, isNativeTest } from './acceptance-documents.js';
import { nativeCompatibility } from './acceptance-compatibility.js';
import { removeAcceptance } from './acceptance-removal.js';

export const acceptanceOutput: OutputRegistration = {
  id: 'acceptance',
  validate(value) { const parsed = options.safeParse(value); return parsed.success ? [] : parsed.error.issues.map(item => ({ path: item.path.map(String), message: item.message })); },
  open(value, context) { const settings = options.parse(value); return {
    id: 'acceptance',
    async plan(request, basedOn) {
      if (!basedOn.complete || basedOn.problems.length) return { problems: [...basedOn.problems, diagnostic('incomplete-project', 'Acceptance generation requires a complete captured project.', '')], deferred: [] };
      const stored = acceptanceState(basedOn, settings);
      const selectingFixture = request.operation === 'update' && stored.value && initialFixtureSelection(stored.value, settings);
      if (stored.problems.length && !selectingFixture) return { problems: stored.problems, deferred: [] };
      if (request.operation === 'delete') return removeAcceptance(request.id, basedOn, settings, stored.value);
      if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Provide the actual specification transition.');
      const known = new Set([...request.current.baseline.elements.map(item => item.id), ...request.current.baseline.retired]);
      if (stored.value && [...stored.value.deleted, ...stored.value.files.flatMap(file => file.artifacts.map(item => item.specId))].some(id => !known.has(id)))
        return failure('unknown-output-identity', 'Current identity must recognize previously generated subjects.');
      if (request.operation === 'insert' && (request.diff.contextChanged || request.diff.changes.some(change => change.kinds.some(kind => kind !== 'add' && kind !== 'artifacts'))))
        return failure('not-addition-only', 'Use update when existing acceptance contracts change.');
      let fixture: AcceptanceTarget | undefined, driver: { file: string; name: string } | undefined, selection: TypeScriptCapture | undefined;
      const targets = new Map<string, AcceptanceTarget>();
      let associations: typeof request.current.baseline.artifacts;
      try {
        if (settings.fixture) {
          if ((!stored.value && !settings.adoptExisting) || settings.fixture.outputId !== 'acceptance' || settings.fixture.format !== 'typescript-symbol-1') return failure('incompatible-fixture', 'Select an explicit native Vitest fixture during adoption.');
          const capture = selection ??= new TypeScriptCapture(basedOn, 'acceptance', settings.configFile);
          const value = settings.fixture.value as unknown as { file: string; declaration: Selector[] };
          if (!Array.isArray(value.declaration) || !isNativeTest(capture, nativeFixture(capture, settings))) return { problems: [diagnostic('incompatible-fixture', 'The selected exported value must be an actual native Vitest fixture.', value.file)], deferred: [] };
          if (capture.problems.length) return { problems: capture.problems, deferred: [] };
          fixture = { file: value.file, name: value.declaration[0]!.name };
        }
        if (settings.driver) {
          if (!stored.value && !settings.adoptExisting || settings.driver.outputId !== 'acceptance' || settings.driver.format !== 'typescript-symbol-1') return failure('unowned-project-artifact', 'An existing driver requires exact native mapping and create-time adoption permission.');
          const capture = selection ??= new TypeScriptCapture(basedOn, 'acceptance', settings.configFile);
          const location = settings.driver.value as unknown as { file: string; declaration: readonly Selector[] }, source = capture.program?.getSourceFile(capture.absolute(location.file));
          const selected = source && nativeSelection(source, location.declaration);
          if (capture.problems.length) return { problems: capture.problems, deferred: [] };
          if (selected?.length !== 1 || !ts.isClassDeclaration(selected[0]!) || !selected[0]!.name
            || !(ts.getCombinedModifierFlags(selected[0]!) & ts.ModifierFlags.Export)) return failure('incompatible-driver', 'Select one exported native driver class.');
          const node = selected[0] as ts.ClassDeclaration;
          driver = { file: capture.projectPath(node.getSourceFile().fileName)!, name: node.name!.text };
        }
        associations = request.current.baseline.artifacts.filter(item => item.locator.outputId !== 'acceptance' && item.locator.format === 'typescript-symbol-1');
        if (associations.length) {
          const capture = selection ??= new TypeScriptCapture(basedOn, 'acceptance', settings.configFile);
          const symbols = new TypeScriptSymbols(capture, associations);
          if (capture.problems.length || symbols.problems.length) return { problems: [...capture.problems, ...symbols.problems], deferred: [] };
          for (const association of associations) {
            const nodes = symbols.selected(association.specId)[0]?.nodes;
            if (nodes?.length === 1 && (ts.isFunctionDeclaration(nodes[0]!) || ts.isInterfaceDeclaration(nodes[0]!) || ts.isTypeAliasDeclaration(nodes[0]!) || ts.isClassDeclaration(nodes[0]!)) && nodes[0].name && ts.getCombinedModifierFlags(nodes[0]) & ts.ModifierFlags.Export)
              targets.set(association.specId, { file: capture.projectPath(nodes[0].getSourceFile().fileName)!, name: nodes[0].name.text });
            if (nodes?.length === 1 && ts.isMethodDeclaration(nodes[0]!)) {
              const method = nodes[0], owner = method.parent;
              if (ts.isClassDeclaration(owner) && owner.name && ts.getCombinedModifierFlags(owner) & ts.ModifierFlags.Export
                && (ts.isIdentifier(method.name) || ts.isStringLiteralLike(method.name))) targets.set(association.specId, {
                  file: capture.projectPath(method.getSourceFile().fileName)!, name: owner.name.text, member: method.name.text,
                  instance: !(ts.getCombinedModifierFlags(method) & ts.ModifierFlags.Static),
                });
            }
          }
        }
      } finally { selection?.service.dispose(); }
      const bindings = new AcceptanceBindings(request.current, settings);
      bindings.retain(stored.value?.mappings ?? [], 'diff' in request ? request.diff : undefined);
      const driverNames = new Map<string, string>(), priorDriver = stored.value?.files.find(file => file.container?.role === 'driver');
      for (const item of request.current.baseline.artifacts) {
        if (!driver || item.locator.outputId !== 'acceptance' || item.locator.format !== 'typescript-symbol-1') continue;
        const location = item.locator.value as unknown as { file: string; declaration: Selector[] };
        if (location.file !== driver.file) continue;
        const operation = request.current.specification.inspection.read(request.current.node(item.specId)), name = bindings.name(operation),
          prior = (priorDriver?.renderedArtifacts ?? priorDriver?.artifacts)?.find(artifact => artifact.specId === item.specId),
          priorName = prior && (prior.locator.value as unknown as { declaration: Selector[] }).declaration.at(-1)!.name;
        driverNames.set(item.specId, !priorName || priorName === name ? location.declaration.at(-1)!.name : name);
      }
      const projection = new AcceptanceProjection(request.current, settings.domain, settings.testRoot, driver, targets, bindings,
        new Set([request.current.specification.entry, ...context?.workspaceModules ?? []]), fixture, driverNames), files = projection.files();
      if (bindings.problems.length) return { problems: bindings.problems, deferred: [] };
      if (projection.problems.length) return { problems: projection.problems, deferred: [] };
      const preservation = new AcceptancePreservation(basedOn, settings, stored.value, files, projection.artifacts, request.current.baseline.artifacts, driver, 'diff' in request ? request.diff : undefined);
      if (stored.value && ['create', 'insert'].includes(request.operation) && stored.value.files.some(file => {
        const after = preservation.state.files.find(item => item.id === file.id); return !after || file.hash !== after.hash;
      })) return failure(request.operation === 'insert' ? 'not-addition-only' : 'use-update', 'Existing acceptance contracts changed; use update.');
      preservation.state.mappings = bindings.mappings();
      preservation.state.deleted = preservation.state.deleted.filter(id => !projection.artifacts.some(item => item.specId === id));
      preservation.state.authored = [...request.current.specification.inspection.query('setup'), ...request.current.specification.inspection.query('action'),
        ...request.current.specification.inspection.query('observation'), ...request.current.specification.inspection.query('check')]
        .filter(operation => operation.body.kind === 'available' || operation.kind === 'check').map(operation => request.current.id(operation.id));
      if (stored.value) {
        const documents = new AcceptanceDocuments(basedOn, selectingFixture ? options.parse(JSON.parse(stored.value.options)) : settings, stored.value);
        try { const problems = documents.problems.filter(problem => ['generated-test-drift', 'unsupported-native-test', 'missing-native-test', 'ambiguous-native-test'].includes(problem.code));
          if (problems.length) return { problems: [...preservation.problems, ...problems], deferred: [] };
        } finally { documents.close(); }
      }
      if (preservation.problems.length) return { problems: preservation.problems, deferred: [] };
      if (driver || fixture || associations.length || settings.imports.length) {
        const changed = preservation.changes.filter(change => change.kind === 'write'), paths = new Set(preservation.changes.flatMap(change => change.kind === 'move' ? [change.from, change.to] : [change.path]));
        const snapshot = { ...basedOn, files: [...basedOn.files.filter(file => !paths.has(file.path)), ...changed.map(file => ({
          path: file.path, bytes: file.bytes, version: hash(file.bytes),
        }))] };
        const capture = new TypeScriptCapture(snapshot, 'acceptance', settings.configFile);
        try {
          const problems = [...capture.problems.map(problem => ({ ...problem, code: fixture ? 'incompatible-fixture' : 'incompatible-driver' })),
            ...nativeCompatibility(capture, settings, preservation.state, request.current, associations.filter(item => projection.runtimeTargets.has(item.specId)))];
          if (problems.length) return { problems, deferred: [] };
        }
        finally { capture.service.dispose(); }
      }
      const bytes = Buffer.from(canonical(preservation.state, 2) + '\n');
      if (!basedOn.files.some(file => file.path === acceptanceStatePath && file.version === hash(bytes))) preservation.changes.push({ kind: 'write', path: acceptanceStatePath, bytes });
      return success({ outputId: 'acceptance', basedOn, changes: preservation.changes, artifacts: preservation.state.files.flatMap(file => file.artifacts),
        obligations: [...projection.obligations, ...preservation.unfinished(projection.implementations)] });
    },
    async read(id, snapshot) { const state = acceptanceState(snapshot, settings), documents = new AcceptanceDocuments(snapshot, settings, state.value, state.problems);
      try { return documents.read(id); } finally { documents.close(); } },
    async search(id, snapshot) { const state = acceptanceState(snapshot, settings), documents = new AcceptanceDocuments(snapshot, settings, state.value, state.problems);
      try { return documents.search(id); } finally { documents.close(); } },
  }; },
};
