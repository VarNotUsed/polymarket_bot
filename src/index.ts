import "dotenv/config";

import { loadConfig } from "./config";
import { openDb } from "./db";
import { pollTradesAboveCashThreshold } from "./poller";
import { scoreWallet } from "./scoring";
import { createDiscord } from "./discord";
import { nowUnix } from "./utils";

let running = false;

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
    const startedAt = Date.now();
    const iso = new Date().toISOString();

    // --- timing buckets ---
    let msLastSeen = 0;
    let msPoll = 0;
    let msUpsert = 0;
    let msSetLastSeen = 0;
    let msScoreTotal = 0;

    // --- counts ---
    let fetched = 0;
    let inserted = 0;
    let wallets = 0;
    let alertsCount = 0;

    // --- ts tracking ---
    let lastSeenTs = 0;
    let maxTs = 0;

    // --- optional perf detail (only a few items) ---
    const slowWallets: Array<{ w: string; ms: number }> = [];

    const nowTs = nowUnix();

    // lastSeen
    {
      const t = Date.now();
      lastSeenTs = await dbh.getLastSeenTs();
      msLastSeen = Date.now() - t;
    }

    // poll
    let trades;
    {
      const t = Date.now();
      trades = await pollTradesAboveCashThreshold({
        pageSize: cfg.pageSize,
        cashThreshold: cfg.cashThreshold,
        lastSeenTs,
        overlapSeconds: cfg.overlapSeconds,
        maxPagesPerTick: cfg.maxPagesPerPoll,
        maxTradesPerTick: 200_000,
        sleepMsBetweenPages: 0,
      });
      msPoll = Date.now() - t;
      fetched = trades.length;
    }

    if (!trades.length) {
      const dur = Date.now() - startedAt;
      console.log(
        `[${iso}] tick dur=${dur}ms poll=${msPoll}ms upsert=0ms score=0ms fetched=0 inserted=0 wallets=0 alerts=0 lastSeen=${lastSeenTs}`
      );
      return;
    }

    // upsert
    let walletsTouched: Set<string>;
    {
      const t = Date.now();
      const res = await dbh.upsertTrades(trades);
      msUpsert = Date.now() - t;

      inserted = res.inserted;
      maxTs = res.maxTs;
      walletsTouched = res.walletsTouched;

      wallets = walletsTouched.size;
    }

    // set lastSeen (only if advanced)
    if (maxTs > lastSeenTs) {
      const t = Date.now();
      await dbh.setLastSeenTs(maxTs);
      msSetLastSeen = Date.now() - t;
    }

    // if nothing new, one line and done
    if (inserted === 0) {
      const dur = Date.now() - startedAt;
      console.log(
        `[${iso}] tick dur=${dur}ms poll=${msPoll}ms upsert=${msUpsert}ms score=0ms fetched=${fetched} inserted=0 wallets=${wallets} alerts=0 lastSeen=${lastSeenTs} maxTs=${maxTs}`
      );
      return;
    }

    // scoring (keep serial; but measure total + capture worst offenders)
    for (const w of walletsTouched!) {
      const t = Date.now();
      const a = await scoreWallet(dbh.db, w, nowTs, cfg.cashThreshold, cfg.minOpenMinutes);
      const ms = Date.now() - t;

      msScoreTotal += ms;
      slowWallets.push({ w, ms });

      if (a) {
        alertsCount++;
        // keep discord behavior unchanged
        discord.sendAlertDM({
          score: a.score,
          flags: a.flags,
          proxyWallet: a.proxyWallet,
          walletAgeDays: a.walletAgeDays,
          notional24h: a.notional24h,
          totalTrades: a.totalTrades,
          topMarketShare30d: a.topMarketShare30d,
          uniqueEvents30d: a.uniqueEvents30d,
        });
      }
    }

    // top slow wallets (max 3) for debugging
    slowWallets.sort((a, b) => b.ms - a.ms);
    const slow3 = slowWallets
      .slice(0, 3)
      .map(x => `${x.w.slice(0, 6)}…${x.w.slice(-4)}:${x.ms}ms`)
      .join(" ");

    const dur = Date.now() - startedAt;

    // one good line per tick
    console.log(
      `[${iso}] tick dur=${dur}ms poll=${msPoll}ms upsert=${msUpsert}ms score=${msScoreTotal}ms` +
      ` fetched=${fetched} inserted=${inserted} wallets=${wallets} alerts=${alertsCount}` +
      ` lastSeen=${lastSeenTs} maxTs=${maxTs}` +
      (slow3 ? ` slow=${slow3}` : "")
    );
  }

  await backfillIfRequested();
  await tick();

  setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(); }
    finally { running = false; }
  }, cfg.pollIntervalMs);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
