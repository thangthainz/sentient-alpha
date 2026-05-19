import type { Candle, SupplyDemandZone } from "@sentient-alpha/shared";
import { calcAtr } from "./ema.js";

export function detectZones(
  candles: Candle[],
  window = 20,
  impulseMult = 1.5
): SupplyDemandZone[] {
  const n = candles.length;
  if (n < window * 2) return [];

  const atr = calcAtr(candles, 14);
  const zones: SupplyDemandZone[] = [];

  for (let i = window; i < n - window; i++) {
    const avgAtr = atr[i] || 0;
    if (avgAtr <= 0) continue;

    let isLocalMin = true;
    let isLocalMax = true;

    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].low < candles[i].low) isLocalMin = false;
      if (candles[j].high > candles[i].high) isLocalMax = false;
      if (!isLocalMin && !isLocalMax) break;
    }

    if (isLocalMin) {
      const impulseUp =
        i + 3 < n
          ? candles[i + 3].close - candles[i].low
          : candles[n - 1].close - candles[i].low;
      if (impulseUp > impulseMult * avgAtr) {
        zones.push({
          type: "demand",
          low: candles[i].low,
          high: candles[i].high,
          strength: impulseUp / avgAtr,
          touches: 0,
          timestamp: candles[i].timestamp,
          broken: false,
        });
      }
    }

    if (isLocalMax) {
      const impulseDown =
        i + 3 < n
          ? candles[i].high - candles[i + 3].close
          : candles[i].high - candles[n - 1].close;
      if (impulseDown > impulseMult * avgAtr) {
        zones.push({
          type: "supply",
          low: candles[i].low,
          high: candles[i].high,
          strength: impulseDown / avgAtr,
          touches: 0,
          timestamp: candles[i].timestamp,
          broken: false,
        });
      }
    }
  }

  updateZoneTouches(zones, candles);
  return zones;
}

function updateZoneTouches(
  zones: SupplyDemandZone[],
  candles: Candle[]
): void {
  for (const zone of zones) {
    for (const c of candles) {
      if (c.timestamp <= zone.timestamp) continue;
      if (zone.type === "demand") {
        if (c.low <= zone.high && c.low >= zone.low) zone.touches++;
        if (c.close < zone.low) { zone.broken = true; break; }
      } else {
        if (c.high >= zone.low && c.high <= zone.high) zone.touches++;
        if (c.close > zone.high) { zone.broken = true; break; }
      }
    }
  }
}

export function findNearestZone(
  price: number,
  zones: SupplyDemandZone[],
  type: "supply" | "demand"
): SupplyDemandZone | null {
  const active = zones.filter((z) => z.type === type && !z.broken);
  if (active.length === 0) return null;

  return active.reduce((best, z) => {
    const dist = type === "demand"
      ? price - z.high
      : z.low - price;
    const bestDist = type === "demand"
      ? price - best.high
      : best.low - price;
    return dist >= 0 && dist < bestDist ? z : best;
  });
}
