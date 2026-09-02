import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { saveChannelCredentials } from "@/lib/stores.functions";
import type { ChannelCredentialStatus } from "@/types/stores";

interface Props {
  accountId: string;
  status: ChannelCredentialStatus | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Credentials are write-only from the browser: the user can replace them, but
 * no stored key or secret is ever sent back for display.
 */
export function ChannelCredentialsDialog({ accountId, status, open, onOpenChange, onSaved }: Props) {
  const save = useServerFn(saveChannelCredentials);
  const [siteUrl, setSiteUrl] = useState(status?.site_url ?? "");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          accountId,
          siteUrl: siteUrl.trim(),
          consumerKey: consumerKey.trim(),
          consumerSecret: consumerSecret.trim(),
          apiVersion: status?.api_version ?? "wc/v3",
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setConsumerKey("");
      setConsumerSecret("");
      onOpenChange(false);
      onSaved();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not save the credentials."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>WooCommerce credentials</DialogTitle>
          <DialogDescription>
            Stored server-side and never displayed again. Saving replaces the existing values.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="site-url">Store URL</Label>
            <Input
              id="site-url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://shop.example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ck">Consumer key</Label>
            <Input
              id="ck"
              value={consumerKey}
              onChange={(e) => setConsumerKey(e.target.value)}
              placeholder="ck_..."
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cs">Consumer secret</Label>
            <Input
              id="cs"
              type="password"
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
              placeholder="cs_..."
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              !siteUrl.trim() || !consumerKey.trim() || !consumerSecret.trim() || mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            Save credentials
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
