"use client";

import { useState } from "react";
import { Copy, Link2, Loader2 } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { LifeKey } from "@/components/ui/life-moments";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import type { ShareAccess } from "./use-share-access";

/*
 * A read-only link anyone can open, outside the school too. It is off until
 * the owner makes one; its full address is shown once, when it is made, and
 * a link Spectra made in one of the owner's runs can be copied again.
 */

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never expires" },
  { value: "7", label: "Expires in 7 days" },
  { value: "30", label: "Expires in 30 days" },
] as const;

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function ShareLink({ access }: { access: ShareAccess }) {
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]["value"]>("never");
  const [made, setMade] = useState<string | null>(null);
  const links = access.publicLinks;

  const make = async () => {
    const url = await access.createLink(expiry === "never" ? null : Number(expiry));
    if (url) setMade(url);
  };
  const copyMade = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made);
      toast.success("Public link copied.");
    } catch {
      toast.error("Could not copy the link. Select it and copy it yourself.");
    }
  };

  return (
    <section className="share-section" aria-labelledby="share-link-title">
      <h3 id="share-link-title" className="share-section-title">
        Anyone with a link
      </h3>
      <p className="share-quiet">
        {links.length
          ? "Anyone with one of these links can view a read-only copy. They cannot edit, comment or see your private context."
          : "Off. Make a link to let anyone view a read-only copy, even outside your school."}
      </p>

      {made ? (
        <div className="share-link-made">
          <input readOnly value={made} aria-label="The new link" onFocus={(event) => event.currentTarget.select()} />
          <Button variant="primary" size="sm" onClick={() => void copyMade()}>
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      ) : null}

      {links.length ? (
        <ul className="share-people">
          {links.map((link) => {
            const copying = access.busyKey === `link:copy:${link.linkId}`;
            const turningOff = access.busyKey === `link:${link.linkId}`;
            return (
              <li key={link.linkId} className="share-person">
                <LifeKey id={`public-link:${link.linkId}`} />
                <Link2 className="share-link-glyph size-4" aria-hidden />
                <div className="share-person-who">
                  <span className="share-person-name">Read-only link</span>
                  <span className="share-person-meta">
                    {link.madeBySpectra ? "Made by Spectra, " : `Made ${day.format(link.createdAt)}, `}
                    {link.expiresAt ? `expires ${day.format(link.expiresAt)}` : "never expires"}
                  </span>
                </div>
                <div className="share-person-actions">
                  {link.madeBySpectra ? (
                    <Button variant="ghost" size="sm" disabled={copying} onClick={() => void access.copySpectraLink(link)}>
                      {copying ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                      Copy link
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" disabled={turningOff} onClick={() => void access.revokeLink(link).then(() => setMade(null))}>
                    {turningOff ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Turn off
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="share-link-make">
        <SelectField layer="modal" ariaLabel="When the link expires" value={expiry} onChange={(next) => setExpiry(next as typeof expiry)} options={EXPIRY_OPTIONS} size="sm" triggerClassName="share-quiet-select" />
        <Button variant="secondary" size="sm" disabled={access.busyKey === "link:create"} onClick={() => void make()}>
          {access.busyKey === "link:create" ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          {links.length ? "Make another link" : "Make a link"}
        </Button>
      </div>
    </section>
  );
}
