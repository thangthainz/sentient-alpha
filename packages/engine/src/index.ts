import { SentientAlphaAgent } from "./agent.js";
import type { AgentMode } from "./agent.js";

const mode = (process.env.TRADING_MODE ?? "paper") as AgentMode;

const agent = new SentientAlphaAgent(mode);

agent.start().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n[SHUTDOWN] Graceful shutdown...");
  const stats = agent.getPaperStats();
  console.log(`\nFinal Stats: ${stats.totalTrades} trades | WR: ${(stats.winRate * 100).toFixed(1)}% | PnL: $${stats.totalPnl.toFixed(2)} | Max DD: ${stats.maxDrawdown.toFixed(1)}%`);
  process.exit(0);
});
