# Sentient Alpha — Autonomous AI Trading Agent on Mantle

> 33-point signal confluence, Bayesian risk engine, multi-DEX execution, and ERC-8004 on-chain identity — all running autonomously on Mantle L2.

Built for the [Mantle Turing Test Hackathon](https://dorahacks.io/hackathon/mantle-turing-test).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Sentient Alpha Agent                       │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Data Pipeline│  │ Signal Engine │  │  Risk Management   │  │
│  │              │  │              │  │                    │  │
│  │ GeckoTerminal│→ │ 6 Indicators │→ │ BayesianTracker    │  │
│  │ DeFiLlama   │  │ 3 Setups     │  │ Kelly Criterion    │  │
│  │ Ace Cloud AI │  │ 33pt Scoring │  │ Emergency Cooldown │  │
│  │ Pyth Oracle  │  │ S&D Zones    │  │                    │  │
│  └─────────────┘  └──────┬───────┘  └────────┬───────────┘  │
│                          │                     │              │
│                    ┌─────▼─────────────────────▼─────┐       │
│                    │      DEX Execution Layer         │       │
│                    │  Merchant Moe (LB) + Agni (V3)  │       │
│                    └──────────────┬───────────────────┘       │
│                                   │                           │
│  ┌────────────────────────────────▼──────────────────────┐   │
│  │              On-Chain Layer (Mantle L2)                │   │
│  │  SentientAgent.sol  │ StrategyVault.sol (ERC-4626)    │   │
│  │  DecisionLogger.sol │ DexRouter.sol                   │   │
│  │  ERC-8004 Identity  │ Reputation Registry             │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## What Makes This Different

1. **ERC-8004 Agent Identity** — First autonomous trading agent with trustless on-chain identity and verifiable reputation on Mantle
2. **33-Point Signal Confluence** — Multi-tier scoring (Technical + Setup + S&D + Volume + On-Chain) replaces single-indicator strategies
3. **3 Legendary Setups** — Trend-Pullback (Tudor Jones + Raschke), Liquidity-Sweep (Wyckoff Spring), Vol-Expansion (Minervini VCP)
4. **Bayesian Risk Engine** — Adaptive position sizing using Beta distribution winrate tracking and Kelly Criterion
5. **AI-Enhanced Decisions** — Ace Data Cloud for sentiment analysis, market search, and visual report generation
6. **Multi-DEX Smart Routing** — Executes through Merchant Moe (Liquidity Book) and Agni Finance (Uniswap V3)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Mantle L2 (Chain ID 5000) |
| Identity | ERC-8004 Trustless Agent Identity |
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin |
| Engine | TypeScript, ethers.js v6 |
| Data | GeckoTerminal, DeFiLlama, Pyth Oracle, Ace Data Cloud |
| Dashboard | Next.js 15, React 19 |
| Monorepo | npm workspaces, Turbo |

## Project Structure

```
sentient-alpha/
├── packages/
│   ├── shared/          # Types, constants, Mantle addresses
│   ├── contracts/       # Solidity smart contracts (Foundry)
│   │   └── src/
│   │       ├── SentientAgent.sol      # ERC-8004 identity + stats
│   │       ├── StrategyVault.sol      # ERC-4626 vault for deposits
│   │       ├── DecisionLogger.sol     # On-chain decision audit trail
│   │       └── DexRouter.sol          # Multi-DEX swap aggregation
│   ├── engine/          # TypeScript trading engine
│   │   └── src/
│   │       ├── indicators/  # EMA, RSI, ATR, ADX, Supertrend, Choppiness, S&D zones
│   │       ├── scoring/     # 33-point scorer + 3 setup detectors
│   │       ├── risk/        # BayesianTracker + Kelly Criterion
│   │       ├── execution/   # Merchant Moe & Agni Finance DEX integration
│   │       └── data/        # GeckoTerminal, DeFiLlama, Ace Cloud, Pyth
│   └── dashboard/       # Next.js 15 real-time dashboard
```

## Setup

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Fill in your keys

# Build all packages
npm run build

# Start the trading engine
npm run engine:dev

# Start the dashboard
npm run dashboard:dev
```

## Smart Contract Deployment

```bash
cd packages/contracts

# Install Foundry dependencies
forge install OpenZeppelin/openzeppelin-contracts

# Deploy to Mantle testnet
forge script script/Deploy.s.sol --rpc-url https://rpc.sepolia.mantle.xyz --broadcast
```

## Signal Scoring Breakdown (33 points)

| Tier | Points | Criteria |
|------|--------|----------|
| T1: Technical | 8 | Trend alignment, ADX, RSI, Supertrend, Choppiness |
| T2: Setup Quality | 8 | Confidence, R:R ratio, setup type |
| T3: S&D Confluence | 5 | Demand zone proximity, zone strength, clear path |
| T4: Volume & Momentum | 5 | Volume surge, trend, price momentum, DI crossover |
| TS: On-Chain & Sentiment | 7 | TVL growth, AI sentiment, whale flows |

**Entry threshold: 22/33 (Tier A)**

## Key Addresses (Mantle Mainnet)

| Contract | Address |
|----------|---------|
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Merchant Moe LB Router | `0x013e138EF6008ae5FDFDE29700e3f2Bc61d21E3a` |
| Agni Finance SwapRouter | `0x319B69888b0d11cEC22caA5034e25FfFBDc88421` |
| Pyth Oracle | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |

## License

MIT
