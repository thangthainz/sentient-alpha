import "dotenv/config";
import type {
  AgentState,
  Candle,
  DecisionLog,
} from "@sentient-alpha/shared";
import { ENGINE, SCORING } from "@sentient-alpha/shared";
import { computeIndicators } from "./indicators/index.js";
import { detectZones } from "./indicators/zones.js";
import { detectBestSetup } from "./scoring/setups.js";
import { scoreSignal } from "./scoring/scorer.js";
import { RiskManager } from "./risk/manager.js";
import { DexExecutor } from "./execution/dex.js";
import { PaperTrader } from "./paper/tracker.js";
import { seedPaperTrader } from "./paper/seed.js";
import type { SeedResult } from "./paper/seed.js";
import { LocalScheduler } from "./scheduler/scheduler.js";
import { generateDailyBrief } from "./brief/daily-brief.js";
import { generateWeeklyReport, formatWeeklyReport } from "./memory/weekly-insights.js";
import { HealthTracker } from "./health/health-tracker.js";
import { TradingMemoryStore } from "./memory/store.js";
import { TradingLearner } from "./memory/learner.js";
import { fetchOhlcv, fetchTopPools } from "./data/gecko-terminal.js";
import { aceSentimentAnalysis } from "./data/ace-cloud.js";

export type AgentMode = "paper" | "live";

export class SentientAlphaAgent {
  private state: AgentState;
  private risk: RiskManager;
  private dex: DexExecutor;
  private paper: PaperTrader;
  private memory: TradingMemoryStore;
  private learner: TradingLearner;
  private aceApiKey: string;
  private mode: AgentMode;

  private watchedPools: Array<{ address: string; name: string }> = [];
  private seedResult: SeedResult | null = null;
  private scheduler: LocalScheduler = new LocalScheduler();
  private health: HealthTracker = new HealthTracker();
  private cachedBrief: { fullText: string; generatedAt: number; nextRun?: number } | null = null;
  private cachedWeekly: { report: ReturnType<typeof generateWeeklyReport>; formatted: string; generatedAt: number; nextRun?: number } | null = null;

  constructor(mode: AgentMode = "paper") {
    const rpcUrl = process.env.MANTLE_RPC_URL || "https://rpc.mantle.xyz";
    const privateKey = process.env.PRIVATE_KEY || "";
    this.aceApiKey = process.env.ACE_API_KEY || "";
    this.mode = mode;

    this.dex = new DexExecutor(rpcUrl, privateKey);
    this.risk = new RiskManager(10000);
    this.paper = new PaperTrader(10000, 3);
    this.memory = new TradingMemoryStore("./data/trading-memory.json");
    this.learner = new TradingLearner();

    this.state = {
      isRunning: false,
      cycleCount: 0,
      positions: [],
      portfolioValue: 10000,
      totalPnl: 0,
      winRate: 0,
      totalTrades: 0,
      lastCycleTime: 0,
      decisions: [],
    };
  }

  async start(): Promise<void> {
    console.log("==========================================");
    console.log("  Sentient Alpha — Autonomous AI Agent");
    console.log(`  Mode: ${this.mode.toUpperCase()} TRADING`);
    console.log("  Chain: Mantle L2 (5000)");
    console.log(`  Wallet: ${this.dex.getWalletAddress()}`);
    console.log(`  Memory: ${this.memory.getStats().total} entries loaded`);
    console.log("==========================================\n");

    if (this.mode === "paper") {
      console.log("[MODE] PAPER TRADING — no real swaps will be executed\n");
    }

    this.state.isRunning = true;

    console.log("[INIT] Discovering top Mantle pools...");
    const pools = await fetchTopPools(3);
    this.watchedPools = pools.map((p) => ({ address: p.address, name: p.name }));
    console.log(`[INIT] Watching ${this.watchedPools.length} pools:`);
    this.watchedPools.forEach((p) => console.log(`  - ${p.name} (${p.address})`));

    // Seed paper portfolio with historical replay (only once per process)
    if (this.mode === "paper" && this.paper.toJSON().closedTrades.length === 0) {
      const seedDays = parseInt(process.env.SEED_DAYS ?? "180", 10);
      const seedThreshold = parseInt(process.env.SEED_THRESHOLD ?? "10", 10);
      try {
        this.seedResult = await seedPaperTrader(this.paper, {
          pools: this.watchedPools,
          daysBack: seedDays,
          initialCapital: 10000,
          entryThreshold: seedThreshold,
        });
        // Sync risk manager portfolio value to the seeded capital
        this.risk.setPortfolioValue(this.paper.toJSON().currentCapital);
      } catch (err: any) {
        console.error(`[SEED] Failed: ${err.message} (continuing without seed)`);
      }
    }

    // Register scheduled tasks (local timezone of the user's machine)
    this.scheduler.registerDaily("daily_brief", 7, 0, () => this.generateAndCacheBrief());
    this.scheduler.registerWeeklySunday("weekly_insights", 22, 0, () => this.generateAndCacheWeekly());

    // First-boot: generate one of each so the dashboard has content immediately
    await this.generateAndCacheBrief();
    await this.generateAndCacheWeekly();

    console.log(`\n[LOOP] Starting autonomous loop (${ENGINE.CYCLE_INTERVAL_MS / 1000}s interval)\n`);
    await this.runCycle();
    setInterval(() => this.runCycle(), ENGINE.CYCLE_INTERVAL_MS);
  }

