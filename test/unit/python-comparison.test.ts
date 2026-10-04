import { describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function compare(example: string): Promise<void> {
  const python = process.env.EXPEC_TEST_PYTHON;
  if (!python) throw Error('Provide the explicit Python 3.12 interpreter.');
  const runtime = fileURLToPath(new URL('../../src/python/comparison.py', import.meta.url));
  const result = await promisify(execFile)(python, ['-I', '-S', '-B', '-c',
    'import runpy, sys\nglobals().update(runpy.run_path(sys.argv[1]))\n' + example, runtime], { windowsHide: true, timeout: 10_000 });
  expect(result.stderr).toBe('');
}

describe('Python comparison observes ordinary finite data', () => {
  it('accepts an exact integer count and treats negative zero as zero', () => compare('expect_data(1, 1.0)\nexpect_data(-0.0, 0.0)'));
  it('keeps Boolean separate from Number', () => compare('assert not equal(True, 1.0)\nassert not equal(False, 0.0)'));
  it('rejects an inexact integer and nonfinite observations', () => compare(`
for value in [9007199254740993, float("nan"), float("inf"), 10 ** 400]:
    try:
        number(value)
    except AssertionError as error:
        assert "Number" in str(error)
    else:
        raise AssertionError("Invalid Number was accepted")`));
  it('compares independently allocated records without conflating absence and None', () => compare(`
expect_data({"title": "Dune", "copies": 1}, {"copies": 1.0, "title": "Dune"})
assert not equal({"title": "Dune"}, {"title": "Dune", "note": None})
assert not equal([1.0, 2.0], (1.0, 2.0))`));
  it('refuses custom containers before invoking their access or equality hooks', () => compare(`
class Trap(dict):
    def __iter__(self): raise RuntimeError("iteration hook ran")
    def __getitem__(self, key): raise RuntimeError("access hook ran")
    def __eq__(self, other): raise RuntimeError("equality hook ran")
try:
    expect_data(Trap(title="Dune"), {"title": "Dune"})
except AssertionError as error:
    assert str(error) == "Expected ordinary comparison data"
else:
    raise AssertionError("Custom container was accepted")`));
  it('rejects cycles while allowing the same finite value in two positions', () => compare(`
book = {"title": "Dune"}
expect_data([book, book], [{"title": "Dune"}, {"title": "Dune"}])
loop = []
loop.append(loop)
try:
    data(loop)
except AssertionError as error:
    assert str(error) == "Cyclic comparison data"
else:
    raise AssertionError("Cyclic data was accepted")`));
});
