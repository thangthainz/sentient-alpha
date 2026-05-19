import type { Candle, Timeframe } from "@sentient-alpha/shared";
import { DATA_SOURCES } from "@sentient-alpha/shared";

const BASE = DATA_SOURCES.GECKO_TERMINAL;
const NETWORK = "mantle";

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
  const tf = TF_MAP[timeframe];
  const agg = TF_AGG[timeframe];
  const url = `${BASE}/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`GeckoTerminal OHLCV error (${res.status}): ${await res.text()}`);
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
  })).reverse();
}

export async function fetchTopPools(limit = 10): Promise<Array<{ address: string; name: string; volume24h: number; tvl: number }>> {
  const url = `${BASE}/networks/${NETWORK}/pools?page=1&sort=h24_volume_usd_desc`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GeckoTerminal pools error: ${res.status}`);

  const data = await res.json() as any;
  const pools = data?.data ?? [];

  return pools.slice(0, limit).map((p: any) => ({
    address: p.attributes?.address ?? p.id?.split("_")[1] ?? "",
    name: p.attributes?.name ?? "",
    volume24h: parseFloat(p.attributes?.volume_usd?.h24 ?? "0"),
    tvl: parseFloat(p.attributes?.reserve_in_usd ?? "0"),
  }));
}

export async function fetchTokenPrice(tokenAddress: string): Promise<number> {
  const url = `${BASE}/networks/${NETWORK}/tokens/${tokenAddress}/pools?page=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return 0;

  const data = await res.json() as any;
  const firstPool = data?.data?.[0];
  return parseFloat(firstPool?.attributes?.base_token_price_usd ?? "0");
}
