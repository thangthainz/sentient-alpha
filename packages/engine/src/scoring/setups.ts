import type { Candle, SetupDetection, SetupType, SignalDirection } from "@sentient-alpha/shared";
import { calcEma, calcAtr, calcSma } from "../indicators/ema.js";
import { calcRsi } from "../indicators/rsi.js";
import { calcAdx } from "../indicators/adx.js";
import { calcChoppiness } from "../indicators/choppiness.js";

function noSetup(type: SetupType, reason: string): SetupDetection {
  return { type, direction: "LONG", confidence: 0, entry: 0, stopLoss: 0, takeProfit: 0, reason };
}

export function detectTrendPullback(
  candles1h: Candle[],
  candles4h?: Candle[]
): SetupDetection {
  if (candles1h.length < 210) return noSetup("TREND_PULLBACK", "insufficient data");

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
    return noSetup("TREND_PULLBACK", `not Stage 2 (px=${closes[last].toFixed(4)} ema200=${ema200[last].toFixed(4)})`);
  }

  const adxVal = adx[last];
  if (adxVal < 25) return noSetup("TREND_PULLBACK", `ADX too low (${adxVal.toFixed(1)}<25)`);

  let touched = false;
  for (let i = n - 3; i < n; i++) {
    if (lows[i] <= ema20[i] && ema20[i] <= highs[i]) { touched = true; break; }
  }
  if (!touched) return noSetup("TREND_PULLBACK", "no EMA20 pullback touch in last 3 bars");

  if (closes[last] <= ema20[last]) return noSetup("TREND_PULLBACK", "close below EMA20");

  const pullbackVols = volumes.slice(n - 3, n);
  const avgPbVol = pullbackVols.reduce((a, b) => a + b, 0) / pullbackVols.length;
  const currentVolSma = volSma[last] || 1;
  if (currentVolSma > 0 && avgPbVol > currentVolSma * 1.1) {
    return noSetup("TREND_PULLBACK", "pullback volume too high (not dry)");
  }

  if (closes[last] <= highs[last - 1]) {
    return noSetup("TREND_PULLBACK", "trigger fail (close <= prior high)");
  }

  if (candles4h && candles4h.length > 50) {
    const closes4h = candles4h.map((c) => c.close);
    const ema50_4h = calcEma(closes4h, 50);
    const last4h = candles4h.length - 1;
    if (closes4h[last4h] < ema50_4h[last4h]) {
      return noSetup("TREND_PULLBACK", "4h close < EMA50_4h (regime mismatch)");
    }
  }

  const currentAtr = atr[last] || 0;
  const entry = closes[last];
  const pullbackLow = Math.min(...lows.slice(n - 3, n));
  const stop = pullbackLow - 0.25 * currentAtr;
  const risk = entry - stop;
  if (risk <= 0) return noSetup("TREND_PULLBACK", "invalid risk");

  let confidence = 4.0;
  if (adxVal > 35) confidence += 0.5;

  return {
    type: "TREND_PULLBACK",
    direction: "LONG",
    confidence: Math.min(confidence, 5),
    entry,
    stopLoss: stop,
    takeProfit: entry + 2 * risk,
    reason: `PTJ+Raschke trend-pullback (ADX=${adxVal.toFixed(0)}, dry vol, EMA20 reclaim)`,
  };
}

