import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { updateOrderAddress, updateOrderCustomer } from "@/lib/orders";
import type { OrderWithDetails } from "@/types/orders";

/**
 * Controlled corrections for customer identity and delivery address.
 *
 * The database rejects both once the order is operationally locked (stock
 * committed at handover, or a shipment past draft), so the dialog simply shows
 * the business error it returns instead of guessing the rule client-side.
 */
export function OrderCorrectionDialog({
  order,
  mode,
  open,
  onOpenChange,
}: {
  order: OrderWithDetails;
  mode: "customer" | "address";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const address = order.address;

  const [name, setName] = useState(order.customer_name);
  const [phone, setPhone] = useState(order.customer_phone);
  const [email, setEmail] = useState(order.customer_email ?? "");
  const [reason, setReason] = useState("");

  const [recipient, setRecipient] = useState(address?.recipient_name ?? order.customer_name);
  const [addrPhone, setAddrPhone] = useState(address?.phone ?? order.customer_phone);
  const [line, setLine] = useState(address?.address_line ?? "");
  const [area, setArea] = useState(address?.area ?? "");
  const [district, setDistrict] = useState(address?.district ?? "");
  const [division, setDivision] = useState(address?.division ?? "");
  const [postal, setPostal] = useState(address?.postal_code ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "customer") {
        await updateOrderCustomer({
          orderId: order.id,
          name,
          phone,
          email: email || null,
          reason: reason || null,
        });
        return;
      }
      await updateOrderAddress(order.id, {
        recipient_name: recipient,
        phone: addrPhone,
        address_line: line,
        area: area || null,
        district: district || null,
        division: division || null,
        postal_code: postal || null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      toast.success(mode === "customer" ? "Customer details corrected" : "Delivery address corrected");
      onOpenChange(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "The correction was rejected"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "customer" ? "Correct customer details" : "Correct delivery address"}
          </DialogTitle>
          <DialogDescription>
            Corrections are only possible until stock is handed to the courier.
          </DialogDescription>
        </DialogHeader>

        {mode === "customer" ? (
          <div className="space-y-3">
            <Field label="Name" value={name} onChange={setName} />
            <Field label="Phone" value={phone} onChange={setPhone} />
            <Field label="Email" value={email} onChange={setEmail} />
            <Field label="Correction reason" value={reason} onChange={setReason} />
            <p className="text-[11.5px] text-muted-foreground">
              A reason is required only when the correction moves this order to a different
              customer record. An order can never be moved to a blocked customer.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Recipient" value={recipient} onChange={setRecipient} />
            <Field label="Phone" value={addrPhone} onChange={setAddrPhone} />
            <Field label="Address" value={line} onChange={setLine} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Area" value={area} onChange={setArea} />
              <Field label="District" value={district} onChange={setDistrict} />
              <Field label="Division" value={division} onChange={setDivision} />
              <Field label="Postal code" value={postal} onChange={setPostal} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px]">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]" />
    </div>
  );
}
