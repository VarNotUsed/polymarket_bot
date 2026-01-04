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

export async function getMarket(conditionId: string): Promise<Market | null> {
  const res = await fetch(`${GAMMA_URL}/markets/${conditionId}`, {
    headers: { accept: "application/json" }
  });
  if (!res.ok) return null;

  const raw = (await res.json()) as GammaMarketRaw;

  // harte Validierung – kein stilles Weiterlaufen
  if (typeof raw.closed !== "boolean") return null;

  return {
    conditionId,
    closed: raw.closed,
    closedTime: typeof raw.closedTime === "string" ? raw.closedTime : undefined,
    endDate: typeof raw.endDate === "string" ? raw.endDate : undefined
  };
}
