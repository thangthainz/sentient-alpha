"use client";

import { useState, useEffect, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3200";

interface Decision {
  id: string;
  timestamp: number;
  pair: string;
  action: string;
  score: { total: number; tier: string; tiers?: Array<{ name: string; points: number; maxPoints: number }> };
  reason: string;
}

interface AgentState {
  isRunning: boolean;
  cycleCount: number;
  positions: unknown[];
  portfolioValue: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  lastCycleTime: number;
  mode: string;
  paper: { totalTrades: number; winRate: number; totalPnl: number; maxDrawdown: number; currentCapital: number; profitFactor: number };
  health: { overall: number; tradingAdjustment: number; warning?: string };
}

interface Brief {
  fullText: string;
  generatedAt: number;
  nextRun?: number | null;
  source?: string;
}

interface Weekly {
  formatted: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: number;
  nextRun?: number | null;
  performance: { trades: number; winRate: number; totalPnl: number; avgHoldTime: number };
  patterns: Array<{ pattern: string; suggestion: string; confidence: number }>;
  healthCorrelation?: string;
  recommendations: string[];
  summary: string;
}

interface CoachResponse {
  answer: string;
  disclaimer: string;
}

interface BacktestTrade {
  id: string;
  pair: string;
  direction: string;
  entryPrice: number;
  exitPrice?: number;
  entryTime: number;
  exitTime?: number;
  pnl?: number;
  pnlPct?: number;
  win?: boolean;
  exitReason?: string;
  score: { total: number; tier: string };
}

interface BacktestData {
  seed: {
    totalTrades: number;
    totalPnl: number;
    winRate: number;
    byPool: Record<string, { trades: number; pnl: number; winRate: number }>;
    startTime: number;
    endTime: number;
  } | null;
  portfolio: {
    initialCapital: number;
    currentCapital: number;
    totalPnl: number;
    maxDrawdown: number;
    winCount: number;
    lossCount: number;
  };
  trades: BacktestTrade[];
  stats: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    sharpeEstimate: number;
    avgWin: number;
    avgLoss: number;
  };
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #1a1b2e 0%, #16172a 100%)",
      borderRadius: 12,
      padding: "20px 24px",
      border: "1px solid #2a2b3d",
      flex: "1 1 200px",
    }}>
      <div style={{ fontSize: 13, color: "#71717a", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || "#f4f4f5" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = { S: "#f59e0b", A: "#22c55e", B: "#3b82f6", C: "#a1a1aa", F: "#ef4444" };
  return (
    <span style={{
      display: "inline-block", width: 28, height: 28, lineHeight: "28px", textAlign: "center",
      borderRadius: 6, fontSize: 13, fontWeight: 700,
      backgroundColor: `${colors[tier] || "#555"}22`, color: colors[tier] || "#555",
      border: `1px solid ${colors[tier] || "#555"}44`,
    }}>{tier}</span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const isEntry = action === "ENTRY";
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      backgroundColor: isEntry ? "#22c55e18" : "#71717a18",
      color: isEntry ? "#22c55e" : "#71717a",
      border: `1px solid ${isEntry ? "#22c55e33" : "#71717a33"}`,
    }}>{action}</span>
  );
}

