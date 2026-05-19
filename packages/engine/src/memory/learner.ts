import type { MemoryInsight, TradingMemory } from "./types.js";
import type { PaperTrade } from "../paper/tracker.js";
import { aceSentimentAnalysis } from "../data/ace-cloud.js";

export class TradingLearner {
  async analyzeTradePatterns(
    trades: PaperTrade[],
    memories: TradingMemory[],
    aceApiKey?: string
  ): Promise<MemoryInsight[]> {
    if (trades.length < 5) return [];

    const insights: MemoryInsight[] = [];

    // Pattern 1: Setup type performance
    const setupStats = new Map<string, { wins: number; losses: number; avgPnl: number }>();
    for (const t of trades) {
      const type = t.score.setup.type;
      const stat = setupStats.get(type) ?? { wins: 0, losses: 0, avgPnl: 0 };
      if (t.win) stat.wins++;
      else stat.losses++;
      stat.avgPnl = ((stat.avgPnl * (stat.wins + stat.losses - 1)) + (t.pnl ?? 0)) / (stat.wins + stat.losses);
      setupStats.set(type, stat);
    }

    for (const [type, stat] of setupStats) {
      const total = stat.wins + stat.losses;
      if (total < 3) continue;
      const wr = stat.wins / total;
      if (wr > 0.65) {
        insights.push({
          pattern: `${type} has high win rate (${(wr * 100).toFixed(0)}% over ${total} trades)`,
          confidence: Math.min(0.9, 0.5 + total * 0.05),
          basedOn: [`${total} trades of type ${type}`],
          suggestion: `Consider increasing position size for ${type} setups`,
          createdAt: Date.now(),
        });
      } else if (wr < 0.35 && total >= 5) {
        insights.push({
          pattern: `${type} has low win rate (${(wr * 100).toFixed(0)}% over ${total} trades)`,
          confidence: Math.min(0.9, 0.5 + total * 0.05),
          basedOn: [`${total} trades of type ${type}`],
          suggestion: `Consider disabling ${type} or raising its score threshold`,
          createdAt: Date.now(),
        });
      }
    }

    // Pattern 2: Time-of-day patterns
    const hourStats = new Map<number, { wins: number; losses: number }>();
    for (const t of trades) {
      const hour = new Date(t.entryTime).getUTCHours();
      const stat = hourStats.get(hour) ?? { wins: 0, losses: 0 };
      if (t.win) stat.wins++;
      else stat.losses++;
      hourStats.set(hour, stat);
    }

    let bestHour = -1;
    let bestWr = 0;
    for (const [hour, stat] of hourStats) {
      const total = stat.wins + stat.losses;
      if (total < 3) continue;
      const wr = stat.wins / total;
      if (wr > bestWr) { bestWr = wr; bestHour = hour; }
    }
    if (bestHour >= 0 && bestWr > 0.6) {
      insights.push({
        pattern: `Best trading hour is ${bestHour}:00 UTC (${(bestWr * 100).toFixed(0)}% WR)`,
        confidence: 0.6,
        basedOn: ["time-of-day analysis"],
        suggestion: `Consider prioritizing signals around ${bestHour}:00 UTC`,
        createdAt: Date.now(),
      });
    }

    // Pattern 3: Score threshold optimization
    const scoreThresholds = [20, 22, 24, 26, 28];
    let bestThreshold = 22;
    let bestPf = 0;
    for (const threshold of scoreThresholds) {
      const filtered = trades.filter((t) => t.score.total >= threshold);
      if (filtered.length < 3) continue;
      const wins = filtered.filter((t) => t.win).reduce((s, t) => s + (t.pnl ?? 0), 0);
      const losses = filtered.filter((t) => !t.win).reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0);
      const pf = losses > 0 ? wins / losses : wins > 0 ? 999 : 0;
      if (pf > bestPf) { bestPf = pf; bestThreshold = threshold; }
    }
    if (bestThreshold !== 22 && bestPf > 1.5) {
      insights.push({
        pattern: `Optimal entry threshold is ${bestThreshold}/33 (PF=${bestPf.toFixed(1)})`,
        confidence: 0.7,
        basedOn: ["score threshold optimization"],
        suggestion: `Consider adjusting ENTRY_THRESHOLD to ${bestThreshold}`,
        createdAt: Date.now(),
      });
    }

    // Pattern 4: AI-powered insight from memories + trades (uses Ace Cloud)
    if (aceApiKey && memories.length > 0) {
      try {
        const memoryContext = memories
          .slice(0, 10)
          .map((m) => `[${m.category}] ${m.content}`)
          .join("\n");
        const tradeContext = trades
          .slice(-10)
          .map((t) => `${t.win ? "WIN" : "LOSS"} ${t.pair} ${t.score.setup.type} score=${t.score.total} pnl=${t.pnl?.toFixed(2)}`)
          .join("\n");

        const prompt = `Given these trading memories:\n${memoryContext}\n\nAnd recent trades:\n${tradeContext}\n\nIdentify one non-obvious correlation or pattern. Return JSON: {"pattern":"...","suggestion":"..."}`;

        const result = await aceSentimentAnalysis(prompt, aceApiKey);
        if (result.summary && result.summary !== "unavailable") {
          try {
            const parsed = JSON.parse(result.summary);
            insights.push({
              pattern: parsed.pattern ?? result.summary.slice(0, 200),
              confidence: 0.5,
              basedOn: ["AI analysis of memories + trades"],
              suggestion: parsed.suggestion ?? "Review this pattern manually",
              createdAt: Date.now(),
            });
          } catch {
            insights.push({
              pattern: result.summary.slice(0, 200),
              confidence: 0.4,
              basedOn: ["AI analysis"],
              suggestion: "Review this observation manually",
              createdAt: Date.now(),
            });
          }
        }
      } catch { /* AI insight optional */ }
    }

    return insights;
  }

  autoRecordTradeResult(trade: PaperTrade): TradingMemory {
    const pnlStr = trade.pnl !== undefined
      ? `${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)}`
      : "unknown PnL";
    const content = `${trade.win ? "WIN" : "LOSS"} ${trade.direction} ${trade.pair} | ${trade.score.setup.type} (${trade.score.total}/33 ${trade.score.tier}) | ${pnlStr} | ${trade.exitReason}`;

    return {
      id: `mem-result-${trade.id}`,
      content,
      category: "trade_result",
      createdAt: trade.exitTime ?? Date.now(),
      pair: trade.pair,
      tags: [trade.score.setup.type, trade.win ? "win" : "loss"],
      importance: trade.win && (trade.pnl ?? 0) > 100 ? 4 : trade.win ? 3 : 2,
    };
  }
}
