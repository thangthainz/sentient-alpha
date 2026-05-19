import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../../.env") });

import { createServer } from "node:http";
import { SentientAlphaAgent } from "../agent.js";
import type { AgentMode } from "../agent.js";
import { generateDailyBrief } from "../brief/daily-brief.js";
import { TradingCoach } from "../coach/trading-coach.js";
import { generateWeeklyReport, formatWeeklyReport } from "../memory/weekly-insights.js";
import { HealthTracker } from "../health/health-tracker.js";

const PORT = parseInt(process.env.API_PORT ?? "3200", 10);
const mode = (process.env.TRADING_MODE ?? "paper") as AgentMode;

const agent = new SentientAlphaAgent(mode);
const coach = new TradingCoach(process.env.ACE_API_KEY ?? "");
const health = new HealthTracker();

function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    // Agent state
    if (path === "/api/state" && req.method === "GET") {
      return json(res, {
        ...agent.getState(),
        mode: agent.getMode(),
        paper: agent.getPaperStats(),
        memory: agent.getMemoryStats(),
        health: health.getLatestScore(),
      });
    }

    // Decisions
    if (path === "/api/decisions" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
      return json(res, agent.getDecisions(limit));
    }

    // Paper portfolio
    if (path === "/api/portfolio" && req.method === "GET") {
      return json(res, agent.getPaperPortfolio());
    }

    // Backtest seed result (historical replay)
    if (path === "/api/backtest" && req.method === "GET") {
      const seed = agent.getSeedResult();
      const portfolio = agent.getPaperPortfolio();
      return json(res, {
        seed,
        portfolio: {
          initialCapital: portfolio.initialCapital,
          currentCapital: portfolio.currentCapital,
          totalPnl: portfolio.totalPnl,
          maxDrawdown: portfolio.maxDrawdown,
          winCount: portfolio.winCount,
          lossCount: portfolio.lossCount,
        },
        trades: portfolio.closedTrades,
        stats: agent.getPaperStats(),
      });
    }

    // Daily brief (returns scheduler-cached version, or generates ad-hoc if missing)
    if (path === "/api/brief" && req.method === "GET") {
      const cached = agent.getCachedBrief();
      const schedule = agent.getScheduleInfo();
      if (cached) {
        return json(res, {
          fullText: cached.fullText,
          generatedAt: cached.generatedAt,
          nextRun: schedule.daily_brief?.nextRun ?? null,
          source: "scheduled",
        });
      }
      // Fallback: generate on demand if scheduler hasn't fired yet
      const portfolio = agent.getPaperPortfolio();
      const decisions = agent.getDecisions(100);
      const insights = agent.getInsights();
      const healthScore = health.getLatestScore();
      const brief = generateDailyBrief(portfolio, decisions, insights, healthScore.overall);
      return json(res, { ...brief, nextRun: schedule.daily_brief?.nextRun ?? null, source: "ad_hoc" });
    }

    // Weekly insights (returns scheduler-cached version, or generates ad-hoc if missing)
    if (path === "/api/weekly" && req.method === "GET") {
      const cached = agent.getCachedWeekly();
      const schedule = agent.getScheduleInfo();
      if (cached) {
        return json(res, {
          ...cached.report,
          formatted: cached.formatted,
          generatedAt: cached.generatedAt,
          nextRun: schedule.weekly_insights?.nextRun ?? null,
          source: "scheduled",
        });
      }
      const portfolio = agent.getPaperPortfolio();
      const memories = agent.searchMemory("");
      const report = generateWeeklyReport(
        portfolio.closedTrades,
        memories,
        health.getHistory(),
        portfolio.currentCapital,
        portfolio.initialCapital
      );
      return json(res, {
        ...report,
        formatted: formatWeeklyReport(report),
        nextRun: schedule.weekly_insights?.nextRun ?? null,
        source: "ad_hoc",
      });
    }

    // Schedule info
    if (path === "/api/schedule" && req.method === "GET") {
      return json(res, agent.getScheduleInfo());
    }

    // Trading Coach
    if (path === "/api/coach" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const response = await coach.ask({
        question: body.question,
        pair: body.pair,
        context: {
          state: agent.getState(),
          memory: undefined,
          recentDecisions: agent.getDecisions(5),
          portfolio: agent.getPaperPortfolio(),
          healthScore: health.getLatestScore().overall,
        },
      });
      return json(res, response);
    }

    // Memory CRUD
    if (path === "/api/memory" && req.method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      return json(res, query ? agent.searchMemory(query) : agent.searchMemory(""));
    }

    if (path === "/api/memory" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const mem = agent.addMemory(body.content, body.category, {
        pair: body.pair,
        tags: body.tags,
        importance: body.importance,
      });
      return json(res, mem, 201);
    }

    if (path.startsWith("/api/memory/") && req.method === "DELETE") {
      const id = path.split("/").pop()!;
      const removed = agent.removeMemory(id);
      return json(res, { removed });
    }

    // Health
    if (path === "/api/health" && req.method === "GET") {
      return json(res, health.getLatestScore());
    }

    if (path === "/api/health" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const snapshot = health.recordSnapshot(body);
      const score = health.getLatestScore();
      return json(res, { snapshot, score });
    }

    // Insights
    if (path === "/api/insights" && req.method === "GET") {
      return json(res, agent.getInsights());
    }

    // 404
    json(res, { error: "not found" }, 404);
  } catch (err: any) {
    json(res, { error: err.message }, 500);
  }
});

async function main() {
  console.log("==========================================");
  console.log("  Sentient Alpha — API Server");
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${mode.toUpperCase()}`);
  console.log("==========================================\n");

  server.listen(PORT, () => {
    console.log(`[API] Server running at http://localhost:${PORT}`);
    console.log("[API] Endpoints:");
    console.log("  GET  /api/state       — Agent state + stats");
    console.log("  GET  /api/decisions   — Decision timeline");
    console.log("  GET  /api/portfolio   — Paper portfolio");
    console.log("  GET  /api/backtest    — Historical replay results");
    console.log("  GET  /api/brief       — Daily trading brief");
    console.log("  GET  /api/weekly      — Weekly insights report");
    console.log("  POST /api/coach       — Ask Trading Coach");
    console.log("  GET  /api/memory      — Search memories");
    console.log("  POST /api/memory      — Add memory");
    console.log("  GET  /api/health      — Health score");
    console.log("  POST /api/health      — Record health snapshot");
    console.log("  GET  /api/insights    — Trading insights");
    console.log("");
  });

  await agent.start();
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
