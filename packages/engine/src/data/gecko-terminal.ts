import type { Candle, Timeframe } from "@sentient-alpha/shared";
import { DATA_SOURCES } from "@sentient-alpha/shared";

const BASE = DATA_SOURCES.GECKO_TERMINAL;
const NETWORK = "mantle";

const ohlcvCache = new Map<string, { data: Candle[]; ts: number }>();
const CACHE_TTL = 120_000;

const TF_MAP: Record<Timeframe, string> = {
  "1m": "minute",
  "5m": "minute",
  "15m": "minute",
  "1h": "hour",
  "4h": "hour",
  "1d": "day",
};

const TF_AGG: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 1,
  "4h": 4,
  "1d": 1,
};

export async function fetchOhlcv(
  poolAddress: string,
  timeframe: Timeframe = "1h",
  limit = 200
): Promise<Candle[]> {
  const cacheKey = `${poolAddress}_${timeframe}_${limit}`;
  const cached = ohlcvCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const tf = TF_MAP[timeframe];
  const agg = TF_AGG[timeframe];
  const url = `${BASE}/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) break;
    if (res.status === 429) {
      if (cached && attempt === 3) return cached.data;
      const backoff = (attempt + 1) * 15000;
      console.log(`[GeckoTerminal] 429 rate limit, retry in ${backoff/1000}s (attempt ${attempt + 1}/4)`);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    if (cached) return cached.data;
    throw new Error(`GeckoTerminal OHLCV error (${res?.status}): ${await res?.text()}`);
  }

  const data = await res.json() as any;
  const list = data?.data?.attributes?.ohlcv_list ?? [];

  const candles = list.map((item: number[]) => ({
    timestamp: item[0],
    open: item[1],
    high: item[2],
    low: item[3],
    close: item[4],
    volume: item[5],
  })).reverse();

  ohlcvCache.set(cacheKey, { data: candles, ts: Date.now() });
  return candles;
}

const STABLECOINS = ["usdt", "usdc", "usdt0", "usde", "dai", "frax", "lusd", "tusd", "busd", "musd"];

function isStablePair(name: string): boolean {
  const parts = name.toLowerCase().split("/").map(s => s.trim().split(" ")[0]);
  return parts.length === 2 && STABLECOINS.includes(parts[0]) && STABLECOINS.includes(parts[1]);
}

export async function fetchTopPools(limit = 10): Promise<Array<{ address: string; name: string; volume24h: number; tvl: number }>> {
  const url = `${BASE}/networks/${NETWORK}/pools?page=1&sort=h24_volume_usd_desc`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GeckoTerminal pools error: ${res.status}`);

  const data = await res.json() as any;
  const pools = data?.data ?? [];

  return pools
    .map((p: any) => ({
      address: p.attributes?.address ?? p.id?.split("_")[1] ?? "",
      name: p.attributes?.name ?? "",
      volume24h: parseFloat(p.attributes?.volume_usd?.h24 ?? "0"),
      tvl: parseFloat(p.attributes?.reserve_in_usd ?? "0"),
    }))
    .filter((p: { name: string }) => !isStablePair(p.name))
    .slice(0, limit);
}

export async function fetchTokenPrice(tokenAddress: string): Promise<number> {
  const url = `${BASE}/networks/${NETWORK}/tokens/${tokenAddress}/pools?page=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return 0;

  const data = await res.json() as any;
  const firstPool = data?.data?.[0];
  return parseFloat(firstPool?.attributes?.base_token_price_usd ?? "0");
}
