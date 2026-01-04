import "dotenv/config";

import { loadConfig } from "./config";
import { openDb } from "./db";
import { pollTradesAboveCashThreshold } from "./poller";
import { scoreWallet } from "./scoring";
import { createDiscord } from "./discord";
import { fmtMoney, nowUnix } from "./utils";

async function main() {
  const cfg = loadConfig();
  const dbh = await openDb(cfg.dbPath);
  await dbh.init();
  const discord = createDiscord(cfg.discordToken, cfg.discordAlertUserId);

  console.log(`DB: ${cfg.dbPath}`);
  console.log(`Polling every ${cfg.pollIntervalMs} ms | CASH_THRESHOLD=${cfg.cashThreshold} | pageSize=${cfg.pageSize} maxPages=${cfg.maxPagesPerPoll}`);

  async function backfillIfRequested() {
    if (cfg.backfillDays <= 0) return;

    const lastSeenTs = await dbh.getLastSeenTs();
    if (lastSeenTs > 0) {
      console.log(`Backfill skipped: DB not empty (lastSeenTs=${lastSeenTs})`);
      return;
    }

    const nowTs = nowUnix();
    const stopBeforeTs = nowTs - cfg.backfillDays * 86400;

    console.log(`Backfill: last ${cfg.backfillDays}d (stopBeforeTs=${stopBeforeTs})`);

    const trades = await pollTradesAboveCashThreshold({
      pageSize: cfg.pageSize,
      cashThreshold: cfg.cashThreshold,
      lastSeenTs: 0,
      overlapSeconds: 0,
      stopBeforeTs,
      maxPagesPerTick: cfg.maxPagesPerPoll,
      maxTradesPerTick: 2_000_000,
      sleepMsBetweenPages: 50
    });

    console.log(`Backfill fetched=${trades.length}`);
    if (!trades.length) return;

    const { inserted, maxTs } = await dbh.upsertTrades(trades);
    if (maxTs > 0) await dbh.setLastSeenTs(maxTs);

    console.log(`Backfill inserted=${inserted} setLastSeenTs=${maxTs}`);
  }

  async function tick() {
    const nowTs = nowUnix();
    const lastSeenTs = await dbh.getLastSeenTs();

    const trades = await pollTradesAboveCashThreshold({
      pageSize: cfg.pageSize,
      cashThreshold: cfg.cashThreshold,
      lastSeenTs,
      overlapSeconds: cfg.overlapSeconds,
      maxPagesPerTick: cfg.maxPagesPerPoll,
      maxTradesPerTick: 200_000,
      sleepMsBetweenPages: 50
    });

    if (!trades.length) return;

    const { inserted, maxTs, walletsTouched } = await dbh.upsertTrades(trades);
    if (maxTs > lastSeenTs) await dbh.setLastSeenTs(maxTs);

    // nur wenn wir wirklich neue Daten reinbekommen haben, scoren wir
    if (inserted === 0) return;

    const alerts = [];
    for (const w of walletsTouched) {
      const a = await scoreWallet(dbh.db, w, nowTs, cfg.cashThreshold, cfg.minOpenMinutes);
      if (a) alerts.push(a);
    }

    // sortiert: höchste score + größtes notional24h
    alerts.sort((a, b) => (b.score - a.score) || (b.notional24h - a.notional24h));

    console.log(`[${new Date().toISOString()}] fetched=${trades.length} inserted=${inserted} wallets=${walletsTouched.size} lastSeenTs=${await dbh.getLastSeenTs()}`);

    for (const a of alerts) {
      console.log(
        `ALERT score=${a.score} flags=${a.flags.join(",")}` +
        ` wallet=${a.proxyWallet}` +
        ` ageDays=${a.walletAgeDays.toFixed(2)}` +
        ` notional24h=$${fmtMoney(a.notional24h)}` +
        ` totalTrades=${a.totalTrades}` +
        ` topMarketShare7d=${(a.topMarketShare7d * 100).toFixed(0)}%` +
        ` uniqueEvents7d=${a.uniqueEvents7d}`
      );

      discord.sendAlertDM({
        score: a.score,
        flags: a.flags,
        proxyWallet: a.proxyWallet,
        walletAgeDays: a.walletAgeDays,
        notional24h: a.notional24h,
        totalTrades: a.totalTrades,
        topMarketShare7d: a.topMarketShare7d,
        uniqueEvents7d: a.uniqueEvents7d
      });
    }
  }

  await backfillIfRequested();
  await tick();

  setInterval(() => {
    tick().catch(err => console.error("tick error:", err));
  }, cfg.pollIntervalMs);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
