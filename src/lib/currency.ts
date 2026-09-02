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

/**
 * Suppliers may invoice in a foreign currency, so procurement amounts carry
 * their own currency code. BDT keeps the familiar symbol; anything else is
 * shown with its ISO code so the number is never mistaken for taka.
 */
export function formatCurrencyAmount(
  amount: number | null | undefined,
  code: string | null | undefined,
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const currencyCode = (code ?? BDT.code).toUpperCase();
  if (currencyCode === BDT.code) return formatMoney(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currencyCode} ${formatted}`;
}

/** ISO codes offered for supplier purchasing. Bangladesh first. */
export const PROCUREMENT_CURRENCIES = ["BDT", "USD", "CNY", "EUR", "INR", "GBP"] as const;
