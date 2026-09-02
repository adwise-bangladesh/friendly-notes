import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/commerce/FormSection";
import {
  createLocation,
  isLocationCodeAvailable,
  setDefaultLocation,
  updateLocation,
} from "@/lib/inventory";
import type { EntityStatus } from "@/types/commerce";
import type { InventoryLocation } from "@/types/inventory";

export interface LocationFormState {
  mode: "create" | "edit";
  location?: InventoryLocation;
}

interface Props {
  state: LocationFormState | null;
  onClose: () => void;
}

const toCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);

export function LocationFormPanel({ state, onClose }: Props) {
  const qc = useQueryClient();
  const editing = state?.mode === "edit" ? state.location : undefined;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<EntityStatus>("active");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setName(editing?.name ?? "");
    setCode(editing?.code ?? "");
    setCodeTouched(!!editing);
    setDescription(editing?.description ?? "");
    setStatus(editing?.status ?? "active");
    setIsDefault(editing?.is_default ?? false);
    setError(null);
  }, [state, editing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const trimmedCode = (codeTouched ? code : toCode(name)).trim();
      if (!trimmedName) throw new Error("Location name is required.");
      if (!trimmedCode) throw new Error("Location code is required.");

      const available = await isLocationCodeAvailable(trimmedCode, editing?.id);
      if (!available) throw new Error(`The code "${trimmedCode}" is already used by another location.`);

      const payload = {
        name: trimmedName,
        code: trimmedCode,
        description: description.trim() || null,
        status,
      };

      const saved = editing
        ? await updateLocation(editing.id, payload)
        : await createLocation(payload);

      // Default is promoted through the database function so only one active
      // location can ever hold the flag.
      if (isDefault && status === "active" && !saved.is_default) {
        await setDefaultLocation(saved.id);
      } else if (!isDefault && saved.is_default) {
        await updateLocation(saved.id, { is_default: false });
      }
      return saved;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory-locations"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(editing ? "Location updated" : "Location created");
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not save this location.");
    },
  });

  return (
    <Sheet open={!!state} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-base">
            {editing ? "Edit Location" : "Add Location"}
          </SheetTitle>
          <SheetDescription className="text-[13px]">
            A location is a place that physically holds stock — a warehouse, a shop, or a partner
            hub.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <FormSection title="Details">
            <div className="space-y-1.5">
              <Label htmlFor="loc-name" className="text-[12px]">
                Name
              </Label>
              <Input
                id="loc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dhaka Main Warehouse"
                className="h-8 text-[13px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loc-code" className="text-[12px]">
                Code
              </Label>
              <Input
                id="loc-code"
                value={codeTouched ? code : toCode(name)}
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(toCode(e.target.value));
                }}
                placeholder="DHK-MAIN"
                className="h-8 font-mono text-[13px]"
              />
              <p className="text-[11.5px] text-muted-foreground">
                Short unique reference used on documents and reports.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loc-desc" className="text-[12px]">
                Description
              </Label>
              <Textarea
                id="loc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Address or a note about what this location is used for."
                className="text-[13px]"
              />
            </div>
          </FormSection>

          <FormSection title="Availability">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as EntityStatus)}>
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11.5px] text-muted-foreground">
                Archived locations keep their history but cannot receive new stock.
              </p>
            </div>

            <div className="flex items-center justify-between rounded border border-border px-3 py-2">
              <div className="pr-3">
                <p className="text-[13px] font-medium">Default location</p>
                <p className="text-[11.5px] text-muted-foreground">
                  Pre-selected when adding stock. Only one active location can be the default.
                </p>
              </div>
              <Switch
                checked={isDefault}
                disabled={status !== "active"}
                onCheckedChange={setIsDefault}
              />
            </div>
          </FormSection>

          {error && (
            <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {editing ? "Save changes" : "Create location"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
