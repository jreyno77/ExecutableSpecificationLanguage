type Pair<T> = [T, T];

type SystemConfig = {
  os: "windows";
  gameroot: URL;
  brightness: number;
};

type ShoppingCart = {
  items: unknown[];
};

type PlayerStateSnapshot = {
  characterPosition: Pair<number>;
  shoppingCart: ShoppingCart;
};

class StoreGame {
  private config: SystemConfig | null = null;
  private currentSnapshot: PlayerStateSnapshot | null = null;
  private running = false;

  startup(configurations: SystemConfig): void {
    this.config = configurations;
    this.running = true;

    console.log("Store Game starting...");
    console.log("Game root:", configurations.gameroot.toString());

    document.body.innerHTML = `
      <main id="store-game">
        <h1>Store Game</h1>
        <button id="new-game">New Game</button>
      </main>
    `;
  }

  save(snapshot: PlayerStateSnapshot): void {
    this.assertRunning();

    this.currentSnapshot = snapshot;

    localStorage.setItem(
      "store-game-save",
      JSON.stringify(snapshot)
    );
  }

  delete(): void {
    this.assertRunning();

    this.currentSnapshot = null;
    localStorage.removeItem("store-game-save");
  }

  new(): PlayerStateSnapshot {
    this.assertRunning();

    const snapshot: PlayerStateSnapshot = {
      characterPosition: [0, 0],
      shoppingCart: {
        items: [],
      },
    };

    this.currentSnapshot = snapshot;

    return snapshot;
  }

  shutDown(): void {
    this.running = false;
    this.config = null;
    this.currentSnapshot = null;

    document.body.innerHTML = "";
  }

  private assertRunning(): void {
    if (!this.running) {
      throw new Error("Store Game is not running.");
    }
  }
}

export const storeGame = new StoreGame();
