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

async function fetchOhlcvChunk(
  poolAddress: string,
  timeframe: Timeframe,
  limit: number,
  beforeTimestamp?: number
): Promise<Candle[]> {
  const tf = TF_MAP[timeframe];
  const agg = TF_AGG[timeframe];
  const params = new URLSearchParams({ aggregate: String(agg), limit: String(limit) });
  if (beforeTimestamp) params.set("before_timestamp", String(beforeTimestamp));
  const url = `${BASE}/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${tf}?${params}`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) break;
    if (res.status === 429) {
      const backoff = (attempt + 1) * 15000;
      console.log(`[GeckoTerminal] 429 rate limit, retry in ${backoff / 1000}s (attempt ${attempt + 1}/4)`);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    throw new Error(`GeckoTerminal OHLCV error (${res?.status}): ${await res?.text()}`);
  }

  const data = await res.json() as any;
  const list = data?.data?.attributes?.ohlcv_list ?? [];

  return list.map((item: number[]) => ({
    timestamp: item[0],
    open: item[1],
    high: item[2],
    low: item[3],
    close: item[4],
    volume: item[5],
  }));
}

export async function fetchOhlcv(
  poolAddress: string,
  timeframe: Timeframe = "1h",
  limit = 200
): Promise<Candle[]> {
  const cacheKey = `${poolAddress}_${timeframe}_${limit}`;
  const cached = ohlcvCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const raw = await fetchOhlcvChunk(poolAddress, timeframe, Math.min(limit, 1000));
    const candles = raw.reverse();
    ohlcvCache.set(cacheKey, { data: candles, ts: Date.now() });
    return candles;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

/**
 * Fetch extended OHLCV history by paginating with before_timestamp.
 * Use for backtests requiring >1000 candles (~41 days for 1h).
 */
export async function fetchOhlcvExtended(
  poolAddress: string,
  timeframe: Timeframe = "1h",
  totalCandles = 4320 // 180 days @ 1h
): Promise<Candle[]> {
  const cacheKey = `${poolAddress}_${timeframe}_ext_${totalCandles}`;
  const cached = ohlcvCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL * 5) return cached.data;

  const chunkSize = 1000;
  const allCandles: Candle[] = [];
  let beforeTs: number | undefined = undefined;

  const chunksNeeded = Math.ceil(totalCandles / chunkSize);
  for (let i = 0; i < chunksNeeded; i++) {
    const remaining = totalCandles - allCandles.length;
    const chunk = await fetchOhlcvChunk(
      poolAddress,
      timeframe,
      Math.min(chunkSize, remaining),
      beforeTs
    );

    if (chunk.length === 0) break;
    allCandles.push(...chunk);

    // GeckoTerminal returns newest first; oldest is the last
    beforeTs = chunk[chunk.length - 1].timestamp;

    if (chunk.length < chunkSize) break;
    if (i < chunksNeeded - 1) await new Promise(r => setTimeout(r, 3000));
  }

  // Dedupe + sort oldest -> newest
  const seen = new Set<number>();
  const deduped = allCandles.filter(c => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });
  deduped.sort((a, b) => a.timestamp - b.timestamp);

  ohlcvCache.set(cacheKey, { data: deduped, ts: Date.now() });
  return deduped;
}

const STABLECOINS = ["usdt", "usdc", "usdt0", "usde", "dai", "frax", "lusd", "tusd", "busd", "musd"];

function isStablePair(name: string): boolean {
  const parts = name.toLowerCase().split("/").map(s => s.trim().split(" ")[0]);
  return parts.length === 2 && STABLECOINS.includes(parts[0]) && STABLECOINS.includes(parts[1]);
}

// In-memory + disk cache for pool discovery (rarely changes; cheap to skip 429s)
let poolsMemCache: { ts: number; data: Array<{ address: string; name: string; volume24h: number; tvl: number }> } | null = null;
const POOLS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function fetchTopPools(limit = 10): Promise<Array<{ address: string; name: string; volume24h: number; tvl: number }>> {
  if (poolsMemCache && Date.now() - poolsMemCache.ts < POOLS_CACHE_TTL) {
    return poolsMemCache.data.slice(0, limit);
  }

  const url = `${BASE}/networks/${NETWORK}/pools?page=1&sort=h24_volume_usd_desc`;
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) break;
    if (res.status === 429) {
      const backoff = (attempt + 1) * 10000;
      console.log(`[GeckoTerminal] Pools 429, retry in ${backoff/1000}s`);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    if (poolsMemCache) {
      console.log(`[GeckoTerminal] Using stale pools cache (API ${res?.status})`);
      return poolsMemCache.data.slice(0, limit);
    }
    throw new Error(`GeckoTerminal pools error: ${res?.status}`);
  }

  const data = await res.json() as any;
  const pools = data?.data ?? [];

  const filtered = pools
    .map((p: any) => ({
      address: p.attributes?.address ?? p.id?.split("_")[1] ?? "",
      name: p.attributes?.name ?? "",
      volume24h: parseFloat(p.attributes?.volume_usd?.h24 ?? "0"),
      tvl: parseFloat(p.attributes?.reserve_in_usd ?? "0"),
    }))
    .filter((p: { name: string }) => !isStablePair(p.name));

  poolsMemCache = { ts: Date.now(), data: filtered };
  return filtered.slice(0, limit);
}

export async function fetchTokenPrice(tokenAddress: string): Promise<number> {
  const url = `${BASE}/networks/${NETWORK}/tokens/${tokenAddress}/pools?page=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return 0;

  const data = await res.json() as any;
  const firstPool = data?.data?.[0];
  return parseFloat(firstPool?.attributes?.base_token_price_usd ?? "0");
}