  async runCycle(): Promise<void> {
    this.state.cycleCount++;
    const cycleNum = this.state.cycleCount;
    console.log(`\n========== CYCLE #${cycleNum} ==========`);

    for (let i = 0; i < this.watchedPools.length; i++) {
      const pool = this.watchedPools[i];
      try {
        await this.analyzePool(pool.address, pool.name);
      } catch (err: any) {
        console.error(`[CYCLE] Error analyzing ${pool.name}: ${err.message}`);
      }
      if (i < this.watchedPools.length - 1) await new Promise(r => setTimeout(r, 3000));
    }

    // Update paper positions
    if (this.mode === "paper") {
      const prices = new Map<string, number>();
      for (let i = 0; i < this.watchedPools.length; i++) {
        const pool = this.watchedPools[i];
        try {
          const candles = await fetchOhlcv(pool.address, "1h", 1);
          if (candles.length > 0) prices.set(pool.name, candles[candles.length - 1].close);
        } catch { /* skip */ }
        if (i < this.watchedPools.length - 1) await new Promise(r => setTimeout(r, 2000));
      }
      const closed = this.paper.updatePositions(prices);
      for (const trade of closed) {
        this.risk.recordResult(trade.score.setup.type, trade.win ?? false);
        const resultMemory = this.learner.autoRecordTradeResult(trade);
        this.memory.add(resultMemory.content, "trade_result", {
          pair: trade.pair,
          tags: resultMemory.tags,
          importance: resultMemory.importance,
        });
      }

      const portfolio = this.paper.getPortfolio();
      this.state.portfolioValue = portfolio.currentCapital;
      this.state.totalPnl = portfolio.totalPnl;
      this.state.totalTrades = portfolio.winCount + portfolio.lossCount;
      this.state.winRate = this.state.totalTrades > 0
        ? portfolio.winCount / this.state.totalTrades
        : 0;
    }

    // Run learning every 10 cycles
    if (cycleNum % 10 === 0 && this.mode === "paper") {
      const portfolio = this.paper.getPortfolio();
      if (portfolio.closedTrades.length >= 5) {
        console.log("[LEARN] Analyzing trade patterns...");
        const insights = await this.learner.analyzeTradePatterns(
          portfolio.closedTrades,
          this.memory.getAll(),
          this.aceApiKey || undefined
        );
        for (const insight of insights) {
          this.memory.addInsight(insight);
          console.log(`[INSIGHT] ${insight.pattern} → ${insight.suggestion}`);
        }
      }
    }

    this.state.lastCycleTime = Date.now();
    const stats = this.paper.getStats();
    console.log(`[CYCLE] #${cycleNum} complete | Capital: $${this.state.portfolioValue.toFixed(2)} | Trades: ${stats.totalTrades} | WR: ${(stats.winRate * 100).toFixed(1)}%`);
  }

