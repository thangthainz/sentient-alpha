/**
 * On-chain OHLCV reconstruction from Uniswap-V3-style Swap events.
 *
 * Fetches Swap events directly from a pool contract via Mantle RPC `eth_getLogs`,
 * parses sqrtPriceX96 to derive spot price, and aggregates into 1h OHLCV buckets.
 *
 * Used for backtest periods > 180 days (beyond GeckoTerminal Public API limit).
 * Pure on-chain data — no third-party API rate limits.
 */

import { JsonRpcProvider, Contract } from "ethers";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Candle, Timeframe } from "@sentient-alpha/shared";

// Uniswap V3 Swap event signature
// event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

// ERC20 + Pool ABIs (minimal)
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

interface RawSwap {
  blockNumber: number;
  timestamp: number;
  sqrtPriceX96: bigint;
  amount0: bigint;
  amount1: bigint;
}

interface PoolMeta {
  token0Decimals: number;
  token1Decimals: number;
  token0Symbol: string;
  token1Symbol: string;
}

const CACHE_DIR = "./data/onchain-cache";

function cachePath(pool: string, tf: Timeframe, days: number): string {
  return join(CACHE_DIR, `${pool.toLowerCase()}_${tf}_${days}d.json`);
}

function loadCache(pool: string, tf: Timeframe, days: number): Candle[] | null {
  const path = cachePath(pool, tf, days);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    // Cache valid for 24 hours
    if (Date.now() - data.cachedAt < 24 * 60 * 60 * 1000) return data.candles;
    return null;
  } catch {
    return null;
  }
}

function saveCache(pool: string, tf: Timeframe, days: number, candles: Candle[]): void {
  const path = cachePath(pool, tf, days);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ cachedAt: Date.now(), candles }), "utf-8");
}

/**
 * Parse a Uniswap V3 Swap log's data field.
 * Layout: amount0(int256) | amount1(int256) | sqrtPriceX96(uint160) | liquidity(uint128) | tick(int24)
 */
function parseSwapLog(data: string): { amount0: bigint; amount1: bigint; sqrtPriceX96: bigint } {
  // Remove 0x prefix
  const hex = data.startsWith("0x") ? data.slice(2) : data;

  // Each field is 32 bytes (64 hex chars)
  const amount0Hex = hex.slice(0, 64);
  const amount1Hex = hex.slice(64, 128);
  const sqrtPriceHex = hex.slice(128, 192);

  // Parse as signed (two's complement) for amounts
  const parseSigned = (h: string): bigint => {
    const v = BigInt("0x" + h);
    const max = 1n << 256n;
    const halfMax = 1n << 255n;
    return v >= halfMax ? v - max : v;
  };

  return {
    amount0: parseSigned(amount0Hex),
    amount1: parseSigned(amount1Hex),
    sqrtPriceX96: BigInt("0x" + sqrtPriceHex),
  };
}

/**
 * Compute price = token1 per token0 from sqrtPriceX96.
 * Adjusted for token decimals.
 */
function sqrtPriceToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  // price = (sqrtPriceX96 / 2^96)^2
  // To avoid precision loss, do math in fixed-point then convert
  const Q96 = 2n ** 96n;
  const ratio = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / (Q96 * Q96);
  const priceRaw = Number(ratio) / 1e18;
  // Adjust for decimals
  return priceRaw * Math.pow(10, decimals0 - decimals1);
}

async function fetchPoolMeta(provider: JsonRpcProvider, poolAddress: string): Promise<PoolMeta> {
  const pool = new Contract(poolAddress, POOL_ABI, provider);

  const [token0Addr, token1Addr] = await Promise.all([pool.token0(), pool.token1()]);

  const token0 = new Contract(token0Addr, ERC20_ABI, provider);
  const token1 = new Contract(token1Addr, ERC20_ABI, provider);

  const [d0, d1, s0, s1] = await Promise.all([
    token0.decimals(),
    token1.decimals(),
    token0.symbol().catch(() => "T0"),
    token1.symbol().catch(() => "T1"),
  ]);

  return {
    token0Decimals: Number(d0),
    token1Decimals: Number(d1),
    token0Symbol: String(s0),
    token1Symbol: String(s1),
  };
}

/**
 * Fetch all Swap logs from a pool over a block range, chunked + parallel.
 */
