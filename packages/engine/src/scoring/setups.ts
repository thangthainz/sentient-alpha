import type { Candle, SetupDetection, SetupType, SignalDirection } from "@sentient-alpha/shared";
import { calcEma, calcAtr, calcSma } from "../indicators/ema.js";
import { calcRsi } from "../indicators/rsi.js";
import { calcAdx } from "../indicators/adx.js";

function noSetup(type: SetupType, reason: string, direction: SignalDirection = "LONG"): SetupDetection {
  return { type, direction, confidence: 0, entry: 0, stopLoss: 0, takeProfit: 0, reason };
}

// ============================================================================
// TREND PULLBACK
// LONG: Stage 2 uptrend (close > EMA200, EMA50 > EMA200) → pullback to EMA20
//   → trigger on break of prior high
// SHORT: Stage 4 downtrend (close < EMA200, EMA50 < EMA200) → rally to EMA20
//   → trigger on break of prior low
// ============================================================================

function detectTrendPullbackLong(candles1h: Candle[], candles4h?: Candle[]): SetupDetection {
  if (candles1h.length < 210) return noSetup("TREND_PULLBACK", "insufficient data", "LONG");

  const closes = candles1h.map((c) => c.close);
  const highs = candles1h.map((c) => c.high);
  const lows = candles1h.map((c) => c.low);
  const volumes = candles1h.map((c) => c.volume);

  const ema20 = calcEma(closes, 20);
  const ema50 = calcEma(closes, 50);
  const ema200 = calcEma(closes, 200);
  const { adx } = calcAdx(candles1h, 14);
  const atr = calcAtr(candles1h, 14);
  const volSma = calcSma(volumes, 20);

  const n = candles1h.length;
  const last = n - 1;

  if (!(closes[last] > ema200[last] && ema50[last] > ema200[last])) {
    return noSetup("TREND_PULLBACK", `not Stage 2 (px=${closes[last].toFixed(4)} ema200=${ema200[last].toFixed(4)})`, "LONG");
  }

  const adxVal = adx[last];
  if (adxVal < 25) return noSetup("TREND_PULLBACK", `ADX too low (${adxVal.toFixed(1)}<25)`, "LONG");

  let touched = false;
  for (let i = n - 3; i < n; i++) {
    if (lows[i] <= ema20[i] && ema20[i] <= highs[i]) { touched = true; break; }
  }
  if (!touched) return noSetup("TREND_PULLBACK", "no EMA20 pullback touch in last 3 bars", "LONG");

  if (closes[last] <= ema20[last]) return noSetup("TREND_PULLBACK", "close below EMA20", "LONG");

  const pullbackVols = volumes.slice(n - 3, n);
  const avgPbVol = pullbackVols.reduce((a, b) => a + b, 0) / pullbackVols.length;
  const currentVolSma = volSma[last] || 1;
  if (currentVolSma > 0 && avgPbVol > currentVolSma * 1.1) {
    return noSetup("TREND_PULLBACK", "pullback volume too high (not dry)", "LONG");
  }

  if (closes[last] <= highs[last - 1]) {
    return noSetup("TREND_PULLBACK", "trigger fail (close <= prior high)", "LONG");
  }

  if (candles4h && candles4h.length > 50) {
    const closes4h = candles4h.map((c) => c.close);
    const ema50_4h = calcEma(closes4h, 50);
    const last4h = candles4h.length - 1;
    if (closes4h[last4h] < ema50_4h[last4h]) {
      return noSetup("TREND_PULLBACK", "4h close < EMA50_4h (regime mismatch)", "LONG");
    }
  }

  const currentAtr = atr[last] || 0;
  const entry = closes[last];
  const pullbackLow = Math.min(...lows.slice(n - 3, n));
  const stop = pullbackLow - 0.25 * currentAtr;
  const risk = entry - stop;
  if (risk <= 0) return noSetup("TREND_PULLBACK", "invalid risk", "LONG");

  let confidence = 4.0;
  if (adxVal > 35) confidence += 0.5;

  return {
    type: "TREND_PULLBACK",
    direction: "LONG",
    confidence: Math.min(confidence, 5),
    entry,
    stopLoss: stop,
    takeProfit: entry + 2 * risk,
    reason: `PTJ+Raschke trend-pullback LONG (ADX=${adxVal.toFixed(0)}, dry vol, EMA20 reclaim)`,
  };
}

