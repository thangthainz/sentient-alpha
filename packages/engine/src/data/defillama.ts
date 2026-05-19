import { DATA_SOURCES } from "@sentient-alpha/shared";

const BASE = DATA_SOURCES.DEFILLAMA;

export interface ProtocolTvl {
  name: string;
  tvl: number;
  change1d: number;
  change7d: number;
  chain: string;
}

export async function fetchMantleTvl(): Promise<number> {
  const res = await fetch(`${BASE}/v2/chains`);
  if (!res.ok) throw new Error(`DeFiLlama chains error: ${res.status}`);
  const chains = await res.json() as any[];
  const mantle = chains.find((c: any) => c.name?.toLowerCase() === "mantle" || c.gecko_id === "mantle");
  return mantle?.tvl ?? 0;
}

export async function fetchProtocolTvls(): Promise<ProtocolTvl[]> {
  const res = await fetch(`${BASE}/protocols`);
  if (!res.ok) throw new Error(`DeFiLlama protocols error: ${res.status}`);
  const protocols = await res.json() as any[];

  return protocols
    .filter((p: any) => p.chains?.includes("Mantle"))
    .map((p: any) => ({
      name: p.name,
      tvl: p.chainTvls?.Mantle ?? p.tvl ?? 0,
      change1d: p.change_1d ?? 0,
      change7d: p.change_7d ?? 0,
      chain: "Mantle",
    }))
    .sort((a: ProtocolTvl, b: ProtocolTvl) => b.tvl - a.tvl)
    .slice(0, 20);
}

export async function fetchProtocolHistory(slug: string): Promise<Array<{ date: number; tvl: number }>> {
  const res = await fetch(`${BASE}/protocol/${slug}`);
  if (!res.ok) throw new Error(`DeFiLlama protocol error: ${res.status}`);
  const data = await res.json() as any;
  const chainTvls = data?.chainTvls?.Mantle?.tvl ?? data?.tvl ?? [];
  return chainTvls.map((entry: any) => ({
    date: entry.date,
    tvl: entry.totalLiquidityUSD ?? 0,
  }));
}
