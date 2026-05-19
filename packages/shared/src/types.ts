export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface IndicatorResult {
  ema_fast: number;
  ema_slow: number;
  rsi: number;
  atr: number;
  adx: number;
  plus_di: number;
  minus_di: number;
  supertrend: number;
  supertrend_direction: "up" | "down";
  choppiness: number;
  volume_sma: number;
  volume_ratio: number;
}

export interface SupplyDemandZone {
  type: "supply" | "demand";
  high: number;
  low: number;
  strength: number;
  touches: number;
  timestamp: number;
  broken: boolean;
}

export type SetupType =
  | "TREND_PULLBACK"
  | "LIQUIDITY_SWEEP"
  | "VOL_EXPANSION"
  | "NONE";

export type SignalDirection = "LONG" | "SHORT";

export interface SetupDetection {
  type: SetupType;
  direction: SignalDirection;
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
}

export interface ScoringTier {
  name: string;
  points: number;
  maxPoints: number;
  breakdown: Record<string, number>;
}

export interface SignalScore {
  total: number;
  tier: "S" | "A" | "B" | "C" | "F";
  tiers: ScoringTier[];
  pass: boolean;
  setup: SetupDetection;
}

export interface RiskParams {
  positionSizePct: number;
  kellyFraction: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRewardRatio: number;
  maxLossUsd: number;
}

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "PENDING" | "FILLED" | "FAILED" | "CANCELLED";

export interface TradeOrder {
  id: string;
  pair: string;
  side: OrderSide;
  amount: bigint;
  expectedPrice: number;
  slippageBps: number;
  dex: "merchant_moe" | "agni_finance";
  status: OrderStatus;
  txHash?: string;
  filledPrice?: number;
  gasUsed?: bigint;
  timestamp: number;
}

export interface Position {
  id: string;
  pair: string;
  side: SignalDirection;
  entryPrice: number;
  currentPrice: number;
  size: number;
  sizeUsd: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop?: number;
  pnl: number;
  pnlPct: number;
  openTime: number;
  lastUpdate: number;
  score: SignalScore;
  orders: TradeOrder[];
}

export interface DecisionLog {
  id: string;
  timestamp: number;
  pair: string;
  action: "ENTRY" | "EXIT" | "SKIP" | "ADJUST";
  score: SignalScore;
  risk: RiskParams;
  reason: string;
  txHash?: string;
  onChainLogId?: string;
}

export interface MarketData {
  pair: string;
  candles: Record<Timeframe, Candle[]>;
  indicators: Record<Timeframe, IndicatorResult>;
  zones: SupplyDemandZone[];
  tvl?: number;
  sentiment?: number;
  whaleFlowNet?: number;
}

export interface AgentState {
  isRunning: boolean;
  cycleCount: number;
  positions: Position[];
  portfolioValue: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  lastCycleTime: number;
  decisions: DecisionLog[];
}

export interface AgentIdentity {
  address: string;
  erc8004Id: string;
  name: string;
  reputation: number;
  registeredAt: number;
}
