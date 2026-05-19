import type { Candle } from "@sentient-alpha/shared";
import { calcTrueRange, calcRollingMax, calcRollingMin } from "./ema.js";

export function calcChoppiness(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const result = new Array<number>(n).fill(50);
  if (n < period + 1) return result;

  const tr = calcTrueRange(candles);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const rollingHigh = calcRollingMax(highs, period);
  const rollingLow = calcRollingMin(lows, period);

  const log10Period = Math.log10(period);

  for (let i = period - 1; i < n; i++) {
    let sumTr = 0;
    for (let j = i - period + 1; j <= i; j++) sumTr += tr[j];

    const range = rollingHigh[i] - rollingLow[i];
    if (range <= 0) { result[i] = 50; continue; }

    const ratio = Math.max(sumTr / range, 1e-9);
    result[i] = Math.min(100, Math.max(0, (100 * Math.log10(ratio)) / log10Period));
  }

  return result;
}
