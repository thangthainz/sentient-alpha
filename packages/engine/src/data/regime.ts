/**
 * Macro regime detector: BTC 4h EMA21/55 + ADX → BULL / BEAR / RANGE.
 * Ported from indicators.py RegimeManager (E:\Trading Bot reference).
 *
 * Data source: CoinGecko free `/coins/bitcoin/market_chart` (4h granularity
 * is interpolated from daily for the 90d window; we accept the approximation
 * for regime detection where exact bar precision isn't critical).
 */

import { calcEma } from "../indicators/ema.js";
import { calcAdx } from "../indicators/adx.js";
import type { Candle } from "@sentient-alpha/shared";

export interface MacroRegime {
  generatedAt: number;
  regime: "BULL" | "BEAR" | "RANGE";
  ema21: number;
  ema55: number;
  adx: number;
  diffPct: number; // (ema21-ema55)/ema55 × 100
  reason: string;
  btcPrice: number;
}

const cache: { value: MacroRegime | null; ts: number } = { value: null, ts: 0 };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch BTC OHLC from CoinGecko free API (no key required).
 * Returns daily candles for the past N days.
 */
async function fetchBtcOhlc(days = 365): Promise<Candle[]> {
  // CoinGecko OHLC endpoint: daily granularity, no API key
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko OHLC error ${res.status}`);
  const raw = await res.json() as Array<[number, number, number, number, number]>;
  // Format: [timestamp, open, high, low, close]
  return raw.map(([ts, o, h, l, c]) => ({
    timestamp: ts,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 0, // OHLC endpoint doesn't include volume — use 0 (ADX doesn't need volume)
  }));
}

/**
 * Detect macro regime from BTC daily candles (proxy for 4h regime; daily is more
 * stable + free public API doesn't expose 4h directly without rate-limit pain).
 */
export async function detectMacroRegime(): Promise<MacroRegime> {
  // Cache check
  if (cache.value && Date.now() - cache.ts < CACHE_TTL_MS) return cache.value;

  const candles = await fetchBtcOhlc(365);
  if (candles.length < 55) {
    const fallback: MacroRegime = {
      generatedAt: Date.now(),
      regime: "RANGE",
      ema21: 0,
      ema55: 0,
      adx: 0,
      diffPct: 0,
      reason: "Insufficient BTC data (<55 candles)",
      btcPrice: 0,
    };
    return fallback;
  }

  const closes = candles.map(c => c.close);
  const ema21 = calcEma(closes, 21);
  const ema55 = calcEma(closes, 55);
  const { adx } = calcAdx(candles, 14);

  const last = candles.length - 1;
  const e21 = ema21[last];
  const e55 = ema55[last];
  const a = adx[last];
  const diffPct = ((e21 - e55) / e55) * 100;

  let regime: "BULL" | "BEAR" | "RANGE";
  let reason: string;

  if (a < 20) {
    regime = "RANGE";
    reason = `ADX=${a.toFixed(1)} < 20 (no trend)`;
  } else if (diffPct > 0.3) {
    regime = "BULL";
    reason = `ADX=${a.toFixed(1)}, EMA21 ${diffPct.toFixed(2)}% > EMA55`;
  } else if (diffPct < -0.3) {
    regime = "BEAR";
    reason = `ADX=${a.toFixed(1)}, EMA21 ${diffPct.toFixed(2)}% < EMA55`;
  } else {
    regime = "RANGE";
    reason = `ADX=${a.toFixed(1)}, EMA gap ${diffPct.toFixed(2)}% < ±0.3% threshold`;
  }

  const value: MacroRegime = {
    generatedAt: Date.now(),
    regime,
    ema21: e21,
    ema55: e55,
    adx: a,
    diffPct,
    reason,
    btcPrice: closes[last],
  };

  cache.value = value;
  cache.ts = Date.now();
  return value;
}

/**
 * Decide whether a trade in `direction` is allowed under the current regime.
 * Implements the regime_allows() pattern from indicators.py.
 */
export function regimeAllows(
  regime: MacroRegime,
  direction: "LONG" | "SHORT",
  score: number,
  rsi: number
): { ok: boolean; reason: string } {
  const COUNTER_MIN_SCORE = 22; // raise threshold for counter-trend
  const RSI_EXTREME_LONG = 30; // long allowed counter-trend only if oversold
  const RSI_EXTREME_SHORT = 70; // short allowed counter-trend only if overbought

  if (regime.regime === "RANGE") {
    return { ok: true, reason: "RANGE — both directions allowed" };
  }

  const aligned =
    (regime.regime === "BULL" && direction === "LONG") ||
    (regime.regime === "BEAR" && direction === "SHORT");

  if (aligned) {
    return { ok: true, reason: `${regime.regime} aligned with ${direction}` };
  }

  // Counter-trend: require higher score + RSI extreme
  if (direction === "LONG" && rsi >= RSI_EXTREME_LONG) {
    return { ok: false, reason: `Counter-trend LONG in ${regime.regime} requires RSI<${RSI_EXTREME_LONG} (current ${rsi.toFixed(0)})` };
  }
  if (direction === "SHORT" && rsi <= RSI_EXTREME_SHORT) {
    return { ok: false, reason: `Counter-trend SHORT in ${regime.regime} requires RSI>${RSI_EXTREME_SHORT} (current ${rsi.toFixed(0)})` };
  }
  if (score < COUNTER_MIN_SCORE) {
    return { ok: false, reason: `Counter-trend ${direction} in ${regime.regime} requires score≥${COUNTER_MIN_SCORE} (current ${score})` };
  }

  return { ok: true, reason: `Counter-trend ${direction} OK (score=${score}, rsi=${rsi.toFixed(0)})` };
}