export default function Dashboard() {
  const [state, setState] = useState<AgentState | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [coachQ, setCoachQ] = useState("");
  const [coachA, setCoachA] = useState<CoachResponse | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [tab, setTab] = useState<"decisions" | "brief" | "weekly" | "coach" | "backtest">("decisions");
  const [backtest, setBacktest] = useState<BacktestData | null>(null);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [stateRes, decisionsRes] = await Promise.all([
        fetch(`${API_URL}/api/state`),
        fetch(`${API_URL}/api/decisions?limit=30`),
      ]);
      if (stateRes.ok) setState(await stateRes.json());
      if (decisionsRes.ok) setDecisions(await decisionsRes.json());
      setError(null);
    } catch {
      setError("Cannot connect to API server. Run: npm run engine:api");
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const fetchBrief = async () => {
    const res = await fetch(`${API_URL}/api/brief`);
    if (res.ok) setBrief(await res.json());
  };

  const fetchBacktest = async () => {
    const res = await fetch(`${API_URL}/api/backtest`);
    if (res.ok) setBacktest(await res.json());
  };

  const fetchWeekly = async () => {
    const res = await fetch(`${API_URL}/api/weekly`);
    if (res.ok) setWeekly(await res.json());
  };

  const formatLocal = (ms: number | null | undefined) => {
    if (!ms) return "—";
    return new Date(ms).toLocaleString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const askCoach = async () => {
    if (!coachQ.trim()) return;
    setCoachLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: coachQ }),
      });
      if (res.ok) setCoachA(await res.json());
    } finally {
      setCoachLoading(false);
    }
  };

  const pnlColor = (state?.totalPnl ?? 0) >= 0 ? "#22c55e" : "#ef4444";

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            backgroundColor: state?.isRunning ? "#22c55e" : error ? "#ef4444" : "#f59e0b",
            boxShadow: state?.isRunning ? "0 0 8px #22c55e88" : "none",
          }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Sentient Alpha</h1>
          {state && (
            <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, backgroundColor: "#3b82f622", color: "#3b82f6", border: "1px solid #3b82f644" }}>
              {state.mode.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#52525b" }}>
          Autonomous AI Trading Agent on Mantle L2 | ERC-8004 Identity | 33-Point Signal Confluence
        </div>
        {error && <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444" }}>{error}</div>}
        {state?.health?.warning && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#f59e0b", padding: "6px 12px", backgroundColor: "#f59e0b11", borderRadius: 6, border: "1px solid #f59e0b33" }}>
            {state.health.warning}
          </div>
        )}
      </header>

      {state && (
        <section style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
          <StatCard label="Portfolio" value={`$${state.paper.currentCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} sub={`${state.totalPnl >= 0 ? "+" : ""}$${state.totalPnl.toFixed(2)} PnL`} color={pnlColor} />
          <StatCard label="Win Rate" value={`${(state.paper.winRate * 100).toFixed(1)}%`} sub={`${state.paper.totalTrades} trades | PF ${state.paper.profitFactor.toFixed(2)}`} />
          <StatCard label="Max Drawdown" value={`${state.paper.maxDrawdown.toFixed(1)}%`} sub={`Cycle #${state.cycleCount}`} />
          <StatCard label="Health" value={`${state.health.overall}/100`} sub={`Adj: ${state.health.tradingAdjustment}x`} color={state.health.overall >= 60 ? "#22c55e" : "#f59e0b"} />
        </section>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["decisions", "backtest", "brief", "weekly", "coach"] as const).map((t) => (
          <button key={t} onClick={() => {
            setTab(t);
            if (t === "brief") fetchBrief();
            if (t === "backtest") fetchBacktest();
            if (t === "weekly") fetchWeekly();
          }}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #2a2b3d", cursor: "pointer",
              backgroundColor: tab === t ? "#3b82f622" : "transparent",
              color: tab === t ? "#3b82f6" : "#a1a1aa", fontWeight: 600, fontSize: 13,
            }}>
            {t === "decisions" ? "Live Decisions"
              : t === "backtest" ? "Backtest (180d)"
              : t === "brief" ? "Daily Brief"
              : t === "weekly" ? "Weekly Insights"
              : "Trading Coach"}
          </button>
        ))}
      </div>

      {tab === "decisions" && (
        <section>
          <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e1f2e" }}>
                  {["Time", "Pair", "Action", "Score", "Reason"].map((h) => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#71717a", fontWeight: 500, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decisions.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#52525b" }}>Waiting for first cycle...</td></tr>
                )}
                {decisions.slice().reverse().map((d) => (
                  <tr key={d.id} style={{ borderBottom: "1px solid #1a1b2e" }}>
                    <td style={{ padding: "10px 16px", color: "#a1a1aa", fontSize: 12 }}>{new Date(d.timestamp).toLocaleTimeString()}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 600 }}>{d.pair}</td>
                    <td style={{ padding: "10px 16px" }}><ActionBadge action={d.action} /></td>
                    <td style={{ padding: "10px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <TierBadge tier={d.score.tier} />
                        <span style={{ color: "#a1a1aa", fontSize: 12 }}>{d.score.total}/33</span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 16px", color: "#a1a1aa", fontSize: 12, maxWidth: 300 }}>{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "backtest" && (
        <section>
          {!backtest ? (
            <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 24, color: "#52525b", textAlign: "center" }}>
              Loading backtest replay...
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <StatCard label="Total Trades" value={`${backtest.stats.totalTrades}`} sub={`${backtest.portfolio.winCount}W / ${backtest.portfolio.lossCount}L`} />
                <StatCard label="Win Rate" value={`${(backtest.stats.winRate * 100).toFixed(1)}%`} sub={`PF: ${backtest.stats.profitFactor.toFixed(2)}`} color={backtest.stats.winRate >= 0.5 ? "#22c55e" : "#ef4444"} />
                <StatCard label="Total PnL" value={`${backtest.portfolio.totalPnl >= 0 ? "+" : ""}$${backtest.portfolio.totalPnl.toFixed(2)}`} sub={`${((backtest.portfolio.totalPnl / backtest.portfolio.initialCapital) * 100).toFixed(2)}%`} color={backtest.portfolio.totalPnl >= 0 ? "#22c55e" : "#ef4444"} />
                <StatCard label="Max Drawdown" value={`${(backtest.portfolio.maxDrawdown * 100).toFixed(2)}%`} sub={`Sharpe est: ${backtest.stats.sharpeEstimate.toFixed(2)}`} />
              </div>

              {backtest.seed && (
                <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "#71717a", marginBottom: 8 }}>
                    HISTORICAL REPLAY ({new Date(backtest.seed.startTime).toLocaleDateString()} → {new Date(backtest.seed.endTime).toLocaleDateString()})
                  </div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    {Object.entries(backtest.seed.byPool).map(([pool, stat]) => (
                      <div key={pool} style={{ fontSize: 13 }}>
                        <div style={{ color: "#a1a1aa" }}>{pool}</div>
                        <div style={{ color: "#e4e4e7", fontWeight: 600 }}>
                          {stat.trades} trades · {(stat.winRate * 100).toFixed(0)}% WR · {stat.pnl >= 0 ? "+" : ""}${stat.pnl.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1e1f2e" }}>
                      {["Time", "Pair", "Side", "Entry", "Exit", "PnL", "Exit Reason", "Score"].map((h) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#71717a", fontWeight: 500, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {backtest.trades.length === 0 && (
                      <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "#52525b" }}>No trades in replay</td></tr>
                    )}
                    {backtest.trades.slice().reverse().map((t) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid #1a1b2e" }}>
                        <td style={{ padding: "8px 12px", color: "#a1a1aa", fontSize: 11 }}>{new Date(t.entryTime).toLocaleDateString()}</td>
                        <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: 11 }}>{t.pair.length > 16 ? `${t.pair.slice(0, 6)}...${t.pair.slice(-4)}` : t.pair}</td>
                        <td style={{ padding: "8px 12px", color: t.direction === "LONG" ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{t.direction}</td>
                        <td style={{ padding: "8px 12px", color: "#a1a1aa" }}>${t.entryPrice.toFixed(4)}</td>
                        <td style={{ padding: "8px 12px", color: "#a1a1aa" }}>{t.exitPrice ? `$${t.exitPrice.toFixed(4)}` : "-"}</td>
                        <td style={{ padding: "8px 12px", color: t.win ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                          {t.pnl !== undefined ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)} (${(t.pnlPct! * 100).toFixed(1)}%)` : "-"}
                        </td>
                        <td style={{ padding: "8px 12px", color: "#a1a1aa", fontSize: 11 }}>{t.exitReason ?? "-"}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <TierBadge tier={t.score.tier} />
                            <span style={{ color: "#a1a1aa", fontSize: 11 }}>{t.score.total}/33</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {tab === "brief" && (
        <section style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 24 }}>
          {brief ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #1e1f2e", fontSize: 12 }}>
                <span style={{ color: "#71717a" }}>
                  Generated: <span style={{ color: "#a1a1aa" }}>{formatLocal(brief.generatedAt)}</span>
                </span>
                <span style={{ color: "#71717a" }}>
                  Next: <span style={{ color: "#a1a1aa" }}>{formatLocal(brief.nextRun)}</span> (7:00 AM local)
                </span>
              </div>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, color: "#e4e4e7", margin: 0, lineHeight: 1.6 }}>
                {brief.fullText}
              </pre>
            </>
          ) : (
            <div style={{ color: "#52525b", textAlign: "center" }}>Loading daily brief...</div>
          )}
        </section>
      )}

      {tab === "weekly" && (
        <section>
          {!weekly ? (
            <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 24, color: "#52525b", textAlign: "center" }}>
              Loading weekly insights...
            </div>
          ) : (
            <>
              <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <span style={{ color: "#71717a" }}>
                  Generated: <span style={{ color: "#a1a1aa" }}>{formatLocal(weekly.generatedAt)}</span>
                </span>
                <span style={{ color: "#71717a" }}>
                  Next: <span style={{ color: "#a1a1aa" }}>{formatLocal(weekly.nextRun)}</span> (Sun 10:00 PM local)
                </span>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <StatCard label="Week Trades" value={`${weekly.performance.trades}`} />
                <StatCard
                  label="Week Win Rate"
                  value={`${(weekly.performance.winRate * 100).toFixed(1)}%`}
                  color={weekly.performance.winRate >= 0.5 ? "#22c55e" : "#ef4444"}
                />
                <StatCard
                  label="Week PnL"
                  value={`${weekly.performance.totalPnl >= 0 ? "+" : ""}$${weekly.performance.totalPnl.toFixed(2)}`}
                  color={weekly.performance.totalPnl >= 0 ? "#22c55e" : "#ef4444"}
                />
                <StatCard label="Avg Hold" value={`${weekly.performance.avgHoldTime.toFixed(1)}h`} />
              </div>

              <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 24, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#71717a", marginBottom: 8, letterSpacing: 0.5 }}>SUMMARY</div>
                <div style={{ color: "#e4e4e7", fontSize: 14, lineHeight: 1.6 }}>{weekly.summary}</div>
              </div>

              {weekly.patterns.length > 0 && (
                <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 24, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: "#71717a", marginBottom: 12, letterSpacing: 0.5 }}>PATTERNS DETECTED</div>
                  {weekly.patterns.map((p, i) => (
                    <div key={i} style={{ marginBottom: 12, paddingLeft: 12, borderLeft: "2px solid #3b82f6" }}>
                      <div style={{ color: "#e4e4e7", fontSize: 13, fontWeight: 500 }}>{p.pattern}</div>
                      <div style={{ color: "#a1a1aa", fontSize: 12, marginTop: 4 }}>→ {p.suggestion}</div>
                      <div style={{ color: "#52525b", fontSize: 11, marginTop: 2 }}>Confidence: {(p.confidence * 100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              )}

              {weekly.healthCorrelation && (
                <div style={{ background: "#f59e0b11", borderRadius: 12, border: "1px solid #f59e0b33", padding: 24, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 8, letterSpacing: 0.5 }}>HEALTH CORRELATION</div>
                  <div style={{ color: "#e4e4e7", fontSize: 13, lineHeight: 1.6 }}>{weekly.healthCorrelation}</div>
                </div>
              )}

              {weekly.recommendations.length > 0 && (
                <div style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 24 }}>
                  <div style={{ fontSize: 11, color: "#71717a", marginBottom: 12, letterSpacing: 0.5 }}>RECOMMENDATIONS</div>
                  {weekly.recommendations.map((r, i) => (
                    <div key={i} style={{ color: "#e4e4e7", fontSize: 13, marginBottom: 8, paddingLeft: 16, position: "relative" }}>
                      <span style={{ position: "absolute", left: 0, color: "#22c55e" }}>→</span> {r}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === "coach" && (
        <section style={{ background: "#111218", borderRadius: 12, border: "1px solid #1e1f2e", padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <input
              value={coachQ}
              onChange={(e) => setCoachQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askCoach()}
              placeholder="Ask the Trading Coach (e.g. Should I hold my WMNT position?)"
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 8, border: "1px solid #2a2b3d",
                backgroundColor: "#0a0b0d", color: "#e4e4e7", fontSize: 14, outline: "none",
              }}
            />
            <button onClick={askCoach} disabled={coachLoading}
              style={{ marginTop: 8, padding: "8px 20px", borderRadius: 8, border: "none", backgroundColor: "#3b82f6", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: coachLoading ? 0.5 : 1 }}>
              {coachLoading ? "Thinking..." : "Ask Coach"}
            </button>
          </div>
          {coachA && (
            <div>
              <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 12, padding: "6px 10px", backgroundColor: "#f59e0b11", borderRadius: 4 }}>
                {coachA.disclaimer}
              </div>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: "#e4e4e7", margin: 0, lineHeight: 1.6 }}>
                {coachA.answer}
              </pre>
            </div>
          )}
        </section>
      )}

      <footer style={{ marginTop: 48, padding: "16px 0", borderTop: "1px solid #1e1f2e", fontSize: 12, color: "#3f3f46" }}>
        Sentient Alpha v0.1.0 | Mantle L2 | Paper Trading Mode | Built for Mantle Turing Test Hackathon
      </footer>
    </div>
  );
}
