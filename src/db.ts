import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import type { Trade } from "./polymarket";

export type Db = {
  db: Database<sqlite3.Database, sqlite3.Statement>;
  init(): Promise<void>;
  getLastSeenTs(): Promise<number>;
  setLastSeenTs(ts: number): Promise<void>;
  upsertTrades(trades: Trade[]): Promise<{ inserted: number; maxTs: number; walletsTouched: Set<string> }>;
};

export async function openDb(path: string): Promise<Db> {
  const db = await open({
    filename: path,
    driver: sqlite3.Database
  });

  async function init() {
    await db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_hash TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,

        proxy_wallet TEXT NOT NULL,
        condition_id TEXT NOT NULL,
        side TEXT NOT NULL,
        size REAL NOT NULL,
        price REAL NOT NULL,
        notional REAL NOT NULL,
        ts INTEGER NOT NULL,

        title TEXT,
        slug TEXT,
        event_slug TEXT,
        outcome TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trades_wallet_ts ON trades(proxy_wallet, ts);
      CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);
      CREATE INDEX IF NOT EXISTS idx_trades_condition_ts ON trades(condition_id, ts);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  function makeDedupeKey(t: Trade): string {
    if (t.transactionHash) return `tx:${t.transactionHash}`;
    return [
      "f",
      t.proxyWallet,
      t.conditionId,
      t.side,
      t.size.toFixed(8),
      t.price.toFixed(8),
      t.timestamp
    ].join("|");
  }

  async function getLastSeenTs(): Promise<number> {
    const row = await db.get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, "last_seen_ts");
    return row ? Number(row.value) : 0;
  }

  async function setLastSeenTs(ts: number): Promise<void> {
    await db.run(
      `INSERT INTO meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      "last_seen_ts",
      String(ts)
    );
  }

  async function upsertTrades(trades: Trade[]) {
    const walletsTouched = new Set<string>();
    let inserted = 0;
    let maxTs = 0;

    await db.exec("BEGIN");
    try {
      for (const t of trades) {
        walletsTouched.add(t.proxyWallet);
        if (t.timestamp > maxTs) maxTs = t.timestamp;

        const notional = t.size * t.price;
        const res = await db.run(
          `
          INSERT OR IGNORE INTO trades (
            transaction_hash, dedupe_key,
            proxy_wallet, condition_id, side, size, price, notional, ts,
            title, slug, event_slug, outcome
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          t.transactionHash ?? null,
          makeDedupeKey(t),
          t.proxyWallet,
          t.conditionId,
          t.side,
          t.size,
          t.price,
          notional,
          t.timestamp,
          t.title ?? null,
          t.slug ?? null,
          t.eventSlug ?? null,
          t.outcome ?? null
        );

        // sqlite3 liefert changes je nach wrapper; sqlite wrapper liefert "changes"
        if (typeof res?.changes === "number") inserted += res.changes;
      }

      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }

    return { inserted, maxTs, walletsTouched };
  }

  return { db, init, getLastSeenTs, setLastSeenTs, upsertTrades };
}
