"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type GeneratedImage = {
  _id: string;
  prompt: string;
  fullUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  model?: string;
  createdAt: number;
};

async function readErrorMessage(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.error?.message === "string") return parsed.error.message;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Non-JSON responses (such as HTML error pages) should not be shown raw.
  }
  return fallback;
}

export default function ImagesPage() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/images");
        if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load images"));
        const data = (await res.json()) as { images: GeneratedImage[] };
        setImages(data.images ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load images");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleDelete(imageId: string) {
    try {
      const res = await fetch("/api/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete image"));
      setImages((prev) => prev.filter((img) => img._id !== imageId));
      toast.success("Image deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete image");
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="mb-5">
        <h1 className="font-display text-4xl tracking-tight">
          <ImagePlus className="mr-2 inline-block h-8 w-8" />
          Image Gallery
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          All images generated in your chats.
        </p>
      </section>

      {images.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">
          No generated images yet. Use Image mode in chat to create images.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image) => (
            <div
              key={image._id}
              className="group overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]"
            >
              <div className="relative aspect-square">
                {(image.fullUrl || image.thumbnailUrl || image.imageUrl) ? (
                  <Image
                    src={(image.fullUrl || image.thumbnailUrl || image.imageUrl)!}
                    alt={image.prompt}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)]">No preview</div>
                )}
              </div>
              <div className="p-3">
                <p className="line-clamp-2 text-xs text-[var(--text-secondary)]">{image.prompt}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-[var(--text-secondary)]">
                    {new Date(image.createdAt).toLocaleDateString()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-[var(--danger)] opacity-0 transition group-hover:opacity-100"
                    onClick={() => void handleDelete(image._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
