// Polymarket API Client
// Wrapper for Polymarket Gamma API with caching

import { API_CONFIG, CONFIG, FEATURED_CATEGORIES, categoryTagIds } from './polymarketConfig.js';
import type {
  PolymarketTag,
  PolymarketMarket,
  MarketDisplay,
  OutcomeDisplay,
  MarketResolution,
} from './polymarketTypes.js';

// ============ Tag Cache ============

let tagsCache: PolymarketTag[] = [];
let tagsCacheTime = 0;

// ============ Rate Limiting ============

let lastRequestTime = 0;

async function throttledFetch(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < API_CONFIG.REQUEST_DELAY_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, API_CONFIG.REQUEST_DELAY_MS - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_CONFIG.REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// ============ Tag Operations ============

/**
 * Fetch all tags from API
 */
async function fetchTagsFromAPI(): Promise<PolymarketTag[]> {
  try {
    const response = await throttledFetch(`${API_CONFIG.BASE_URL}/tags`);
    if (!response.ok) {
      console.error(`Failed to fetch tags: ${response.status}`);
      return [];
    }
    const data = (await response.json()) as PolymarketTag[];
    return data;
  } catch (error) {
    console.error('Error fetching tags:', error);
    return [];
  }
}

/**
 * Get tags with caching
 */
export async function getTags(): Promise<PolymarketTag[]> {
  const now = Date.now();
  if (now - tagsCacheTime < API_CONFIG.TAGS_CACHE_TTL_MS && tagsCache.length > 0) {
    return tagsCache;
  }

  tagsCache = await fetchTagsFromAPI();
  tagsCacheTime = now;

  // Update category tag ID mappings
  for (const category of FEATURED_CATEGORIES) {
    const tag = tagsCache.find(
      (t) => t.slug.toLowerCase() === category.slug.toLowerCase() ||
             t.label.toLowerCase() === category.slug.toLowerCase()
    );
    if (tag) {
      categoryTagIds.set(category.slug, tag.id);
    }
  }

  return tagsCache;
}

/**
 * Get tag ID for a category slug
 */
export async function getTagIdForCategory(categorySlug: string): Promise<number | null> {
  // Ensure cache is populated
  await getTags();

  // Check our featured category mappings first
  const cachedId = categoryTagIds.get(categorySlug);
  if (cachedId !== undefined) {
    return cachedId;
  }

  // Search in full tag list
  const tag = tagsCache.find(
    (t) => t.slug.toLowerCase() === categorySlug.toLowerCase() ||
           t.label.toLowerCase() === categorySlug.toLowerCase()
  );

  return tag?.id ?? null;
}

// ============ Market Operations ============

/**
 * Transform API market to display format
 */
function transformMarket(market: PolymarketMarket): MarketDisplay {
  const outcomes: OutcomeDisplay[] = market.outcomes.map((name, index) => {
    const price = parseFloat(market.outcomePrices[index] || '0');
    return {
      index,
      name,
      price,
      clobTokenId: market.clobTokenIds[index] || '',
      payoutMultiplier: price > 0 ? 1 / price : 0,
    };
  });

  return {
    id: market.id,
    slug: market.slug,
    question: market.question,
    outcomes,
    endDate: new Date(market.endDate),
    closed: market.closed,
    volume: parseFloat(market.volume || '0'),
  };
}

/**
 * Get markets by tag/category
 */
export async function getMarketsByTag(
  tagId: number,
  limit: number = API_CONFIG.DEFAULT_MARKET_LIMIT
): Promise<MarketDisplay[]> {
  try {
    const url = `${API_CONFIG.BASE_URL}/markets?tag_id=${tagId}&closed=false&limit=${limit}&order=volume&ascending=false`;
    const response = await throttledFetch(url);

    if (!response.ok) {
      console.error(`Failed to fetch markets: ${response.status}`);
      return [];
    }

    const markets = (await response.json()) as PolymarketMarket[];
    return markets.map(transformMarket);
  } catch (error) {
    console.error('Error fetching markets by tag:', error);
    return [];
  }
}

/**
 * Get markets by category slug
 */
export async function getMarketsByCategory(
  categorySlug: string,
  limit: number = API_CONFIG.DEFAULT_MARKET_LIMIT
): Promise<MarketDisplay[]> {
  const tagId = await getTagIdForCategory(categorySlug);
  if (tagId === null) {
    console.error(`No tag found for category: ${categorySlug}`);
    return [];
  }
  return getMarketsByTag(tagId, limit);
}

/**
 * Get single market by slug
 */
export async function getMarketBySlug(slug: string): Promise<MarketDisplay | null> {
  try {
    const url = `${API_CONFIG.BASE_URL}/markets/slug/${encodeURIComponent(slug)}`;
    const response = await throttledFetch(url);

    if (!response.ok) {
      if (response.status === 404) return null;
      console.error(`Failed to fetch market: ${response.status}`);
      return null;
    }

    const market = (await response.json()) as PolymarketMarket;
    return transformMarket(market);
  } catch (error) {
    console.error('Error fetching market by slug:', error);
    return null;
  }
}

/**
 * Get markets by IDs (for batch resolution)
 */
export async function getMarketsByIds(ids: string[]): Promise<MarketDisplay[]> {
  if (ids.length === 0) return [];

  try {
    const idsParam = ids.join(',');
    const url = `${API_CONFIG.BASE_URL}/markets?id=${encodeURIComponent(idsParam)}`;
    const response = await throttledFetch(url);

    if (!response.ok) {
      console.error(`Failed to fetch markets by IDs: ${response.status}`);
      return [];
    }

    const markets = (await response.json()) as PolymarketMarket[];
    return markets.map(transformMarket);
  } catch (error) {
    console.error('Error fetching markets by IDs:', error);
    return [];
  }
}

// ============ Resolution Logic ============

/**
 * Determine winning outcome from a closed market
 * Winner is the outcome with price > WINNING_PRICE_THRESHOLD (0.95)
 */
export function getWinningOutcome(market: MarketDisplay): MarketResolution {
  const result: MarketResolution = {
    marketId: market.id,
    resolved: market.closed,
    winningOutcomeIndex: null,
    winningTokenId: null,
    voided: false,
  };

  if (!market.closed) {
    return result;
  }

  // Find outcome with price > threshold
  const winningIndex = market.outcomes.findIndex(
    (o) => o.price > CONFIG.WINNING_PRICE_THRESHOLD
  );

  if (winningIndex >= 0) {
    return {
      ...result,
      winningOutcomeIndex: winningIndex,
      winningTokenId: market.outcomes[winningIndex].clobTokenId,
    };
  }

  // No clear winner - market might be voided
  // Check if all prices are near 0 or all near 0.5
  const allPricesLow = market.outcomes.every((o) => o.price < 0.1);
  const allPricesMid = market.outcomes.every((o) => o.price > 0.3 && o.price < 0.7);

  if (allPricesLow || allPricesMid) {
    return { ...result, voided: true };
  }

  // Market closed but unclear resolution - treat as not yet resolved
  return { ...result, resolved: false };
}

/**
 * Get resolution status for multiple markets
 */
export async function getResolutionsForMarkets(
  marketIds: string[]
): Promise<Map<string, MarketResolution>> {
  const markets = await getMarketsByIds(marketIds);
  const resolutions = new Map<string, MarketResolution>();

  for (const market of markets) {
    resolutions.set(market.id, getWinningOutcome(market));
  }

  return resolutions;
}

// ============ Initialization ============

/**
 * Pre-warm the tag cache on bot startup
 */
export async function initializeClient(): Promise<void> {
  console.log('[Polymarket] Initializing client and warming tag cache...');
  const tags = await getTags();
  console.log(`[Polymarket] Cached ${tags.length} tags`);
}
