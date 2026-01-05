import type sqlite3 from "sqlite3";
import type { Database } from "sqlite";
import { getMarket } from "./gamma";

export type WalletAlert = {
  proxyWallet: string;
  score: number;
  flags: string[];
  walletAgeDays: number;
  totalTrades: number;
  notional24h: number;
  notional30d: number;
  uniqueEvents30d: number;
  uniqueMarkets30d: number;
  topMarketShare30d: number;
  firstSeen: number;
  lastSeen: number;

  minutesUntilClose?: number;
  marketConditionId?: string;
};

// Robust: ISO -> unix seconds, returns undefined on invalid/missing
function isoToUnixSeconds(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return Math.floor(ms / 1000);
}

export async function scoreWallet(
  db: Database<sqlite3.Database, sqlite3.Statement>,
  proxyWallet: string,
  nowTs: number,
  cashThreshold: number,
  minOpenMinutes: number
): Promise<WalletAlert | null> {
  const base = await db.get<{
    firstSeen: number | null;
    lastSeen: number | null;
    totalTrades: number;
  }>(
    `
    SELECT
      MIN(ts) AS firstSeen,
      MAX(ts) AS lastSeen,
      COUNT(*) AS totalTrades
    FROM trades
    WHERE proxy_wallet = ?
    `,
    proxyWallet
  );

  if (!base?.firstSeen || !base.lastSeen) return null;

  const firstSeen = Number(base.firstSeen);
  const lastSeen = Number(base.lastSeen);
  const totalTrades = Number(base.totalTrades);

  const since24h = nowTs - 86400;
  const since30d = nowTs - 30 * 86400;

  const w24 = await db.get<{ notional24h: number; trades24h: number }>(
    `
    SELECT
      COALESCE(SUM(notional), 0) AS notional24h,
      COUNT(*) AS trades24h
    FROM trades
    WHERE proxy_wallet = ?
      AND ts >= ?
    `,
    proxyWallet,
    since24h
  );

  const w30 = await db.get<{
    notional30d: number;
    uniqueMarkets30d: number;
    uniqueEvents30d: number;
  }>(
    `
    SELECT
      COALESCE(SUM(notional), 0) AS notional30d,
      COUNT(DISTINCT condition_id) AS uniqueMarkets30d,
      COUNT(DISTINCT event_slug) AS uniqueEvents30d
    FROM trades
    WHERE proxy_wallet = ?
      AND ts >= ?
    `,
    proxyWallet,
    since30d
  );

  const top = await db.get<{ condition_id: string; n: number }>(
    `
    SELECT
      condition_id,
      SUM(notional) AS n
    FROM trades
    WHERE proxy_wallet = ?
      AND ts >= ?
    GROUP BY condition_id
    ORDER BY n DESC
    LIMIT 1
    `,
    proxyWallet,
    since30d
  );

  const notional24h = Number(w24?.notional24h ?? 0);
  const trades24h = Number(w24?.trades24h ?? 0);

  const notional30d = Number(w30?.notional30d ?? 0);
  const uniqueMarkets30d = Number(w30?.uniqueMarkets30d ?? 0);
  const uniqueEvents30d = Number(w30?.uniqueEvents30d ?? 0);

  const topMarketNotional = Number(top?.n ?? 0);
  const topMarketShare30d = notional30d > 0 ? topMarketNotional / notional30d : 0;

  const walletAgeDays = (nowTs - firstSeen) / 86400;

  // --------- NEU: Market muss noch >= minOpenMinutes offen sein (Gamma: closed/closedTime/endDate) ----------
  const topConditionId = top?.condition_id;
  if (!topConditionId) return null;

  const market = await getMarket(topConditionId);
  if (!market) return null;

  // Gamma: `closed` ist das relevante Flag (nicht `resolved`)
  if (market.closed) return null;

  // Gamma: Zeiten sind ISO-Strings; bevorzugt closedTime, sonst endDate
  const closeTs =
    isoToUnixSeconds(market.closedTime) ??
    isoToUnixSeconds(market.endDate);

  let minutesUntilClose: number | undefined;
  if (typeof closeTs === "number") {
    minutesUntilClose = (closeTs - nowTs) / 60;
    if (minutesUntilClose < minOpenMinutes) return null;
  }
  // Wenn closeTs fehlt/unklar: lassen wir den Check passieren (alternativ: return null, wenn du strikt sein willst)

  // ---------------- Scoring ----------------
  const flags: string[] = [];
  let score = 0;

  const isNew = walletAgeDays <= 30;
  const isBig24h = notional24h >= cashThreshold;
  const isLowHistory = totalTrades <= 30;

  if (isNew && isBig24h && isLowHistory) {
    flags.push("NEW_WHALE");
    score += 6;
  }

  if (
    notional30d >= cashThreshold &&
    (topMarketShare30d >= 0.85 || (uniqueEvents30d > 0 && uniqueEvents30d <= 1))
  ) {
    flags.push("CONCENTRATED");
    score += 3;
  }

  if (trades24h >= 5 && totalTrades <= 15) {
    flags.push("BURST");
    score += 2;
  }

  if (score < 6) return null;

  return {
    proxyWallet,
    score,
    flags,
    walletAgeDays,
    totalTrades,
    notional24h,
    notional30d,
    uniqueEvents30d,
    uniqueMarkets30d,
    topMarketShare30d,
    firstSeen,
    lastSeen,
    minutesUntilClose,
    marketConditionId: topConditionId
  };
}
