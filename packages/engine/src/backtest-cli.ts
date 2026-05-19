import "dotenv/config";
import { fetchOhlcv, fetchTopPools } from "./data/gecko-terminal.js";
import { runBacktest, formatBacktestReport } from "./paper/backtest.js";
import { TradingMemoryStore } from "./memory/store.js";

async function main() {
  const poolArg = process.argv[2];
  const daysArg = parseInt(process.argv[3] ?? "30", 10);

  console.log("==========================================");
  console.log("  Sentient Alpha — Backtest Engine");
  console.log("==========================================\n");

  const memory = new TradingMemoryStore("./data/trading-memory.json");
  console.log(`[MEMORY] ${memory.getStats().total} memories loaded\n`);

  let poolAddress: string;
  let poolName: string;

  if (poolArg) {
    poolAddress = poolArg;
    poolName = poolArg;
  } else {
    console.log("[BACKTEST] No pool specified, fetching top Mantle pool...");
    const pools = await fetchTopPools(1);
    if (pools.length === 0) {
      console.error("[ERROR] No pools found on GeckoTerminal");
      process.exit(1);
    }
    poolAddress = pools[0].address;
    poolName = pools[0].name;
  }

  console.log(`[BACKTEST] Pool: ${poolName} (${poolAddress})`);
  console.log(`[BACKTEST] Fetching ${daysArg * 24} 1h candles...\n`);

  const candles1h = await fetchOhlcv(poolAddress, "1h", Math.min(daysArg * 24, 1000));
  const candles4h = await fetchOhlcv(poolAddress, "4h", Math.min(daysArg * 6, 500));

  console.log(`[DATA] 1h candles: ${candles1h.length} | 4h candles: ${candles4h.length}`);

  if (candles1h.length < 250) {
    console.error(`[ERROR] Need at least 250 1h candles, got ${candles1h.length}`);
    process.exit(1);
  }

  console.log("[BACKTEST] Running...\n");
  const result = runBacktest(candles1h, candles4h, poolName, {
    initialCapital: 10000,
    maxConcurrentPositions: 3,
    slippageBps: 50,
    commissionBps: 30,
  });

  console.log(formatBacktestReport(result, poolName));

  // Save insights if significant
  if (result.stats.totalTrades >= 5) {
    const { TradingLearner } = await import("./memory/learner.js");
    const learner = new TradingLearner();
    const insights = await learner.analyzeTradePatterns(
      result.trades,
      memory.getAll(),
      process.env.ACE_API_KEY || undefined
    );
    if (insights.length > 0) {
      console.log(`\n[INSIGHTS] Discovered ${insights.length} patterns:`);
      for (const insight of insights) {
        console.log(`  - ${insight.pattern}`);
        console.log(`    → ${insight.suggestion} (confidence: ${(insight.confidence * 100).toFixed(0)}%)`);
        memory.addInsight(insight);
      }
    }
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
