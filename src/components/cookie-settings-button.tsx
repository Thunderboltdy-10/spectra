"use client";

export function CookieSettingsButton() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new Event("ai-school:open-cookie-settings"))
      }
      className="mt-2 rounded-control border border-[var(--border-default)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
    >
      Manage cookie settings
    </button>
  );
}
