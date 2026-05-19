import type { PaperTrade } from "../paper/tracker.js";
import type { HealthSnapshot } from "../health/health-tracker.js";
import type { MemoryInsight, TradingMemory } from "./types.js";

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  generatedAt: number;
  performance: {
    trades: number;
    winRate: number;
    totalPnl: number;
    bestTrade: { pair: string; pnl: number; setup: string } | null;
    worstTrade: { pair: string; pnl: number; setup: string } | null;
    avgHoldTime: number;
  };
  patterns: MemoryInsight[];
  healthCorrelation?: string;
  recommendations: string[];
  summary: string;
}

export function generateWeeklyReport(
  trades: PaperTrade[],
  memories: TradingMemory[],
  healthHistory: HealthSnapshot[],
  currentCapital: number,
  initialCapital: number
): WeeklyReport {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);

  const weekTrades = trades.filter(
    (t) => (t.exitTime ?? t.entryTime) >= weekStart.getTime()
  );

  const wins = weekTrades.filter((t) => t.win);
  const losses = weekTrades.filter((t) => !t.win);
  const totalPnl = weekTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = weekTrades.length > 0 ? wins.length / weekTrades.length : 0;

  const bestTrade = weekTrades.length > 0
    ? weekTrades.reduce((best, t) => (t.pnl ?? 0) > (best.pnl ?? 0) ? t : best)
    : null;
  const worstTrade = weekTrades.length > 0
    ? weekTrades.reduce((worst, t) => (t.pnl ?? 0) < (worst.pnl ?? 0) ? t : worst)
    : null;

  const avgHoldTime = weekTrades.length > 0
    ? weekTrades.reduce((s, t) => s + ((t.exitTime ?? Date.now()) - t.entryTime), 0) / weekTrades.length / 3_600_000
    : 0;

  // Pattern detection
  const patterns: MemoryInsight[] = [];

  // Setup distribution
  const setupCounts = new Map<string, { wins: number; total: number }>();
  for (const t of weekTrades) {
    const type = t.score.setup.type;
    const stat = setupCounts.get(type) ?? { wins: 0, total: 0 };
    stat.total++;
    if (t.win) stat.wins++;
    setupCounts.set(type, stat);
  }

  for (const [type, stat] of setupCounts) {
    if (stat.total >= 3) {
      const wr = stat.wins / stat.total;
      patterns.push({
        pattern: `${type}: ${stat.total} trades, ${(wr * 100).toFixed(0)}% win rate this week`,
        confidence: Math.min(0.8, 0.4 + stat.total * 0.1),
        basedOn: [`${stat.total} trades this week`],
        suggestion: wr > 0.6
          ? `${type} is performing well — maintain current approach`
          : wr < 0.4
            ? `${type} underperforming — consider raising threshold or pausing`
            : `${type} average — monitor next week`,
        createdAt: Date.now(),
      });
    }
  }

  // Score tier analysis
  const tierBreakdown = new Map<string, { wins: number; total: number }>();
  for (const t of weekTrades) {
    const tier = t.score.tier;
    const stat = tierBreakdown.get(tier) ?? { wins: 0, total: 0 };
    stat.total++;
    if (t.win) stat.wins++;
    tierBreakdown.set(tier, stat);
  }

  for (const [tier, stat] of tierBreakdown) {
    if (stat.total >= 2) {
      const wr = stat.wins / stat.total;
      if (tier === "A" || tier === "S") {
        patterns.push({
          pattern: `Tier ${tier} signals: ${(wr * 100).toFixed(0)}% WR (${stat.total} trades)`,
          confidence: 0.7,
          basedOn: ["tier analysis"],
          suggestion: wr >= 0.6
            ? `High-tier signals confirmed profitable — trust the system`
            : `Tier ${tier} not living up to expectations — review scoring weights`,
          createdAt: Date.now(),
        });
      }
    }
  }

  // Health correlation
  let healthCorrelation: string | undefined;
  if (healthHistory.length >= 3 && weekTrades.length >= 3) {
    const tradeDayHealth = new Map<string, number>();
    for (const snap of healthHistory) {
      const day = new Date(snap.timestamp).toISOString().slice(0, 10);
      const score = (snap.sleepHours ?? 7) >= 7 && (snap.stressLevel ?? 5) <= 5 ? 1 : 0;
      tradeDayHealth.set(day, score);
    }

    let goodDayWins = 0, goodDayTotal = 0;
    let badDayWins = 0, badDayTotal = 0;

    for (const t of weekTrades) {
      const day = new Date(t.entryTime).toISOString().slice(0, 10);
      const healthGood = tradeDayHealth.get(day);
      if (healthGood === 1) { goodDayTotal++; if (t.win) goodDayWins++; }
      else if (healthGood === 0) { badDayTotal++; if (t.win) badDayWins++; }
    }

    if (goodDayTotal >= 2 && badDayTotal >= 2) {
      const goodWR = goodDayWins / goodDayTotal;
      const badWR = badDayWins / badDayTotal;
      if (goodWR - badWR > 0.15) {
        healthCorrelation = `Trades on well-rested days: ${(goodWR * 100).toFixed(0)}% WR vs tired days: ${(badWR * 100).toFixed(0)}% WR. Sleep quality correlates with +${((goodWR - badWR) * 100).toFixed(0)}pp win rate.`;
      }
    }
  }

  // Recommendations
  const recommendations: string[] = [];

  if (winRate > 0.55 && weekTrades.length >= 5) {
    recommendations.push("Winning edge confirmed this week. Consider slightly increasing position sizes next week.");
  }
  if (winRate < 0.4 && weekTrades.length >= 5) {
    recommendations.push("Below-average week. Consider raising entry threshold by 2 points or taking fewer trades.");
  }
  if (avgHoldTime > 48) {
    recommendations.push(`Average hold time ${avgHoldTime.toFixed(0)}h is long. Check if stop losses are too wide.`);
  }
  if (avgHoldTime < 2 && weekTrades.length > 5) {
    recommendations.push("Very short hold times suggest choppy entries. Consider adding Choppiness Index filter.");
  }
  if (healthCorrelation) {
    recommendations.push("Health data shows clear correlation. Prioritize sleep before trading days.");
  }
  if (weekTrades.length === 0) {
    recommendations.push("No trades this week. Market may be choppy — patience is a valid strategy.");
  }

  // Summary
  const pnlStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
  const summary = weekTrades.length > 0
    ? `Week summary: ${weekTrades.length} trades, ${(winRate * 100).toFixed(0)}% WR, ${pnlStr} PnL. Capital: $${currentCapital.toFixed(2)} (${((currentCapital / initialCapital - 1) * 100).toFixed(1)}% all-time).`
    : "Quiet week with no trades executed. The system is monitoring and waiting for high-quality setups.";

  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: now.toISOString().slice(0, 10),
    generatedAt: Date.now(),
    performance: {
      trades: weekTrades.length,
      winRate,
      totalPnl,
      bestTrade: bestTrade ? { pair: bestTrade.pair, pnl: bestTrade.pnl ?? 0, setup: bestTrade.score.setup.type } : null,
      worstTrade: worstTrade ? { pair: worstTrade.pair, pnl: worstTrade.pnl ?? 0, setup: worstTrade.score.setup.type } : null,
      avgHoldTime,
    },
    patterns,
    healthCorrelation,
    recommendations,
    summary,
  };
}