function detectTrendPullbackShort(candles1h: Candle[], candles4h?: Candle[]): SetupDetection {
  if (candles1h.length < 210) return noSetup("TREND_PULLBACK", "insufficient data", "SHORT");

  const closes = candles1h.map((c) => c.close);
  const highs = candles1h.map((c) => c.high);
  const lows = candles1h.map((c) => c.low);
  const volumes = candles1h.map((c) => c.volume);

  const ema20 = calcEma(closes, 20);
  const ema50 = calcEma(closes, 50);
  const ema200 = calcEma(closes, 200);
  const { adx } = calcAdx(candles1h, 14);
  const atr = calcAtr(candles1h, 14);
  const volSma = calcSma(volumes, 20);

  const n = candles1h.length;
  const last = n - 1;

  // Stage 4 downtrend
  if (!(closes[last] < ema200[last] && ema50[last] < ema200[last])) {
    return noSetup("TREND_PULLBACK", `not Stage 4 (px=${closes[last].toFixed(4)} ema200=${ema200[last].toFixed(4)})`, "SHORT");
  }

  const adxVal = adx[last];
  if (adxVal < 25) return noSetup("TREND_PULLBACK", `ADX too low (${adxVal.toFixed(1)}<25)`, "SHORT");

  // Rally up to EMA20 (touch from below)
  let touched = false;
  for (let i = n - 3; i < n; i++) {
    if (lows[i] <= ema20[i] && ema20[i] <= highs[i]) { touched = true; break; }
  }
  if (!touched) return noSetup("TREND_PULLBACK", "no EMA20 rally touch in last 3 bars", "SHORT");

  // Close must be back below EMA20 (rejection)
  if (closes[last] >= ema20[last]) return noSetup("TREND_PULLBACK", "close above EMA20", "SHORT");

  // Volume on the rally should be dry (low conviction bounce)
  const rallyVols = volumes.slice(n - 3, n);
  const avgRallyVol = rallyVols.reduce((a, b) => a + b, 0) / rallyVols.length;
  const currentVolSma = volSma[last] || 1;
  if (currentVolSma > 0 && avgRallyVol > currentVolSma * 1.1) {
    return noSetup("TREND_PULLBACK", "rally volume too high (not dry)", "SHORT");
  }

  // Trigger: close breaks below prior low
  if (closes[last] >= lows[last - 1]) {
    return noSetup("TREND_PULLBACK", "trigger fail (close >= prior low)", "SHORT");
  }

  // 4h regime confirmation: 4h close < EMA50_4h
  if (candles4h && candles4h.length > 50) {
    const closes4h = candles4h.map((c) => c.close);
    const ema50_4h = calcEma(closes4h, 50);
    const last4h = candles4h.length - 1;
    if (closes4h[last4h] > ema50_4h[last4h]) {
      return noSetup("TREND_PULLBACK", "4h close > EMA50_4h (regime mismatch)", "SHORT");
    }
  }

  const currentAtr = atr[last] || 0;
  const entry = closes[last];
  const pullbackHigh = Math.max(...highs.slice(n - 3, n));
  const stop = pullbackHigh + 0.25 * currentAtr; // stop ABOVE recent high
  const risk = stop - entry;
  if (risk <= 0) return noSetup("TREND_PULLBACK", "invalid risk", "SHORT");

  let confidence = 4.0;
  if (adxVal > 35) confidence += 0.5;

  return {
    type: "TREND_PULLBACK",
    direction: "SHORT",
    confidence: Math.min(confidence, 5),
    entry,
    stopLoss: stop,
    takeProfit: entry - 2 * risk, // TP BELOW entry
    reason: `PTJ+Raschke trend-pullback SHORT (ADX=${adxVal.toFixed(0)}, dry vol, EMA20 rejection)`,
  };
}

export function detectTrendPullback(candles1h: Candle[], candles4h?: Candle[]): SetupDetection {
  const long = detectTrendPullbackLong(candles1h, candles4h);
  if (long.confidence > 0) return long;
  return detectTrendPullbackShort(candles1h, candles4h);
}

