// Polymarket API Client
// Wrapper for Polymarket Gamma API with caching

import { API_CONFIG, CONFIG, FEATURED_CATEGORIES, TRENDING_SLUG, categoryTagIds } from './polymarketConfig.js';
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

  const fetchedTags = await fetchTagsFromAPI();

  // Only update cache if we got valid results - don't overwrite with empty
  if (fetchedTags.length === 0) {
    console.warn('[Polymarket] Tags API returned empty - using cached/fallback values');
    return tagsCache;
  }

  tagsCache = fetchedTags;
  tagsCacheTime = now;
  console.log(`[Polymarket] Fetched ${tagsCache.length} tags from API`);

  // Update category tag ID mappings (only update, don't remove existing fallbacks)
  for (const category of FEATURED_CATEGORIES) {
    // Skip trending - it's handled specially without a tag filter
    if (category.slug === TRENDING_SLUG) continue;

    const tag = tagsCache.find(
      (t) => t.slug.toLowerCase() === category.slug.toLowerCase() ||
             t.label.toLowerCase() === category.slug.toLowerCase()
    );
    if (tag) {
      // API returns id as string, convert to number for consistency
      const tagId = typeof tag.id === 'string' ? parseInt(tag.id, 10) : tag.id;
      categoryTagIds.set(category.slug, tagId);
      console.log(`[Polymarket] Mapped category '${category.slug}' to tag ID ${tagId}`);
    } else {
      console.warn(`[Polymarket] No tag found for category '${category.slug}' - using fallback if available`);
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

  // Check our featured category mappings first (includes fallback values)
  const cachedId = categoryTagIds.get(categorySlug);
  if (cachedId !== undefined) {
    console.log(`[Polymarket] Using cached tag ID ${cachedId} for category '${categorySlug}'`);
    return cachedId;
  }

  // Search in full tag list
  const tag = tagsCache.find(
    (t) => t.slug.toLowerCase() === categorySlug.toLowerCase() ||
           t.label.toLowerCase() === categorySlug.toLowerCase()
  );

  if (tag) {
    const tagId = typeof tag.id === 'string' ? parseInt(tag.id, 10) : tag.id;
    console.log(`[Polymarket] Found tag ID ${tagId} for category '${categorySlug}' via search`);
    return tagId;
  }

  console.error(`[Polymarket] No tag ID found for category '${categorySlug}'`);
  return null;
}

// ============ Market Operations ============

/**
 * Parse a market array field that may be a JSON string or already an array
 * The Polymarket API returns these fields as JSON strings, not arrays
 */
function parseMarketArrayField(field: string | string[] | undefined): string[] {
  if (Array.isArray(field)) return field;
  if (typeof field === 'string') {
    try {
      const parsed = JSON.parse(field) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Check if a market has valid structure for transformation
 */
function isValidMarket(market: PolymarketMarket): boolean {
  const outcomes = parseMarketArrayField(market.outcomes);
  const outcomePrices = parseMarketArrayField(market.outcomePrices);
  const clobTokenIds = parseMarketArrayField(market.clobTokenIds);
  return outcomes.length > 0 && outcomePrices.length > 0 && clobTokenIds.length > 0;
}

/**
 * Transform API market to display format
 */
function transformMarket(market: PolymarketMarket): MarketDisplay {
  const outcomes = parseMarketArrayField(market.outcomes);
  const outcomePrices = parseMarketArrayField(market.outcomePrices);
  const clobTokenIds = parseMarketArrayField(market.clobTokenIds);

  const outcomesDisplay: OutcomeDisplay[] = outcomes.map((name, index) => {
    const price = parseFloat(outcomePrices[index] || '0');
    return {
      index,
      name,
      price,
      clobTokenId: clobTokenIds[index] || '',
      payoutMultiplier: price > 0 ? 1 / price : 0,
    };
  });

  return {
    id: market.id,
    slug: market.slug,
    question: market.question,
    outcomes: outcomesDisplay,
    endDate: new Date(market.endDate),
    closed: market.closed,
    volume: parseFloat(market.volume || '0'),
  };
}

/**
 * Get markets by tag/category
 * Filters to only show markets above MIN_MARKET_VOLUME threshold
 */
export async function getMarketsByTag(
  tagId: number,
  limit: number = API_CONFIG.DEFAULT_MARKET_LIMIT
): Promise<MarketDisplay[]> {
  try {
    // Fetch extra markets to account for volume filtering
    const fetchLimit = limit * 3;
    const url = `${API_CONFIG.BASE_URL}/markets?tag_id=${tagId}&closed=false&limit=${fetchLimit}&order=volume&ascending=false`;
    console.log(`[Polymarket] Fetching markets for tag_id=${tagId}`);
    const response = await throttledFetch(url);

    if (!response.ok) {
      console.error(`[Polymarket] Failed to fetch markets: ${response.status} ${response.statusText}`);
      return [];
    }

    const markets = (await response.json()) as PolymarketMarket[];
    const transformed = markets.filter(isValidMarket).map(transformMarket);
    const filtered = transformed.filter(m => m.volume >= CONFIG.MIN_MARKET_VOLUME);
    console.log(`[Polymarket] Found ${markets.length} markets for tag_id=${tagId}, ${filtered.length} above volume threshold`);
    return filtered.slice(0, limit);
  } catch (error) {
    console.error('[Polymarket] Error fetching markets by tag:', error);
    return [];
  }
}

/**
 * Get popular/trending markets by volume (no tag filter)
 */
export async function getPopularMarkets(
  limit: number = API_CONFIG.DEFAULT_MARKET_LIMIT
): Promise<MarketDisplay[]> {
  try {
    const url = `${API_CONFIG.BASE_URL}/markets?closed=false&limit=${limit}&order=volume&ascending=false`;
    const response = await throttledFetch(url);

    if (!response.ok) {
      console.error(`Failed to fetch popular markets: ${response.status}`);
      return [];
    }

    const markets = (await response.json()) as PolymarketMarket[];
    return markets.filter(isValidMarket).map(transformMarket);
  } catch (error) {
    console.error('Error fetching popular markets:', error);
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
  // Handle trending specially - no tag filter, just top markets by volume
  if (categorySlug === TRENDING_SLUG) {
    return getPopularMarkets(limit);
  }

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
    if (!isValidMarket(market)) {
      console.warn(`[Polymarket] Market ${slug} has invalid structure, skipping`);
      return null;
    }
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
    return markets.filter(isValidMarket).map(transformMarket);
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
