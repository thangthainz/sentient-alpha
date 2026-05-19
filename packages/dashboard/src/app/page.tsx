"use client";

import { useState, useEffect } from "react";

interface Decision {
  id: string;
  timestamp: number;
  pair: string;
  action: string;
  score: { total: number; tier: string };
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
}

const MOCK_DECISIONS: Decision[] = [
  { id: "d-1", timestamp: Date.now() - 300000, pair: "WMNT/USDC", action: "ENTRY", score: { total: 26, tier: "A" }, reason: "TREND_PULLBACK @ 0.4521 | R:R=2.1" },
  { id: "d-2", timestamp: Date.now() - 240000, pair: "WETH/USDC", action: "SKIP", score: { total: 18, tier: "B" }, reason: "Score 18 < 22 threshold" },
  { id: "d-3", timestamp: Date.now() - 180000, pair: "mETH/WMNT", action: "SKIP", score: { total: 14, tier: "C" }, reason: "ADX too low (19.2<25)" },
  { id: "d-4", timestamp: Date.now() - 120000, pair: "USDT/USDC", action: "SKIP", score: { total: 8, tier: "F" }, reason: "no setup (insufficient data)" },
  { id: "d-5", timestamp: Date.now() - 60000, pair: "WMNT/USDC", action: "ENTRY", score: { total: 29, tier: "S" }, reason: "LIQUIDITY_SWEEP @ 0.4489 | Wyckoff Spring confirmed" },
];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #1a1b2e 0%, #16172a 100%)",
      borderRadius: 12,
      padding: "20px 24px",
      border: "1px solid #2a2b3d",
      flex: "1 1 200px",
    }}>
      <div style={{ fontSize: 13, color: "#71717a", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#f4f4f5" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    S: "#f59e0b", A: "#22c55e", B: "#3b82f6", C: "#a1a1aa", F: "#ef4444",
  };
  return (
    <span style={{
      display: "inline-block",
      width: 28,
      height: 28,
      lineHeight: "28px",
      textAlign: "center",
      borderRadius: 6,
      fontSize: 13,
      fontWeight: 700,
      backgroundColor: `${colors[tier] || "#555"}22`,
      color: colors[tier] || "#555",
      border: `1px solid ${colors[tier] || "#555"}44`,
    }}>
      {tier}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const isEntry = action === "ENTRY";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      backgroundColor: isEntry ? "#22c55e18" : "#71717a18",
      color: isEntry ? "#22c55e" : "#71717a",
      border: `1px solid ${isEntry ? "#22c55e33" : "#71717a33"}`,
    }}>
      {action}
    </span>
  );
}

export default function Dashboard() {
  const [decisions] = useState<Decision[]>(MOCK_DECISIONS);
  const [agentState] = useState<AgentState>({
    isRunning: true,
    cycleCount: 47,
    positions: [],
    portfolioValue: 10842.5,
    totalPnl: 842.5,
    winRate: 0.58,
    totalTrades: 23,
    lastCycleTime: Date.now() - 30000,
  });

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            backgroundColor: agentState.isRunning ? "#22c55e" : "#ef4444",
            boxShadow: agentState.isRunning ? "0 0 8px #22c55e88" : "none",
          }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Sentient Alpha</h1>
          <span style={{ fontSize: 13, color: "#71717a", marginLeft: 8 }}>
            Autonomous AI Trading Agent on Mantle L2
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#52525b" }}>
          ERC-8004 Identity | 33-Point Signal Confluence | Bayesian Risk Engine | Multi-DEX Execution
        </div>
      </header>

      <section style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
        <StatCard label="Portfolio Value" value={`$${agentState.portfolioValue.toLocaleString()}`} sub={`+$${agentState.totalPnl.toFixed(2)} PnL`} />
        <StatCard label="Win Rate" value={`${(agentState.winRate * 100).toFixed(0)}%`} sub={`${agentState.totalTrades} trades`} />
        <StatCard label="Cycle" value={`#${agentState.cycleCount}`} sub="60s interval" />
        <StatCard label="Active Positions" value={`${agentState.positions.length}`} sub="max 3 concurrent" />
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Decision Timeline</h2>
        <div style={{
          background: "#111218",
          borderRadius: 12,
          border: "1px solid #1e1f2e",
          overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e1f2e" }}>
                {["Time", "Pair", "Action", "Score", "Reason"].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#71717a", fontWeight: 500, fontSize: 12 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid #1a1b2e" }}>
                  <td style={{ padding: "10px 16px", color: "#a1a1aa", fontSize: 12 }}>
                    {new Date(d.timestamp).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: "10px 16px", fontWeight: 600 }}>{d.pair}</td>
                  <td style={{ padding: "10px 16px" }}><ActionBadge action={d.action} /></td>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <TierBadge tier={d.score.tier} />
                      <span style={{ color: "#a1a1aa", fontSize: 12 }}>{d.score.total}/33</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 16px", color: "#a1a1aa", fontSize: 12, maxWidth: 300 }}>
                    {d.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Signal Heatmap</h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 12,
        }}>
          {[
            { name: "Trend Alignment", value: 2, max: 2 },
            { name: "ADX Strength", value: 2, max: 2 },
            { name: "RSI Zone", value: 1, max: 1 },
            { name: "Supertrend", value: 2, max: 2 },
            { name: "Choppiness Clear", value: 1, max: 1 },
            { name: "Setup Confidence", value: 5, max: 5 },
            { name: "Risk/Reward", value: 2, max: 2 },
            { name: "Near Demand Zone", value: 2, max: 2 },
            { name: "Zone Strength", value: 1, max: 1 },
            { name: "Volume Surge", value: 2, max: 2 },
            { name: "DI Bullish", value: 1, max: 1 },
            { name: "TVL Growth", value: 2, max: 2 },
            { name: "Sentiment", value: 2, max: 2 },
            { name: "Whale Inflow", value: 2, max: 2 },
          ].map((s) => {
            const pct = s.value / s.max;
            const hue = pct > 0.7 ? 142 : pct > 0.3 ? 45 : 0;
            return (
              <div key={s.name} style={{
                background: `hsla(${hue}, 60%, 40%, 0.12)`,
                border: `1px solid hsla(${hue}, 60%, 40%, 0.25)`,
                borderRadius: 8,
                padding: "12px 14px",
              }}>
                <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 4 }}>{s.name}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: `hsl(${hue}, 60%, 65%)` }}>
                  {s.value}/{s.max}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 13, color: "#52525b" }}>
          Total: 27/33 (Tier A) — ENTRY signal active
        </div>
      </section>

      <footer style={{ marginTop: 48, padding: "16px 0", borderTop: "1px solid #1e1f2e", fontSize: 12, color: "#3f3f46" }}>
        Sentient Alpha v0.1.0 | Mantle L2 | ERC-8004 Agent Identity | Built for Mantle Turing Test Hackathon
      </footer>
    </div>
  );
}
