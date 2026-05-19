import type { Candle } from "@sentient-alpha/shared";

export function calcEma(values: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const result = new Array<number>(values.length);
  result[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function calcSma(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

export function calcTrueRange(candles: Candle[]): number[] {
  const tr = new Array<number>(candles.length);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }
  return tr;
}

export function calcAtr(candles: Candle[], period = 14): number[] {
  const tr = calcTrueRange(candles);
  return calcRollingMean(tr, period);
}

export function calcRollingMean(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

export function calcRollingMax(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] > max) max = values[j];
    }
    result[i] = max;
  }
  return result;
}

export function calcRollingMin(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] < min) min = values[j];
    }
    result[i] = min;
  }
  return result;
}
