import { supabase } from "@/integrations/supabase/client";

export const COMMERCE_BUCKET = "commerce-media";

/**
 * Uploads a commerce image and returns the storage path stored on the record.
 * The bucket is private; use `getMediaUrl` to render a short-lived signed URL.
 */
export async function uploadCommerceMedia(
  folder: string,
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(COMMERCE_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
}

export async function removeCommerceMedia(path: string): Promise<void> {
  if (!path || /^https?:\/\//.test(path)) return;
  await supabase.storage.from(COMMERCE_BUCKET).remove([path]);
}

/** Resolves a stored value (storage path or absolute URL) to a displayable URL. */
export async function getMediaUrl(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  const { data, error } = await supabase.storage
    .from(COMMERCE_BUCKET)
    .createSignedUrl(value, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}
