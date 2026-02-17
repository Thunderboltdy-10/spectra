"use client";

import { useEffect, useCallback, useState } from "react";
import Image from "next/image";
import { X, Copy, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
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

type ImageLightboxProps = {
  images: GeneratedImage[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
};

export function ImageLightbox({ images, initialIndex, isOpen, onClose }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.5, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.5, 0.5));
  }, []);

  const navigatePrev = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev > 0) {
        setZoom(1);
        setIsLoading(true);
        return prev - 1;
      }
      return prev;
    });
  }, []);

  const navigateNext = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev < images.length - 1) {
        setZoom(1);
        setIsLoading(true);
        return prev + 1;
      }
      return prev;
    });
  }, [images.length]);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setZoom(1);
      setIsLoading(true);
    }
  }, [isOpen, initialIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          navigatePrev();
          break;
        case "ArrowRight":
          navigateNext();
          break;
        case "+":
        case "=":
          handleZoomIn();
          break;
        case "-":
          handleZoomOut();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose, navigatePrev, navigateNext, handleZoomIn, handleZoomOut]);

  const currentImage = images[currentIndex];

  const handleCopy = useCallback(async () => {
    if (!currentImage) return;

    const imageUrl = currentImage.fullUrl || currentImage.imageUrl;
    if (!imageUrl) {
      toast.error("No image URL available");
      return;
    }

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      toast.success("Image copied to clipboard");
    } catch {
      toast.error("Failed to copy image");
    }
  }, [currentImage]);

  const handleDownload = useCallback(async () => {
    if (!currentImage) return;

    const imageUrl = currentImage.fullUrl || currentImage.imageUrl;
    if (!imageUrl) {
      toast.error("No image URL available");
      return;
    }

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai-image-${currentImage._id}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    } catch {
      toast.error("Failed to download image");
    }
  }, [currentImage]);

  if (!isOpen || !currentImage) return null;

  const imageUrl = currentImage.fullUrl || currentImage.imageUrl || currentImage.thumbnailUrl;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < images.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-black/90 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close lightbox"
      />

      <div className="relative z-10 flex h-full w-full flex-col">
        <div className="flex items-center justify-between border-b border-white/10 bg-black/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-white/70">
            <span>{currentIndex + 1} / {images.length}</span>
            <span className="text-white/30">|</span>
            <span className="text-xs">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              className="h-8 w-8 p-0 text-white/70 hover:text-white hover:bg-white/10"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              className="h-8 w-8 p-0 text-white/70 hover:text-white hover:bg-white/10"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="mx-2 h-4 w-px bg-white/20" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
            >
              <Copy className="h-4 w-4" />
              <span className="hidden sm:inline">Copy</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="h-8 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Download</span>
            </Button>
            <div className="mx-2 h-4 w-px bg-white/20" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 text-white/70 hover:text-white hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          {hasPrev && (
            <button
              type="button"
              onClick={navigatePrev}
              className="absolute left-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-sm transition hover:bg-black/70 hover:text-white"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          <div
            className="relative flex items-center justify-center transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }}
          >
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            )}
            {imageUrl && (
              <Image
                src={imageUrl}
                alt={currentImage.prompt}
                width={1200}
                height={1200}
                className="max-h-[calc(100vh-12rem)] max-w-[calc(100vw-8rem)] object-contain"
                onLoad={() => setIsLoading(false)}
                unoptimized
                priority
              />
            )}
          </div>

          {hasNext && (
            <button
              type="button"
              onClick={navigateNext}
              className="absolute right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-sm transition hover:bg-black/70 hover:text-white"
              aria-label="Next image"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        <div className="border-t border-white/10 bg-black/50 px-4 py-3">
          <p className="mx-auto max-w-3xl text-center text-sm text-white/70 line-clamp-2">
            {currentImage.prompt}
          </p>
          {currentImage.model && (
            <p className="mt-1 text-center text-xs text-white/40">
              Generated with {currentImage.model}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
