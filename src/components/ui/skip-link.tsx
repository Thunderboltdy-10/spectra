"use client";

/** Use the shell's content landmark, with a fallback for standalone pages. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link sr-only focus:not-sr-only"
      onClick={(event) => {
        // Keep native fragment navigation and sequential keyboard focus.
        event.currentTarget.hash = document.getElementById("main-content")
          ? "main-content"
          : "page-content";
      }}
    >
      Skip to content
    </a>
  );
}
