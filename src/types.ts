export type TokenQuote = {
  address: string;
  symbol: string;
  name: string;
  priceSol: number;
  priceUsd: number | null;
  pairAddress: string;
  dexId: string;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  url: string;
  updatedAt: number;
};

export type FeeConfig = {
  slippagePct: number;
  bribeSol: number;
  txFeeSol: number;
};

export type AccountState = {
  startingCapitalSol: number;
  cashSol: number;
};

export type BuyLot = {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  createdAt: number;
  capitalSol: number;
  feesSol: number;
  tokenAmount: number;
  entryPriceSol: number;
  costBasisSol: number;
};

export type Position = {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  lots: BuyLot[];
  realizedPnlSol: number;
  openedAt: number;
  updatedAt: number;
};

export type LimitOrder = {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  side: "buy" | "sell";
  limitPriceSol: number;
  limitMarketCapUsd?: number | null;
  capitalSol?: number;
  reservedSol?: number;
  reservedFeesSol?: number;
  sellPercent?: number;
  status: "open" | "filled" | "cancelled";
  createdAt: number;
  filledAt?: number;
  fillPriceSol?: number;
  note?: string;
};

export type TradeEvent = {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  createdAt: number;
  priceSol: number;
  tokenAmount: number;
  grossSol: number;
  feesSol: number;
  realizedPnlSol?: number;
};

export type PaperTradeState = {
  positions: Position[];
  orders: LimitOrder[];
  trades: TradeEvent[];
  fees: FeeConfig;
  account: AccountState;
  usdMode: boolean;
  lastAddress: string;
};
