"use client";

import { Toaster } from "sonner";
import { CommandPaletteProvider } from "@/components/command-palette";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/context/sidebar-context";
import { PanelProvider } from "@/context/panel-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <PanelProvider>
          <CommandPaletteProvider>
            {children}
            <Toaster theme="system" position="top-right" richColors />
          </CommandPaletteProvider>
        </PanelProvider>
      </SidebarProvider>
    </ThemeProvider>
  );
}
