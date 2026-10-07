import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { SpecificationIdentity } from 'executable-specification-language';

// Deliberate corruption fixture, never a documented CLI ledger-editing recipe.
const file = 'game/.expec/identity.json', envelope = JSON.parse(await readFile(file, 'utf8'));
const identities = new SpecificationIdentity(() => { throw Error('No new identity is needed.'); });
const before = identities.read({ sourceId: file, text: JSON.stringify(envelope.baseline) });
assert.ok(before.value, JSON.stringify(before));
const cases = before.value.elements.filter(item => item.address.kind === 'example' && item.address.name === process.argv[2]);
assert.equal(cases.length, 1);
const artifacts = before.value.artifacts.filter(item => item.specId === cases[0].id && item.locator.outputId === 'acceptance' && item.locator.format === 'vitest-test-1');
assert.equal(artifacts.length, 1);
const after = identities.write({ ...before.value, artifacts: before.value.artifacts.filter(item => item !== artifacts[0]) });
assert.ok(after.value, JSON.stringify(after));
await writeFile(file, JSON.stringify({ ...envelope, baseline: JSON.parse(after.value) }));
