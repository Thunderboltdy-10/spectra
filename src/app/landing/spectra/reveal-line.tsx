import type { CSSProperties } from "react";

/*
 * A line of the page's few words. It is set once its scene has played, word
 * by word, each rising out of its own line box; the reader's eye follows the
 * words in, so there is never a block of text waiting to be read.
 */

export function RevealLine({
  text,
  on,
  as: Tag = "p",
  className,
  delay = 0,
}: {
  text: string;
  on: boolean;
  as?: "p" | "h2" | "h3" | "span";
  className?: string;
  /** How many words' worth to wait before the first. */
  delay?: number;
}) {
  return (
    <Tag className={["sp-line", className].filter(Boolean).join(" ")} data-on={on || undefined} aria-label={text}>
      {text.split(" ").map((word, index) => (
        <span key={index} className="sp-line-word" aria-hidden style={{ "--i": index + delay } as CSSProperties}>
          <span>{word}</span>
        </span>
      ))}
    </Tag>
  );
}
