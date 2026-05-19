import type {
  Candle,
  IndicatorResult,
  SetupDetection,
  SignalScore,
  ScoringTier,
  SupplyDemandZone,
  SignalDirection,
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
  const dir = input.setup.direction;

  // Tier 1: Technical Indicators (max 8 pts)
  const t1 = scoreTierTechnical(input.indicators, input.candles, dir);
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
  const t4 = scoreTierVolume(input.indicators, input.candles, dir);
  tiers.push(t4);
  total += t4.points;

  // Tier S: On-Chain & Sentiment (max 7 pts)
  const t5 = scoreTierOnChain(dir, input.tvl, input.sentiment, input.whaleFlowNet);
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

function scoreTierTechnical(ind: IndicatorResult, candles: Candle[], dir: SignalDirection): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;
  const isLong = dir === "LONG";

  // Trend alignment in direction of trade
  const trendAligned = isLong ? ind.ema_fast > ind.ema_slow : ind.ema_fast < ind.ema_slow;
  if (trendAligned) { bd.trend_align = 2; pts += 2; }
  else { bd.trend_align = 0; }

  // ADX strength (same for both)
  if (ind.adx > 25) { bd.adx_strong = ind.adx > 35 ? 2 : 1; pts += bd.adx_strong; }

  // RSI zone: LONG 40-70, SHORT 30-60
  const rsiInZone = isLong
    ? (ind.rsi >= 40 && ind.rsi <= 70)
    : (ind.rsi >= 30 && ind.rsi <= 60);
  if (rsiInZone) { bd.rsi_zone = 1; pts += 1; }

  // Supertrend confirmation in trade direction
  const supertrendAligned = isLong
    ? ind.supertrend_direction === "up"
    : ind.supertrend_direction === "down";
  if (supertrendAligned) { bd.supertrend = 2; pts += 2; }

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

  // Base score from confidence
  bd.confidence = Math.round(setup.confidence);
  pts += bd.confidence;

  // Risk/reward (absolute value handles both directions)
  const rr = setup.takeProfit && setup.stopLoss && setup.entry
    ? Math.abs(setup.takeProfit - setup.entry) / Math.abs(setup.entry - setup.stopLoss)
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

  const isLong = setup.direction === "LONG";

  if (isLong) {
    // LONG: prefer demand near entry (support), supply above is obstacle to TP
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
  } else {
    // SHORT: prefer supply near entry (resistance), demand below is obstacle to TP
    const nearSupply = zones.filter(
      (z) => z.type === "supply" && !z.broken && Math.abs(z.low - setup.entry) / setup.entry < 0.02
    );
    if (nearSupply.length > 0) {
      bd.near_supply = 2;
      pts += 2;
      const strongest = nearSupply.reduce((a, b) => (a.strength > b.strength ? a : b));
      if (strongest.strength > 3) { bd.strong_zone = 1; pts += 1; }
      if (strongest.touches >= 2) { bd.tested_zone = 1; pts += 1; }
    }

    const nearDemand = zones.filter(
      (z) => z.type === "demand" && !z.broken && setup.takeProfit > 0 &&
        z.high > setup.takeProfit && z.high < setup.entry
    );
    if (nearDemand.length === 0) { bd.clear_path = 1; pts += 1; }
  }

  return { name: "S&D Confluence", points: Math.min(pts, 5), maxPoints: 5, breakdown: bd };
}

function scoreTierVolume(ind: IndicatorResult, candles: Candle[], dir: SignalDirection): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;
  const isLong = dir === "LONG";

  // Volume surge (same for both — high volume confirms either move)
  if (ind.volume_ratio > 1.5) { bd.vol_surge = 2; pts += 2; }
  else if (ind.volume_ratio > 1.0) { bd.vol_above_avg = 1; pts += 1; }

  // Volume increasing into the move (same for both)
  if (candles.length >= 3) {
    const last3 = candles.slice(-3);
    const volIncreasing = last3[0].volume < last3[1].volume && last3[1].volume < last3[2].volume;
    if (volIncreasing) { bd.vol_trend = 1; pts += 1; }
  }

  // Price momentum in trade direction
  if (candles.length >= 20) {
    const recent = candles.slice(-20);
    const mid = (Math.max(...recent.map((c) => c.high)) + Math.min(...recent.map((c) => c.low))) / 2;
    const lastClose = candles[candles.length - 1].close;
    const momentumAligned = isLong ? lastClose > mid : lastClose < mid;
    if (momentumAligned) { bd.price_momentum = 1; pts += 1; }
  }

  // DI direction alignment
  const diAligned = isLong ? ind.plus_di > ind.minus_di : ind.minus_di > ind.plus_di;
  if (diAligned) { bd.di_aligned = 1; pts += 1; }

  return { name: "Volume & Momentum", points: Math.min(pts, 5), maxPoints: 5, breakdown: bd };
}

function scoreTierOnChain(
  dir: SignalDirection,
  tvl?: number,
  sentiment?: number,
  whaleFlowNet?: number
): ScoringTier {
  const bd: Record<string, number> = {};
  let pts = 0;
  const isLong = dir === "LONG";

  // TVL: growth confirms long, decline confirms short
  if (tvl !== undefined) {
    const tvlAligned = isLong ? tvl > 0 : tvl < 0;
    if (tvlAligned) { bd.tvl_aligned = 2; pts += 2; }
  }

  // Sentiment: LONG benefits from bullish (>0.6), SHORT from bearish (<0.4)
  if (sentiment !== undefined) {
    if (isLong) {
      if (sentiment > 0.6) { bd.sentiment_bullish = 2; pts += 2; }
      else if (sentiment > 0.4) { bd.sentiment_neutral = 1; pts += 1; }
    } else {
      if (sentiment < 0.4) { bd.sentiment_bearish = 2; pts += 2; }
      else if (sentiment < 0.6) { bd.sentiment_neutral = 1; pts += 1; }
    }
  }

  // Whale flow: long from inflow, short from outflow
  if (whaleFlowNet !== undefined) {
    const whaleAligned = isLong ? whaleFlowNet > 0 : whaleFlowNet < 0;
    if (whaleAligned) { bd.whale_aligned = 2; pts += 2; }
  }

  // No-data default: neutral 2pts
  if (tvl === undefined && sentiment === undefined && whaleFlowNet === undefined) {
    bd.no_data_default = 2;
    pts = 2;
  }

  return { name: "On-Chain & Sentiment", points: Math.min(pts, 7), maxPoints: 7, breakdown: bd };
}
