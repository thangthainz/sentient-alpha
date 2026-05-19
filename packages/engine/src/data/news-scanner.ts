/**
 * Multi-source RSS news scanner with VADER + crypto-lexicon sentiment.
 *
 * Free public sources only — no API key required. Ported from the Python
 * trading bot reference, adapted for TypeScript + no external NLP deps.
 */

export interface NewsSource {
  name: string;
  url: string;
  authority: number; // 0-1
}

export const RSS_SOURCES: NewsSource[] = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", authority: 0.95 },
  { name: "The Block", url: "https://www.theblock.co/rss.xml", authority: 0.95 },
  { name: "Decrypt", url: "https://decrypt.co/feed", authority: 0.85 },
  { name: "CoinTelegraph", url: "https://cointelegraph.com/rss", authority: 0.80 },
  { name: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/.rss/full/", authority: 0.80 },
  { name: "Bitcoin.com", url: "https://news.bitcoin.com/feed/", authority: 0.70 },
];

export interface NewsItem {
  source: string;
  authority: number;
  title: string;
  summary: string;
  url: string;
  publishedTs: number;
  fetchedTs: number;
  sentimentScore: number; // -1 to +1
  sentimentConfidence: number; // 0 to 1
  importanceScore: number; // 0 to 1
  tickers: string[];
  category: string;
}

export interface MarketNewsView {
  generatedAt: number;
  itemCount: number;
  netSentiment: number;
  weightedIntensity: number;
  fearGreedProxy: number; // 0-100
  regime: "FEAR" | "NEUTRAL" | "GREED";
  criticalNegative: number;
  criticalPositive: number;
  topHeadlines: NewsItem[];
}

// ============================================================================
// Crypto sentiment lexicon (ported from news_scanner.py)
// ============================================================================

const BULLISH_PHRASES: Record<string, number> = {
  "etf approved": 0.85,
  "etf approval": 0.85,
  "spot etf": 0.6,
  "halving": 0.45,
  "mainnet launch": 0.55,
  "mainnet live": 0.55,
  "buyback": 0.45,
  "burn": 0.35,
  "partnership": 0.4,
  "integration": 0.35,
  "listed on": 0.5,
  "new listing": 0.5,
  "all-time high": 0.55,
  "ath": 0.5,
  "breakout": 0.5,
  "rally": 0.45,
  "surge": 0.5,
  "soar": 0.5,
  "moon": 0.4,
  "bullish": 0.5,
  "accumulation": 0.4,
  "institutional adoption": 0.55,
  "treasury purchase": 0.5,
  "tvl growth": 0.45,
  "record volume": 0.4,
  "approval": 0.4,
  "upgrade complete": 0.4,
  "fork successful": 0.4,
  "milestone": 0.35,
};

const BEARISH_PHRASES: Record<string, number> = {
  "hack": -0.85,
  "exploit": -0.85,
  "stolen": -0.75,
  "drained": -0.75,
  "rug pull": -0.95,
  "rugpull": -0.95,
  "exit scam": -0.95,
  "scam": -0.7,
  "sec lawsuit": -0.80,
  "sec sues": -0.80,
  "sec charges": -0.80,
  "indictment": -0.7,
  "arrested": -0.7,
  "fraud": -0.75,
  "ponzi": -0.85,
  "bankruptcy": -0.85,
  "insolvent": -0.8,
  "insolvency": -0.8,
  "depeg": -0.70,
  "collapse": -0.75,
  "crash": -0.65,
  "selloff": -0.5,
  "sell-off": -0.5,
  "liquidation": -0.55,
  "dumps": -0.5,
  "dumping": -0.5,
  "bearish": -0.5,
  "death cross": -0.55,
  "ban": -0.6,
  "banned": -0.6,
  "regulatory crackdown": -0.65,
  "crackdown": -0.6,
  "halt withdrawals": -0.8,
  "freeze": -0.55,
  "vulnerability": -0.5,
  "exploit found": -0.65,
  "delisting": -0.6,
  "delisted": -0.6,
  "shutdown": -0.6,
  "cease operations": -0.7,
};

const HIGH_IMPACT_KEYWORDS = [
  "hack", "exploit", "depeg", "etf", "sec", "lawsuit", "bankruptcy",
  "halving", "fork", "upgrade", "ban", "regulation", "approved",
];

const TICKER_SET = new Set([
  "BTC", "ETH", "SOL", "MNT", "BNB", "XRP", "ADA", "DOGE", "MATIC", "DOT",
  "LINK", "UNI", "AVAX", "ATOM", "ARB", "OP", "USDC", "USDT", "DAI",
  "USDE", "WETH", "WBTC", "WMNT", "PEPE", "SHIB", "AAVE", "COMP", "MKR",
  "LDO", "PYTH", "TIA", "JTO", "SUI", "APT", "INJ", "SEI",
]);

