import type { OutputRegistration } from './output.js';
import { canonical, failure, success } from './identity-baseline.js';
import { AcceptanceProjection, type AcceptanceTarget } from './acceptance-projection.js';
import { hash } from './project-files.js';
import { TypeScriptCapture, diagnostic } from './typescript-capture.js';
import { TypeScriptSymbols, nativeSelection, type Selector } from './typescript-symbols.js';
import ts from 'typescript';
import { AcceptanceBindings, acceptanceOptions as options } from './acceptance-bindings.js';
import { acceptanceState, acceptanceStatePath } from './acceptance-state.js';
import { AcceptancePreservation } from './acceptance-preservation.js';
import { validDiff } from './output-contract.js';
import { AcceptanceDocuments } from './acceptance-documents.js';

export const acceptanceOutput: OutputRegistration = {
  id: 'acceptance',
  validate(value) { const parsed = options.safeParse(value); return parsed.success ? [] : parsed.error.issues.map(item => ({ path: item.path.map(String), message: item.message })); },
  open(value) { const settings = options.parse(value); return {
    id: 'acceptance',
    async plan(request, basedOn) {
      if (request.operation === 'delete') return failure('generation-unavailable', 'Acceptance deletion is not implemented.');
      const stored = acceptanceState(basedOn, settings);
      if (stored.problems.length) return { problems: stored.problems, deferred: [] };
      if ('diff' in request && !validDiff(request.diff, request.current)) return failure('inconsistent-diff', 'Provide the actual specification transition.');
      let driver: { file: string; name: string } | undefined;
      if (settings.driver) {
        if (!stored.value && !settings.adoptExisting || settings.driver.outputId !== 'acceptance' || settings.driver.format !== 'typescript-symbol-1') return failure('unowned-project-artifact', 'An existing driver requires exact native mapping and create-time adoption permission.');
        const capture = new TypeScriptCapture(basedOn, 'acceptance', settings.configFile);
        try {
          const location = settings.driver.value as unknown as { file: string; declaration: readonly Selector[] }, source = capture.program?.getSourceFile(capture.absolute(location.file));
          const selected = source && nativeSelection(source, location.declaration);
          if (capture.problems.length) return { problems: capture.problems, deferred: [] };
          if (selected?.length !== 1 || !ts.isClassDeclaration(selected[0]!) || !selected[0]!.name
            || !(ts.getCombinedModifierFlags(selected[0]!) & ts.ModifierFlags.Export)) return failure('incompatible-driver', 'Select one exported native driver class.');
          const node = selected[0] as ts.ClassDeclaration;
          driver = { file: capture.projectPath(node.getSourceFile().fileName)!, name: node.name!.text };
        } finally { capture.service.dispose(); }
      }
      const targets = new Map<string, AcceptanceTarget>();
      const associations = request.current.baseline.artifacts.filter(item => item.locator.outputId !== 'acceptance' && item.locator.format === 'typescript-symbol-1');
      if (associations.length) {
        const capture = new TypeScriptCapture(basedOn, 'acceptance', settings.configFile);
        try {
          const symbols = new TypeScriptSymbols(capture, associations);
          if (capture.problems.length || symbols.problems.length) return { problems: [...capture.problems, ...symbols.problems], deferred: [] };
          for (const association of associations) {
            const nodes = symbols.selected(association.specId)[0]?.nodes;
            if (nodes?.length === 1 && (ts.isFunctionDeclaration(nodes[0]!) || ts.isInterfaceDeclaration(nodes[0]!) || ts.isTypeAliasDeclaration(nodes[0]!) || ts.isClassDeclaration(nodes[0]!)) && nodes[0].name && ts.getCombinedModifierFlags(nodes[0]) & ts.ModifierFlags.Export)
              targets.set(association.specId, { file: capture.projectPath(nodes[0].getSourceFile().fileName)!, name: nodes[0].name.text });
          }
        } finally { capture.service.dispose(); }
      }
      const bindings = new AcceptanceBindings(request.current, settings);
      const projection = new AcceptanceProjection(request.current, settings.domain, settings.testRoot, driver, targets, bindings), files = projection.files();
      if (bindings.problems.length) return { problems: bindings.problems, deferred: [] };
      if (projection.problems.length) return { problems: projection.problems, deferred: [] };
      const preservation = new AcceptancePreservation(basedOn, settings, stored.value, files, projection.artifacts, request.current.baseline.artifacts, driver, 'diff' in request ? request.diff : undefined);
      if (preservation.problems.length) return { problems: preservation.problems, deferred: [] };
      preservation.state.authored = [...request.current.specification.inspection.query('setup'), ...request.current.specification.inspection.query('action'),
        ...request.current.specification.inspection.query('observation'), ...request.current.specification.inspection.query('check')]
        .filter(operation => operation.body.kind === 'available' || operation.kind === 'check').map(operation => request.current.id(operation.id));
      if (stored.value) {
        const documents = new AcceptanceDocuments(basedOn, settings, stored.value);
        try { const problems = documents.problems.filter(problem => ['generated-test-drift', 'unsupported-native-test', 'missing-native-test', 'ambiguous-native-test'].includes(problem.code));
          if (problems.length) return { problems, deferred: [] };
        } finally { documents.close(); }
      }
      if (driver || associations.length) {
        const changed = preservation.changes.filter(change => change.kind === 'write'), paths = new Set(changed.map(file => file.path));
        const snapshot = { ...basedOn, files: [...basedOn.files.filter(file => !paths.has(file.path)), ...changed.map(file => ({
          path: file.path, bytes: file.bytes, version: hash(file.bytes),
        }))] };
        const capture = new TypeScriptCapture(snapshot, 'acceptance', settings.configFile);
        try { if (capture.problems.length) return { problems: capture.problems.map(problem => ({ ...problem, code: 'incompatible-driver' })), deferred: [] }; }
        finally { capture.service.dispose(); }
      }
      const bytes = Buffer.from(canonical(preservation.state, 2) + '\n');
      if (!basedOn.files.some(file => file.path === acceptanceStatePath && file.version === hash(bytes))) preservation.changes.push({ kind: 'write', path: acceptanceStatePath, bytes });
      return success({ outputId: 'acceptance', basedOn, changes: preservation.changes, artifacts: preservation.state.files.flatMap(file => file.artifacts), obligations: projection.obligations });
    },
    async read(id, snapshot) { const state = acceptanceState(snapshot, settings), documents = new AcceptanceDocuments(snapshot, settings, state.value, state.problems);
      try { return documents.read(id); } finally { documents.close(); } },
    async search(id, snapshot) { const state = acceptanceState(snapshot, settings), documents = new AcceptanceDocuments(snapshot, settings, state.value, state.problems);
      try { return documents.search(id); } finally { documents.close(); } },
  }; },
};
