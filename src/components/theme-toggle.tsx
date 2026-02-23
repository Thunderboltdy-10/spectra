"use client";

import { useEffect, useState } from "react";
import { Contrast, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";

const HIGH_CONTRAST_STORAGE_KEY = "ai-school-high-contrast";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const [highContrast, setHighContrast] = useState(false);

  useEffect(() => {
    try {
      const next = window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === "1";
      setHighContrast(next);
      document.documentElement.classList.toggle("high-contrast", next);
    } catch {
      setHighContrast(false);
      document.documentElement.classList.remove("high-contrast");
    }
  }, []);

  function toggleHighContrast() {
    setHighContrast((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("high-contrast", next);
      try {
        if (next) {
          window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "1");
        } else {
          window.localStorage.removeItem(HIGH_CONTRAST_STORAGE_KEY);
        }
      } catch {
        // Ignore localStorage failures.
      }
      return next;
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={className}
          aria-label="Theme and contrast options"
          title="Theme and contrast options"
        >
          {highContrast ? <Contrast className="h-4 w-4" /> : theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => toggleTheme()}>
          {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleHighContrast()}>
          {highContrast ? "Disable high contrast" : "Enable high contrast"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
