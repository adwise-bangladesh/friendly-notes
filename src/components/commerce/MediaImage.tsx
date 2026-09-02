import { useQuery } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import { getMediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

interface MediaImageProps {
  path: string | null;
  alt: string;
  className?: string;
}

/** Renders an image stored in the private commerce-media bucket (signed URL). */
export function MediaImage({ path, alt, className }: MediaImageProps) {
  const { data: url } = useQuery({
    queryKey: ["media-url", path],
    queryFn: () => getMediaUrl(path),
    enabled: !!path,
    staleTime: 50 * 60 * 1000,
  });

  if (!path || !url) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded border border-border bg-muted text-muted-foreground",
          className,
        )}
        aria-hidden="true"
      >
        <ImageIcon className="h-3.5 w-3.5" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={cn("rounded border border-border object-cover", className)}
    />
  );
}
