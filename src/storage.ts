import type { AccountState, FeeConfig, LimitOrder, PaperTradeState, Position, TradeEvent } from "./types";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const loadPositions = () => read<Position[]>("mpt.positions", []);
export const loadOrders = () => read<LimitOrder[]>("mpt.orders", []);
export const loadTrades = () => read<TradeEvent[]>("mpt.trades", []);
export const loadFees = () => read<FeeConfig>("mpt.fees", { slippagePct: 1, bribeSol: 0.002, txFeeSol: 0.00001 });
export const loadUsdMode = () => read<boolean>("mpt.usdMode", true);
export const loadLastAddress = () => read<string>("mpt.lastAddress", "");
export const loadAccount = () => read<AccountState>("mpt.account", { startingCapitalSol: 5, cashSol: 5 });

export const loadLocalState = (): PaperTradeState => ({
  positions: loadPositions(),
  orders: loadOrders(),
  trades: loadTrades(),
  fees: loadFees(),
  account: loadAccount(),
  usdMode: loadUsdMode(),
  lastAddress: loadLastAddress(),
});

export const saveJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};