const TICKER_BLACKLIST = new Set([
  "CEO", "CTO", "ETF", "SEC", "API", "DEFI", "NFT", "DAO", "MMORPG",
  "USD", "EUR", "GBP", "RSI", "DEX", "CEX", "TVL", "ICO", "IDO", "ATH",
  "ATL", "USA", "UK", "US", "EU", "AI", "ML",
]);

// Tiny VADER-ish lexicon (much smaller than full VADER for size)
const POSITIVE_WORDS = new Set([
  "growth", "gain", "rise", "rises", "rising", "up", "positive", "good", "great",
  "strong", "boost", "win", "wins", "winning", "success", "successful", "boost",
  "bullish", "rally", "rallies", "soar", "soared", "soaring", "approve", "approved",
]);
const NEGATIVE_WORDS = new Set([
  "loss", "losses", "fall", "falls", "falling", "drop", "drops", "dropping",
  "down", "negative", "bad", "weak", "decline", "declining", "lose", "lost",
  "bearish", "crash", "crashes", "plunge", "plunged", "tumble", "tumbled",
  "concern", "concerns", "warning", "warn", "risk", "risks", "fail", "fails",
]);

// ============================================================================
// Sentiment computation
// ============================================================================

function lightweightVader(text: string): number {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(t => t.length > 0);
  let pos = 0, neg = 0;
  for (const t of tokens) {
    if (POSITIVE_WORDS.has(t)) pos++;
    else if (NEGATIVE_WORDS.has(t)) neg++;
  }
  const total = pos + neg;
  if (total === 0) return 0;
  return (pos - neg) / Math.max(total, 5); // normalise to ~[-1, +1]
}

function cryptoLexiconShift(text: string): { shift: number; hits: number } {
  const lc = text.toLowerCase();
  let shift = 0;
  let hits = 0;
  for (const [phrase, weight] of Object.entries(BULLISH_PHRASES)) {
    if (lc.includes(phrase)) { shift += weight; hits++; }
  }
  for (const [phrase, weight] of Object.entries(BEARISH_PHRASES)) {
    if (lc.includes(phrase)) { shift += weight; hits++; }
  }
  return { shift, hits };
}

function computeSentiment(text: string): { score: number; confidence: number } {
  const vader = lightweightVader(text);
  const { shift, hits } = cryptoLexiconShift(text);
  const score = Math.max(-1, Math.min(1, vader + 0.7 * shift));
  const confidence = Math.min(1, 0.3 + 0.15 * hits + 0.4 * Math.abs(score));
  return { score, confidence };
}

function computeImportance(text: string, authority: number): number {
  const lc = text.toLowerCase();
  let hits = 0;
  for (const kw of HIGH_IMPACT_KEYWORDS) {
    if (lc.includes(kw)) hits++;
  }
  const keywordScore = Math.min(1, 0.3 + 0.2 * hits);
  return 0.6 * keywordScore + 0.4 * authority;
}

function extractTickers(text: string): string[] {
  const found = new Set<string>();
  const upperMatches = text.match(/\b[A-Z]{2,15}\b/g) ?? [];
  for (const m of upperMatches) {
    if (TICKER_SET.has(m) && !TICKER_BLACKLIST.has(m)) found.add(m);
  }
  // Name-to-ticker
  const lc = text.toLowerCase();
  const nameMap: Record<string, string> = {
    "bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL", "mantle": "MNT",
    "binance": "BNB", "ripple": "XRP", "cardano": "ADA", "dogecoin": "DOGE",
    "polygon": "MATIC", "polkadot": "DOT", "chainlink": "LINK",
    "avalanche": "AVAX", "cosmos": "ATOM", "arbitrum": "ARB",
  };
  for (const [name, ticker] of Object.entries(nameMap)) {
    if (lc.includes(name)) found.add(ticker);
  }
  return Array.from(found);
}

function categoryFromText(text: string): string {
  const lc = text.toLowerCase();
  if (/hack|exploit|stolen|drained/.test(lc)) return "hack";
  if (/sec|lawsuit|regulation|ban/.test(lc)) return "regulatory";
  if (/etf|spot etf/.test(lc)) return "etf";
  if (/launch|mainnet|release/.test(lc)) return "launch";
  if (/partnership|integration|collaboration/.test(lc)) return "partnership";
  if (/fed|inflation|cpi|fomc|interest rate/.test(lc)) return "macro";
  if (/liquidat|crash|sell-off/.test(lc)) return "liquidation";
  return "generic";
}

