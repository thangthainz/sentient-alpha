import "dotenv/config";
import { fetchOhlcvOnchain } from "./data/onchain-ohlcv.js";

async function main() {
  const pool = process.argv[2] ?? "0xdc16fF7d202bAe83B35fD7cDbBA28bE6B8B13F24";
  const days = parseInt(process.argv[3] ?? "30", 10);
  const tf = (process.argv[4] ?? "1h") as any;

  const start = Date.now();
  const candles = await fetchOhlcvOnchain(pool, tf, days);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n=== Result ===`);
  console.log(`Candles: ${candles.length}`);
  console.log(`Elapsed: ${elapsed}s`);
  if (candles.length > 0) {
    console.log(`First: ${new Date(candles[0].timestamp).toISOString()} | O=${candles[0].open.toFixed(6)} C=${candles[0].close.toFixed(6)} V=${candles[0].volume.toFixed(2)}`);
    console.log(`Last:  ${new Date(candles[candles.length - 1].timestamp).toISOString()} | O=${candles[candles.length - 1].open.toFixed(6)} C=${candles[candles.length - 1].close.toFixed(6)} V=${candles[candles.length - 1].volume.toFixed(2)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
