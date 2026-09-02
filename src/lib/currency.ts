/**
 * Centralised money formatting for the Bangladesh MVP.
 * Amounts are always stored as plain numbers in the database; only the UI
 * formats them. Swap `ACTIVE_CURRENCY` for a workspace setting later.
 */

export interface CurrencyConfig {
  code: string;
  symbol: string;
  locale: string;
  fractionDigits: number;
}

export const BDT: CurrencyConfig = {
  code: "BDT",
  symbol: "৳",
  locale: "en-BD",
  fractionDigits: 2,
};

export const ACTIVE_CURRENCY = BDT;

/** `1250` -> `৳1,250.00`. Returns an em dash for null/undefined. */
export function formatMoney(
  amount: number | null | undefined,
  currency: CurrencyConfig = ACTIVE_CURRENCY,
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency.fractionDigits,
    maximumFractionDigits: currency.fractionDigits,
  }).format(amount);
  return `${currency.symbol}${formatted}`;
}

/** Parses user input into a number, or null when empty/invalid. */
export function parseMoney(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export const CURRENCY_SYMBOL = ACTIVE_CURRENCY.symbol;
