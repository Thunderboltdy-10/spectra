"use client";

import { Toaster } from "sonner";
import { CommandPaletteProvider } from "@/components/command-palette";
import { ThemeProvider } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CommandPaletteProvider>
        {children}
        <Toaster theme="system" position="top-right" richColors />
      </CommandPaletteProvider>
    </ThemeProvider>
  );
}