// ============================================================================
// LIQUIDITY SWEEP
// LONG = Wyckoff Spring: sweep below range low, reclaim, confirmation up
// SHORT = Wyckoff Upthrust: sweep above range high, reject, confirmation down
// ============================================================================

function detectLiquiditySweepLong(candles1h: Candle[]): SetupDetection {
  if (candles1h.length < 50) return noSetup("LIQUIDITY_SWEEP", "insufficient data", "LONG");

  const n = candles1h.length;
  const atr = calcAtr(candles1h, 14);
  const currentAtr = atr[n - 1] || 0;
  if (currentAtr <= 0) return noSetup("LIQUIDITY_SWEEP", "ATR zero", "LONG");

  const rangeSlice = candles1h.slice(n - 33, n - 3);
  if (rangeSlice.length < 25) return noSetup("LIQUIDITY_SWEEP", "range window too small", "LONG");

  const rangeHigh = Math.max(...rangeSlice.map((c) => c.high));
  const rangeLow = Math.min(...rangeSlice.map((c) => c.low));
  const rangeSize = rangeHigh - rangeLow;

  if (rangeSize / currentAtr > 6) {
    return noSetup("LIQUIDITY_SWEEP", `range too wide (${(rangeSize / currentAtr).toFixed(1)}x ATR > 6)`, "LONG");
  }

  const sweepBar = candles1h[n - 2];
  if (!(sweepBar.low < rangeLow - 0.3 * currentAtr)) {
    return noSetup("LIQUIDITY_SWEEP", "no sweep below range", "LONG");
  }
  if (!(sweepBar.close > rangeLow)) {
    return noSetup("LIQUIDITY_SWEEP", "sweep bar closed below range (real breakdown)", "LONG");
  }

  const volWindow = candles1h.slice(n - 12, n - 2);
  const maxVol = Math.max(...volWindow.map((c) => c.volume));
  if (sweepBar.volume > maxVol * 1.1) {
    return noSetup("LIQUIDITY_SWEEP", "sweep was capitulation (high volume)", "LONG");
  }

  const lastBar = candles1h[n - 1];
  if (!(lastBar.close > sweepBar.high)) {
    return noSetup("LIQUIDITY_SWEEP", "no confirmation (last close <= sweep high)", "LONG");
  }

  const entry = lastBar.close;
  const stop = sweepBar.low - 0.25 * currentAtr;
  const risk = entry - stop;
  if (risk <= 0) return noSetup("LIQUIDITY_SWEEP", "invalid risk", "LONG");

  return {
    type: "LIQUIDITY_SWEEP",
    direction: "LONG",
    confidence: 4.5,
    entry,
    stopLoss: stop,
    takeProfit: Math.min(rangeHigh, entry + 3 * risk),
    reason: `Wyckoff Spring (swept ${rangeLow.toFixed(4)}, reclaimed, confirmation)`,
  };
}