export function detectLiquiditySweep(
  candles1h: Candle[],
  _candles4h?: Candle[]
): SetupDetection {
  if (candles1h.length < 50) return noSetup("LIQUIDITY_SWEEP", "insufficient data");

  const n = candles1h.length;
  const atr = calcAtr(candles1h, 14);
  const currentAtr = atr[n - 1] || 0;
  if (currentAtr <= 0) return noSetup("LIQUIDITY_SWEEP", "ATR zero");

  const rangeSlice = candles1h.slice(n - 33, n - 3);
  if (rangeSlice.length < 25) return noSetup("LIQUIDITY_SWEEP", "range window too small");

  const rangeHigh = Math.max(...rangeSlice.map((c) => c.high));
  const rangeLow = Math.min(...rangeSlice.map((c) => c.low));
  const rangeSize = rangeHigh - rangeLow;

  if (rangeSize / currentAtr > 6) {
    return noSetup("LIQUIDITY_SWEEP", `range too wide (${(rangeSize / currentAtr).toFixed(1)}x ATR > 6)`);
  }

  const sweepBar = candles1h[n - 2];
  if (!(sweepBar.low < rangeLow - 0.3 * currentAtr)) {
    return noSetup("LIQUIDITY_SWEEP", "no sweep below range");
  }
  if (!(sweepBar.close > rangeLow)) {
    return noSetup("LIQUIDITY_SWEEP", "sweep bar closed below range (real breakdown)");
  }

  const volWindow = candles1h.slice(n - 12, n - 2);
  const maxVol = Math.max(...volWindow.map((c) => c.volume));
  if (sweepBar.volume > maxVol * 1.1) {
    return noSetup("LIQUIDITY_SWEEP", "sweep was capitulation (high volume)");
  }

  const lastBar = candles1h[n - 1];
  if (!(lastBar.close > sweepBar.high)) {
    return noSetup("LIQUIDITY_SWEEP", "no confirmation (last close <= sweep high)");
  }

  const entry = lastBar.close;
  const stop = sweepBar.low - 0.25 * currentAtr;
  const risk = entry - stop;
  if (risk <= 0) return noSetup("LIQUIDITY_SWEEP", "invalid risk");

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

export function detectVolExpansion(
  candles1h: Candle[],
  _candles4h?: Candle[]
): SetupDetection {
  if (candles1h.length < 210) return noSetup("VOL_EXPANSION", "insufficient data");

  const n = candles1h.length;
  const closes = candles1h.map((c) => c.close);
  const volumes = candles1h.map((c) => c.volume);

  const atr = calcAtr(candles1h, 14);
  const ema200 = calcEma(closes, 200);
  const volSma = calcSma(volumes, 20);

  const last = n - 1;
  const atrNow = atr[last] || 0;
  if (atrNow <= 0) return noSetup("VOL_EXPANSION", "ATR zero");

  const atrThen = atr[n - 30] || 0;
  if (atrThen <= 1e-9 || atrNow / atrThen > 0.7) {
    return noSetup("VOL_EXPANSION", `no contraction (ATR ratio ${(atrNow / Math.max(atrThen, 1e-9)).toFixed(2)} > 0.7)`);
  }

  const pivotHigh = Math.max(...candles1h.slice(n - 21, n - 1).map((c) => c.high));
  if (closes[last] <= pivotHigh) {
    return noSetup("VOL_EXPANSION", `no pivot break (close ${closes[last].toFixed(4)} <= pivot ${pivotHigh.toFixed(4)})`);
  }

  const currentVolSma = volSma[last] || 1;
  if (currentVolSma > 0 && volumes[last] < 1.8 * currentVolSma) {
    return noSetup("VOL_EXPANSION", `vol expansion fail (${(volumes[last] / currentVolSma).toFixed(1)}x < 1.8x)`);
  }

  const barRange = candles1h[last].high - candles1h[last].low;
  if (barRange < 1.5 * atrNow) {
    return noSetup("VOL_EXPANSION", `bar range ${(barRange / atrNow).toFixed(1)} ATR < 1.5`);
  }

  if (closes[last] < ema200[last]) {
    return noSetup("VOL_EXPANSION", "below EMA200 (PTJ filter)");
  }

  const entry = closes[last];
  const contractionLow = Math.min(...candles1h.slice(n - 6, n - 1).map((c) => c.low));
  const stop = contractionLow - 0.5 * atrNow;
  const risk = entry - stop;
  if (risk <= 0) return noSetup("VOL_EXPANSION", "invalid risk");

  return {
    type: "VOL_EXPANSION",
    direction: "LONG",
    confidence: 4.0,
    entry,
    stopLoss: stop,
    takeProfit: entry + 3 * risk,
    reason: `VCP break: ATR contracted ${(atrNow / atrThen).toFixed(2)}x, vol ${(volumes[last] / Math.max(currentVolSma, 1)).toFixed(1)}x`,
  };
}

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
