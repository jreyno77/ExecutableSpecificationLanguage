import { afterEach, it } from 'vitest';

import { JavaPreservation } from '../dsl/java-preservation.js';

afterEach(() => JavaPreservation.dispose());

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

it('preserves separate native data files and private bodies across an identity-backed rename', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect();
  const contract = 'opaque type SystemConfig\nopaque type PlayerStateSnapshot\nclass StoreGame {\npublic startup, save, delete, new, shutDown\ncapability startup(configurations: SystemConfig) returns Nothing\ncapability save(snapshot: PlayerStateSnapshot) returns Nothing\ncapability delete() returns Nothing\ncapability new() returns PlayerStateSnapshot\ncapability shutDown() returns Nothing\n}';
  p.source(contract);
  const configuration = 'package store; public record SystemConfig(String gameRoot, double brightness) {}\n';
  const snapshot = 'package store; public record PlayerStateSnapshot(double x, double y, java.util.List<String> items) {}\n';
  await p.file('src/main/java/store/SystemConfig.java', configuration);
  await p.file('src/main/java/store/PlayerStateSnapshot.java', snapshot);
  await p.file('src/main/java/store/StoreGame.java', `package store;
public class StoreGame {
  private SystemConfig config; private PlayerStateSnapshot current; private boolean running;
  private final java.util.Map<String,PlayerStateSnapshot> storage = new java.util.HashMap<>();
  public void startup(SystemConfig configurations) { config=configurations; running=true; }
  public void save(PlayerStateSnapshot snapshot) { assertRunning(); current=snapshot; storage.put("store-game-save",snapshot); }
  public void delete() { assertRunning(); current=null; storage.remove("store-game-save"); }
  public PlayerStateSnapshot newGame() { assertRunning(); current=new PlayerStateSnapshot(0,0,java.util.List.of()); return current; }
  public void shutDown() { running=false; config=null; current=null; }
  public String savedTitle() { return storage.get("store-game-save").items().get(0); }
  private void assertRunning() { if(!running) throw new IllegalStateException("Game is not running"); }
}`);
  const caller = 'package store; public class Launcher { public void run(StoreGame game, PlayerStateSnapshot state) { game.save(state); } }\n';
  await p.file('src/main/java/store/Launcher.java', caller); p.mapStoreGame('src/main/java/store/StoreGame.java');
  await p.adopt({ imports: [
    { module: 'main', declaration: ['SystemConfig'], name: 'store.SystemConfig' },
    { module: 'main', declaration: ['PlayerStateSnapshot'], name: 'store.PlayerStateSnapshot' },
  ], names: [{ declaration: ['StoreGame', 'new'], name: 'newGame' }] }); p.expectWritten();
  await p.update(contract.replace('startup, save,', 'startup, saveGame,').replace('capability save(', 'capability saveGame('), ['save', 'saveGame']);
  p.expectWritten(); p.expectFileText('src/main/java/store/SystemConfig.java', configuration);
  p.expectFileText('src/main/java/store/PlayerStateSnapshot.java', snapshot);
  p.expectFileText('src/main/java/store/Launcher.java', caller.replace('game.save(state)', 'game.saveGame(state)'));
  p.expectText('src/main/java/store/StoreGame.java', 'public void saveGame(PlayerStateSnapshot snapshot) { assertRunning(); current=snapshot; storage.put("store-game-save",snapshot); }');
  p.expectText('src/main/java/store/StoreGame.java', 'private void assertRunning() { if(!running) throw new IllegalStateException("Game is not running"); }');
  await p.search('saveGame'); p.expectUnmodeledUse('src/main/java/store/Launcher.java', 'game.saveGame(state)', 'saveGame');
  await p.runJava('var game=new store.StoreGame(); game.startup(new store.SystemConfig("library",0.5)); new store.Launcher().run(game,new store.PlayerStateSnapshot(1,2,java.util.List.of("Dune"))); System.out.print(game.savedTitle());');
  p.expectStdout('Dune');
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

it('moves an untouched generated public class and its proven callers on a type rename', { timeout: 120_000 }, async () => {
  const p = await JavaPreservation.connect(); p.source('class Store {}'); await p.generate(); p.expectWritten();
  const caller = 'src/main/java/store/Launcher.java';
  await p.file(caller, 'package store; public class Launcher { public Store make() { return new Store(); } }');
  await p.update('class Shop {}', ['Store', 'Shop']); p.expectWritten();
  p.expectFileAbsent('src/main/java/store/Store.java'); p.expectText('src/main/java/store/Shop.java', 'public class Shop');
  p.expectText(caller, 'Shop make() { return new Shop(); }');
  await p.runJava('System.out.print(new store.Launcher().make().getClass().getSimpleName());'); p.expectStdout('Shop');
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
