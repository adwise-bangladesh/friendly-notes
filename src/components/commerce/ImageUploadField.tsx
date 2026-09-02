import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MediaImage } from "./MediaImage";
import { uploadCommerceMedia } from "@/lib/media";

interface ImageUploadFieldProps {
  label: string;
  hint?: string;
  folder: string;
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
  aspect?: "square" | "wide";
}

export function ImageUploadField({
  label,
  hint,
  folder,
  value,
  onChange,
  disabled,
  aspect = "square",
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be 10MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const path = await uploadCommerceMedia(folder, file);
      onChange(path);
      toast.success(`${label} uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-[12.5px]">{label}</Label>
      <div className="flex items-start gap-3">
        <MediaImage
          path={value}
          alt={label}
          className={aspect === "square" ? "h-14 w-14" : "h-14 w-24"}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-3.5 w-3.5" />
              )}
              {value ? "Replace" : "Upload"}
            </Button>
            {value && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || busy}
                onClick={() => onChange(null)}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
          {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