function detectLiquiditySweepShort(candles1h: Candle[]): SetupDetection {
  if (candles1h.length < 50) return noSetup("LIQUIDITY_SWEEP", "insufficient data", "SHORT");

  const n = candles1h.length;
  const atr = calcAtr(candles1h, 14);
  const currentAtr = atr[n - 1] || 0;
  if (currentAtr <= 0) return noSetup("LIQUIDITY_SWEEP", "ATR zero", "SHORT");

  const rangeSlice = candles1h.slice(n - 33, n - 3);
  if (rangeSlice.length < 25) return noSetup("LIQUIDITY_SWEEP", "range window too small", "SHORT");

  const rangeHigh = Math.max(...rangeSlice.map((c) => c.high));
  const rangeLow = Math.min(...rangeSlice.map((c) => c.low));
  const rangeSize = rangeHigh - rangeLow;

  if (rangeSize / currentAtr > 6) {
    return noSetup("LIQUIDITY_SWEEP", `range too wide (${(rangeSize / currentAtr).toFixed(1)}x ATR > 6)`, "SHORT");
  }

  // Sweep ABOVE range high
  const sweepBar = candles1h[n - 2];
  if (!(sweepBar.high > rangeHigh + 0.3 * currentAtr)) {
    return noSetup("LIQUIDITY_SWEEP", "no sweep above range", "SHORT");
  }
  // Reject: sweep bar closed back inside range
  if (!(sweepBar.close < rangeHigh)) {
    return noSetup("LIQUIDITY_SWEEP", "sweep bar closed above range (real breakout)", "SHORT");
  }

  // Not capitulation buy
  const volWindow = candles1h.slice(n - 12, n - 2);
  const maxVol = Math.max(...volWindow.map((c) => c.volume));
  if (sweepBar.volume > maxVol * 1.1) {
    return noSetup("LIQUIDITY_SWEEP", "sweep was capitulation buy (high volume)", "SHORT");
  }

  // Confirmation: last close below sweep low
  const lastBar = candles1h[n - 1];
  if (!(lastBar.close < sweepBar.low)) {
    return noSetup("LIQUIDITY_SWEEP", "no confirmation (last close >= sweep low)", "SHORT");
  }

  const entry = lastBar.close;
  const stop = sweepBar.high + 0.25 * currentAtr; // stop ABOVE the upthrust
  const risk = stop - entry;
  if (risk <= 0) return noSetup("LIQUIDITY_SWEEP", "invalid risk", "SHORT");

  return {
    type: "LIQUIDITY_SWEEP",
    direction: "SHORT",
    confidence: 4.5,
    entry,
    stopLoss: stop,
    takeProfit: Math.max(rangeLow, entry - 3 * risk),
    reason: `Wyckoff Upthrust (swept ${rangeHigh.toFixed(4)}, rejected, confirmation)`,
  };
}

export function detectLiquiditySweep(candles1h: Candle[], _candles4h?: Candle[]): SetupDetection {
  const long = detectLiquiditySweepLong(candles1h);
  if (long.confidence > 0) return long;
  return detectLiquiditySweepShort(candles1h);
}

// ============================================================================
// VOL EXPANSION (VCP / Minervini)
// LONG: ATR contraction → break above pivot high (with volume), above EMA200
// SHORT: ATR contraction → break below pivot low (with volume), below EMA200
// ============================================================================

function detectVolExpansionLong(candles1h: Candle[]): SetupDetection {
  if (candles1h.length < 210) return noSetup("VOL_EXPANSION", "insufficient data", "LONG");

  const n = candles1h.length;
  const closes = candles1h.map((c) => c.close);
  const volumes = candles1h.map((c) => c.volume);

  const atr = calcAtr(candles1h, 14);
  const ema200 = calcEma(closes, 200);
  const volSma = calcSma(volumes, 20);

  const last = n - 1;
  const atrNow = atr[last] || 0;
  if (atrNow <= 0) return noSetup("VOL_EXPANSION", "ATR zero", "LONG");

  const atrThen = atr[n - 30] || 0;
  if (atrThen <= 1e-9 || atrNow / atrThen > 0.7) {
    return noSetup("VOL_EXPANSION", `no contraction (ATR ratio ${(atrNow / Math.max(atrThen, 1e-9)).toFixed(2)} > 0.7)`, "LONG");
  }

  const pivotHigh = Math.max(...candles1h.slice(n - 21, n - 1).map((c) => c.high));
  if (closes[last] <= pivotHigh) {
    return noSetup("VOL_EXPANSION", `no pivot break (close ${closes[last].toFixed(4)} <= pivot ${pivotHigh.toFixed(4)})`, "LONG");
  }

  const currentVolSma = volSma[last] || 1;
  if (currentVolSma > 0 && volumes[last] < 1.8 * currentVolSma) {
    return noSetup("VOL_EXPANSION", `vol expansion fail (${(volumes[last] / currentVolSma).toFixed(1)}x < 1.8x)`, "LONG");
  }

  const barRange = candles1h[last].high - candles1h[last].low;
  if (barRange < 1.5 * atrNow) {
    return noSetup("VOL_EXPANSION", `bar range ${(barRange / atrNow).toFixed(1)} ATR < 1.5`, "LONG");
  }

  if (closes[last] < ema200[last]) {
    return noSetup("VOL_EXPANSION", "below EMA200 (PTJ filter)", "LONG");
  }

  const entry = closes[last];
  const contractionLow = Math.min(...candles1h.slice(n - 6, n - 1).map((c) => c.low));
  const stop = contractionLow - 0.5 * atrNow;
  const risk = entry - stop;
  if (risk <= 0) return noSetup("VOL_EXPANSION", "invalid risk", "LONG");

  return {
    type: "VOL_EXPANSION",
    direction: "LONG",
    confidence: 4.0,
    entry,
    stopLoss: stop,
    takeProfit: entry + 3 * risk,
    reason: `VCP up-break: ATR contracted ${(atrNow / atrThen).toFixed(2)}x, vol ${(volumes[last] / Math.max(currentVolSma, 1)).toFixed(1)}x`,
  };
}

