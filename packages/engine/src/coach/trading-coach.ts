import type { AgentState, DecisionLog, SignalScore } from "@sentient-alpha/shared";
import type { TradingMemory, MemoryContext } from "../memory/types.js";
import type { PaperTrade, PaperPortfolio } from "../paper/tracker.js";

const NFA_DISCLAIMER =
  "⚠️ NOT FINANCIAL ADVICE (NFA). I am an AI trading assistant providing analysis " +
  "based on technical indicators and historical patterns. All trading involves risk of " +
  "loss. Never trade with money you cannot afford to lose. Always do your own research (DYOR).";

const COACH_SYSTEM_PROMPT = `You are Sentient Alpha's Trading Coach — a calm, analytical AI assistant that helps traders make better decisions.

CRITICAL RULES:
1. ALWAYS start responses with the NFA disclaimer when discussing specific trades
2. NEVER guarantee profits or predict exact price movements
3. Frame everything as analysis and observation, not recommendation
4. When uncertain, say so explicitly
5. Reference the user's own trading memory/rules when relevant
6. Be concise — traders value clarity over verbosity

Your personality:
- Calm and measured (like a Stoic mentor)
- Data-driven — always cite specific numbers from indicators/scores
- Risk-aware — always highlight the downside before the upside
- Supportive but honest — don't sugarcoat bad positions

${NFA_DISCLAIMER}`;

export interface CoachQuery {
  question: string;
  pair?: string;
  context?: {
    state?: AgentState;
    memory?: MemoryContext;
    recentDecisions?: DecisionLog[];
    portfolio?: PaperPortfolio;
    healthScore?: number;
  };
}

export interface CoachResponse {
  answer: string;
  disclaimer: string;
  suggestions?: string[];
  relatedMemories?: TradingMemory[];
}

export class TradingCoach {
  private aceApiKey: string;
  private aceBaseUrl: string;

  constructor(aceApiKey: string, baseUrl = "https://api.acedata.cloud") {
    this.aceApiKey = aceApiKey;
    this.aceBaseUrl = baseUrl;
  }

  async ask(query: CoachQuery): Promise<CoachResponse> {
    const contextBlock = this.buildContext(query);
    const messages = [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      { role: "user", content: `${contextBlock}\n\nUser question: ${query.question}` },
    ];

    const answer = await this.callLlm(messages);

    return {
      answer,
      disclaimer: NFA_DISCLAIMER,
      suggestions: this.extractSuggestions(answer),
      relatedMemories: query.context?.memory?.strategies,
    };
  }

