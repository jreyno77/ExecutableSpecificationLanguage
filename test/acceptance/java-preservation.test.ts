import { afterEach, describe, it } from 'vitest';
import { JavaPreservation } from '../dsl/java-preservation.js';

afterEach(() => JavaPreservation.dispose());
describe('Java contract changes preserve native implementations', { timeout: 120_000 }, () => {
  it('adopts a mapped native implementation without copying its body into the generated baseline', async () => {
    const p = await JavaPreservation.connect();
    p.source('class Store { public title\ncapability title() returns Text }');
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; public class Store { private final String chosen = "Dune"; public String title() { return chosen; } }');
    p.mapStore(file, 'store.Store', 'title', []); await p.rememberFile(file); await p.adopt();
    p.expectWritten(); p.expectFileUnchanged(file); p.expectGeneratedBaselineExcludes('return chosen;'); await p.runJava('System.out.print(new store.Store().title());'); p.expectStdout('Dune');
  });
  it('adds a visible unfinished operation while keeping the existing implementation', async () => {
    const p = await JavaPreservation.connect();
    p.source('class Store { public title\ncapability title() returns Text }');
    const file = 'src/main/java/store/Store.java';
    await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
    p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten();
    await p.update('class Store { public title, save\ncapability title() returns Text\ncapability save(title: Text) returns Nothing }');
    p.expectWritten(); p.expectText(file, 'return "Dune";'); await p.runJava('System.out.print(new store.Store().title());'); p.expectStdout('Dune');
    await p.runJava('new store.Store().save("Dune");'); p.expectStub('save');
  });
  it('renames the actual method and its unmodeled caller while preserving unrelated same-spelled code', async () => {
    const p = await JavaPreservation.connect();
    p.source('class Store { public title\ncapability title() returns Text }');
    const file = 'src/main/java/store/Store.java', caller = 'src/main/java/store/Launcher.java';
    await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
    await p.file(caller, 'package store; public class Launcher { public String read(Store store) { return store.title(); } } class Other { String title() { return "Other"; } String read() { return title(); } }');
    p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten();
    await p.update('class Store { public bookTitle\ncapability bookTitle() returns Text }', ['title', 'bookTitle']);
    p.expectWritten(); p.expectText(file, 'return "Dune";'); p.expectText(caller, 'store.bookTitle()'); p.expectText(caller, 'return title();');
    await p.runJava('System.out.print(new store.Launcher().read(new store.Store()));'); p.expectStdout('Dune');
  });
});

it('retains the full shared-file StoreGame implementation and its native data types', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  const contract = `opaque type SystemConfig
opaque type PlayerStateSnapshot
class StoreGame {
public startup, save, delete, new, shutDown
capability startup(configurations: SystemConfig) returns Nothing
capability save(snapshot: PlayerStateSnapshot) returns Nothing
capability delete() returns Nothing
capability new() returns PlayerStateSnapshot
capability shutDown() returns Nothing
}`;
  p.source(contract);
  const file = 'src/main/java/store/StoreGame.java';
  await p.file(file, `package store;
record SystemConfig(String gameRoot, double brightness) {}
record PlayerStateSnapshot(double x, double y, java.util.List<String> items) {}
public class StoreGame {
  private SystemConfig config; private PlayerStateSnapshot current; private boolean running;
  private final java.util.Map<String,PlayerStateSnapshot> storage = new java.util.HashMap<>();
  public void startup(SystemConfig configurations) { config=configurations; running=true; }
  public void save(PlayerStateSnapshot snapshot) { assertRunning(); current=snapshot; storage.put("store-game-save",snapshot); }
  public void delete() { assertRunning(); current=null; storage.remove("store-game-save"); }
  public PlayerStateSnapshot newGame() { assertRunning(); current=new PlayerStateSnapshot(0,0,java.util.List.of()); return current; }
  public void shutDown() { running=false; config=null; current=null; }
  private void assertRunning() { if(!running) throw new IllegalStateException("Game is not running"); }
}`);
  p.mapStoreGame(file); await p.rememberFile(file);
  await p.adopt({ imports: [
    { module: 'main', declaration: ['SystemConfig'], name: 'store.SystemConfig' },
    { module: 'main', declaration: ['PlayerStateSnapshot'], name: 'store.PlayerStateSnapshot' },
  ], names: [{ declaration: ['StoreGame', 'new'], name: 'newGame' }] });
  p.expectWritten(); p.expectFileUnchanged(file);
  await p.update(contract.replace('public startup,', 'public reset, startup,').replace('\n}', '\ncapability reset() returns Nothing\n}'));
  p.expectWritten(); p.expectRetainedPrefix(file);
  await p.runJava('var game=new StoreGame(); game.startup(new SystemConfig("Dune",0.5)); var snapshot=game.newGame(); game.save(snapshot); game.delete(); game.shutDown(); System.out.print(snapshot.items().size()+":"+snapshot.x());', 'store');
  p.expectStdout('0:0.0');
  await p.runJava('new StoreGame().reset();', 'store'); p.expectStub('reset');
});