// ============================================================================
// RSS fetching + parsing (no external library)
// ============================================================================

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&[#a-z0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function parseRssDate(s: string): number {
  // RFC 822 or ISO 8601 — Date.parse handles both
  const t = Date.parse(s);
  return isNaN(t) ? Date.now() : t;
}

function extractTag(xml: string, tag: string): string {
  // Matches first occurrence of <tag>...</tag> (non-greedy), case insensitive
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return "";
  // Strip CDATA wrapper if present
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function parseRss(xml: string, source: NewsSource, limit = 30): NewsItem[] {
  // RSS uses <item>, Atom uses <entry> — handle both
  const itemBlocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) ?? [];
  const items: NewsItem[] = [];
  const now = Date.now();

  for (const block of itemBlocks.slice(0, limit)) {
    const title = stripHtml(extractTag(block, "title"));
    if (!title) continue;
    const link = extractTag(block, "link") || (block.match(/<link[^>]*href=["']([^"']+)/i)?.[1] ?? "");
    const descRaw = extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content:encoded");
    const summary = stripHtml(descRaw).slice(0, 600);
    const pubStr = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated");
    const publishedTs = pubStr ? parseRssDate(pubStr) : now;

    const fullText = `${title} ${summary}`;
    const { score, confidence } = computeSentiment(fullText);
    const importance = computeImportance(fullText, source.authority);

    items.push({
      source: source.name,
      authority: source.authority,
      title,
      summary,
      url: link,
      publishedTs,
      fetchedTs: now,
      sentimentScore: score,
      sentimentConfidence: confidence,
      importanceScore: importance,
      tickers: extractTickers(fullText),
      category: categoryFromText(fullText),
    });
  }
  return items;
}

async function fetchSource(source: NewsSource, timeoutMs = 15000): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 SentientAlphaNewsScanner/0.1" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, source);
  } catch {
    return [];
  }
}

export async function fetchAllNews(): Promise<NewsItem[]> {
  const results = await Promise.all(RSS_SOURCES.map(s => fetchSource(s)));
  const merged: NewsItem[] = [];
  const seenUrls = new Set<string>();
  for (const items of results) {
    for (const item of items) {
      const key = item.url || item.title;
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      merged.push(item);
    }
  }
  // Sort newest first
  merged.sort((a, b) => b.publishedTs - a.publishedTs);
  return merged;
}

// ============================================================================
// Market regime view (24h window)
// ============================================================================

export function computeMarketView(items: NewsItem[], windowMs = 24 * 60 * 60 * 1000): MarketNewsView {
  const cutoff = Date.now() - windowMs;
  const recent = items.filter(i => i.publishedTs >= cutoff);

  if (recent.length === 0) {
    return {
      generatedAt: Date.now(),
      itemCount: 0,
      netSentiment: 0,
      weightedIntensity: 0,
      fearGreedProxy: 50,
      regime: "NEUTRAL",
      criticalNegative: 0,
      criticalPositive: 0,
      topHeadlines: [],
    };
  }

  let weightSum = 0;
  let netSentSum = 0;
  let intensity = 0;
  let criticalNeg = 0;
  let criticalPos = 0;

  for (const item of recent) {
    const w = Math.max(0.1, item.authority * item.sentimentConfidence);
    weightSum += w;
    netSentSum += item.sentimentScore * w;
    intensity += Math.abs(item.sentimentScore) * item.authority * item.importanceScore;
    if (item.sentimentScore <= -0.6 && item.importanceScore >= 0.5) criticalNeg++;
    if (item.sentimentScore >= 0.6 && item.importanceScore >= 0.5) criticalPos++;
  }

  const netSentiment = weightSum > 0 ? netSentSum / weightSum : 0;
  const fearGreedProxy = Math.max(0, Math.min(100, 50 + 50 * netSentiment));

  const regime: "FEAR" | "NEUTRAL" | "GREED" =
    fearGreedProxy >= 65 ? "GREED" : fearGreedProxy <= 35 ? "FEAR" : "NEUTRAL";

  // Top headlines: highest importance×|sentiment|
  const topHeadlines = [...recent]
    .sort((a, b) => (b.importanceScore * Math.abs(b.sentimentScore)) - (a.importanceScore * Math.abs(a.sentimentScore)))
    .slice(0, 10);

  return {
    generatedAt: Date.now(),
    itemCount: recent.length,
    netSentiment,
    weightedIntensity: intensity,
    fearGreedProxy,
    regime,
    criticalNegative: criticalNeg,
    criticalPositive: criticalPos,
    topHeadlines,
  };
}
