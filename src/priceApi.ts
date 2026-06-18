import type { TokenQuote } from "./types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEXSCREENER_TOKEN_URL = "https://api.dexscreener.com/tokens/v1/solana";

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceNative?: string;
  priceUsd?: string | null;
  liquidity?: { usd?: number | null };
  marketCap?: number | null;
  fdv?: number | null;
};

const numberOrNull = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const pickBestPair = (pairs: DexPair[], tokenAddress: string) => {
  const normalized = tokenAddress.toLowerCase();
  const matching = pairs.filter((pair) => {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    return base === normalized || quote === normalized;
  });

  return [...(matching.length ? matching : pairs)].sort((a, b) => {
    const aLiquidity = a.liquidity?.usd ?? 0;
    const bLiquidity = b.liquidity?.usd ?? 0;
    return bLiquidity - aLiquidity;
  })[0];
};

export async function fetchTokenQuote(tokenAddress: string, solUsdFallback?: number): Promise<TokenQuote> {
  const address = tokenAddress.trim();
  if (!address) {
    throw new Error("Paste contract address trước đã.");
  }

  const response = await fetch(`${DEXSCREENER_TOKEN_URL}/${encodeURIComponent(address)}`);
  if (!response.ok) {
    throw new Error(`DEX Screener lỗi ${response.status}. Thử lại sau một nhịp.`);
  }

  const pairs = (await response.json()) as DexPair[];
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error("Không tìm thấy pool cho contract address này trên DEX Screener.");
  }

  const pair = pickBestPair(pairs, address);
  const isQuoteToken = pair.quoteToken?.address?.toLowerCase() === address.toLowerCase();
  const token = isQuoteToken ? pair.quoteToken : pair.baseToken;
  const priceUsd = numberOrNull(pair.priceUsd);
  const native = numberOrNull(pair.priceNative);
  const priceSol = address === SOL_MINT ? 1 : native ?? (priceUsd && solUsdFallback ? priceUsd / solUsdFallback : null);

  if (!priceSol || priceSol <= 0) {
    throw new Error("Pool này chưa có giá SOL hợp lệ để paper trade.");
  }

  return {
    address,
    symbol: token?.symbol || "TOKEN",
    name: token?.name || "Unknown token",
    priceSol,
    priceUsd,
    pairAddress: pair.pairAddress || "",
    dexId: pair.dexId || "dex",
    liquidityUsd: pair.liquidity?.usd ?? null,
    marketCapUsd: pair.marketCap ?? null,
    fdvUsd: pair.fdv ?? null,
    url: pair.url || "",
    updatedAt: Date.now(),
  };
}

export async function fetchSolUsd(): Promise<number | null> {
  try {
    const solQuote = await fetchTokenQuote(SOL_MINT);
    return solQuote.priceUsd;
  } catch {
    return null;
  }
}
