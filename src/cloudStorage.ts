import { supabase } from "./supabaseClient";
import type { AccountState, FeeConfig, LimitOrder, PaperTradeState, Position, TradeEvent } from "./types";

type PaperTradeStateRow = {
  user_id: string;
  positions: unknown;
  orders: unknown;
  trades: unknown;
  fees: unknown;
  account: unknown;
  usd_mode: boolean | null;
  last_address: string | null;
};

const defaultFees: FeeConfig = { slippagePct: 1, bribeSol: 0.002, txFeeSol: 0.00001 };
const defaultAccount: AccountState = { startingCapitalSol: 5, cashSol: 5 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const normalizeFees = (value: unknown): FeeConfig => {
  if (!isRecord(value)) return defaultFees;
  return {
    slippagePct: Number(value.slippagePct ?? defaultFees.slippagePct),
    bribeSol: Number(value.bribeSol ?? defaultFees.bribeSol),
    txFeeSol: Number(value.txFeeSol ?? defaultFees.txFeeSol),
  };
};

const normalizeAccount = (value: unknown): AccountState => {
  if (!isRecord(value)) return defaultAccount;
  return {
    startingCapitalSol: Number(value.startingCapitalSol ?? defaultAccount.startingCapitalSol),
    cashSol: Number(value.cashSol ?? defaultAccount.cashSol),
  };
};

const rowToState = (row: PaperTradeStateRow): PaperTradeState => ({
  positions: Array.isArray(row.positions) ? (row.positions as Position[]) : [],
  orders: Array.isArray(row.orders) ? (row.orders as LimitOrder[]) : [],
  trades: Array.isArray(row.trades) ? (row.trades as TradeEvent[]) : [],
  fees: normalizeFees(row.fees),
  account: normalizeAccount(row.account),
  usdMode: row.usd_mode ?? true,
  lastAddress: row.last_address ?? "",
});

const stateToRow = (userId: string, state: PaperTradeState) => ({
  user_id: userId,
  positions: state.positions,
  orders: state.orders,
  trades: state.trades,
  fees: state.fees,
  account: state.account,
  usd_mode: state.usdMode,
  last_address: state.lastAddress,
});

export const ensureCloudUser = async () => {
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (session?.user) return session.user;
  return null;
};

export const sendCloudLoginLink = async (email: string) => {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
};

export const signOutCloud = async () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const loadCloudState = async (localState: PaperTradeState) => {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = await ensureCloudUser();
  if (!user) throw new Error("Sign in to sync DB");
  const { data, error } = await supabase
    .from("paper_trade_states")
    .select("user_id, positions, orders, trades, fees, account, usd_mode, last_address")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (data) return { userId: user.id, state: rowToState(data as PaperTradeStateRow), migrated: false };

  const { error: insertError } = await supabase.from("paper_trade_states").insert(stateToRow(user.id, localState));
  if (insertError) throw insertError;
  return { userId: user.id, state: localState, migrated: true };
};

export const saveCloudState = async (state: PaperTradeState) => {
  if (!supabase) throw new Error("Supabase is not configured.");

  const user = await ensureCloudUser();
  if (!user) throw new Error("Sign in to sync DB");
  const { error } = await supabase.from("paper_trade_states").upsert(stateToRow(user.id, state), { onConflict: "user_id" });
  if (error) throw error;
  return user.id;
};
