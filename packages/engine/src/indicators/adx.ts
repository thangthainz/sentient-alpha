import type { Candle } from "@sentient-alpha/shared";

export interface AdxResult {
  adx: number[];
  plusDi: number[];
  minusDi: number[];
}

export function calcAdx(candles: Candle[], period = 14): AdxResult {
  const n = candles.length;
  const adx = new Array<number>(n).fill(0);
  const plusDi = new Array<number>(n).fill(0);
  const minusDi = new Array<number>(n).fill(0);

  if (n < period * 2) return { adx, plusDi, minusDi };

  const tr = new Array<number>(n).fill(0);
  const plusDm = new Array<number>(n).fill(0);
  const minusDm = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);

    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  let smoothTr = 0;
  let smoothPlusDm = 0;
  let smoothMinusDm = 0;

  for (let i = 1; i <= period; i++) {
    smoothTr += tr[i];
    smoothPlusDm += plusDm[i];
    smoothMinusDm += minusDm[i];
  }

  const dx = new Array<number>(n).fill(0);

  for (let i = period; i < n; i++) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + tr[i];
      smoothPlusDm = smoothPlusDm - smoothPlusDm / period + plusDm[i];
      smoothMinusDm = smoothMinusDm - smoothMinusDm / period + minusDm[i];
    }

    const pdi = smoothTr > 0 ? (100 * smoothPlusDm) / smoothTr : 0;
    const mdi = smoothTr > 0 ? (100 * smoothMinusDm) / smoothTr : 0;
    plusDi[i] = pdi;
    minusDi[i] = mdi;

    const diSum = pdi + mdi;
    dx[i] = diSum > 0 ? (100 * Math.abs(pdi - mdi)) / diSum : 0;
  }

  let adxSum = 0;
  for (let i = period; i < period * 2 && i < n; i++) {
    adxSum += dx[i];
  }
  if (period * 2 <= n) {
    adx[period * 2 - 1] = adxSum / period;
  }
  for (let i = period * 2; i < n; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }

  return { adx, plusDi, minusDi };
}
