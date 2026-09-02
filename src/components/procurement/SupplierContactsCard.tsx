import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Star, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  deleteSupplierContact,
  getSupplierContacts,
  saveSupplierContact,
} from "@/lib/procurement";
import type { SupplierContact } from "@/types/procurement";

interface Draft {
  id?: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  is_primary: boolean;
  notes: string;
}

const EMPTY: Draft = { name: "", phone: "", email: "", role: "", is_primary: false, notes: "" };

export function SupplierContactsCard({
  supplierId,
  canManage,
}: {
  supplierId: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const contactsQuery = useQuery({
    queryKey: ["supplier-contacts", supplierId],
    queryFn: () => getSupplierContacts(supplierId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
    void qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: Draft) => {
      if (!values.name.trim()) throw new Error("Contact name is required.");
      await saveSupplierContact({
        ...(values.id ? { id: values.id } : {}),
        supplier_id: supplierId,
        name: values.name.trim(),
        phone: values.phone.trim() || null,
        email: values.email.trim() || null,
        role: values.role.trim() || null,
        is_primary: values.is_primary,
        notes: values.notes.trim() || null,
      });
    },
    onSuccess: () => {
      invalidate();
      setDraft(null);
      toast.success("Contact saved");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save contact."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSupplierContact(id),
    onSuccess: () => {
      invalidate();
      toast.success("Contact removed");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not remove."),
  });

  const toDraft = (c: SupplierContact): Draft => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    email: c.email ?? "",
    role: c.role ?? "",
    is_primary: c.is_primary,
    notes: c.notes ?? "",
  });

  const contacts = contactsQuery.data ?? [];

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Contacts</h2>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add contact
          </Button>
        )}
      </header>

      {contacts.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title="No contacts"
          description="Add the people you deal with at this supplier."
        />
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{c.name}</span>
                  {c.is_primary && (
                    <StatusBadge tone="info">
                      <Star className="mr-1 h-3 w-3" />
                      Primary
                    </StatusBadge>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground">
                  {[c.role, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                </p>
                {c.notes && <p className="mt-0.5 text-[12px] text-muted-foreground">{c.notes}</p>}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setDraft(toDraft(c))}
                    aria-label={`Edit ${c.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => deleteMutation.mutate(c.id)}
                    aria-label={`Remove ${c.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit contact" : "Add contact"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div>
                <Label htmlFor="c-name">Name *</Label>
                <Input
                  id="c-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="c-role">Role</Label>
                <Input
                  id="c-role"
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                  placeholder="Sales manager"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="c-phone">Phone</Label>
                  <Input
                    id="c-phone"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="c-email">Email</Label>
                  <Input
                    id="c-email"
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="c-notes">Notes</Label>
                <Input
                  id="c-notes"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={draft.is_primary}
                  onCheckedChange={(v) => setDraft({ ...draft, is_primary: v === true })}
                />
                Primary contact
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saveMutation.isPending}
              onClick={() => draft && saveMutation.mutate(draft)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
