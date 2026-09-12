import type { DailyDigest } from './daily-digest-template.js';

export const CLOUD_MARKET_CATEGORY = '金融与市场';
export const CLOUD_WATCHLIST_CATEGORY = '观察名单';

interface WatchlistStockRequirement {
  name: string;
  symbol: string;
  tokens: string[];
}

export interface CloudDigestCompletenessRequirements {
  unreadMailCount: number;
  requiredCategories: string[];
  watchlistStockCount: number;
  watchlistStocks: WatchlistStockRequirement[];
}

export interface CloudDigestCompletenessInput {
  mail: { messages?: unknown; unreadCount?: unknown };
  cloudContext: Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function watchlistStocks(context: Record<string, unknown>): WatchlistStockRequirement[] {
  const watchlist = objectValue(context.watchlist);
  const rawStocks = Array.isArray(watchlist?.stocks) ? watchlist.stocks : [];
  const seen = new Set<string>();
  const result: WatchlistStockRequirement[] = [];
  for (const rawStock of rawStocks) {
    const stock = objectValue(rawStock);
    if (!stock) continue;
    const name = textValue(stock.name);
    const symbol = textValue(stock.symbol);
    const tokens = [...new Set([name, symbol].filter(token => token.length >= 2))];
    if (!tokens.length) continue;
    const key = tokens.map(token => token.toLocaleLowerCase()).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, symbol, tokens });
  }
  return result;
}

export function getCloudDigestCompletenessRequirements(
  input: CloudDigestCompletenessInput,
): CloudDigestCompletenessRequirements {
  const messagesCount = Array.isArray(input.mail.messages) ? input.mail.messages.length : 0;
  const reportedUnreadCount = nonNegativeInteger(input.mail.unreadCount);
  const unreadMailCount = Math.max(messagesCount, reportedUnreadCount);
  const stocks = watchlistStocks(input.cloudContext);
  return {
    unreadMailCount,
    requiredCategories: [CLOUD_MARKET_CATEGORY, ...(stocks.length ? [CLOUD_WATCHLIST_CATEGORY] : [])],
    watchlistStockCount: stocks.length,
    watchlistStocks: stocks,
  };
}

export function summarizeCloudDigestCompletenessRequirements(
  requirements: CloudDigestCompletenessRequirements,
): { unreadMailCount: number; requiredCategories: string[]; watchlistStockCount: number } {
  return {
    unreadMailCount: requirements.unreadMailCount,
    requiredCategories: [...requirements.requiredCategories],
    watchlistStockCount: requirements.watchlistStockCount,
  };
}

export function assertCloudDigestCompleteness(
  digest: DailyDigest,
  requirements: CloudDigestCompletenessRequirements,
): void {
  if (requirements.unreadMailCount > digest.mailBriefings.length) {
    throw new Error(
      `云端日报缺少未读邮件简报：当前输入有 ${requirements.unreadMailCount} 封未读邮件，但只生成了 ${digest.mailBriefings.length} 条邮件简报`,
    );
  }

  const categories = new Map(digest.categories.map(category => [category.name.trim(), category]));
  if (!categories.has(CLOUD_MARKET_CATEGORY)) {
    throw new Error('云端日报缺少“金融与市场”栏目，未发布');
  }

  if (!requirements.watchlistStocks.length) return;
  const watchlistCategory = categories.get(CLOUD_WATCHLIST_CATEGORY);
  if (!watchlistCategory) {
    throw new Error('Cloud Context 中存在关注股票，但日报缺少“观察名单”栏目，未发布');
  }
  const categoryText = watchlistCategory.items
    .map(item => `${item.headline}\n${item.summary}`.toLocaleLowerCase())
    .join('\n');
  const unmatched = requirements.watchlistStocks.filter(stock =>
    !stock.tokens.some(token => categoryText.includes(token.toLocaleLowerCase())),
  );
  if (unmatched.length) {
    throw new Error(`“观察名单”栏目未覆盖 Cloud Context 中的 ${unmatched.length} 项关注股票，未发布`);
  }
}