async function fetchSwapLogs(
  provider: JsonRpcProvider,
  poolAddress: string,
  fromBlock: number,
  toBlock: number,
  currentBlock: number,
  currentTimestamp: number,
  chunkSize: number = 20000,
  parallel: number = 6
): Promise<RawSwap[]> {
  const swaps: RawSwap[] = [];

  // Build chunk list
  const chunks: Array<[number, number]> = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = Math.min(cursor + chunkSize - 1, toBlock);
    chunks.push([cursor, end]);
    cursor = end + 1;
  }

  let processed = 0;
  let lastReport = Date.now();

  const fetchChunk = async (from: number, end: number): Promise<any[]> => {
    try {
      return await provider.send("eth_getLogs", [{
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
        address: poolAddress,
        topics: [SWAP_TOPIC],
      }]);
    } catch (err: any) {
      const half = Math.floor((end - from + 1) / 2);
      if (half < 100) throw err;
      const mid = from + half;
      const [a, b] = await Promise.all([
        fetchChunk(from, mid - 1),
        fetchChunk(mid, end),
      ]);
      return [...a, ...b];
    }
  };

  // Mantle block time ~2 seconds — estimate timestamps from block delta
  // ts = currentTs - (currentBlock - block) * 2
  const estimateTimestamp = (blockNum: number): number => {
    return (currentTimestamp - (currentBlock - blockNum) * 2) * 1000;
  };

  for (let i = 0; i < chunks.length; i += parallel) {
    const batch = chunks.slice(i, i + parallel);
    const results = await Promise.all(
      batch.map(([from, end]) => fetchChunk(from, end))
    );

    for (const logs of results) {
      for (const log of logs) {
        const blockNum = parseInt(log.blockNumber, 16);
        try {
          const parsed = parseSwapLog(log.data);
          swaps.push({
            blockNumber: blockNum,
            timestamp: estimateTimestamp(blockNum),
            ...parsed,
          });
        } catch { /* skip */ }
      }
    }

    processed += batch.length;
    if (Date.now() - lastReport > 10000) {
      const progress = (processed / chunks.length) * 100;
      console.log(`[onchain] Progress: ${progress.toFixed(1)}% (${processed}/${chunks.length} chunks) | Swaps: ${swaps.length}`);
      lastReport = Date.now();
    }
  }

  return swaps;
}

/**
 * Aggregate raw swaps into OHLCV candles for a given timeframe.
 */
function swapsToOhlcv(
  swaps: RawSwap[],
  timeframe: Timeframe,
  meta: PoolMeta
): Candle[] {
  if (swaps.length === 0) return [];

  const intervalMs: Record<Timeframe, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
  };

  const interval = intervalMs[timeframe];
  const buckets = new Map<number, { swaps: RawSwap[] }>();

  for (const swap of swaps) {
    const bucketTs = Math.floor(swap.timestamp / interval) * interval;
    let bucket = buckets.get(bucketTs);
    if (!bucket) {
      bucket = { swaps: [] };
      buckets.set(bucketTs, bucket);
    }
    bucket.swaps.push(swap);
  }

  const candles: Candle[] = [];
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);

  for (const bucketTs of sortedKeys) {
    const bucket = buckets.get(bucketTs)!;
    const prices = bucket.swaps.map(s =>
      sqrtPriceToPrice(s.sqrtPriceX96, meta.token0Decimals, meta.token1Decimals)
    );

    const volume = bucket.swaps.reduce(
      (sum, s) => sum + Math.abs(Number(s.amount0)) / Math.pow(10, meta.token0Decimals),
      0
    );

    candles.push({
      timestamp: bucketTs,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume,
    });
  }

  return candles;
}

/**
 * Main entry: fetch OHLCV for a pool over `days` of history using on-chain logs.
 *
 * Approximates blocks by Mantle block time (~2 seconds), then fetches Swap events,
 * parses sqrtPriceX96, and reconstructs OHLCV. Cached to disk for 24h.
 */
export async function fetchOhlcvOnchain(
  poolAddress: string,
  timeframe: Timeframe = "1h",
  days: number = 365,
  rpcUrl: string = "https://rpc.mantle.xyz"
): Promise<Candle[]> {
  // Check disk cache
  const cached = loadCache(poolAddress, timeframe, days);
  if (cached) {
    console.log(`[onchain] Cache hit: ${poolAddress} ${timeframe} ${days}d (${cached.length} candles)`);
    return cached;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const currentBlock = await provider.getBlockNumber();

  // Fetch current block timestamp once (anchor for estimation)
  const headBlock = await provider.send("eth_getBlockByNumber", [`0x${currentBlock.toString(16)}`, false]);
  const currentTimestamp = parseInt(headBlock.timestamp, 16);

  // Mantle block time ~2 seconds
  const BLOCKS_PER_DAY = 43_200;
  const fromBlock = Math.max(1, currentBlock - days * BLOCKS_PER_DAY);

  console.log(`[onchain] Fetching ${days}d of swap events for ${poolAddress}`);
  console.log(`[onchain] Block range: ${fromBlock} → ${currentBlock} (${currentBlock - fromBlock} blocks)`);

  const meta = await fetchPoolMeta(provider, poolAddress);
  console.log(`[onchain] Pool: ${meta.token0Symbol}/${meta.token1Symbol} (decimals ${meta.token0Decimals}/${meta.token1Decimals})`);

  const swaps = await fetchSwapLogs(provider, poolAddress, fromBlock, currentBlock, currentBlock, currentTimestamp);
  console.log(`[onchain] Fetched ${swaps.length} swap events`);

  const candles = swapsToOhlcv(swaps, timeframe, meta);
  console.log(`[onchain] Aggregated into ${candles.length} ${timeframe} candles`);

  saveCache(poolAddress, timeframe, days, candles);
  return candles;
}