  private async analyzePool(poolAddress: string, poolName: string): Promise<void> {
    console.log(`\n[ANALYZE] ${poolName}`);

    const candles1h = await fetchOhlcv(poolAddress, "1h", 250);
    const candles4h = await fetchOhlcv(poolAddress, "4h", 100);

    if (candles1h.length < 50) {
      console.log(`[ANALYZE] ${poolName}: insufficient data (${candles1h.length} candles)`);
      return;
    }

    const indicators = computeIndicators(candles1h);
    const zones = detectZones(candles1h);
    const setup = detectBestSetup(candles1h, candles4h);

    if (setup.confidence <= 0) {
      console.log(`[ANALYZE] ${poolName}: no setup (${setup.reason})`);
      return;
    }

    // Get memory context for this pair
    const memContext = this.memory.getContext(setup.type, poolName);
    const memoryPrompt = this.memory.formatForPrompt(memContext);

    // Check if any user rules contradict this trade
    const contradictingRule = memContext.rules.find((r) =>
      r.content.toLowerCase().includes("skip") &&
      r.content.toLowerCase().includes(poolName.toLowerCase())
    );
    if (contradictingRule) {
      console.log(`[MEMORY] Skipping ${poolName}: user rule "${contradictingRule.content}"`);
      return;
    }

    let sentiment = 0.5;
    if (this.aceApiKey) {
      try {
        const aiPrompt = memoryPrompt
          ? `${poolName} on Mantle. Context from user:\n${memoryPrompt}`
          : poolName;
        const analysis = await aceSentimentAnalysis(aiPrompt, this.aceApiKey);
        sentiment = analysis.sentiment;
        console.log(`[SENTIMENT] ${poolName}: ${(sentiment * 100).toFixed(0)}% — ${analysis.summary.slice(0, 80)}`);
      } catch { /* continue without sentiment */ }
    }

    const score = scoreSignal({
      indicators,
      setup,
      zones,
      candles: candles1h,
      sentiment,
    });

    console.log(`[SCORE] ${poolName}: ${score.total}/${SCORING.MAX_SCORE} (${score.tier}) — ${setup.type}`);
    score.tiers.forEach((t) =>
      console.log(`  ${t.name}: ${t.points}/${t.maxPoints}`)
    );

    const decision: DecisionLog = {
      id: `d-${Date.now()}`,
      timestamp: Date.now(),
      pair: poolName,
      action: "SKIP",
      score,
      risk: { positionSizePct: 0, kellyFraction: 0, stopLossPrice: 0, takeProfitPrice: 0, riskRewardRatio: 0, maxLossUsd: 0 },
      reason: "",
    };

    if (!score.pass) {
      decision.reason = `Score ${score.total} < ${SCORING.ENTRY_THRESHOLD} threshold`;
      console.log(`[SKIP] ${poolName}: ${decision.reason}`);
      this.state.decisions.push(decision);
      return;
    }

    const tradeCheck = this.risk.shouldTrade(setup.type);
    if (!tradeCheck.allowed) {
      decision.reason = tradeCheck.reason;
      console.log(`[SKIP] ${poolName}: ${tradeCheck.reason}`);
      this.state.decisions.push(decision);
      return;
    }

    const riskParams = this.risk.calcRiskParams(score, setup);
    decision.action = "ENTRY";
    decision.risk = riskParams;
    decision.reason = `${setup.type} @ ${setup.entry.toFixed(6)} | SL=${setup.stopLoss.toFixed(6)} TP=${setup.takeProfit.toFixed(6)} | Size=${(riskParams.positionSizePct * 100).toFixed(2)}%`;

    console.log(`\n[SIGNAL] ${poolName} — ${setup.direction} ${setup.type}`);
    console.log(`  Entry: ${setup.entry.toFixed(6)}`);
    console.log(`  Stop: ${setup.stopLoss.toFixed(6)}`);
    console.log(`  TP: ${setup.takeProfit.toFixed(6)}`);
    console.log(`  R:R = ${riskParams.riskRewardRatio.toFixed(1)}`);
    console.log(`  Size: ${(riskParams.positionSizePct * 100).toFixed(2)}% ($${riskParams.maxLossUsd.toFixed(2)} risk)`);
    console.log(`  Reason: ${setup.reason}`);

    if (this.mode === "paper") {
      this.paper.openPosition(poolName, setup.direction, setup.entry, score, riskParams);
    }

    this.state.decisions.push(decision);
  }

  // --- Public API for dashboard / CLI ---

  addMemory(content: string, category: "strategy" | "rule" | "observation", options?: { pair?: string; tags?: string[]; importance?: number }) {
    return this.memory.add(content, category, options);
  }

  removeMemory(id: string) {
    return this.memory.remove(id);
  }

  searchMemory(query: string) {
    return this.memory.search(query);
  }

  getMemoryStats() {
    return this.memory.getStats();
  }

  getInsights() {
    return this.memory.getInsights();
  }

  getState(): AgentState {
    return { ...this.state };
  }

  getDecisions(limit = 50): DecisionLog[] {
    return this.state.decisions.slice(-limit);
  }

  getPaperStats() {
    return this.paper.getStats();
  }

  getPaperPortfolio() {
    return this.paper.getPortfolio();
  }

  getMode(): AgentMode {
    return this.mode;
  }

  getSeedResult(): SeedResult | null {
    return this.seedResult;
  }

  // ---- Scheduled brief / weekly ----

  private async generateAndCacheBrief(): Promise<void> {
    const portfolio = this.paper.getPortfolio();
    const decisions = this.state.decisions.slice(-100);
    const insights = this.memory.getInsights();
    const healthScore = this.health.getLatestScore().overall;

    const brief = generateDailyBrief(portfolio, decisions, insights, healthScore);
    const info = this.scheduler.getTaskInfo("daily_brief");
    this.cachedBrief = {
      fullText: brief.fullText,
      generatedAt: Date.now(),
      nextRun: info?.nextRun,
    };
    console.log(`[SCHEDULER] Daily brief generated at ${new Date().toLocaleString()}`);
  }

  private async generateAndCacheWeekly(): Promise<void> {
    const portfolio = this.paper.getPortfolio();
    const memories = this.memory.search("");
    const healthHistory = this.health.getHistory();

    const report = generateWeeklyReport(
      portfolio.closedTrades,
      memories,
      healthHistory,
      portfolio.currentCapital,
      portfolio.initialCapital
    );
    const formatted = formatWeeklyReport(report);
    const info = this.scheduler.getTaskInfo("weekly_insights");
    this.cachedWeekly = {
      report,
      formatted,
      generatedAt: Date.now(),
      nextRun: info?.nextRun,
    };
    console.log(`[SCHEDULER] Weekly insights generated at ${new Date().toLocaleString()}`);
  }

  getCachedBrief() {
    return this.cachedBrief;
  }

  getCachedWeekly() {
    return this.cachedWeekly;
  }

  getScheduleInfo() {
    return {
      daily_brief: this.scheduler.getTaskInfo("daily_brief"),
      weekly_insights: this.scheduler.getTaskInfo("weekly_insights"),
    };
  }
}
