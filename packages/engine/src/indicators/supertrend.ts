import type { Candle } from "@sentient-alpha/shared";
import { calcAtr } from "./ema.js";

export interface SupertrendResult {
  line: number[];
  direction: number[]; // +1 = uptrend, -1 = downtrend
}

export function calcSupertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3.0
): SupertrendResult {
  const n = candles.length;
  const line = new Array<number>(n).fill(NaN);
  const direction = new Array<number>(n).fill(0);

  if (n < period * 3) return { line, direction };

  const atr = calcAtr(candles, period);
  const upperBand = new Array<number>(n);
  const lowerBand = new Array<number>(n);
  const finalUpper = new Array<number>(n);
  const finalLower = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const a = isNaN(atr[i]) ? 0 : atr[i];
    upperBand[i] = hl2 + multiplier * a;
    lowerBand[i] = hl2 - multiplier * a;
  }

  let seed = -1;
  for (let i = 0; i < n; i++) {
    if (!isNaN(atr[i])) { seed = i; break; }
  }
  if (seed < 0 || seed >= n - 1) return { line, direction };

  finalUpper[seed] = upperBand[seed];
  finalLower[seed] = lowerBand[seed];

  if (candles[seed].close > finalUpper[seed]) {
    direction[seed] = 1;
    line[seed] = finalLower[seed];
  } else {
    direction[seed] = -1;
    line[seed] = finalUpper[seed];
  }

  for (let i = seed + 1; i < n; i++) {
    finalUpper[i] =
      upperBand[i] < finalUpper[i - 1] ||
      candles[i - 1].close > finalUpper[i - 1]
        ? upperBand[i]
        : finalUpper[i - 1];

    finalLower[i] =
      lowerBand[i] > finalLower[i - 1] ||
      candles[i - 1].close < finalLower[i - 1]
        ? lowerBand[i]
        : finalLower[i - 1];

    if (candles[i].close > finalUpper[i - 1]) {
      direction[i] = 1;
    } else if (candles[i].close < finalLower[i - 1]) {
      direction[i] = -1;
    } else {
      direction[i] = direction[i - 1];
    }

    line[i] = direction[i] === 1 ? finalLower[i] : finalUpper[i];
  }

  return { line, direction };
}
