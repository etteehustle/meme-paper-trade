import type { BuyLot, FeeConfig, LimitOrder, Position, TokenQuote, TradeEvent } from "./types";

export const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const totalFees = (fees: FeeConfig) => Math.max(0, fees.bribeSol) + Math.max(0, fees.txFeeSol);

export const totalsForPosition = (position: Position | undefined, currentPriceSol?: number) => {
  const lots = position?.lots ?? [];
  const tokenAmount = lots.reduce((sum, lot) => sum + lot.tokenAmount, 0);
  const costBasisSol = lots.reduce((sum, lot) => sum + lot.costBasisSol, 0);
  const avgEntrySol = tokenAmount > 0 ? costBasisSol / tokenAmount : 0;
  const marketValueSol = currentPriceSol ? tokenAmount * currentPriceSol : 0;
  const unrealizedPnlSol = currentPriceSol ? marketValueSol - costBasisSol : 0;
  const pnlPct = costBasisSol > 0 ? (unrealizedPnlSol / costBasisSol) * 100 : 0;

  return {
    tokenAmount,
    costBasisSol,
    avgEntrySol,
    marketValueSol,
    unrealizedPnlSol,
    pnlPct,
    realizedPnlSol: position?.realizedPnlSol ?? 0,
  };
};

export function applyBuy(
  positions: Position[],
  quote: TokenQuote,
  capitalSol: number,
  fillPriceSol: number,
  fees: FeeConfig,
  type: "market" | "limit",
) {
  const safeCapital = Math.max(0, capitalSol);
  const executionPrice = Math.max(fillPriceSol, 0);
  const feesSol = totalFees(fees);

  if (safeCapital <= 0 || executionPrice <= 0) {
    throw new Error("Vốn và giá fill phải lớn hơn 0.");
  }

  const tokenAmount = safeCapital / executionPrice;
  const lot: BuyLot = {
    id: uid(),
    tokenAddress: quote.address,
    tokenSymbol: quote.symbol,
    createdAt: Date.now(),
    capitalSol: safeCapital,
    feesSol,
    tokenAmount,
    entryPriceSol: executionPrice,
    costBasisSol: safeCapital + feesSol,
  };

  const existing = positions.find((position) => position.tokenAddress === quote.address);
  const nextPosition: Position = existing
    ? {
        ...existing,
        tokenSymbol: quote.symbol,
        tokenName: quote.name,
        lots: [...existing.lots, lot],
        updatedAt: Date.now(),
      }
    : {
        tokenAddress: quote.address,
        tokenSymbol: quote.symbol,
        tokenName: quote.name,
        lots: [lot],
        realizedPnlSol: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      };

  const nextPositions = existing
    ? positions.map((position) => (position.tokenAddress === quote.address ? nextPosition : position))
    : [nextPosition, ...positions];

  const trade: TradeEvent = {
    id: uid(),
    tokenAddress: quote.address,
    tokenSymbol: quote.symbol,
    side: "buy",
    type,
    createdAt: Date.now(),
    priceSol: executionPrice,
    tokenAmount,
    grossSol: safeCapital,
    feesSol,
  };

  return { positions: nextPositions, trade };
}

export function applySell(
  positions: Position[],
  quote: TokenQuote,
  sellPercent: number,
  fillPriceSol: number,
  fees: FeeConfig,
  type: "market" | "limit",
) {
  const existing = positions.find((position) => position.tokenAddress === quote.address);
  if (!existing) {
    throw new Error("Chưa có vị thế để bán.");
  }

  const percent = Math.min(100, Math.max(0, sellPercent));
  if (percent <= 0) {
    throw new Error("Phần trăm bán phải lớn hơn 0.");
  }

  const totals = totalsForPosition(existing, fillPriceSol);
  if (totals.tokenAmount <= 0) {
    throw new Error("Vị thế rỗng.");
  }

  const ratio = percent / 100;
  const tokenAmount = totals.tokenAmount * ratio;
  const costRemoved = totals.costBasisSol * ratio;
  const grossSol = tokenAmount * fillPriceSol;
  const feesSol = totalFees(fees);
  const realizedPnlSol = grossSol - feesSol - costRemoved;

  const remainingLots = existing.lots
    .map((lot) => ({
      ...lot,
      tokenAmount: lot.tokenAmount * (1 - ratio),
      costBasisSol: lot.costBasisSol * (1 - ratio),
      capitalSol: lot.capitalSol * (1 - ratio),
      feesSol: lot.feesSol * (1 - ratio),
    }))
    .filter((lot) => lot.tokenAmount > 0.000000000001);

  const updated: Position = {
    ...existing,
    lots: remainingLots,
    realizedPnlSol: existing.realizedPnlSol + realizedPnlSol,
    updatedAt: Date.now(),
  };

  const nextPositions =
    remainingLots.length === 0
      ? positions.filter((position) => position.tokenAddress !== quote.address)
      : positions.map((position) => (position.tokenAddress === quote.address ? updated : position));

  const trade: TradeEvent = {
    id: uid(),
    tokenAddress: quote.address,
    tokenSymbol: quote.symbol,
    side: "sell",
    type,
    createdAt: Date.now(),
    priceSol: fillPriceSol,
    tokenAmount,
    grossSol,
    feesSol,
    realizedPnlSol,
  };

  return { positions: nextPositions, trade };
}

export function shouldFill(order: LimitOrder, quote: TokenQuote) {
  if (order.status !== "open" || order.tokenAddress !== quote.address) return false;
  if (order.side === "buy") return quote.priceSol <= order.limitPriceSol;
  return quote.priceSol >= order.limitPriceSol;
}

export function executionPriceFor(side: "buy" | "sell", marketPriceSol: number, limitPriceSol: number | null, fees: FeeConfig) {
  const referencePrice =
    limitPriceSol === null ? marketPriceSol : side === "buy" ? Math.min(marketPriceSol, limitPriceSol) : Math.max(marketPriceSol, limitPriceSol);
  const slippage = Math.max(0, fees.slippagePct) / 100;
  return side === "buy" ? referencePrice * (1 + slippage) : referencePrice * (1 - slippage);
}
