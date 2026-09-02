import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROCUREMENT_CURRENCIES } from "@/lib/currency";
import { createSupplier, isSupplierCodeAvailable, updateSupplier } from "@/lib/procurement";
import { SUPPLIER_STATUSES, SUPPLIER_STATUS_LABELS } from "@/types/procurement";
import type { Supplier, SupplierStatus } from "@/types/procurement";

export type SupplierFormState =
  | { mode: "create" }
  | { mode: "edit"; supplier: Supplier };

interface Props {
  state: SupplierFormState | null;
  onClose: () => void;
  onSaved?: (supplier: Supplier) => void;
}

interface FormValues {
  name: string;
  supplier_code: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  default_currency: string;
  status: SupplierStatus;
  notes: string;
}

const EMPTY: FormValues = {
  name: "",
  supplier_code: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  country: "Bangladesh",
  default_currency: "BDT",
  status: "active",
  notes: "",
};

function toCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16);
}

export function SupplierFormPanel({ state, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setError(null);
    if (state.mode === "create") {
      setValues(EMPTY);
      setCodeTouched(false);
    } else {
      const s = state.supplier;
      setValues({
        name: s.name,
        supplier_code: s.supplier_code,
        contact_person: s.contact_person ?? "",
        phone: s.phone ?? "",
        email: s.email ?? "",
        address: s.address ?? "",
        city: s.city ?? "",
        country: s.country ?? "Bangladesh",
        default_currency: s.default_currency,
        status: s.status,
        notes: s.notes ?? "",
      });
      setCodeTouched(true);
    }
  }, [state]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const name = values.name.trim();
      const code = (codeTouched ? values.supplier_code : toCode(values.name)).trim();
      if (!name) throw new Error("Supplier name is required.");
      if (!code) throw new Error("Supplier code is required.");
      const available = await isSupplierCodeAvailable(
        code,
        state?.mode === "edit" ? state.supplier.id : undefined,
      );
      if (!available) throw new Error(`Supplier code "${code}" is already used.`);

      const payload = {
        name,
        supplier_code: code,
        contact_person: values.contact_person.trim() || null,
        phone: values.phone.trim() || null,
        email: values.email.trim() || null,
        address: values.address.trim() || null,
        city: values.city.trim() || null,
        country: values.country.trim() || "Bangladesh",
        default_currency: values.default_currency,
        status: values.status,
        notes: values.notes.trim() || null,
      };
      return state?.mode === "edit"
        ? updateSupplier(state.supplier.id, payload)
        : createSupplier(payload);
    },
    onSuccess: (supplier) => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      void qc.invalidateQueries({ queryKey: ["supplier", supplier.id] });
      toast.success(state?.mode === "edit" ? "Supplier updated" : "Supplier created");
      onSaved?.(supplier);
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save supplier."),
  });

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit supplier" : "New supplier"}</DialogTitle>
          <DialogDescription>
            Suppliers are never deleted. Archive one to keep its purchase history intact.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="sup-name">Supplier name *</Label>
            <Input
              id="sup-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Dhaka Trading House"
            />
          </div>
          <div>
            <Label htmlFor="sup-code">Supplier code *</Label>
            <Input
              id="sup-code"
              value={codeTouched ? values.supplier_code : toCode(values.name)}
              onChange={(e) => {
                setCodeTouched(true);
                set("supplier_code", e.target.value.toUpperCase());
              }}
              placeholder="DHK-TRADING"
              className="font-mono"
            />
          </div>
          <div>
            <Label htmlFor="sup-currency">Default currency</Label>
            <Select
              value={values.default_currency}
              onValueChange={(v) => set("default_currency", v)}
            >
              <SelectTrigger id="sup-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROCUREMENT_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="sup-person">Contact person</Label>
            <Input
              id="sup-person"
              value={values.contact_person}
              onChange={(e) => set("contact_person", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sup-phone">Phone</Label>
            <Input
              id="sup-phone"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="01XXXXXXXXX"
            />
          </div>
          <div>
            <Label htmlFor="sup-email">Email</Label>
            <Input
              id="sup-email"
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sup-status">Status</Label>
            <Select
              value={values.status}
              onValueChange={(v) => set("status", v as SupplierStatus)}
            >
              <SelectTrigger id="sup-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPLIER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SUPPLIER_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sup-address">Address</Label>
            <Input
              id="sup-address"
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="sup-city">City</Label>
            <Input id="sup-city" value={values.city} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="sup-country">Country</Label>
            <Input
              id="sup-country"
              value={values.country}
              onChange={(e) => set("country", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sup-notes">Internal notes</Label>
            <Textarea
              id="sup-notes"
              rows={2}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-[12.5px] text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