  async analyzePosition(trade: PaperTrade, currentPrice: number): Promise<CoachResponse> {
    const pnlPct = ((currentPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2);
    const riskRemaining = ((trade.stopLoss - currentPrice) / currentPrice * 100).toFixed(2);
    const tpDistance = ((trade.takeProfit - currentPrice) / currentPrice * 100).toFixed(2);

    const question = [
      `Analyze my open ${trade.direction} position on ${trade.pair}:`,
      `- Entry: ${trade.entryPrice.toFixed(6)} | Current: ${currentPrice.toFixed(6)} (${pnlPct}%)`,
      `- Stop Loss: ${trade.stopLoss.toFixed(6)} (${riskRemaining}% away)`,
      `- Take Profit: ${trade.takeProfit.toFixed(6)} (${tpDistance}% away)`,
      `- Signal Score: ${trade.score.total}/33 (${trade.score.tier})`,
      `- Setup: ${trade.score.setup.type}`,
      `Should I hold, tighten stop, or close?`,
    ].join("\n");

    return this.ask({ question, pair: trade.pair });
  }

  async reviewDay(portfolio: PaperPortfolio, decisions: DecisionLog[]): Promise<CoachResponse> {
    const todayDecisions = decisions.filter(
      (d) => Date.now() - d.timestamp < 86_400_000
    );
    const entries = todayDecisions.filter((d) => d.action === "ENTRY");
    const skips = todayDecisions.filter((d) => d.action === "SKIP");

    const question = [
      "Review my trading day:",
      `- Signals generated: ${todayDecisions.length}`,
      `- Entries taken: ${entries.length}`,
      `- Skipped: ${skips.length}`,
      `- Current capital: $${portfolio.currentCapital.toFixed(2)}`,
      `- Open positions: ${portfolio.openPositions.length}`,
      `- Today's PnL: $${portfolio.closedTrades.filter((t) => Date.now() - (t.exitTime ?? 0) < 86_400_000).reduce((s, t) => s + (t.pnl ?? 0), 0).toFixed(2)}`,
      "",
      "What did I do well? What should I improve?",
    ].join("\n");

    return this.ask({ question, context: { portfolio } });
  }

  private buildContext(query: CoachQuery): string {
    const parts: string[] = [];

    if (query.context?.state) {
      const s = query.context.state;
      parts.push(`<agent_state>
  Portfolio: $${s.portfolioValue.toFixed(2)} | PnL: $${s.totalPnl.toFixed(2)}
  Win Rate: ${(s.winRate * 100).toFixed(1)}% | Trades: ${s.totalTrades}
  Positions: ${s.positions.length} open | Cycle: #${s.cycleCount}
</agent_state>`);
    }

    if (query.context?.healthScore !== undefined) {
      const hs = query.context.healthScore;
      const label = hs >= 80 ? "Excellent" : hs >= 60 ? "Good" : hs >= 40 ? "Fair" : "Poor";
      parts.push(`<health_status>Score: ${hs}/100 (${label}) — ${hs < 60 ? "Consider reduced position sizes" : "Normal trading conditions"}</health_status>`);
    }

    if (query.context?.memory) {
      const mem = query.context.memory;
      if (mem.strategies.length > 0) {
        parts.push("<user_strategies>");
        mem.strategies.slice(0, 5).forEach((m) => parts.push(`  - ${m.content}`));
        parts.push("</user_strategies>");
      }
      if (mem.rules.length > 0) {
        parts.push("<user_rules>");
        mem.rules.slice(0, 5).forEach((m) => parts.push(`  - ${m.content}`));
        parts.push("</user_rules>");
      }
    }

    if (query.context?.recentDecisions && query.context.recentDecisions.length > 0) {
      parts.push("<recent_decisions>");
      for (const d of query.context.recentDecisions.slice(-5)) {
        parts.push(`  ${d.pair}: ${d.action} | Score ${d.score.total}/33 (${d.score.tier}) | ${d.reason.slice(0, 100)}`);
      }
      parts.push("</recent_decisions>");
    }

    return parts.length > 0 ? parts.join("\n\n") : "";
  }

  private async callLlm(messages: Array<{ role: string; content: string }>): Promise<string> {
    if (!this.aceApiKey) {
      return `${NFA_DISCLAIMER}\n\nI cannot provide analysis without an LLM API key configured. Please set ACE_API_KEY in your .env file.`;
    }

    try {
      const res = await fetch(`${this.aceBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.aceApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          max_tokens: 500,
          temperature: 0.4,
        }),
      });

      if (!res.ok) {
        return `${NFA_DISCLAIMER}\n\nAnalysis temporarily unavailable (API error ${res.status}). Based on your data, consider reviewing your position sizes and stop losses.`;
      }

      const data = await res.json() as any;
      return data?.choices?.[0]?.message?.content ?? "Unable to generate analysis.";
    } catch (err: any) {
      return `${NFA_DISCLAIMER}\n\nAnalysis unavailable: ${err.message}`;
    }
  }

  private extractSuggestions(text: string): string[] {
    const lines = text.split("\n");
    return lines
      .filter((l) => l.match(/^[-•*]\s/) || l.match(/^\d+\.\s/))
      .map((l) => l.replace(/^[-•*\d.]+\s*/, "").trim())
      .filter((l) => l.length > 10)
      .slice(0, 5);
  }
}

export { NFA_DISCLAIMER };
