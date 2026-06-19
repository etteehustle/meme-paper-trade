import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { loadCloudState, saveCloudState, signInCloud, signOutCloud, signUpCloud } from "./cloudStorage";
import { fetchSolUsd, fetchTokenQuote } from "./priceApi";
import { applyBuy, applySell, executionPriceFor, shouldFill, totalFees, totalsForPosition, uid } from "./trading";
import { loadAccount, loadFees, loadLastAddress, loadLocalState, loadOrders, loadPositions, loadTrades, loadUsdMode, saveJson } from "./storage";
import type { AccountState, FeeConfig, LimitOrder, PaperTradeState, Position, TokenQuote, TradeEvent } from "./types";

const fmt = (value: number, digits = 4) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: value > 0 && value < 1 ? Math.min(digits, 8) : 0,
  }).format(Number.isFinite(value) ? value : 0);

const fmtSol = (value: number) => `${fmt(value, value < 0.01 ? 8 : 4)} SOL`;
const fmtUsd = (value: number) => `$${fmt(value, value < 1 ? 6 : 2)}`;
const fmtCompactUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value < 1_000_000 ? 2 : 1,
  }).format(Number.isFinite(value) ? value : 0);
const fmtPct = (value: number) => `${value >= 0 ? "+" : ""}${fmt(value, 2)}%`;
const dateLabel = (value: number) => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(value);
const refreshIntervalMs = 8000;
const notificationTimeoutMs = 5000;
const currentMarketCapUsd = (quote: TokenQuote | null) => quote?.marketCapUsd ?? quote?.fdvUsd ?? null;
const marketCapToPriceSol = (marketCapUsd: number, quote: TokenQuote | null) => {
  const currentMc = currentMarketCapUsd(quote);
  if (!quote || !currentMc || currentMc <= 0 || marketCapUsd <= 0) return 0;
  return quote.priceSol * (marketCapUsd / currentMc);
};
const priceToMarketCapUsd = (priceSol: number, quote: TokenQuote | null) => {
  const currentMc = currentMarketCapUsd(quote);
  if (!quote || !currentMc || quote.priceSol <= 0 || priceSol <= 0) return null;
  return currentMc * (priceSol / quote.priceSol);
};
const priceToMarketCapLabel = (priceSol: number, quote: TokenQuote | null) => {
  const marketCapUsd = priceToMarketCapUsd(priceSol, quote);
  return marketCapUsd ? `MC ${fmtCompactUsd(marketCapUsd)}` : fmtSol(priceSol);
};
const orderLimitLabel = (order: LimitOrder, quote: TokenQuote | null) => {
  const marketCapUsd = order.limitMarketCapUsd ?? priceToMarketCapUsd(order.limitPriceSol, quote);
  return marketCapUsd ? `MC ${fmtCompactUsd(marketCapUsd)}` : fmtSol(order.limitPriceSol);
};
const orderEntryNote = (order: LimitOrder, quote: TokenQuote | null) => {
  return `Entry ${orderLimitLabel(order, quote)} / ${dateLabel(order.createdAt)}`;
};
const decimalInputPattern = /^\d*\.?\d*$/;
const valueToInputText = (value: number) => (Number.isFinite(value) ? String(value) : "");

function NumberInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  const id = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => valueToInputText(value));

  useEffect(() => {
    if (!isEditing) setDraft(valueToInputText(value));
  }, [isEditing, value]);

  const handleChange = (nextText: string) => {
    if (!decimalInputPattern.test(nextText)) return;

    setDraft(nextText);
    if (nextText.trim() === "") {
      onChange(0);
      return;
    }

    const nextValue = Number(nextText);
    if (Number.isFinite(nextValue)) onChange(nextValue);
  };

  const finishEditing = () => {
    setIsEditing(false);
    if (draft.trim() === "" || !Number.isFinite(Number(draft))) {
      setDraft(valueToInputText(value));
    }
  };

  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <div className="input-shell">
        <input
          id={id}
          name={id}
          type="text"
          inputMode="decimal"
          pattern="\d*\.?\d*"
          value={isEditing ? draft : valueToInputText(value)}
          onBlur={finishEditing}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => {
            setIsEditing(true);
            if (value === 0) setDraft("");
          }}
        />
        {suffix ? <strong>{suffix}</strong> : null}
      </div>
    </label>
  );
}

