// One-time script to backfill stock_prices table with current prices
// Run with: npx tsx backfill-stock-prices.ts

import 'dotenv/config';
import { getAllHeldTickers } from './stock/stockDb.js';
import { getQuote } from './stock/stockApi.js';

async function backfillPrices(): Promise<void> {
  console.log('Starting stock price backfill...\n');

  const tickers = await getAllHeldTickers();
  console.log(`Found ${tickers.length} unique tickers to backfill\n`);

  if (tickers.length === 0) {
    console.log('No tickers found in stock_holdings. Nothing to backfill.');
    process.exit(0);
  }

  let success = 0;
  let failed = 0;

  for (const ticker of tickers) {
    const result = await getQuote(ticker);
    if (result.success) {
      console.log(`  [OK] ${ticker}: $${result.data.currentPrice}`);
      success++;
    } else {
      console.log(`[FAIL] ${ticker}: ${result.error}`);
      failed++;
    }
    // Rate limit: 1 second between calls (Finnhub free tier = 60/min)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\nBackfill complete! ${success} succeeded, ${failed} failed`);
  // Grace period for final cache operation to complete (fire-and-forget from getQuote)
  await new Promise(resolve => setTimeout(resolve, 500));
  process.exit(0);
}

backfillPrices().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
