import type { Candle, Timeframe } from "@sentient-alpha/shared";
import { SCORING } from "@sentient-alpha/shared";
import { computeIndicators } from "../indicators/index.js";
import { detectZones } from "../indicators/zones.js";
import { detectBestSetup } from "../scoring/setups.js";
import { scoreSignal } from "../scoring/scorer.js";
import { RiskManager } from "../risk/manager.js";
import { PaperTrader } from "./tracker.js";
import type { PaperTrade } from "./tracker.js";

export interface BacktestConfig {
  initialCapital: number;
  maxConcurrentPositions: number;
  entryThreshold: number;
  slippageBps: number;
  commissionBps: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: PaperTrade[];
  stats: ReturnType<PaperTrader["getStats"]>;
  equityCurve: Array<{ timestamp: number; equity: number }>;
  signals: Array<{ timestamp: number; score: number; tier: string; action: string; pair: string }>;
  durationMs: number;
  candlesProcessed: number;
}

const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 10000,
  maxConcurrentPositions: 3,
  entryThreshold: SCORING.ENTRY_THRESHOLD,
  slippageBps: 50,
  commissionBps: 30,
};

export function runBacktest(
  candles1h: Candle[],
  candles4h: Candle[] | undefined,
  pair: string,
  config: Partial<BacktestConfig> = {}
): BacktestResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  const trader = new PaperTrader(cfg.initialCapital, cfg.maxConcurrentPositions);
  const risk = new RiskManager(cfg.initialCapital);
  const equityCurve: BacktestResult["equityCurve"] = [];
  const signals: BacktestResult["signals"] = [];

  const MIN_LOOKBACK = 210;
  if (candles1h.length < MIN_LOOKBACK) {
    return {
      config: cfg,
      trades: [],
      stats: trader.getStats(),
      equityCurve: [],
      signals: [],
      durationMs: Date.now() - startTime,
      candlesProcessed: 0,
    };
  }

  let candlesProcessed = 0;

  for (let i = MIN_LOOKBACK; i < candles1h.length; i++) {
    const window1h = candles1h.slice(0, i + 1);
    const currentPrice = candles1h[i].close;
    const timestamp = candles1h[i].timestamp;
    candlesProcessed++;

    const window4h = candles4h
      ? candles4h.filter((c) => c.timestamp <= timestamp)
      : undefined;

    const prices = new Map([[pair, currentPrice]]);
    const closed = trader.updatePositions(prices);
    for (const trade of closed) {
      risk.recordResult(trade.score.setup.type, trade.win ?? false);
    }

    if (i % 4 !== 0) {
      equityCurve.push({ timestamp, equity: trader.getPortfolio().currentCapital });
      continue;
    }

    const indicators = computeIndicators(window1h.slice(-250));
    const zones = detectZones(window1h.slice(-100));
    const setup = detectBestSetup(window1h.slice(-250), window4h?.slice(-100));

    if (setup.confidence <= 0) continue;

    const score = scoreSignal({ indicators, setup, zones, candles: window1h.slice(-50) });

    signals.push({
      timestamp,
      score: score.total,
      tier: score.tier,
      action: score.pass ? "SIGNAL" : "SKIP",
      pair,
    });

    if (score.total < cfg.entryThreshold) continue;

    const tradeCheck = risk.shouldTrade(setup.type);
    if (!tradeCheck.allowed) continue;

    if (!trader.canOpenPosition()) continue;

    const riskParams = risk.calcRiskParams(score, setup);

    const slippage = currentPrice * (cfg.slippageBps / 10000);
    const entryPrice = setup.direction === "LONG"
      ? currentPrice + slippage
      : currentPrice - slippage;

    trader.openPosition(pair, setup.direction, entryPrice, score, riskParams);

    risk.setPortfolioValue(trader.getPortfolio().currentCapital);
    equityCurve.push({ timestamp, equity: trader.getPortfolio().currentCapital });
  }

  const finalPrices = new Map([[pair, candles1h[candles1h.length - 1].close]]);
  trader.forceCloseAll(finalPrices);

  return {
    config: cfg,
    trades: trader.getPortfolio().closedTrades,
    stats: trader.getStats(),
    equityCurve,
    signals,
    durationMs: Date.now() - startTime,
    candlesProcessed,
  };
}

export function formatBacktestReport(result: BacktestResult, pair: string): string {
  const s = result.stats;
  const lines = [
    `\n${"=".repeat(50)}`,
    `  BACKTEST REPORT — ${pair}`,
    `${"=".repeat(50)}`,
    ``,
    `  Capital: $${result.config.initialCapital.toLocaleString()} → $${s.currentCapital.toFixed(2)}`,
    `  Total PnL: ${s.totalPnl >= 0 ? "+" : ""}$${s.totalPnl.toFixed(2)} (${s.totalPnlPct >= 0 ? "+" : ""}${s.totalPnlPct.toFixed(2)}%)`,
    `  Max Drawdown: ${s.maxDrawdown.toFixed(2)}%`,
    ``,
    `  Trades: ${s.totalTrades} (${s.winCount}W / ${s.lossCount}L)`,
    `  Win Rate: ${(s.winRate * 100).toFixed(1)}%`,
    `  Avg Win: $${s.avgWin.toFixed(2)}  |  Avg Loss: $${s.avgLoss.toFixed(2)}`,
    `  Profit Factor: ${s.profitFactor.toFixed(2)}`,
    `  Sharpe (est): ${s.sharpeEstimate.toFixed(2)}`,
    ``,
    `  Candles: ${result.candlesProcessed}  |  Signals: ${result.signals.length}`,
    `  Duration: ${result.durationMs}ms`,
    `${"=".repeat(50)}`,
  ];

  if (result.trades.length > 0) {
    lines.push(`\n  TRADE LOG:`);
    for (const t of result.trades.slice(-20)) {
      const pnlStr = t.pnl !== undefined
        ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`
        : "open";
      lines.push(
        `  ${new Date(t.entryTime).toISOString().slice(0, 16)} ${t.direction} ${t.pair} ` +
        `@ ${t.entryPrice.toFixed(6)} → ${t.exitPrice?.toFixed(6) ?? "?"} ` +
        `| ${t.exitReason ?? "?"} | ${pnlStr} | Score: ${t.score.total}/${SCORING.MAX_SCORE} (${t.score.tier})`
      );
    }
  }

  return lines.join("\n");
}
