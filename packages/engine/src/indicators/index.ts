import type { Candle, IndicatorResult } from "@sentient-alpha/shared";
import { calcEma, calcAtr, calcSma } from "./ema.js";
import { calcRsi } from "./rsi.js";
import { calcAdx } from "./adx.js";
import { calcSupertrend } from "./supertrend.js";
import { calcChoppiness } from "./choppiness.js";

export { calcEma, calcSma, calcAtr, calcTrueRange, calcRollingMean, calcRollingMax, calcRollingMin } from "./ema.js";
export { calcRsi } from "./rsi.js";
export { calcAdx } from "./adx.js";
export type { AdxResult } from "./adx.js";
export { calcSupertrend } from "./supertrend.js";
export type { SupertrendResult } from "./supertrend.js";
export { calcChoppiness } from "./choppiness.js";
export { detectZones, findNearestZone } from "./zones.js";

export function computeIndicators(candles: Candle[]): IndicatorResult {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;
  const last = n - 1;

  const emaFast = calcEma(closes, 20);
  const emaSlow = calcEma(closes, 50);
  const rsi = calcRsi(closes, 14);
  const atr = calcAtr(candles, 14);
  const { adx, plusDi, minusDi } = calcAdx(candles, 14);
  const { line: stLine, direction: stDir } = calcSupertrend(candles, 10, 3);
  const chop = calcChoppiness(candles, 14);
  const volSma = calcSma(volumes, 20);

  const currentVolSma = volSma[last] || 1;

  return {
    ema_fast: emaFast[last],
    ema_slow: emaSlow[last],
    rsi: rsi[last],
    atr: atr[last] || 0,
    adx: adx[last],
    plus_di: plusDi[last],
    minus_di: minusDi[last],
    supertrend: stLine[last] || 0,
    supertrend_direction: stDir[last] === 1 ? "up" : "down",
    choppiness: chop[last],
    volume_sma: currentVolSma,
    volume_ratio: volumes[last] / currentVolSma,
  };
}
