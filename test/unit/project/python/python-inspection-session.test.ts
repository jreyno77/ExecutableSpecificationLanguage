import { describe, expect, it } from 'vitest';
import { PythonInspectionUnit } from '../../../dsl/project/python/python-inspection-unit.js';

describe('private Python inspection reuse at its caller boundary', () => {
  it('reads and searches an equal capture with one analysis and real native byte verification', async () => {
    const p = await PythonInspectionUnit.connect(); p.expectRead(await p.read());
    const reads = p.rememberNativeReads(); p.expectSearch(await p.search());
    p.expectNativeBytesReadAfter(reads); p.expectAttempts(1);
  });
  it('keeps returned bytes and definitions independent from later answers', async () => {
    const p = await PythonInspectionUnit.connect(), first = await p.read(), search = await p.search();
    first.artifacts[0]!.file.bytes[0] = 0;
    (search.definitions[0]!.value as { declaration: { name: string }[] }).declaration[0]!.name = 'Wrong';
    p.expectRead(await p.read()); p.expectSearch(await p.search()); p.expectAttempts(1);
  });
  it('analyzes changed supplied bytes despite the retained editable version', async () => {
    const p = await PythonInspectionUnit.connect(); p.expectRead(await p.read());
    const version = p.driver.snapshot.files.find(file => file.path === 'src/store.py')!.version;
    p.driver.changeSupplied('# New human comment.\nclass StoreGame:\n    pass\n');
    p.expectRead(await p.read(), '# New human comment.\nclass StoreGame:\n    pass\n');
    expect(p.driver.snapshot.files.find(file => file.path === 'src/store.py')!.version).toBe(version); p.expectAttempts(2);
  });
  it('starts an independent analysis for another reader', async () => {
    const p = await PythonInspectionUnit.connect(); p.expectRead(await p.read());
    p.expectRead(await p.driver.read(p.driver.newReader())); p.expectAttempts(2);
  });
  it('does not poison the session with an invalid native answer', async () => {
    const p = await PythonInspectionUnit.connect(); p.driver.invalidNext();
    p.expectRefused(await p.read(), 'invalid-python-result'); p.expectRead(await p.read());
    p.expectSearch(await p.search()); p.expectAttempts(2);
  });
  it('does not publish an older completed analysis over the newer capture', async () => {
    const p = await PythonInspectionUnit.connect(); p.driver.holdNext();
    const older = p.read(); await p.driver.started();
    p.driver.changeSupplied('# Newer capture.\nclass StoreGame:\n    pass\n');
    p.expectRead(await p.read(), '# Newer capture.\nclass StoreGame:\n    pass\n');
    p.driver.finishHeld(); p.expectRead(await older);
    p.expectRead(await p.read(), '# Newer capture.\nclass StoreGame:\n    pass\n'); p.expectAttempts(2);
  });
  it('refuses changed actual native bytes after a successful answer', async () => {
    const p = await PythonInspectionUnit.connect(); p.expectSearch(await p.search());
    await p.driver.changeNative(); p.expectRefused(await p.search(), 'native-input-changed'); p.expectAttempts(1);
  });
  it('does not treat mismatching supplied native versions as a cache hit', async () => {
    const p = await PythonInspectionUnit.connect(); p.expectRead(await p.read());
    p.driver.nativeVersion('0'.repeat(64)); p.expectRefused(await p.read(), 'native-input-changed'); p.expectAttempts(1);
  });
  it('discards facts when actual native bytes change during scratch cleanup', async () => {
    const p = await PythonInspectionUnit.connect(); p.driver.changeDuringCleanup();
    p.expectRefused(await p.read(), 'native-input-changed'); p.expectCleanupMutation();
  });
  it.each(['schema', 'nonzero', 'semantic'] as const)('does not cache a %s native result', async failure => {
    const p = await PythonInspectionUnit.connect(); p.driver.failNext(failure);
    const failed = await p.read();
    if (failure === 'semantic') { expect(failed.problems.map(problem => problem.code)).toContain('generated-tests-changed'); expect(failed.coverage.complete).toBe(false); }
    else p.expectRefused(failed, failure === 'schema' ? 'invalid-python-result' : 'python-inspection-failed');
    p.expectRead(await p.read()); p.expectSearch(await p.search()); p.expectAttempts(2);
  });
  it('retains a thrown analyzer failure and allows a later valid answer', async () => {
    const p = await PythonInspectionUnit.connect(); p.driver.failNext('throw');
    await expect(p.read()).rejects.toThrow('Owned analyzer failed.');
    p.expectRead(await p.read()); p.expectSearch(await p.search()); p.expectAttempts(2);
  });
  it('preserves a cleanup failure instead of publishing its facts', async () => {
    const p = await PythonInspectionUnit.connect(); p.driver.failDuringCleanup();
    await expect(p.read()).rejects.toThrow('Owned scratch cleanup failed.');
    await expect(p.read()).rejects.toThrow('Owned scratch cleanup failed.'); p.expectAttempts(2);
  });
  it('keeps the in-flight supplied bytes independent from a caller mutation', async () => {
    const p = await PythonInspectionUnit.connect(); p.driver.holdNext();
    const original = p.driver.snapshot, older = p.read(); await p.driver.started();
    const bytes = original.files.find(file => file.path === 'src/store.py')!.bytes;
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).write('None', Buffer.from(bytes).indexOf('pass'));
    p.driver.finishHeld(); p.expectRead(await older);
    p.expectRead(await p.read(), 'class StoreGame:\n    None\n'); p.expectSearch(await p.search()); p.expectAttempts(2);
  });
  it('separates base facts and exact ordered integrity requests', async () => {
    const p = await PythonInspectionUnit.connect(), tests = [
      { file: 'test/acceptance/test_store.py', text: 'assert quantity == 1\n', driver: false },
      { file: 'test/driver/store.py', text: 'class StoreDriver: pass\n', driver: true },
    ];
    expect((await p.driver.inspect()).problems).toEqual([]);
    expect((await p.driver.inspect(tests)).problems).toEqual([]);
    expect((await p.driver.inspect(structuredClone(tests))).problems).toEqual([]); p.expectAttempts(2);
    expect((await p.driver.inspect([...tests].reverse())).problems).toEqual([]); p.expectAttempts(3);
    tests[0]!.text = 'assert quantity == 2\n';
    expect((await p.driver.inspect(tests)).problems).toEqual([]); p.expectAttempts(4);
    tests[0]!.driver = true;
    expect((await p.driver.inspect(tests)).problems).toEqual([]); p.expectAttempts(5);
  });
  it('never certifies an integrity request from unsuccessful native assertions', async () => {
    const p = await PythonInspectionUnit.connect(), tests = [{ file: 'test/acceptance/test_store.py', text: 'assert quantity == 1\n', driver: false }];
    p.driver.failNext('semantic'); expect((await p.driver.inspect(tests)).problems.map(problem => problem.code)).toContain('generated-tests-changed');
    expect((await p.driver.inspect(tests)).problems).toEqual([]);
    expect((await p.driver.inspect(tests)).problems).toEqual([]); p.expectAttempts(2);
  });
  it('keys the selected configuration filename and native evidence order independently', async () => {
    const p = await PythonInspectionUnit.connect(); p.driver.copyConfiguration('custom.python.json');
    expect((await p.driver.inspect()).problems).toEqual([]);
    expect((await p.driver.inspect(undefined, 'custom.python.json')).problems).toEqual([]); p.expectAttempts(2);
    p.driver.snapshot = { ...p.driver.snapshot, nativeInputs: [...p.driver.snapshot.nativeInputs!].reverse() };
    expect((await p.driver.inspect(undefined, 'custom.python.json')).problems).toEqual([]); p.expectAttempts(3);
  });
  it('does not retain a hit whose caller changes its baseline while native bytes are verified', async () => {
    const p = await PythonInspectionUnit.connect(), tests = [{ file: 'test/acceptance/test_store.py', text: 'assert quantity == 1\n', driver: false }];
    p.expectInspection(await p.driver.inspect(tests)); const reads = p.rememberNativeReads();
    p.driver.holdNextCatalogRead(); const hit = p.driver.inspect(tests);
    await p.driver.catalogReadStarted(); p.expectNativeBytesReadAfter(reads);
    tests[0]!.text = 'assert quantity == 2\n'; p.driver.releaseCatalogRead();
    p.expectInspection(await hit); p.expectAttempts(1);
    tests[0]!.text = 'assert quantity == 1\n';
    p.expectInspection(await p.driver.inspect(tests)); p.expectAttempts(2);
  });
  it('does not let a mutated older hit discard a newer successful request', async () => {
    const p = await PythonInspectionUnit.connect(), tests = [{ file: 'test/acceptance/test_store.py', text: 'assert quantity == 1\n', driver: false }];
    p.expectInspection(await p.driver.inspect(tests)); p.driver.holdNextCatalogRead();
    const older = p.driver.inspect(tests); await p.driver.catalogReadStarted();
    tests[0]!.text = 'assert quantity == 2\n'; p.expectInspection(await p.driver.inspect(tests));
    p.driver.releaseCatalogRead(); p.expectInspection(await older);
    p.expectInspection(await p.driver.inspect(tests)); p.expectAttempts(2);
  });
});
