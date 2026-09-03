import { supabase } from "@/integrations/supabase/client";

/**
 * Courier settlement auto-population and statement import.
 *
 * Every write goes through a controlled database function. Statement files are
 * parsed in the browser only to produce normalised rows; classification,
 * matching, idempotency and all financial effects happen in the database.
 */

export interface SettlementCandidate {
  shipment_id: string;
  shipment_number: string;
  order_id: string;
  order_number: string;
  provider_name: string;
  courier_account_name: string;
  consignment_id: string | null;
  status: string;
  expected_collected: number;
  collected_amount: number | null;
  expected_delivery_fee: number;
  booked_delivery_fee: number | null;
  expected_return_charge: number;
  expected_net: number;
  eligibility_reason: string;
  already_settled: boolean;
  settlement_reference: string | null;
}

export async function getSettlementCandidates(
  courierAccountId: string,
  limit = 100,
  offset = 0,
): Promise<SettlementCandidate[]> {
  const { data, error } = await supabase.rpc("settlement_candidate_shipments", {
    _courier_account_id: courierAccountId,
    _limit: limit,
    _offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as unknown as SettlementCandidate[];
}

export interface PopulateResult {
  added: number;
  already_present: number;
  skipped_other_settlement: number;
  details: { shipment_number: string; reason: string }[];
}

export async function populateSettlement(
  settlementId: string,
  limit = 200,
): Promise<PopulateResult> {
  const { data, error } = await supabase.rpc("populate_courier_settlement", {
    _settlement_id: settlementId,
    _limit: limit,
  });
  if (error) throw error;
  return data as unknown as PopulateResult;
}

/* ---------- Statement import ---------- */

export interface StatementRowInput {
  consignment_id?: string;
  merchant_order_reference?: string;
  provider_status?: string;
  collected_amount?: string;
  delivery_fee?: string;
  cod_fee?: string;
  return_charge?: string;
  other_charge?: string;
  net_amount?: string;
}

export interface StatementImport {
  id: string;
  courier_account_id: string;
  statement_reference: string;
  status: "draft" | "previewed" | "confirmed" | "cancelled";
  source_name: string | null;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  ambiguous_rows: number;
  duplicate_rows: number;
  invalid_rows: number;
  conflict_rows: number;
  applied_rows: number;
  confirmed_at: string | null;
  created_at: string;
}

export interface StatementRow {
  id: string;
  row_number: number;
  consignment_id: string | null;
  merchant_order_reference: string | null;
  collected_amount: number | null;
  delivery_fee: number | null;
  cod_fee: number | null;
  return_charge: number | null;
  other_charge: number | null;
  net_amount: number | null;
  match_status: string;
  match_note: string | null;
  applied_at: string | null;
}

export async function beginStatementImport(input: {
  courierAccountId: string;
  reference: string;
  sourceName?: string;
  settlementId?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<StatementImport> {
  const { data, error } = await supabase.rpc("begin_courier_statement_import", {
    _courier_account_id: input.courierAccountId,
    _statement_reference: input.reference,
    _source_name: input.sourceName ?? undefined,
    _period_start: input.periodStart ?? undefined,
    _period_end: input.periodEnd ?? undefined,
    _settlement_id: input.settlementId ?? undefined,
  } as never);
  if (error) throw error;
  return data as unknown as StatementImport;
}

export interface PreviewCounts {
  total: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  duplicate: number;
  invalid: number;
  conflict: number;
}

export async function stageStatementRows(
  importId: string,
  rows: StatementRowInput[],
): Promise<PreviewCounts> {
  const { data, error } = await supabase.rpc("stage_courier_statement_rows", {
    _import_id: importId,
    _rows: rows as never,
  });
  if (error) throw error;
  return data as unknown as PreviewCounts;
}

export async function getStatementRows(importId: string, limit = 200): Promise<StatementRow[]> {
  const { data, error } = await supabase
    .from("courier_statement_rows")
    .select(
      `id, row_number, consignment_id, merchant_order_reference, collected_amount,
       delivery_fee, cod_fee, return_charge, other_charge, net_amount,
       match_status, match_note, applied_at`,
    )
    .eq("import_id", importId)
    .order("row_number")
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as StatementRow[];
}

export interface ConfirmResult {
  applied: number;
  failed: number;
  discrepancies_created: number;
  errors: { row: number; error: string }[];
}

export async function confirmStatementImport(importId: string): Promise<ConfirmResult> {
  const { data, error } = await supabase.rpc("confirm_courier_statement_import", {
    _import_id: importId,
  });
  if (error) throw error;
  return data as unknown as ConfirmResult;
}

export async function getStatementImports(courierAccountId: string): Promise<StatementImport[]> {
  const { data, error } = await supabase
    .from("courier_statement_imports")
    .select(
      `id, courier_account_id, statement_reference, status, source_name, total_rows,
       matched_rows, unmatched_rows, ambiguous_rows, duplicate_rows, invalid_rows,
       conflict_rows, applied_rows, confirmed_at, created_at`,
    )
    .eq("courier_account_id", courierAccountId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as unknown as StatementImport[];
}

/* ---------- CSV parsing (browser side, normalisation only) ---------- */

/**
 * Header aliases seen on Bangladeshi courier payout statements. Unknown columns
 * are preserved in the raw row but never guessed into a financial field.
 */
const HEADER_MAP: Record<string, keyof StatementRowInput> = {
  consignment_id: "consignment_id",
  consignment: "consignment_id",
  "consignment id": "consignment_id",
  tracking_code: "consignment_id",
  "tracking code": "consignment_id",
  tracking_id: "consignment_id",
  invoice: "merchant_order_reference",
  invoice_id: "merchant_order_reference",
  merchant_order_id: "merchant_order_reference",
  "merchant order id": "merchant_order_reference",
  order_id: "merchant_order_reference",
  status: "provider_status",
  delivery_status: "provider_status",
  collected_amount: "collected_amount",
  "collected amount": "collected_amount",
  cod_amount: "collected_amount",
  "cod collected": "collected_amount",
  amount_collected: "collected_amount",
  delivery_charge: "delivery_fee",
  "delivery charge": "delivery_fee",
  delivery_fee: "delivery_fee",
  cod_charge: "cod_fee",
  "cod charge": "cod_fee",
  cod_fee: "cod_fee",
  return_charge: "return_charge",
  "return charge": "return_charge",
  other_charge: "other_charge",
  "other charge": "other_charge",
  adjustment: "other_charge",
  net_amount: "net_amount",
  "net amount": "net_amount",
  payable: "net_amount",
  payable_amount: "net_amount",
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export interface ParsedStatement {
  rows: StatementRowInput[];
  unknownHeaders: string[];
  recognisedHeaders: string[];
}

export function parseStatementCsv(text: string): ParsedStatement {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("The statement needs a header row and at least one line.");
  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  const mapped = headers.map((h) => HEADER_MAP[h] ?? HEADER_MAP[h.replace(/ /g, "_")]);
  const unknownHeaders = headers.filter((_, i) => !mapped[i]);
  const recognised = mapped.filter(Boolean) as string[];
  if (!recognised.includes("consignment_id") && !recognised.includes("merchant_order_reference")) {
    throw new Error(
      "The statement must contain a tracking/consignment column or a merchant order reference column.",
    );
  }

  const rows: StatementRowInput[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: StatementRowInput = {};
    mapped.forEach((key, i) => {
      if (!key) return;
      const raw = (cells[i] ?? "").replace(/[৳,]/g, "").trim();
      if (raw !== "") row[key] = raw;
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  if (rows.length === 0) throw new Error("No usable rows found in this statement.");
  return { rows, unknownHeaders, recognisedHeaders: recognised };
}
