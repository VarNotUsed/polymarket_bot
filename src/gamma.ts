type Market = {
  conditionId: string;
  closed: boolean;
  closedTime?: string; // ISO
  endDate?: string;    // ISO
};

type GammaMarketRaw = {
  conditionId?: string;
  closed?: boolean;
  closedTime?: string;
  endDate?: string;
};

const GAMMA_URL = "https://gamma-api.polymarket.com";

const CACHE = new Map<string, { data: Market | null; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function getMarket(conditionId: string): Promise<Market | null> {
  const cached = CACHE.get(conditionId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const res = await fetch(`${GAMMA_URL}/markets/${conditionId}`, {
    headers: { accept: "application/json" }
  });
  if (!res.ok) return null;

  const raw = (await res.json()) as GammaMarketRaw;
  if (typeof raw.closed !== "boolean") return null;

  const market = {
    conditionId,
    closed: raw.closed,
    closedTime: typeof raw.closedTime === "string" ? raw.closedTime : undefined,
    endDate: typeof raw.endDate === "string" ? raw.endDate : undefined
  };

  CACHE.set(conditionId, { data: market, ts: Date.now() });
  return market;
}
