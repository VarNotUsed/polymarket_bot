import { getTradesPage, type Trade } from "./polymarket";

export type PollOptions = {
  pageSize: number;
  cashThreshold: number;
  lastSeenTs: number;
  overlapSeconds: number;

  stopBeforeTs?: number;

  // optional safety
  maxPagesPerTick?: number;      // default 1000
  maxTradesPerTick?: number;     // default 200_000
  sleepMsBetweenPages?: number;  // default 50
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pollTradesAboveCashThreshold(opts: PollOptions): Promise<Trade[]> {
  const {
    pageSize,
    cashThreshold,
    lastSeenTs,
    overlapSeconds,
    stopBeforeTs,
    maxPagesPerTick = 1000,
    maxTradesPerTick = 200_000,
    sleepMsBetweenPages = 50
  } = opts;

  const stopBefore =
    typeof stopBeforeTs === "number"
      ? stopBeforeTs
      : Math.max(0, lastSeenTs - overlapSeconds);

  const all: Trade[] = [];
  for (let page = 0; page < maxPagesPerTick && all.length < maxTradesPerTick; page++) {
    const offset = page * pageSize;

    const trades = await getTradesPage({
      limit: pageSize,
      offset,
      takerOnly: true,
      filterType: "CASH",
      filterAmount: cashThreshold
    });

    if (!trades.length) break;

    for (const t of trades) {
      if (t.timestamp >= stopBefore) all.push(t);
    }

    const oldest = trades[trades.length - 1]?.timestamp ?? 0;
    if (oldest <= stopBefore) break;

    if (sleepMsBetweenPages > 0) await sleep(sleepMsBetweenPages);
  }

  return all;
}
