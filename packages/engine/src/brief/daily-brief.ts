import type { AgentState, DecisionLog } from "@sentient-alpha/shared";
import type { PaperPortfolio, PaperTrade } from "../paper/tracker.js";
import type { MemoryInsight } from "../memory/types.js";
import { NFA_DISCLAIMER } from "../coach/trading-coach.js";

export interface DailyBrief {
  generatedAt: number;
  greeting: string;
  portfolioSummary: string;
  overnightActivity: string;
  openPositions: string;
  insights: string;
  healthNote?: string;
  disclaimer: string;
  fullText: string;
}

export function generateDailyBrief(
  portfolio: PaperPortfolio,
  decisions: DecisionLog[],
  insights: MemoryInsight[],
  healthScore?: number
): DailyBrief {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12
    ? "Good morning"
    : hour < 17
      ? "Good afternoon"
      : "Good evening";

  const last24h = Date.now() - 86_400_000;

  // Portfolio summary
  const pnlToday = portfolio.closedTrades
    .filter((t) => (t.exitTime ?? 0) > last24h)
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const pnlSign = pnlToday >= 0 ? "+" : "";
  const totalPnlPct = ((portfolio.currentCapital - portfolio.initialCapital) / portfolio.initialCapital * 100).toFixed(2);

  const portfolioSummary = [
    `Capital: $${portfolio.currentCapital.toFixed(2)} (${Number(totalPnlPct) >= 0 ? "+" : ""}${totalPnlPct}% all-time)`,
    `Today's P&L: ${pnlSign}$${pnlToday.toFixed(2)}`,
    `Open positions: ${portfolio.openPositions.length}`,
    `Total trades: ${portfolio.closedTrades.length}`,
  ].join("\n  ");

  // Overnight activity
  const overnightDecisions = decisions.filter((d) => d.timestamp > last24h);
  const entries = overnightDecisions.filter((d) => d.action === "ENTRY");
  const skips = overnightDecisions.filter((d) => d.action === "SKIP");
  const closedToday = portfolio.closedTrades.filter((t) => (t.exitTime ?? 0) > last24h);

  const overnightActivity = [
    `Signals analyzed: ${overnightDecisions.length}`,
    `Entries taken: ${entries.length}`,
    `Positions closed: ${closedToday.length} (${closedToday.filter((t) => t.win).length}W / ${closedToday.filter((t) => !t.win).length}L)`,
    entries.length > 0
      ? `Latest entry: ${entries[entries.length - 1].pair} — ${entries[entries.length - 1].score.tier} tier (${entries[entries.length - 1].score.total}/33)`
      : "No new entries",
  ].join("\n  ");

  // Open positions
  let openPositions = "No open positions.";
  if (portfolio.openPositions.length > 0) {
    openPositions = portfolio.openPositions
      .map((p) => {
        const holdTime = Math.round((Date.now() - p.entryTime) / 3_600_000);
        return `${p.direction} ${p.pair} @ ${p.entryPrice.toFixed(6)} | Hold: ${holdTime}h | Score: ${p.score.total}/33 (${p.score.tier})`;
      })
      .join("\n  ");
  }

  // Insights
  const recentInsights = insights.filter((i) => i.createdAt > Date.now() - 7 * 86_400_000);
  let insightsText = "No new insights this week.";
  if (recentInsights.length > 0) {
    insightsText = recentInsights
      .slice(0, 3)
      .map((i) => `• ${i.pattern} → ${i.suggestion}`)
      .join("\n  ");
  }

  // Health note
  let healthNote: string | undefined;
  if (healthScore !== undefined) {
    if (healthScore < 40) {
      healthNote = `⚠️ Health Score: ${healthScore}/100 (Poor) — Position sizes auto-reduced by 50%. Consider taking the day off trading.`;
    } else if (healthScore < 60) {
      healthNote = `Health Score: ${healthScore}/100 (Fair) — Position sizes reduced by 25%. Trade cautiously.`;
    } else {
      healthNote = `Health Score: ${healthScore}/100 (${healthScore >= 80 ? "Excellent" : "Good"}) — Normal trading conditions.`;
    }
  }

  // Compile
  const sections = [
    `${greeting}, trader.`,
    "",
    `📊 PORTFOLIO`,
    `  ${portfolioSummary}`,
    "",
    `📈 OVERNIGHT ACTIVITY`,
    `  ${overnightActivity}`,
    "",
    `📍 OPEN POSITIONS`,
    `  ${openPositions}`,
    "",
    `💡 INSIGHTS`,
    `  ${insightsText}`,
  ];

  if (healthNote) {
    sections.push("", `🏥 HEALTH`, `  ${healthNote}`);
  }

  sections.push("", `---`, NFA_DISCLAIMER);

  const fullText = sections.join("\n");

  return {
    generatedAt: Date.now(),
    greeting,
    portfolioSummary,
    overnightActivity,
    openPositions,
    insights: insightsText,
    healthNote,
    disclaimer: NFA_DISCLAIMER,
    fullText,
  };
}