it('updates promises while preserving the implemented body and handwritten documentation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing { promises "Save to disk." } }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { /** Keep the local retry policy. */ public void save(String title) { System.out.print("local:"+title); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten();
  await p.update('class Store { public save\ncapability save(title: Text) returns Nothing { promises "Persist the snapshot using Supabase." } }');
  p.expectWritten(); p.expectText(file, 'Keep the local retry policy.'); p.expectText(file, 'Persist the snapshot using Supabase.');
  p.expectText(file, 'Unverified implementation obligation.');
  await p.runJava('new store.Store().save("Dune");'); p.expectStdout('local:Dune');
});

it('changes a parameter type without erasing its comment or repairing the authored body', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(/* rationale */ String title) { System.out.print(title.toUpperCase()); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten();
  await p.update('class Store { public save\ncapability save(title: Number) returns Nothing }');
  p.expectWritten(); p.expectText(file, '/* rationale */'); p.expectText(file, 'double title'); p.expectText(file, 'title.toUpperCase()'); p.expectImplementationProblem(file,'title.toUpperCase()','double');
  await p.runJava('new store.Store().save(1);'); p.expectNativeProblem('double cannot be dereferenced');
});

it('adds a parameter while retaining the actual existing implementation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(/* title rationale */ String title) { System.out.print(title); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten();
  await p.update('class Store { public save\ncapability save(title: Text, copies: Number) returns Nothing }');
  p.expectWritten(); p.expectText(file, '/* title rationale */');
  await p.runJava('new store.Store().save("Dune",2);'); p.expectStdout('Dune');
});

it('refuses to discard a handwritten comment on a removed parameter', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text, copies: Number) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String title, /* copy rationale */ double copies) {} }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String', 'double']); await p.adopt(); p.expectWritten(); await p.rememberWrites();
  await p.update('class Store { public save\ncapability save(title: Text) returns Nothing }', undefined, ['copies']);
  p.expectConflictAt(file, 'copy rationale'); await p.expectNoWrites();
});

it('refuses an unrelated subclass member capturing a renamed caller', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java', caller = 'src/main/java/store/Child.java';
  await p.file(file, 'package store; public class Store { public void save(String title) {} }');
  await p.file(caller, 'package store; class Child extends Store { public void saveGame(String title) {} void run() { save("Dune"); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten(); await p.rememberWrites();
  await p.update('class Store { public saveGame\ncapability saveGame(title: Text) returns Nothing }', ['save', 'saveGame']);
  p.expectConflictAt(caller, 'save'); await p.expectNoWrites();
});

it('keeps an adopted throwing body manual when its contract is removed', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String title) { throw new java.lang.UnsupportedOperationException("Not implemented: save"); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String']); await p.adopt(); p.expectWritten(); await p.rememberWrites();
  await p.update('class Store {}', undefined, ['save']);
  p.expectConflictAt(file, 'save'); await p.expectNoWrites();
});

it('does not schedule writes when an adopted contract and baseline are already current', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public title\ncapability title() returns Text }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
  p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten();
  await p.planRepeat(); p.expectNoPlanChanges();
});

it('renames every generated default overload and its corresponding native calls', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text, copies: Number = 1) returns Nothing }');
  await p.generate(); p.expectWritten();
  const caller = 'src/main/java/store/Launcher.java';
  await p.file(caller, 'package store; public class Launcher { void run(Store store) { store.save("Dune"); store.save("Dune",2); } }');
  await p.update('class Store { public saveGame\ncapability saveGame(title: Text, copies: Number = 1) returns Nothing }', ['save', 'saveGame']);
  p.expectWritten(); p.expectText(caller, 'store.saveGame("Dune")'); p.expectText(caller, 'store.saveGame("Dune",2)');
  await p.runJava('new store.Store().saveGame("Dune");'); p.expectStub('saveGame');
  await p.runJava('new store.Store().saveGame("Dune",2);'); p.expectStub('saveGame');
});