function detectVolExpansionShort(candles1h: Candle[]): SetupDetection {
  if (candles1h.length < 210) return noSetup("VOL_EXPANSION", "insufficient data", "SHORT");

  const n = candles1h.length;
  const closes = candles1h.map((c) => c.close);
  const volumes = candles1h.map((c) => c.volume);

  const atr = calcAtr(candles1h, 14);
  const ema200 = calcEma(closes, 200);
  const volSma = calcSma(volumes, 20);

  const last = n - 1;
  const atrNow = atr[last] || 0;
  if (atrNow <= 0) return noSetup("VOL_EXPANSION", "ATR zero", "SHORT");

  const atrThen = atr[n - 30] || 0;
  if (atrThen <= 1e-9 || atrNow / atrThen > 0.7) {
    return noSetup("VOL_EXPANSION", `no contraction (ATR ratio ${(atrNow / Math.max(atrThen, 1e-9)).toFixed(2)} > 0.7)`, "SHORT");
  }

  // Break BELOW pivot low
  const pivotLow = Math.min(...candles1h.slice(n - 21, n - 1).map((c) => c.low));
  if (closes[last] >= pivotLow) {
    return noSetup("VOL_EXPANSION", `no pivot break (close ${closes[last].toFixed(4)} >= pivot ${pivotLow.toFixed(4)})`, "SHORT");
  }

  const currentVolSma = volSma[last] || 1;
  if (currentVolSma > 0 && volumes[last] < 1.8 * currentVolSma) {
    return noSetup("VOL_EXPANSION", `vol expansion fail (${(volumes[last] / currentVolSma).toFixed(1)}x < 1.8x)`, "SHORT");
  }

  const barRange = candles1h[last].high - candles1h[last].low;
  if (barRange < 1.5 * atrNow) {
    return noSetup("VOL_EXPANSION", `bar range ${(barRange / atrNow).toFixed(1)} ATR < 1.5`, "SHORT");
  }

  // Below EMA200 confirms bearish regime
  if (closes[last] > ema200[last]) {
    return noSetup("VOL_EXPANSION", "above EMA200 (regime mismatch for short)", "SHORT");
  }

  const entry = closes[last];
  const contractionHigh = Math.max(...candles1h.slice(n - 6, n - 1).map((c) => c.high));
  const stop = contractionHigh + 0.5 * atrNow;
  const risk = stop - entry;
  if (risk <= 0) return noSetup("VOL_EXPANSION", "invalid risk", "SHORT");

  return {
    type: "VOL_EXPANSION",
    direction: "SHORT",
    confidence: 4.0,
    entry,
    stopLoss: stop,
    takeProfit: entry - 3 * risk,
    reason: `VCP down-break: ATR contracted ${(atrNow / atrThen).toFixed(2)}x, vol ${(volumes[last] / Math.max(currentVolSma, 1)).toFixed(1)}x`,
  };
}

export function detectVolExpansion(candles1h: Candle[], _candles4h?: Candle[]): SetupDetection {
  const long = detectVolExpansionLong(candles1h);
  if (long.confidence > 0) return long;
  return detectVolExpansionShort(candles1h);
}

// ============================================================================
// Best-of-all detector
// ============================================================================

export function detectBestSetup(
  candles1h: Candle[],
  candles4h?: Candle[]
): SetupDetection {
  const candidates = [
    detectTrendPullback(candles1h, candles4h),
    detectLiquiditySweep(candles1h, candles4h),
    detectVolExpansion(candles1h, candles4h),
  ];
  const valid = candidates.filter((s) => s.confidence > 0);
  if (valid.length === 0) return candidates[0];
  return valid.reduce((best, s) => (s.confidence > best.confidence ? s : best));
}
