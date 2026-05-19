import type {
  Candle,
  IndicatorResult,
  SetupDetection,
  SignalScore,
  ScoringTier,
  SupplyDemandZone,
} from "@sentient-alpha/shared";
import { SCORING } from "@sentient-alpha/shared";

interface ScoringInput {
  indicators: IndicatorResult;
  setup: SetupDetection;
  zones: SupplyDemandZone[];
  candles: Candle[];
  tvl?: number;
  sentiment?: number;
  whaleFlowNet?: number;
}

export function scoreSignal(input: ScoringInput): SignalScore {
  const tiers: ScoringTier[] = [];
  let total = 0;

  // Tier 1: Technical Indicators (max 8 pts)
  const t1 = scoreTierTechnical(input.indicators, input.candles);
  tiers.push(t1);
  total += t1.points;

  // Tier 2: Setup Quality (max 8 pts)
  const t2 = scoreTierSetup(input.setup);
  tiers.push(t2);
  total += t2.points;

  // Tier 3: Supply/Demand Confluence (max 5 pts)
  const t3 = scoreTierZones(input.setup, input.zones);
  tiers.push(t3);
  total += t3.points;

  // Tier 4: Volume & Momentum (max 5 pts)
  const t4 = scoreTierVolume(input.indicators, input.candles);
  tiers.push(t4);
  total += t4.points;

  // Tier S: On-Chain & Sentiment (max 7 pts) — replaces A1 Academy
  const t5 = scoreTierOnChain(input.tvl, input.sentiment, input.whaleFlowNet);
  tiers.push(t5);
  total += t5.points;

  const tier = total >= SCORING.TIER_S_THRESHOLD
    ? "S"
    : total >= SCORING.TIER_A_THRESHOLD
      ? "A"
      : total >= SCORING.TIER_B_THRESHOLD
        ? "B"
        : total >= SCORING.TIER_C_THRESHOLD
          ? "C"
          : "F";

  return {
    total,
    tier,
    tiers,
    pass: total >= SCORING.ENTRY_THRESHOLD,
    setup: input.setup,
  };
}

function scoreTierTechnical(ind: IndicatorResult, candles: Candle[]): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;

  // Trend alignment (EMA fast > slow = uptrend)
  if (ind.ema_fast > ind.ema_slow) { bd.trend_align = 2; pts += 2; }
  else { bd.trend_align = 0; }

  // ADX strength
  if (ind.adx > 25) { bd.adx_strong = ind.adx > 35 ? 2 : 1; pts += bd.adx_strong; }

  // RSI healthy zone (40-70 for longs)
  if (ind.rsi >= 40 && ind.rsi <= 70) { bd.rsi_zone = 1; pts += 1; }

  // Supertrend confirmation
  if (ind.supertrend_direction === "up") { bd.supertrend = 2; pts += 2; }

  // Choppiness filter (< 61.8 = trending)
  if (ind.choppiness < 61.8) { bd.chop_clear = 1; pts += 1; }

  return { name: "Technical Indicators", points: Math.min(pts, 8), maxPoints: 8, breakdown: bd };
}

function scoreTierSetup(setup: SetupDetection): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;

  if (setup.confidence <= 0) {
    return { name: "Setup Quality", points: 0, maxPoints: 8, breakdown: { no_setup: 0 } };
  }

  // Base score from confidence (0-5 → 0-5 pts)
  bd.confidence = Math.round(setup.confidence);
  pts += bd.confidence;

  // Risk/reward
  const rr = setup.takeProfit && setup.stopLoss && setup.entry
    ? (setup.takeProfit - setup.entry) / (setup.entry - setup.stopLoss)
    : 0;
  if (rr >= 2) { bd.rr_good = rr >= 3 ? 2 : 1; pts += bd.rr_good; }

  // Setup type bonus
  if (setup.type === "LIQUIDITY_SWEEP") { bd.type_bonus = 1; pts += 1; }

  return { name: "Setup Quality", points: Math.min(pts, 8), maxPoints: 8, breakdown: bd };
}

function scoreTierZones(setup: SetupDetection, zones: SupplyDemandZone[]): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;

  if (setup.entry <= 0 || zones.length === 0) {
    return { name: "S&D Confluence", points: 0, maxPoints: 5, breakdown: bd };
  }

  const nearDemand = zones.filter(
    (z) => z.type === "demand" && !z.broken && Math.abs(setup.entry - z.high) / setup.entry < 0.02
  );
  if (nearDemand.length > 0) {
    bd.near_demand = 2;
    pts += 2;
    const strongest = nearDemand.reduce((a, b) => (a.strength > b.strength ? a : b));
    if (strongest.strength > 3) { bd.strong_zone = 1; pts += 1; }
    if (strongest.touches >= 2) { bd.tested_zone = 1; pts += 1; }
  }

  const nearSupply = zones.filter(
    (z) => z.type === "supply" && !z.broken && setup.takeProfit > 0 &&
      z.low < setup.takeProfit && z.low > setup.entry
  );
  if (nearSupply.length === 0) { bd.clear_path = 1; pts += 1; }

  return { name: "S&D Confluence", points: Math.min(pts, 5), maxPoints: 5, breakdown: bd };
}

function scoreTierVolume(ind: IndicatorResult, candles: Candle[]): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;

  if (ind.volume_ratio > 1.5) { bd.vol_surge = 2; pts += 2; }
  else if (ind.volume_ratio > 1.0) { bd.vol_above_avg = 1; pts += 1; }

  if (candles.length >= 3) {
    const last3 = candles.slice(-3);
    const volIncreasing = last3[0].volume < last3[1].volume && last3[1].volume < last3[2].volume;
    if (volIncreasing) { bd.vol_trend = 1; pts += 1; }
  }

  // Momentum: price above recent range midpoint
  if (candles.length >= 20) {
    const recent = candles.slice(-20);
    const mid = (Math.max(...recent.map((c) => c.high)) + Math.min(...recent.map((c) => c.low))) / 2;
    if (candles[candles.length - 1].close > mid) { bd.price_momentum = 1; pts += 1; }
  }

  // DI crossover
  if (ind.plus_di > ind.minus_di) { bd.di_bullish = 1; pts += 1; }

  return { name: "Volume & Momentum", points: Math.min(pts, 5), maxPoints: 5, breakdown: bd };
}

function scoreTierOnChain(
  tvl?: number,
  sentiment?: number,
  whaleFlowNet?: number
): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;

  // TVL growth signal (from DeFiLlama)
  if (tvl !== undefined) {
    if (tvl > 0) { bd.tvl_positive = 2; pts += 2; }
  }

  // Sentiment from Ace Data Cloud AI analysis
  if (sentiment !== undefined) {
    if (sentiment > 0.6) { bd.sentiment_bullish = 2; pts += 2; }
    else if (sentiment > 0.4) { bd.sentiment_neutral = 1; pts += 1; }
  }

  // Whale flow from on-chain monitoring
  if (whaleFlowNet !== undefined) {
    if (whaleFlowNet > 0) { bd.whale_inflow = 2; pts += 2; }
    else { bd.whale_outflow = 0; }
  }

  // Cap: no data = assume neutral 2pts
  if (tvl === undefined && sentiment === undefined && whaleFlowNet === undefined) {
    bd.no_data_default = 2;
    pts = 2;
  }

  return { name: "On-Chain & Sentiment", points: Math.min(pts, 7), maxPoints: 7, breakdown: bd };
}