it('deletes an unused untouched generated contract', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}');
  await p.generate(); p.expectWritten();
  await p.remove('Store'); p.expectDeletionWritten(); p.expectFileAbsent('src/main/java/store/Store.java');
});

it('refuses to delete a generated class with an actual unmodeled caller', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
  const caller = 'src/main/java/store/Launcher.java';
  await p.file(caller, 'package store; public class Launcher { Store make() { return new Store(); } }');
  await p.rememberWrites(); await p.remove('Store');
  p.expectConflictAt(caller, 'Store'); await p.expectNoWrites();
});

it('refuses deletion after the owned generated class acquires handwritten code', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { private String title = "Dune"; }');
  await p.rememberWrites(); await p.remove('Store');
  p.expectConflictAt(file, 'Store'); await p.expectNoWrites();
});

it('inserts and deletes a generated record without changing an adopted implementation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  const contract = 'class Store { public title\ncapability title() returns Text }';
  p.source(contract); const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
  p.mapStore(file, 'store.Store', 'title', []); await p.adopt(); p.expectWritten(); await p.rememberFile(file);
  await p.update(contract + '\ntype Book { title: Text }'); p.expectWritten(); p.expectFileUnchanged(file);
  await p.runJava('System.out.print(new store.Book("Dune").title()+new store.Store().title());'); p.expectStdout('DuneDune');
  await p.remove('Book'); p.expectDeletionWritten(['Store', 'title']); p.expectFileAbsent('src/main/java/store/Book.java'); p.expectFileUnchanged(file);
});

it('moves an untouched generated public class and its proven callers on a type rename', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
  const caller = 'src/main/java/store/Launcher.java';
  await p.file(caller, 'package store; public class Launcher { public Store make() { return new Store(); } }');
  await p.update('class Shop {}', ['Store', 'Shop']); p.expectWritten();
  p.expectFileAbsent('src/main/java/store/Store.java'); p.expectText('src/main/java/store/Shop.java', 'public class Shop');
  p.expectText(caller, 'Shop make() { return new Shop(); }');
  await p.runJava('System.out.print(new store.Launcher().make().getClass().getSimpleName());'); p.expectStdout('Shop');
});

it('removes an uncommented unused parameter while retaining the adopted method body', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text, copies: Number) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String title, double copies) { System.out.print(title); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String','double']); await p.adopt(); p.expectWritten();
  await p.update('class Store { public save\ncapability save(title: Text) returns Nothing }', undefined, ['copies']); p.expectWritten();
  await p.runJava('new store.Store().save("Dune");'); p.expectStdout('Dune');
});

it('preserves a standalone class comment and refuses ambiguous duplicate obligation documentation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save() returns Nothing { promises "Save to disk." } }'); await p.generate(); p.expectWritten();
  const file = 'src/main/java/store/Store.java';
  await p.annotateGeneratedClass(file, 'Keep this migration rationale.', 'Save to disk.'); await p.rememberWrites();
  await p.remove('Store'); p.expectConflictAt(file, 'Keep this migration rationale.');
  p.expectProblemCode('ambiguous-documentation'); await p.expectNoWrites();
});

it('repeats an unchanged error family and its generated exception companion without writes', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('error type Rejected<T> { code: "rejected"\npayload: T }');
  await p.generate(); p.expectWritten(); await p.planRepeat(); p.expectNoPlanChanges();
});

it('adds a top-level function to its shared generated class without replacing another implementation', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('function title() returns Text'); await p.generate(); p.expectWritten();
  const file = 'src/main/java/store/Functions.java';
  await p.file(file, 'package store; public final class Functions { private Functions() {} public static String title() { return "Dune"; } }');
  await p.update('function title() returns Text\nfunction save(title: Text) returns Nothing'); p.expectWritten();
  await p.runJava('System.out.print(store.Functions.title());'); p.expectStdout('Dune');
  await p.runJava('store.Functions.save("Dune");'); p.expectStub('save');
});


it('does not adopt a same-spelled method merely because its class is mapped', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store { public title\ncapability title() returns Text }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public String title() { return "Dune"; } }');
  p.mapOwner(file, 'store.Store'); await p.rememberWrites(); await p.adopt();
  p.expectConflictAt(file, 'title'); await p.expectNoWrites();
});

