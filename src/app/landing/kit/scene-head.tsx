import type { ReactNode } from "react";
import { clock } from "../world/story";

/*
 * A section's words. The page is one evening, so each section is stamped
 * with the time it happens and whose it is, like an entry in a diary; the
 * line under it says what Spectra does there.
 */

export function SceneHead({
  id,
  at,
  who = "Henry",
  title,
  children,
  className,
}: {
  id: string;
  /** When it happens, in the story's evening. */
  at: number;
  who?: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={className ? `landing-head ${className}` : "landing-head"}>
      <p className="landing-when">
        <time dateTime={new Date(at).toISOString()}>{clock(at)}</time>
        <span>{who}</span>
      </p>
      <h2 id={id} className="landing-heading">
        {title}
      </h2>
      {children ? <p className="landing-lede">{children}</p> : null}
    </header>
  );
}
