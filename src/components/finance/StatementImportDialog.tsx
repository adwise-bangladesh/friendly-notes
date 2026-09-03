import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import {
  beginStatementImport,
  confirmStatementImport,
  getStatementRows,
  parseStatementCsv,
  stageStatementRows,
  type PreviewCounts,
  type StatementImport,
  type StatementRowInput,
} from "@/lib/settlement-import";

type Stage = "setup" | "preview" | "done";

const MAX_BYTES = 2 * 1024 * 1024;

const ROW_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  matched: "success",
  applied: "success",
  unmatched: "warning",
  ambiguous: "warning",
  duplicate: "neutral",
  invalid: "danger",
  conflict: "danger",
};

/**
 * Provider-aware courier statement import. Parsing happens in the browser to
 * normalise columns; matching, classification, idempotency and every financial
 * effect are decided by the controlled database functions.
 */
export function StatementImportDialog({
  open,
  onOpenChange,
  courierAccountId,
  courierAccountName,
  settlementId,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierAccountId: string;
  courierAccountName: string;
  settlementId: string;
  onApplied: () => void;
}) {
  const [stage, setStage] = useState<Stage>("setup");
  const [reference, setReference] = useState("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<StatementRowInput[]>([]);
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([]);
  const [batch, setBatch] = useState<StatementImport | null>(null);
  const [counts, setCounts] = useState<PreviewCounts | null>(null);
  const [result, setResult] = useState<{ applied: number; failed: number; discrepancies: number } | null>(
    null,
  );

  const { data: previewRows = [] } = useQuery({
    queryKey: ["statement-rows", batch?.id],
    queryFn: () => getStatementRows(batch!.id),
    enabled: stage === "preview" && !!batch,
  });

  const reset = () => {
    setStage("setup");
    setReference("");
    setFileName("");
    setRows([]);
    setUnknownHeaders([]);
    setBatch(null);
    setCounts(null);
    setResult(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("Statement files must be 2 MB or smaller.");
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      toast.error("Upload the courier statement as a CSV file.");
      return;
    }
    try {
      const parsed = parseStatementCsv(await file.text());
      setRows(parsed.rows);
      setUnknownHeaders(parsed.unknownHeaders);
      setFileName(file.name);
      if (!reference.trim()) setReference(file.name.replace(/\.csv$/i, ""));
      toast.success(`${parsed.rows.length} statement lines read`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read this statement");
    }
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const created = await beginStatementImport({
        courierAccountId,
        reference: reference.trim(),
        sourceName: fileName,
        settlementId,
      });
      const c = await stageStatementRows(created.id, rows);
      return { created, c };
    },
    onSuccess: ({ created, c }) => {
      setBatch(created);
      setCounts(c);
      setStage("preview");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not preview"),
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmStatementImport(batch!.id),
    onSuccess: (r) => {
      setResult({ applied: r.applied, failed: r.failed, discrepancies: r.discrepancies_created });
      setStage("done");
      onApplied();
      for (const err of r.errors.slice(0, 3)) toast.error(`Row ${err.row}: ${err.error}`);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not import"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Import courier statement</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {courierAccountName} · nothing is posted until you confirm the preview.
          </DialogDescription>
        </DialogHeader>

        {stage === "setup" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[12px]">Statement reference</Label>
              <Input
                className="h-9"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. PATHAO-PAYOUT-2026-09-01"
              />
              <p className="text-[11.5px] text-muted-foreground">
                A statement reference can only be confirmed once for this courier account.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Statement file (CSV, max 2 MB)</Label>
              <Input
                type="file"
                accept=".csv,text/csv"
                className="h-9"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <p className="text-[11.5px] text-muted-foreground">
                Recognised columns: consignment/tracking id, merchant order id, status, collected
                amount, delivery charge, COD charge, return charge, other charge, net payable.
              </p>
            </div>
            {rows.length > 0 && (
              <p className="text-[12.5px]">
                {rows.length} lines ready from <span className="font-medium">{fileName}</span>
                {unknownHeaders.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · ignored columns: {unknownHeaders.join(", ")}
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {stage === "preview" && counts && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Count label="Matched" value={counts.matched} />
              <Count label="Unmatched" value={counts.unmatched} />
              <Count label="Ambiguous" value={counts.ambiguous} />
              <Count label="Duplicate" value={counts.duplicate} />
              <Count label="Invalid" value={counts.invalid} />
              <Count label="Conflict" value={counts.conflict} />
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Confirming applies actual values to the {counts.matched} matched line
              {counts.matched === 1 ? "" : "s"} only. Every other line is kept on record with its
              reason.
            </p>
            <div className="max-h-72 overflow-y-auto rounded border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">#</th>
                    <th className="px-2 py-1.5 text-left font-medium">Tracking</th>
                    <th className="px-2 py-1.5 text-right font-medium">Collected</th>
                    <th className="px-2 py-1.5 text-right font-medium">Delivery</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net</th>
                    <th className="px-2 py-1.5 text-left font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-1 text-muted-foreground">{r.row_number}</td>
                      <td className="px-2 py-1">
                        {r.consignment_id ?? r.merchant_order_reference ?? "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.collected_amount === null ? "—" : formatMoney(Number(r.collected_amount))}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.delivery_fee === null ? "—" : formatMoney(Number(r.delivery_fee))}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.net_amount === null ? "—" : formatMoney(Number(r.net_amount))}
                      </td>
                      <td className="px-2 py-1">
                        <StatusBadge tone={ROW_TONE[r.match_status] ?? "neutral"}>
                          {r.match_status}
                        </StatusBadge>
                        {r.match_note && (
                          <div className="text-[11px] text-muted-foreground">{r.match_note}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stage === "done" && result && (
          <div className="space-y-2 text-[13px]">
            <p>
              Applied <span className="font-medium">{result.applied}</span> settlement lines.
              {result.failed > 0 && ` ${result.failed} line(s) could not be applied and are marked as conflicts.`}
            </p>
            <p className="text-muted-foreground">
              {result.discrepancies} difference{result.discrepancies === 1 ? "" : "s"} recorded for
              review. Re-importing this statement will not post the same money twice.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            {stage === "done" ? "Close" : "Cancel"}
          </Button>
          {stage === "setup" && (
            <Button
              size="sm"
              className="h-8"
              disabled={rows.length === 0 || !reference.trim() || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? "Checking…" : "Preview import"}
            </Button>
          )}
          {stage === "preview" && (
            <Button
              size="sm"
              className="h-8"
              disabled={!counts || counts.matched === 0 || confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              {confirmMutation.isPending
                ? "Applying…"
                : `Confirm ${counts?.matched ?? 0} matched line(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border p-2 text-center">
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
