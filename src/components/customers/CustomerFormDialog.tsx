import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeBdPhone, saveCustomer } from "@/lib/customers";
import type { Customer } from "@/types/customers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | null;
  onSaved?: (customer: Customer) => void;
}

/**
 * Identity editing only. Status, blocking and flags are deliberately not
 * editable here — they go through controlled, audited actions.
 */
export function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [primaryPhone, setPrimaryPhone] = useState("");
  const [secondaryPhone, setSecondaryPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(customer?.name ?? "");
    setPrimaryPhone(customer?.primary_phone ?? "");
    setSecondaryPhone(customer?.secondary_phone ?? "");
    setEmail(customer?.email ?? "");
  }, [open, customer]);

  const mutation = useMutation({
    mutationFn: () =>
      saveCustomer({
        ...(customer ? { id: customer.id } : {}),
        name: name.trim(),
        primaryPhone: primaryPhone.trim(),
        secondaryPhone: secondaryPhone.trim() || null,
        email: email.trim() || null,
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["customer", saved.id] });
      toast.success(customer ? "Customer updated" : "Customer created");
      onSaved?.(saved);
      onOpenChange(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save customer"),
  });

  const normalized = normalizeBdPhone(primaryPhone);
  const disabled = !name.trim() || !primaryPhone.trim() || mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{customer ? "Edit customer" : "New customer"}</DialogTitle>
          <DialogDescription>
            Phone numbers are normalized so the same person is never duplicated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[12.5px]">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12.5px]">Primary phone</Label>
            <Input
              value={primaryPhone}
              onChange={(e) => setPrimaryPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
              className="h-8 text-[13px]"
            />
            {normalized && normalized !== primaryPhone.trim() && (
              <p className="text-[11.5px] text-muted-foreground">Stored as {normalized}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12.5px]">Secondary phone</Label>
            <Input
              value={secondaryPhone}
              onChange={(e) => setSecondaryPhone(e.target.value)}
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12.5px]">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-8 text-[13px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
