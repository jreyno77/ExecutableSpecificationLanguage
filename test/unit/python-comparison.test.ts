import { describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function compare(example: string): Promise<void> {
  const python = process.env.EXPEC_TEST_PYTHON;
  if (!python) throw Error('Provide the explicit Python 3.12 interpreter.');
  const runtime = fileURLToPath(new URL('../../src/project/python/runtime/comparison.py', import.meta.url));
  const result = await promisify(execFile)(python, ['-I', '-S', '-B', '-c',
    'import runpy, sys\nglobals().update(runpy.run_path(sys.argv[1]))\n' + example, runtime], { windowsHide: true, timeout: 10_000 });
  expect(result.stderr).toBe('');
}

describe('Python comparison observes ordinary finite data', () => {
  it('accepts an exact integer count and treats negative zero as zero', () => compare('expect_data(1, 1.0)\nexpect_data(-0.0, 0.0)'));
  it('keeps Boolean separate from Number', () => compare('assert not equal(True, 1.0)\nassert not equal(False, 0.0)'));
  it('keeps the dividend sign in a finite remainder', () => compare('expect_data(remainder(-5, 2), -1)\nexpect_data(remainder(5, -2), 1)\nexpect_data(remainder(-0.0, 2), 0)'));
  it('refuses a zero remainder divisor rather than returning comparison data', () => compare(`
try:
    remainder(1, -0.0)
except AssertionError as error:
    assert str(error) == "remainder by zero"
else:
    raise AssertionError("Zero divisor was accepted")`));
  it('rejects numeric conversion hooks and an overflowing integer without invoking the hook', () => compare(`
hooks = []
class Count(int):
    def __float__(self):
        hooks.append("called")
        return 1.0
for value in [Count(1), 10 ** 10000]:
    try:
        number(value)
    except AssertionError as error:
        assert "Number" in str(error)
    else:
        raise AssertionError("Invalid Number was accepted")
assert hooks == []`));
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
  it('does not let two wrong Text values satisfy their declared Number boundary', () => compare(`
try:
    expect_data(checked("Dune", [["Number"]], 0), checked("Dune", [["Number"]], 0))
except AssertionError as error:
    assert str(error) == "Expected a finite Number"
else:
    raise AssertionError("Matching wrong observations passed")`));
  it('rejects truthy Text where Boolean was declared', () => compare(`
try:
    checked("yes", [["Boolean"]], 0)
except AssertionError as error:
    assert str(error) == "Expected Boolean"
else:
    raise AssertionError("A truthy value became Boolean")`));
  it('checks known fields and permits only the declared optional key to be absent', () => compare(`
shapes = [["record", ["title", 1], ["note", 2]], ["Text"], ["optional", 1]]
book = {"title": "Dune"}
assert checked(book, shapes, 0) is book
for invalid in [{}, {"title": "Dune", "note": None}, {"title": "Dune", "unknown": 1}]:
    try:
        checked(invalid, shapes, 0)
    except AssertionError:
        pass
    else:
        raise AssertionError("Invalid declared record was accepted")`));
  it('validates finite recursive data without accepting a cyclic instance', () => compare(`
shapes = [["record", ["title", 1], ["children", 2]], ["Text"], ["List", 0]]
book = {"title": "Dune", "children": [{"title": "Chapter", "children": []}]}
assert checked(book, shapes, 0) is book
book["children"].append(book)
try:
    checked(book, shapes, 0)
except AssertionError as error:
    assert str(error) == "Cyclic comparison data"
else:
    raise AssertionError("Cyclic declared data was accepted")`));
  it('keeps aliased optional record data absent without accepting None', () => compare(`
shapes = [["record", ["note", 1]], ["alias", 2], ["optional", 3], ["Text"]]
assert checked({}, shapes, 0) == {}
try:
    checked({"note": None}, shapes, 0)
except AssertionError as error:
    assert str(error) == "Expected Text"
else:
    raise AssertionError("None was accepted as aliased absence")`));
});