function App() {
  const [contractAddress, setContractAddress] = useState(() => loadLastAddress());
  const [quote, setQuote] = useState<TokenQuote | null>(null);
  const [quotesByAddress, setQuotesByAddress] = useState<Record<string, TokenQuote>>({});
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [positions, setPositions] = useState<Position[]>(() => loadPositions());
  const [orders, setOrders] = useState<LimitOrder[]>(() => loadOrders());
  const [trades, setTrades] = useState<TradeEvent[]>(() => loadTrades());
  const [fees, setFees] = useState<FeeConfig>(() => loadFees());
  const [account, setAccount] = useState<AccountState>(() => loadAccount());
  const [capitalInput, setCapitalInput] = useState(() => loadAccount().startingCapitalSol);
  const [usdMode, setUsdMode] = useState(() => loadUsdMode());
  const [buyCapital, setBuyCapital] = useState(1);
  const [sellPercent, setSellPercent] = useState(25);
  const [limitBuyMarketCapUsd, setLimitBuyMarketCapUsd] = useState(0);
  const [limitBuyCapital, setLimitBuyCapital] = useState(1);
  const [limitSellMarketCapUsd, setLimitSellMarketCapUsd] = useState(0);
  const [limitSellPercent, setLimitSellPercent] = useState(25);
  const [limitSellValue, setLimitSellValue] = useState(0);
  const [sellSizingMode, setSellSizingMode] = useState<"percent" | "value">("percent");
  const [notice, setNotice] = useState("");
  const [refreshRemainingMs, setRefreshRemainingMs] = useState(refreshIntervalMs);
  const [syncStatus, setSyncStatus] = useState<"connecting" | "synced" | "saving" | "local" | "sent" | "error">("connecting");
  const [syncMessage, setSyncMessage] = useState("Connecting DB");
  const [loginFeedback, setLoginFeedback] = useState("");
  const [cloudUserId, setCloudUserId] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fillLockRef = useRef(false);
  const initialLoadRef = useRef(false);
  const cloudReadyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  const selectedPosition = useMemo(
    () => (quote ? positions.find((position) => position.tokenAddress === quote.address) : undefined),
    [positions, quote],
  );
  const selectedTotals = useMemo(() => totalsForPosition(selectedPosition, quote?.priceSol), [selectedPosition, quote?.priceSol]);
  const openOrders = useMemo(() => orders.filter((order) => order.status === "open"), [orders]);
  const trackedTokenAddresses = useMemo(() => {
    return Array.from(
      new Set([
        ...positions.map((position) => position.tokenAddress),
        ...openOrders.map((order) => order.tokenAddress),
        ...(quote?.address ? [quote.address] : []),
      ]),
    ).filter(Boolean);
  }, [openOrders, positions, quote?.address]);
  const reservedSol = useMemo(
    () => openOrders.reduce((sum, order) => sum + (order.side === "buy" ? order.reservedSol ?? order.capitalSol ?? 0 : 0), 0),
    [openOrders],
  );
  const totalPositionValueSol = useMemo(() => {
    return positions.reduce((sum, position) => {
      const currentPrice = quotesByAddress[position.tokenAddress]?.priceSol;
      const totals = totalsForPosition(position, currentPrice);
      return sum + (currentPrice ? totals.marketValueSol : totals.costBasisSol);
    }, 0);
  }, [positions, quotesByAddress]);
  const equitySol = account.cashSol + reservedSol + totalPositionValueSol;
  const accountPnlSol = equitySol - account.startingCapitalSol;
  const currentOrderFeesSol = totalFees(fees);

  const displayValue = useCallback(
    (solValue: number) => {
      if (usdMode && solUsd) return fmtUsd(solValue * solUsd);
      return fmtSol(solValue);
    },
    [solUsd, usdMode],
  );
  const paperTradeState = useMemo<PaperTradeState>(
    () => ({
      positions,
      orders,
      trades,
      fees,
      account,
      usdMode,
      lastAddress: contractAddress,
    }),
    [account, contractAddress, fees, orders, positions, trades, usdMode],
  );

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), notificationTimeoutMs);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!quoteError) return;
    const id = window.setTimeout(() => setQuoteError(""), notificationTimeoutMs);
    return () => window.clearTimeout(id);
  }, [quoteError]);

  useEffect(() => {
    if (!settingsOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => saveJson("mpt.positions", positions), [positions]);
  useEffect(() => saveJson("mpt.orders", orders), [orders]);
  useEffect(() => saveJson("mpt.trades", trades), [trades]);
  useEffect(() => saveJson("mpt.fees", fees), [fees]);
  useEffect(() => saveJson("mpt.account", account), [account]);
  useEffect(() => saveJson("mpt.usdMode", usdMode), [usdMode]);
  useEffect(() => saveJson("mpt.lastAddress", contractAddress), [contractAddress]);

  useEffect(() => {
    let cancelled = false;

    const hydrateCloudState = async () => {
      try {
        setSyncStatus("connecting");
        setSyncMessage("Connecting DB");
        const result = await loadCloudState(loadLocalState());
        if (cancelled) return;

        cloudReadyRef.current = true;
        setCloudUserId(result.userId);
        setPositions(result.state.positions);
        setOrders(result.state.orders);
        setTrades(result.state.trades);
        setFees(result.state.fees);
        setAccount(result.state.account);
        setCapitalInput(result.state.account.startingCapitalSol);
        setUsdMode(result.state.usdMode);
        setContractAddress(result.state.lastAddress);
        setSyncStatus("synced");
        setSyncMessage(result.migrated ? "DB synced from local" : "DB synced");
      } catch (error) {
        if (cancelled) return;
        cloudReadyRef.current = false;
        const message = error instanceof Error ? error.message : "Sign in to sync DB";
        setSyncStatus("local");
        setSyncMessage(message === "Sign in to sync DB" ? message : `DB unavailable: ${message}`);
        setLoginFeedback("");
      }
    };

    hydrateCloudState();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const hydrateAfterAuth = async () => {
    const result = await loadCloudState(loadLocalState());
    cloudReadyRef.current = true;
    setCloudUserId(result.userId);
    setPositions(result.state.positions);
    setOrders(result.state.orders);
    setTrades(result.state.trades);
    setFees(result.state.fees);
    setAccount(result.state.account);
    setCapitalInput(result.state.account.startingCapitalSol);
    setUsdMode(result.state.usdMode);
    setContractAddress(result.state.lastAddress);
    setSyncStatus("synced");
    setSyncMessage(result.migrated ? "DB synced from local" : "DB synced");
  };

  const signInWithPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!loginEmail.trim() || !loginPassword) return;

    setAuthBusy(true);
    try {
      await signInCloud(loginEmail.trim(), loginPassword);
      await hydrateAfterAuth();
      setLoginFeedback("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login error";
      setSyncStatus("error");
      setSyncMessage(`Login error: ${message}`);
      setLoginFeedback(`Login failed: ${message}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const createAccount = async () => {
    if (!loginEmail.trim() || !loginPassword) return;

    setAuthBusy(true);
    try {
      const result = await signUpCloud(loginEmail.trim(), loginPassword);
      if (result.session) {
        await hydrateAfterAuth();
        setLoginFeedback("");
      } else {
        setSyncStatus("sent");
        setSyncMessage("Confirm email before login");
        setLoginFeedback("Account created. Please confirm your email once, then come back and press Login.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Create account error";
      setSyncStatus("error");
      setSyncMessage(`Signup error: ${message}`);
      setLoginFeedback(`Create account failed: ${message}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const signOutFromCloud = async () => {
    setAuthBusy(true);
    try {
      await signOutCloud();
      cloudReadyRef.current = false;
      setCloudUserId("");
      setSyncStatus("local");
      setSyncMessage("Signed out");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(error instanceof Error ? `Logout error: ${error.message}` : "Logout error");
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    if (!cloudReadyRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);

    setSyncStatus("saving");
    setSyncMessage("DB saving");
    saveTimerRef.current = window.setTimeout(() => {
      saveCloudState(paperTradeState)
        .then((userId) => {
          setCloudUserId(userId);
          setSyncStatus("synced");
          setSyncMessage("DB synced");
        })
        .catch((error) => {
          setSyncStatus("error");
          setSyncMessage(error instanceof Error ? `DB error: ${error.message}` : "DB error");
        });
    }, 500);
  }, [paperTradeState]);

  const refreshSol = useCallback(async () => {
    const next = await fetchSolUsd();
    if (next) setSolUsd(next);
  }, []);

  const storeQuote = useCallback((next: TokenQuote) => {
    setQuotesByAddress((current) => ({ ...current, [next.address]: next }));
    setQuote((current) => (current?.address === next.address ? next : current));
  }, []);

  const refreshQuote = useCallback(
    async (address = contractAddress) => {
      if (!address.trim()) return;
      setLoadingQuote(true);
      setQuoteError("");
      try {
        const next = await fetchTokenQuote(address, solUsd ?? undefined);
        const nextMarketCap = currentMarketCapUsd(next);
        setQuote(next);
        setQuotesByAddress((current) => ({ ...current, [next.address]: next }));
        setContractAddress(next.address);
        if (nextMarketCap) {
          setLimitBuyMarketCapUsd(nextMarketCap);
          setLimitSellMarketCapUsd(nextMarketCap);
        }
      } catch (error) {
        setQuoteError(error instanceof Error ? error.message : "Không lấy được giá token.");
      } finally {
        setLoadingQuote(false);
      }
    },
    [contractAddress, solUsd],
  );

  useEffect(() => {
    refreshSol();
    const id = window.setInterval(refreshSol, 30000);
    return () => window.clearInterval(id);
  }, [refreshSol]);

  useEffect(() => {
    if (!cloudUserId || trackedTokenAddresses.length === 0) return;
    let cancelled = false;

    const refreshTrackedQuotes = async () => {
      const results = await Promise.allSettled(
        trackedTokenAddresses.map((address) => fetchTokenQuote(address, solUsd ?? undefined)),
      );
      if (cancelled) return;

      results.forEach((result) => {
        if (result.status === "fulfilled") storeQuote(result.value);
      });
    };

    refreshTrackedQuotes();
    const id = window.setInterval(refreshTrackedQuotes, refreshIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [cloudUserId, solUsd, storeQuote, trackedTokenAddresses]);

  useEffect(() => {
    if (!quote) {
      setRefreshRemainingMs(refreshIntervalMs);
      return;
    }

    const tick = () => {
      const elapsed = Date.now() - quote.updatedAt;
      setRefreshRemainingMs(Math.max(0, refreshIntervalMs - elapsed));
    };

    tick();
    const id = window.setInterval(tick, 120);
    return () => window.clearInterval(id);
  }, [quote]);

  useEffect(() => {
    if (!cloudUserId || initialLoadRef.current || !contractAddress.trim()) return;
    initialLoadRef.current = true;
    refreshQuote(contractAddress);
  }, [cloudUserId, contractAddress, refreshQuote]);

  useEffect(() => {
    if (fillLockRef.current) return;
    const fillable = openOrders
      .map((order) => ({ order, orderQuote: quotesByAddress[order.tokenAddress] }))
      .filter(
        (item): item is { order: LimitOrder; orderQuote: TokenQuote } =>
          Boolean(item.orderQuote) && shouldFill(item.order, item.orderQuote),
      );
    if (fillable.length === 0) return;

    fillLockRef.current = true;
    let nextPositions = positions;
    let nextCashSol = account.cashSol;
    const nextTrades: TradeEvent[] = [];
    const filledIds = new Set<string>();
    const fillMarketPrices = new Map<string, number>();

    for (const { order, orderQuote } of fillable) {
      try {
        const fillPrice = executionPriceFor(order.side, orderQuote.priceSol, order.limitPriceSol, fees);
        if (order.side === "buy" && order.capitalSol) {
          const buyFees = { ...fees, bribeSol: order.reservedFeesSol ?? totalFees(fees), txFeeSol: 0 };
          const result = applyBuy(nextPositions, orderQuote, order.capitalSol, fillPrice, buyFees, "limit");
          nextPositions = result.positions;
          nextTrades.push(result.trade);
          filledIds.add(order.id);
          fillMarketPrices.set(order.id, orderQuote.priceSol);
        }

        if (order.side === "sell" && order.sellPercent) {
          const result = applySell(nextPositions, orderQuote, order.sellPercent, fillPrice, fees, "limit");
          nextPositions = result.positions;
          nextTrades.push(result.trade);
          nextCashSol += result.trade.grossSol - result.trade.feesSol;
          filledIds.add(order.id);
          fillMarketPrices.set(order.id, orderQuote.priceSol);
        }
      } catch {
        // A stale sell limit can become impossible if the position was closed by another order.
      }
    }

    if (filledIds.size) {
      setPositions(nextPositions);
      setAccount((current) => ({ ...current, cashSol: nextCashSol }));
      setTrades((current) => [...nextTrades, ...current].slice(0, 80));
      setOrders((current) =>
        current.map((order) =>
          filledIds.has(order.id)
            ? { ...order, status: "filled", filledAt: Date.now(), fillPriceSol: fillMarketPrices.get(order.id) ?? order.fillPriceSol }
            : order,
        ),
      );
      setNotice(`${filledIds.size} limit order vừa được fill.`);
    }
    window.setTimeout(() => {
      fillLockRef.current = false;
    }, 0);
  }, [account.cashSol, fees, openOrders, positions, quotesByAddress]);

  useEffect(() => {
    if (!quote || sellSizingMode !== "percent") return;
    const limitSellPrice = marketCapToPriceSol(limitSellMarketCapUsd, quote);
    setLimitSellValue((selectedTotals.tokenAmount * limitSellPrice * limitSellPercent) / 100);
  }, [limitSellMarketCapUsd, limitSellPercent, quote, selectedTotals.tokenAmount, sellSizingMode]);

  const loadToken = (event: FormEvent) => {
    event.preventDefault();
    refreshQuote();
  };

  const marketBuy = () => {
    if (!quote) return;
    const requiredSol = buyCapital + currentOrderFeesSol;
    if (account.cashSol < requiredSol) {
      setNotice(`Không đủ cash: cần ${fmtSol(requiredSol)}, còn ${fmtSol(account.cashSol)}.`);
      return;
    }
    const fillPrice = executionPriceFor("buy", quote.priceSol, null, fees);
    const result = applyBuy(positions, quote, buyCapital, fillPrice, fees, "market");
    setPositions(result.positions);
    setAccount((current) => ({ ...current, cashSol: current.cashSol - requiredSol }));
    setTrades((current) => [result.trade, ...current].slice(0, 80));
    setNotice(`Market buy ${quote.symbol} filled at ${fmtSol(fillPrice)}.`);
  };

  const marketSell = () => {
    if (!quote) return;
    const fillPrice = executionPriceFor("sell", quote.priceSol, null, fees);
    const result = applySell(positions, quote, sellPercent, fillPrice, fees, "market");
    setPositions(result.positions);
    setAccount((current) => ({ ...current, cashSol: current.cashSol + result.trade.grossSol - result.trade.feesSol }));
    setTrades((current) => [result.trade, ...current].slice(0, 80));
    setNotice(`Market sell ${fmtPct(sellPercent)} ${quote.symbol} filled.`);
  };

  const placeLimitBuy = () => {
    const limitBuyPrice = marketCapToPriceSol(limitBuyMarketCapUsd, quote);
    if (!quote || limitBuyMarketCapUsd <= 0 || limitBuyPrice <= 0 || limitBuyCapital <= 0) return;
    const reservedSolForOrder = limitBuyCapital + currentOrderFeesSol;
    if (account.cashSol < reservedSolForOrder) {
      setNotice(`Không đủ cash để giữ limit buy: cần ${fmtSol(reservedSolForOrder)}, còn ${fmtSol(account.cashSol)}.`);
      return;
    }
    const order: LimitOrder = {
      id: uid(),
      tokenAddress: quote.address,
      tokenSymbol: quote.symbol,
      side: "buy",
      limitPriceSol: limitBuyPrice,
      limitMarketCapUsd: limitBuyMarketCapUsd,
      capitalSol: limitBuyCapital,
      reservedSol: reservedSolForOrder,
      reservedFeesSol: currentOrderFeesSol,
      status: "open",
      createdAt: Date.now(),
    };
    setOrders((current) => [order, ...current]);
    setAccount((current) => ({ ...current, cashSol: current.cashSol - reservedSolForOrder }));
    setNotice(`Limit buy ${quote.symbol} set at MC ${fmtCompactUsd(limitBuyMarketCapUsd)}.`);
  };

  const placeLimitSell = () => {
    const limitSellPrice = marketCapToPriceSol(limitSellMarketCapUsd, quote);
    if (!quote || limitSellMarketCapUsd <= 0 || limitSellPrice <= 0 || selectedTotals.tokenAmount <= 0) return;
    const positionValueAtLimit = selectedTotals.tokenAmount * limitSellPrice;
    const percent = sellSizingMode === "value" && positionValueAtLimit > 0 ? (limitSellValue / positionValueAtLimit) * 100 : limitSellPercent;
    const safePercent = Math.min(100, Math.max(0, percent));
    if (safePercent <= 0) return;
    const order: LimitOrder = {
      id: uid(),
      tokenAddress: quote.address,
      tokenSymbol: quote.symbol,
      side: "sell",
      limitPriceSol: limitSellPrice,
      limitMarketCapUsd: limitSellMarketCapUsd,
      sellPercent: safePercent,
      status: "open",
      createdAt: Date.now(),
      note: `MC ${fmtCompactUsd(limitSellMarketCapUsd)} / value ${fmtSol((positionValueAtLimit * safePercent) / 100)}`,
    };
    setOrders((current) => [order, ...current]);
    setLimitSellPercent(safePercent);
    setNotice(`Limit sell ${fmtPct(safePercent)} ${quote.symbol} set at MC ${fmtCompactUsd(limitSellMarketCapUsd)}.`);
  };

  const cancelOrder = (id: string) => {
    const order = orders.find((current) => current.id === id);
    if (order?.status === "open" && order.side === "buy") {
      setAccount((current) => ({ ...current, cashSol: current.cashSol + (order.reservedSol ?? order.capitalSol ?? 0) }));
    }
    setOrders((current) => current.map((order) => (order.id === id ? { ...order, status: "cancelled" } : order)));
  };

  const closePosition = (position: Position) => {
    if (!quote || quote.address !== position.tokenAddress) {
      setContractAddress(position.tokenAddress);
      refreshQuote(position.tokenAddress);
      setNotice("Mình đã load coin này. Bấm Close 100% lần nữa sau khi giá hiện tại hiện lên.");
      return;
    }
    const fillPrice = executionPriceFor("sell", quote.priceSol, null, fees);
    const result = applySell(positions, quote, 100, fillPrice, fees, "market");
    setPositions(result.positions);
    setAccount((current) => ({ ...current, cashSol: current.cashSol + result.trade.grossSol - result.trade.feesSol }));
    setTrades((current) => [result.trade, ...current].slice(0, 80));
    setNotice(`Đã đóng 100% vị thế ${quote.symbol}.`);
  };

  const resetCapital = () => {
    const nextCapital = Math.max(0, capitalInput);
    setAccount({ startingCapitalSol: nextCapital, cashSol: nextCapital });
    setPositions([]);
    setOrders([]);
    setTrades([]);
    setNotice(`Vốn giả lập đã reset về ${fmtSol(nextCapital)}.`);
  };

  const resetJournal = () => {
    setPositions([]);
    setOrders([]);
    setTrades([]);
    setAccount((current) => ({ ...current, cashSol: current.startingCapitalSol }));
    setCapitalInput(account.startingCapitalSol);
    setQuote(null);
    setContractAddress("");
    setLimitBuyMarketCapUsd(0);
    setLimitSellMarketCapUsd(0);
    setLimitSellValue(0);
    setNotice("Paper journal đã reset.");
  };

  const quoteMarketCap = currentMarketCapUsd(quote);
  const limitBuyPrice = marketCapToPriceSol(limitBuyMarketCapUsd, quote);
  const limitSellPrice = marketCapToPriceSol(limitSellMarketCapUsd, quote);
  const currentMarketCapLine = quoteMarketCap ? `MC ${fmtCompactUsd(quoteMarketCap)}` : "Paste CA để load MC";
  const remainingMs = quote ? refreshRemainingMs : refreshIntervalMs;
  const progressRatio = Math.max(0, Math.min(1, remainingMs / refreshIntervalMs));
  const refreshRingRadius = 15;
  const circumference = 2 * Math.PI * refreshRingRadius;
  // As remaining time falls, dashOffset grows, so the active stroke depletes from full to empty.
  const dashOffset = circumference * (1 - progressRatio);
  const refreshSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

  if (!cloudUserId) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div>
            <p className="eyebrow">Paper trade journal</p>
            <h1>Solana Meme Paper Trade</h1>
            <p className="login-copy">Login bằng email và password để đồng bộ vốn, vị thế, lệnh chờ và lịch sử fill trên database Supabase.</p>
          </div>

          <form className="login-form" onSubmit={signInWithPassword}>
            <label htmlFor="login-email">
              Email
              <input
                id="login-email"
                autoComplete="email"
                placeholder="you@example.com"
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
              />
            </label>
            <label htmlFor="login-password">
              Password
              <input
                id="login-password"
                autoComplete="current-password"
                minLength={6}
                placeholder="At least 6 characters"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
            </label>
            <button type="submit" disabled={authBusy || !loginEmail.trim() || !loginPassword}>
              {authBusy ? "Working..." : "Login"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={authBusy || !loginEmail.trim() || loginPassword.length < 6}
              onClick={createAccount}
            >
              Create account
            </button>
          </form>

          {loginFeedback ? <p className={`login-status ${syncStatus}`}>{loginFeedback}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Solana Meme Paper Trade</h1>
          <p>Tập vào/ra lệnh bằng SOL, có slippage, fee và PnL theo từng vị thế.</p>
        </div>
      </header>

      <div className={settingsOpen ? "settings-bubble open" : "settings-bubble"}>
        <div className="settings-menu" id="settings-menu" aria-hidden={!settingsOpen}>
          <div className="settings-menu-heading">
            <span>Settings</span>
            <small>Account & display</small>
          </div>
          <div className="currency-switch" aria-label="Display currency">
            <button type="button" className={usdMode ? "active" : ""} aria-pressed={usdMode} onClick={() => setUsdMode(true)}>
              USD
            </button>
            <button type="button" className={!usdMode ? "active" : ""} aria-pressed={!usdMode} onClick={() => setUsdMode(false)}>
              SOL
            </button>
          </div>
          <button type="button" className="ghost danger" onClick={resetJournal}>Reset</button>
          <button type="button" className="ghost logout-button" disabled={authBusy} onClick={signOutFromCloud}>Logout</button>
        </div>
        <button
          type="button"
          className="settings-trigger"
          aria-controls="settings-menu"
          aria-expanded={settingsOpen}
          aria-label={settingsOpen ? "Đóng settings" : "Mở settings"}
          onClick={() => setSettingsOpen((current) => !current)}
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm8.2 4.9v-2.2l-2.1-.4a6.5 6.5 0 0 0-.8-1.8l1.2-1.8-1.6-1.6-1.8 1.2a6.5 6.5 0 0 0-1.8-.8L12.9 3h-2.2l-.4 2.1a6.5 6.5 0 0 0-1.8.8L6.7 4.7 5.1 6.3l1.2 1.8a6.5 6.5 0 0 0-.8 1.8l-2.1.4v2.2l2.1.4c.2.7.5 1.3.8 1.8l-1.2 1.8 1.6 1.6 1.8-1.2c.6.4 1.2.6 1.8.8l.4 2.1h2.2l.4-2.1c.7-.2 1.3-.5 1.8-.8l1.8 1.2 1.6-1.6-1.2-1.8c.4-.6.6-1.2.8-1.8l2.1-.4Z" />
          </svg>
        </button>
      </div>

      <form className="address-bar" onSubmit={loadToken}>
        <label htmlFor="contract-address">
          Contract address
          <input
            id="contract-address"
            name="contract-address"
            placeholder="Paste Solana CA..."
            value={contractAddress}
            onChange={(event) => setContractAddress(event.target.value)}
          />
        </label>
        <button type="submit" disabled={loadingQuote}>{loadingQuote ? "Loading..." : "Load price"}</button>
        <div className="price-ticker">
          <div className="ticker-copy">
            <span>{quote?.symbol ?? "Current MC"}</span>
            <strong>{currentMarketCapLine}</strong>
            <small>{quote ? `Updated ${dateLabel(quote.updatedAt)}` : "MC loading"}</small>
          </div>
          {quote ? (
            <span
              aria-label={`Còn ${refreshSeconds} giây trước lần cập nhật tiếp theo`}
              className="refresh-indicator"
              role="timer"
              title={`Refresh sau ${refreshSeconds}s`}
            >
              <svg aria-hidden="true" className="refresh-ring" focusable="false" viewBox="0 0 40 40">
                <circle className="refresh-ring-bg" cx="20" cy="20" r={refreshRingRadius} />
                <circle
                  className="refresh-ring-progress"
                  cx="20"
                  cy="20"
                  r={refreshRingRadius}
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
            </span>
          ) : null}
        </div>
      </form>

      {quoteError ? <div className="alert error">{quoteError}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <section className="capital-panel">
        <div className="capital-control">
          <NumberInput label="Tổng vốn giả lập" value={capitalInput} onChange={setCapitalInput} suffix="SOL" />
          <button type="button" className="ghost" onClick={resetCapital}>Reset capital</button>
        </div>
        <div className="capital-metrics">
          <div>
            <span>Cash available</span>
            <strong>{displayValue(account.cashSol)}</strong>
          </div>
          <div>
            <span>Reserved orders</span>
            <strong>{displayValue(reservedSol)}</strong>
          </div>
          <div>
            <span>Positions</span>
            <strong>{displayValue(totalPositionValueSol)}</strong>
          </div>
          <div>
            <span>Equity / PnL</span>
            <strong className={accountPnlSol >= 0 ? "positive" : "negative"}>{displayValue(equitySol)} / {displayValue(accountPnlSol)}</strong>
          </div>
        </div>
      </section>

      <section className="grid">
        <aside className="panel order-ticket">
          <div className="panel-heading">
            <h2>Order Ticket</h2>
            <span>{quote?.dexId ?? "DEX"}</span>
          </div>

          <div className="fee-box">
            <NumberInput label="Slippage giả lập" value={fees.slippagePct} onChange={(value) => setFees({ ...fees, slippagePct: value })} suffix="%" />
            <NumberInput label="Bribe fee" value={fees.bribeSol} onChange={(value) => setFees({ ...fees, bribeSol: value })} suffix="SOL" />
            <NumberInput label="Tx fee" value={fees.txFeeSol} onChange={(value) => setFees({ ...fees, txFeeSol: value })} suffix="SOL" />
          </div>

          <div className="ticket-section">
            <h3>Market</h3>
            <NumberInput label="Buy capital" value={buyCapital} onChange={setBuyCapital} suffix="SOL" />
            <button type="button" disabled={!quote || account.cashSol < buyCapital + currentOrderFeesSol} onClick={marketBuy}>Buy Market</button>
            <NumberInput label="Sell position" value={sellPercent} onChange={setSellPercent} suffix="%" />
            <button type="button" className="sell" disabled={!quote || selectedTotals.tokenAmount <= 0} onClick={marketSell}>Sell Market</button>
          </div>

          <div className="ticket-section">
            <h3>Limit Buy</h3>
            <NumberInput label="Limit market cap" value={limitBuyMarketCapUsd} onChange={setLimitBuyMarketCapUsd} suffix="USD MC" />
            <p className="preview">
              Current MC: {quoteMarketCap ? fmtCompactUsd(quoteMarketCap) : "n/a"} / implied price {limitBuyPrice ? fmtSol(limitBuyPrice) : "n/a"}
            </p>
            <NumberInput label="Capital" value={limitBuyCapital} onChange={setLimitBuyCapital} suffix="SOL" />
            <button type="button" disabled={!quote || !limitBuyPrice || account.cashSol < limitBuyCapital + currentOrderFeesSol} onClick={placeLimitBuy}>Place Limit Buy</button>
          </div>

          <div className="ticket-section">
            <h3>Limit Sell</h3>
            <NumberInput label="Limit market cap" value={limitSellMarketCapUsd} onChange={setLimitSellMarketCapUsd} suffix="USD MC" />
            <p className="preview">
              Current MC: {quoteMarketCap ? fmtCompactUsd(quoteMarketCap) : "n/a"} / implied price {limitSellPrice ? fmtSol(limitSellPrice) : "n/a"}
            </p>
            <div className="segmented">
              <button type="button" className={sellSizingMode === "percent" ? "active" : ""} onClick={() => setSellSizingMode("percent")}>By %</button>
              <button type="button" className={sellSizingMode === "value" ? "active" : ""} onClick={() => setSellSizingMode("value")}>By value</button>
            </div>
            {sellSizingMode === "percent" ? (
              <NumberInput label="Position to sell" value={limitSellPercent} onChange={setLimitSellPercent} suffix="%" />
            ) : (
              <NumberInput label="Value to sell" value={limitSellValue} onChange={setLimitSellValue} suffix="SOL" />
            )}
            <p className="preview">
              Est. sell value: {displayValue((selectedTotals.tokenAmount * limitSellPrice * (sellSizingMode === "value" && selectedTotals.tokenAmount * limitSellPrice > 0 ? Math.min(100, (limitSellValue / (selectedTotals.tokenAmount * limitSellPrice)) * 100) : limitSellPercent)) / 100)}
            </p>
            <button type="button" className="sell" disabled={!quote || !limitSellPrice || selectedTotals.tokenAmount <= 0} onClick={placeLimitSell}>Place Limit Sell</button>
          </div>
        </aside>

        <section className="panel positions-panel">
          <div className="panel-heading">
            <h2>Open Positions</h2>
            <span>{positions.length} vị thế</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Qty</th>
                  <th>Entry basis</th>
                  <th>Value</th>
                  <th>PnL</th>
                  <th>Lots</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr><td colSpan={7} className="empty">Chưa có vị thế. Paste CA và thử một market/limit buy.</td></tr>
                ) : (
                  positions.map((position) => {
                    const isSelected = quote?.address === position.tokenAddress;
                    const positionQuote = quotesByAddress[position.tokenAddress];
                    const current = positionQuote?.priceSol;
                    const totals = totalsForPosition(position, current);
                    return (
                      <tr key={position.tokenAddress} className={isSelected ? "selected-row" : ""}>
                        <td>
                          <button type="button" className="link-button" onClick={() => refreshQuote(position.tokenAddress)}>{position.tokenSymbol}</button>
                          <small>{position.tokenAddress.slice(0, 4)}...{position.tokenAddress.slice(-4)}</small>
                        </td>
                        <td>{fmt(totals.tokenAmount, 4)}</td>
                        <td>
                          {priceToMarketCapLabel(totals.avgEntrySol, positionQuote ?? null)}
                          {positionQuote ? <small>{fmtSol(totals.avgEntrySol)}</small> : null}
                        </td>
                        <td>{current ? displayValue(totals.marketValueSol) : "Load price"}</td>
                        <td>
                          {current ? (
                            <span className={totals.unrealizedPnlSol >= 0 ? "pnl positive" : "pnl negative"}>
                              {displayValue(totals.unrealizedPnlSol)} / {fmtPct(totals.pnlPct)}
                            </span>
                          ) : "n/a"}
                          <small>Realized {displayValue(totals.realizedPnlSol)}</small>
                        </td>
                        <td>{position.lots.length}</td>
                        <td><button type="button" className="ghost" onClick={() => closePosition(position)}>Close 100%</button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="panel-heading compact">
            <h2>Open Limit Orders</h2>
            <span>{openOrders.length} lệnh</span>
          </div>
          <div className="orders-list">
            {openOrders.length === 0 ? <p className="empty">Chưa có limit order đang chờ.</p> : openOrders.map((order) => (
              <div className="order-row" key={order.id}>
                <strong className={order.side === "buy" ? "buy-text" : "sell-text"}>{order.side.toUpperCase()} {order.tokenSymbol}</strong>
                <span>@ {orderLimitLabel(order, quotesByAddress[order.tokenAddress] ?? null)}</span>
                <span>{order.side === "buy" ? `${fmtSol(order.capitalSol ?? 0)} capital` : `${fmtPct(order.sellPercent ?? 0)} position`}</span>
                <small>{orderEntryNote(order, quotesByAddress[order.tokenAddress] ?? null)}</small>
                <button type="button" className="ghost" onClick={() => cancelOrder(order.id)}>Cancel</button>
              </div>
            ))}
          </div>
        </section>

        <aside className="panel detail-panel">
          <div className="panel-heading">
            <h2>{quote ? `${quote.symbol} Detail` : "Coin Detail"}</h2>
            <span>{quote?.liquidityUsd ? `Liq ${fmtUsd(quote.liquidityUsd)}` : "No chart"}</span>
          </div>

          <div className="stats">
            <div>
              <span>Current MC</span>
              <strong>{quoteMarketCap ? fmtCompactUsd(quoteMarketCap) : "--"}</strong>
              <small>{quote ? `${fmtSol(quote.priceSol)} / token` : "Price n/a"}</small>
            </div>
            <div>
              <span>Entry basis</span>
              <strong>{priceToMarketCapLabel(selectedTotals.avgEntrySol, quote)}</strong>
              <small>{fmtSol(selectedTotals.avgEntrySol)} / {selectedPosition?.lots.length ?? 0} buy lots</small>
            </div>
            <div>
              <span>Position value</span>
              <strong>{displayValue(selectedTotals.marketValueSol)}</strong>
              <small>{fmt(selectedTotals.tokenAmount, 4)} tokens</small>
            </div>
            <div>
              <span>Unrealized PnL</span>
              <strong className={selectedTotals.unrealizedPnlSol >= 0 ? "positive" : "negative"}>{displayValue(selectedTotals.unrealizedPnlSol)}</strong>
              <small>{fmtPct(selectedTotals.pnlPct)}</small>
            </div>
          </div>

          <h3>Buy Lots</h3>
          <div className="lots">
            {!selectedPosition || selectedPosition.lots.length === 0 ? <p className="empty">Load coin có vị thế để xem từng lệnh buy.</p> : selectedPosition.lots.map((lot) => (
              <div className="lot" key={lot.id}>
                <div>
                  <strong>{fmtSol(lot.capitalSol)}</strong>
                  <small>{dateLabel(lot.createdAt)}</small>
                </div>
                <div>
                  <span>Entry</span>
                  <strong>{priceToMarketCapLabel(lot.entryPriceSol, quote)}</strong>
                  <small>{fmtSol(lot.entryPriceSol)}</small>
                </div>
                <div>
                  <span>Basis</span>
                  <strong>{priceToMarketCapLabel(lot.costBasisSol / lot.tokenAmount, quote)}</strong>
                  <small>{fmtSol(lot.costBasisSol / lot.tokenAmount)}</small>
                </div>
              </div>
            ))}
          </div>

          <h3>Recent Fills</h3>
          <div className="fills">
            {trades.length === 0 ? <p className="empty">Fills sẽ hiện ở đây.</p> : trades.slice(0, 8).map((trade) => (
              <div className="fill" key={trade.id}>
                <strong className={trade.side === "buy" ? "buy-text" : "sell-text"}>{trade.side.toUpperCase()} {trade.tokenSymbol}</strong>
                <div>
                  <span>{priceToMarketCapLabel(trade.priceSol, quote?.address === trade.tokenAddress ? quote : null)}</span>
                  <small>{trade.type} / {dateLabel(trade.createdAt)}</small>
                </div>
                {trade.realizedPnlSol !== undefined ? <em className={trade.realizedPnlSol >= 0 ? "positive" : "negative"}>{displayValue(trade.realizedPnlSol)}</em> : null}
              </div>
            ))}
          </div>

          {quote?.url ? <a className="dex-link" href={quote.url} target="_blank" rel="noreferrer">Open pair on DEX Screener</a> : null}
        </aside>
      </section>
    </main>
  );
}

export default App;