it('refuses swapped parameter names even when their native types agree', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(first: Text, second: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file, 'package store; public class Store { public void save(String second, String first) { System.out.print(first+second); } }');
  p.mapStore(file, 'store.Store', 'save', ['java.lang.String','java.lang.String']); await p.rememberWrites(); await p.adopt();
  p.expectConflictAt(file, 'second'); await p.expectNoWrites();
});


it('locates the actual read-only native caller that prevents a method rename', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store { public save\ncapability save(title: Text) returns Nothing }');
  const file = 'src/main/java/store/Store.java';
  await p.file(file,'package store; public class Store { public void save(String title) { System.out.print(title); } }');
  await p.nativeCaller('package catalog; public class Caller { public void run(store.Store target) { target.save("Dune"); } }');
  p.mapStore(file,'store.Store','save',['java.lang.String']); await p.adopt(); p.expectWritten(); await p.rememberWrites();
  await p.update('class Store { public saveGame\ncapability saveGame(title: Text) returns Nothing }',['save','saveGame']);
  await p.expectReadonlyConflict('save'); await p.expectNoWrites();
});


it('does not capture an untouched overload call while renaming another method', { timeout: 120_000 }, async () => {
  const p=await JavaPreservation.connect();
  p.source('class Store { public save\ncapability save(title: Text) returns Text }');
  const file='src/main/java/store/Store.java',caller='src/main/java/store/Launcher.java';
  await p.file(file,'package store; public class Store { public String save(String title) { return "Dune"; } public String bar(Object title) { return "Other"; } }');
  await p.file(caller,'package store; public class Launcher { public String read(Store store) { return store.bar("unrelated"); } public String save(Store store) { return store.save("Dune"); } }');
  p.mapStore(file,'store.Store','save',['java.lang.String']); await p.adopt(); p.expectWritten();
  await p.runJava('System.out.print(new store.Launcher().read(new store.Store()));'); p.expectStdout('Other'); await p.rememberWrites();
  await p.update('class Store { public bar\ncapability bar(title: Text) returns Text }',['save','bar']);
  p.expectProblemCode('native-binding-conflict'); p.expectConflictAt(caller,'bar'); await p.expectNoWrites();
});


describe('Java mappings extend without retargeting existing ownership', { timeout: 150_000 }, () => {
  it('adds a mapping for a new declaration while retaining existing native bytes', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.rememberFile('src/main/java/store/Store.java'); p.configureOutput({names:[{declaration:['Shelf'],name:'BookShelf'}]});
    await p.update('class Store {}\nclass Shelf {}'); p.expectWritten(); p.expectFileUnchanged('src/main/java/store/Store.java');
    p.expectText('src/main/java/store/BookShelf.java','public class BookShelf');
    await p.runJava('System.out.print(new store.BookShelf().getClass().getSimpleName());'); p.expectStdout('BookShelf');
  });
  it('accepts a redundant exact mapping without changing the owned declaration', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
    await p.rememberFile('src/main/java/store/Store.java'); p.configureOutput({names:[{declaration:['Store'],name:'Store'}]});
    await p.update('class Store {}'); p.expectWritten(); p.expectFileUnchanged('src/main/java/store/Store.java');
  });
  it('refuses a new mapping that would retarget an already-owned declaration', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten(); await p.rememberWrites();
    p.configureOutput({names:[{declaration:['Store'],name:'OtherStore'}]}); await p.update('class Store {}');
    p.expectProblemCode('output-options-changed'); await p.expectNoWrites();
  });
  it('follows an authored rename selector only while retaining its exact native mapping', async () => {
    const p=await JavaPreservation.connect(); p.source('class Store {}'); await p.generate({names:[{declaration:['Store'],name:'NativeStore'}]}); p.expectWritten();
    await p.rememberFile('src/main/java/store/NativeStore.java'); p.configureOutput({names:[{declaration:['Shop'],name:'NativeStore'}]});
    await p.update('class Shop {}',['Store','Shop']); p.expectWritten(); p.expectFileUnchanged('src/main/java/store/NativeStore.java');
    await p.rememberWrites(); p.configureOutput({names:[{declaration:['Shop'],name:'OtherStore'}]}); await p.update('class Shop {}');
    p.expectProblemCode('output-options-changed'); await p.expectNoWrites();
  });
});