export function formatWeeklyReport(report: WeeklyReport): string {
  const lines = [
    `\n${"═".repeat(50)}`,
    `  WEEKLY INSIGHTS — ${report.weekStart} to ${report.weekEnd}`,
    `${"═".repeat(50)}`,
    "",
    `  ${report.summary}`,
    "",
    `  PERFORMANCE`,
    `  ────────────`,
    `  Trades: ${report.performance.trades}`,
    `  Win Rate: ${(report.performance.winRate * 100).toFixed(1)}%`,
    `  PnL: ${report.performance.totalPnl >= 0 ? "+" : ""}$${report.performance.totalPnl.toFixed(2)}`,
    `  Avg Hold: ${report.performance.avgHoldTime.toFixed(1)}h`,
  ];

  if (report.performance.bestTrade) {
    lines.push(`  Best: ${report.performance.bestTrade.pair} +$${report.performance.bestTrade.pnl.toFixed(2)} (${report.performance.bestTrade.setup})`);
  }
  if (report.performance.worstTrade) {
    lines.push(`  Worst: ${report.performance.worstTrade.pair} -$${Math.abs(report.performance.worstTrade.pnl).toFixed(2)} (${report.performance.worstTrade.setup})`);
  }

  if (report.patterns.length > 0) {
    lines.push("", `  PATTERNS DETECTED`, `  ────────────────`);
    for (const p of report.patterns) {
      lines.push(`  • ${p.pattern}`);
      lines.push(`    → ${p.suggestion}`);
    }
  }

  if (report.healthCorrelation) {
    lines.push("", `  HEALTH CORRELATION`, `  ──────────────────`);
    lines.push(`  ${report.healthCorrelation}`);
  }

  if (report.recommendations.length > 0) {
    lines.push("", `  RECOMMENDATIONS`, `  ───────────────`);
    for (const r of report.recommendations) {
      lines.push(`  → ${r}`);
    }
  }

  lines.push("", `${"═".repeat(50)}`);
  return lines.join("\n");
}
