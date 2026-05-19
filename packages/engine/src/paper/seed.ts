import { fetchOhlcvExtended } from "../data/gecko-terminal.js";
import { runBacktest } from "./backtest.js";
import type { PaperTrader, PaperTrade } from "./tracker.js";

export interface SeedConfig {
  pools: Array<{ address: string; name: string }>;
  daysBack: number;
  initialCapital: number;
  entryThreshold: number;
}

export interface SeedResult {
  totalTrades: number;
  trades: PaperTrade[];
  totalPnl: number;
  winRate: number;
  byPool: Record<string, { trades: number; pnl: number; winRate: number }>;
  startTime: number;
  endTime: number;
}

/**
 * Run backtest across multiple pools over an extended history,
 * then merge all closed trades into the live PaperTrader portfolio.
 *
 * This gives the agent a realistic starting point on first boot so the
 * dashboard has data immediately, while preserving the integrity of the
 * scoring + risk pipeline (all trades come from real Mantle market data).
 */
export async function seedPaperTrader(
  trader: PaperTrader,
  config: SeedConfig
): Promise<SeedResult> {
  const allTrades: PaperTrade[] = [];
  const byPool: Record<string, { trades: number; pnl: number; winRate: number }> = {};
  const now = Date.now();
  const startTime = now - config.daysBack * 24 * 60 * 60 * 1000;
  let totalPnl = 0;

  console.log(`[SEED] Replaying ${config.daysBack} days of history across ${config.pools.length} pools...`);

  for (const pool of config.pools) {
    try {
      console.log(`[SEED] Fetching extended history for ${pool.name}...`);
      const targetCandles = Math.min(config.daysBack * 24, 4320);
      const candles1h = await fetchOhlcvExtended(pool.address, "1h", targetCandles);

      if (candles1h.length < 250) {
        console.log(`[SEED] ${pool.name}: skipped (${candles1h.length} candles, need >=250)`);
        continue;
      }

      const candles4h = await fetchOhlcvExtended(pool.address, "4h", Math.ceil(targetCandles / 4));

      const result = runBacktest(candles1h, candles4h, pool.name, {
        initialCapital: config.initialCapital,
        maxConcurrentPositions: 3,
        slippageBps: 50,
        commissionBps: 30,
        entryThreshold: config.entryThreshold,
      });

      const wins = result.trades.filter(t => t.win).length;
      byPool[pool.name] = {
        trades: result.trades.length,
        pnl: result.stats.totalPnl,
        winRate: result.trades.length > 0 ? wins / result.trades.length : 0,
      };

      allTrades.push(...result.trades);
      totalPnl += result.stats.totalPnl;

      console.log(`[SEED] ${pool.name}: ${result.trades.length} trades, ${(byPool[pool.name].winRate * 100).toFixed(0)}% WR, $${result.stats.totalPnl.toFixed(2)} PnL`);
    } catch (err: any) {
      console.error(`[SEED] ${pool.name} failed: ${err.message}`);
    }
  }

  // Sort trades chronologically by entry time
  allTrades.sort((a, b) => a.entryTime - b.entryTime);

  // Inject trades into the live PaperTrader
  const portfolio = trader.toJSON();
  portfolio.closedTrades = allTrades;
  portfolio.winCount = allTrades.filter(t => t.win).length;
  portfolio.lossCount = allTrades.filter(t => !t.win).length;
  portfolio.totalPnl = totalPnl;
  portfolio.currentCapital = config.initialCapital + totalPnl;
  portfolio.peakCapital = Math.max(config.initialCapital, portfolio.currentCapital);

  // Reconstruct peak/drawdown from equity curve
  let equity = config.initialCapital;
  let peak = config.initialCapital;
  let maxDD = 0;
  for (const t of allTrades) {
    equity += t.pnl ?? 0;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  portfolio.peakCapital = peak;
  portfolio.maxDrawdown = maxDD;

  trader.fromJSON(portfolio);

  const winRate = allTrades.length > 0 ? portfolio.winCount / allTrades.length : 0;

  console.log(`[SEED] Complete: ${allTrades.length} trades, ${(winRate * 100).toFixed(1)}% WR, $${totalPnl.toFixed(2)} PnL, capital $${portfolio.currentCapital.toFixed(2)}`);

  return {
    totalTrades: allTrades.length,
    trades: allTrades,
    totalPnl,
    winRate,
    byPool,
    startTime,
    endTime: now,
  };
}
