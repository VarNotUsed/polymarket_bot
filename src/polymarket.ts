export type TradeSide = "BUY" | "SELL";
export type FilterType = "CASH" | "TOKENS";

export type Trade = {
  proxyWallet: string;
  side: TradeSide;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number; // unix seconds
  title: string;
  slug: string;
  eventSlug?: string;
  outcome?: string;
  transactionHash?: string;
};

export type TradesQuery = {
  limit?: number;
  offset?: number;
  takerOnly?: boolean;
  filterType?: FilterType;
  filterAmount?: number;
};

const BASE_URL = "https://data-api.polymarket.com";

function toQueryString(q: TradesQuery): string {
  const p = new URLSearchParams();
  if (q.limit !== undefined) p.set("limit", String(q.limit));
  if (q.offset !== undefined) p.set("offset", String(q.offset));
  if (q.takerOnly !== undefined) p.set("takerOnly", String(q.takerOnly));
  if ((q.filterType === undefined) !== (q.filterAmount === undefined)) {
    throw new Error("filterType und filterAmount müssen gemeinsam gesetzt werden.");
  }
  if (q.filterType) p.set("filterType", q.filterType);
  if (q.filterAmount !== undefined) p.set("filterAmount", String(q.filterAmount));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "polymarket-scanner/0.1"
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url}\n${body.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

export async function getTradesPage(q: TradesQuery): Promise<Trade[]> {
  const url = `${BASE_URL}/trades${toQueryString(q)}`;
  return fetchJson<Trade[]>(url);
}
