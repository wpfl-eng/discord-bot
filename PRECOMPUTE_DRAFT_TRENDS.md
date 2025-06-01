# Draft Trends Precomputation

The `drafttrends` command now uses precomputed data stored in PostgreSQL for much faster response times.

## How to use

1. **First time setup** - Run the precomputation script to populate the database:
   ```bash
   node precompute-draft-trends.js
   ```
   This will fetch all draft data (2010-2024) and player scores (2015-2024) and compute statistics for each owner.

2. **Custom date ranges** - You can specify custom season ranges:
   ```bash
   node precompute-draft-trends.js 2020 2024
   ```

3. **Use the Discord command** - Once data is precomputed:
   ```
   /drafttrends user:AJ Boorde
   /drafttrends user:AJ Boorde seasonmin:2020 seasonmax:2024
   ```

## What it does

The precomputation script:
- Creates necessary database tables if they don't exist
- Fetches all draft history data from the API
- Fetches player performance scores (2015+ only)
- Computes statistics for each owner including:
  - Draft tendencies (favorite teams, positions, repeat players)
  - Auction metrics (ROI, hit rate, bust rate)
  - Position preferences by round
  - And more...
- Stores everything in PostgreSQL for instant retrieval

## Performance

- **Before**: Command would timeout due to fetching years of player scores
- **After**: Command responds in < 1 second using cached data

## When to rerun

Run the precomputation script:
- After each draft to include new data
- Weekly during the season to update performance metrics
- When you need a specific date range not yet computed

## Database tables

- `draft_picks` - All historical draft picks
- `player_scores` - Aggregated player performance by season
- `owner_draft_stats` - Precomputed statistics per owner
- `draft_computation_status` - Tracks computation runs

## Notes

- Performance data (ROI, bargains, etc.) only available for 2015+
- The Discord command will suggest similar names if exact match not found
- Data older than 24 hours will show a warning suggesting to rerun