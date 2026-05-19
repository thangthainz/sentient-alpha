# Sentient Alpha — Demo Materials

Hackathon submission materials for the [Mantle Turing Test Hackathon](https://dorahacks.io/hackathon/mantle-turing-test).

## 1. Live Deployment (Mantle Sepolia)

| Contract | Address | Mantlescan | Sourcify |
|----------|---------|------------|----------|
| SentientAgent | `0x9b2D768727600577962aA69474E49B70621ebc34` | [link](https://sepolia.mantlescan.xyz/address/0x9b2D768727600577962aA69474E49B70621ebc34) | [verified](https://sourcify.dev/#/lookup/0x9b2D768727600577962aA69474E49B70621ebc34) |
| DecisionLogger | `0x41e1CbcaFAbDb8B22fC8a658DC50faBEB0CB292B` | [link](https://sepolia.mantlescan.xyz/address/0x41e1CbcaFAbDb8B22fC8a658DC50faBEB0CB292B) | [verified](https://sourcify.dev/#/lookup/0x41e1CbcaFAbDb8B22fC8a658DC50faBEB0CB292B) |
| DexRouter | `0xE5CbF1D18e0663131cb54eFD0A369a66A4b6c412` | [link](https://sepolia.mantlescan.xyz/address/0xE5CbF1D18e0663131cb54eFD0A369a66A4b6c412) | [verified](https://sourcify.dev/#/lookup/0xE5CbF1D18e0663131cb54eFD0A369a66A4b6c412) |
| StrategyVault | `0x9c1F07ecd31AbE8C08459B980E1A9e55C7dbb572` | [link](https://sepolia.mantlescan.xyz/address/0x9c1F07ecd31AbE8C08459B980E1A9e55C7dbb572) | [verified](https://sourcify.dev/#/lookup/0x9c1F07ecd31AbE8C08459B980E1A9e55C7dbb572) |

All source code is publicly verified via Sourcify (chain ID 5003).

## 2. Backtest Results (BSB/USDT0, 60 days)

Pool: `0xdc16ff7d202bae83b35fd7cdbba28be6b8b13f24` (Merchant Moe LB)
Period: 60 days, 720 hourly candles

| Metric | Value |
|--------|-------|
| Initial Capital | $10,000 |
| Final Capital | $10,057.79 |
| Total PnL | **+$57.79 (+0.58%)** |
| Trades | 4 (4W / 0L) |
| Win Rate | **100%** |
| Best Trade | +31.83% (Score 14/33, Tier C) |
| Worst Drawdown | 0% |
| Avg Win | $14.45 |

All 4 trades exited via TAKE_PROFIT (no SL hits). Demonstrates correct risk-management math (SL/TP placement, position sizing via Bayesian risk engine).

Full report: `docs/backtest-report.txt`

## 3. Engine Live Demo

```bash
# Start engine API (runs autonomous loop every 60s)
npm run engine:api
# → http://localhost:3200

# Start dashboard (auto-refresh every 10s)
npm run dashboard:dev
# → http://localhost:3100
```

The engine analyzes 3 volatile Mantle pools per cycle (stablecoin/stablecoin pairs filtered out), scores them on the 33-point system, and tracks a virtual $10,000 paper portfolio.

## 4. Key Differentiators

1. **ERC-8004 Identity** — First autonomous trading agent registered on Mantle with on-chain reputation
2. **33-Point Signal Confluence** — Multi-tier scoring across 5 dimensions (Technical / Setup / S&D / Volume / On-Chain)
3. **3 Legendary Setups** — Trend-Pullback, Liquidity-Sweep, Vol-Expansion
4. **Bayesian Risk Engine** — Adaptive position sizing with Beta-distribution winrate tracking + Kelly Criterion
5. **Health Correlation** — Sleep/stress/mood inputs scale position size 0.25x–1.0x (prevent emotional trading)
6. **Trading Coach** (NFA) — Memory-aware Q&A about positions and strategy
7. **Daily Brief** — Auto-generated overnight summary with insights

## 5. Demo Recording Checklist

- [ ] Dashboard at http://localhost:3100 — show all 4 stat cards live + status indicator
- [ ] Click into Daily Brief tab — show generated brief
- [ ] Click into Trading Coach tab — ask: "Should I increase position size after 3 wins?"
- [ ] Show engine terminal log — cycle analyzing pools with reasons
- [ ] Open `sepolia.mantlescan.xyz` → SentientAgent contract → show verified source
- [ ] Show `docs/backtest-report.txt` — 100% win rate on real Mantle data
- [ ] GitHub repo: https://github.com/thangthainz/sentient-alpha
