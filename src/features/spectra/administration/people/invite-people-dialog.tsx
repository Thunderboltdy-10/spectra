"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Check, Copy, Loader2, Mail, Send, X } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import { mutateAdministration } from "../api";
import { ROLE_OPTIONS, readEmails, roleName, type SchoolRole } from "./people-model";

/*
 * Bringing people into the school: type or paste their school emails, say
 * whether they are students, teachers or admins, and send. Each address gets
 * its own single-use link by email; when an email cannot go out, the link is
 * shown here to pass on another way, since it is the only time it can be.
 */

type Outcome =
  | { email: string; state: "sent" }
  | { email: string; state: "manual"; url: string; reason?: string }
  | { email: string; state: "failed"; reason: string };

type InviteResult = {
  delivery: { status: "sent" | "skipped" | "failed"; reason?: string };
  manualInvitationUrl?: string;
};

export function InvitePeopleDialog({
  open,
  operatorSessionId,
  onClose,
  onInvited,
  again,
}: {
  open: boolean;
  operatorSessionId?: string;
  onClose: () => void;
  onInvited: () => void;
  /** Inviting someone again: their address and role, ready to send. */
  again?: { email: string; role: SchoolRole } | null;
}) {
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<SchoolRole>("student");
  const [sending, setSending] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [hint, setHint] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setEmails(again ? [again.email] : []);
    setDraft("");
    setRole(again?.role ?? "student");
    setOutcomes(null);
    setHint("");
    // `again` is read as the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Takes the addresses out of the text; what is not one stays to be fixed. */
  const take = (text: string) => {
    const found = readEmails(text);
    if (!found.length) return false;
    setEmails((current) => [...current, ...found.filter((email) => !current.includes(email))]);
    setDraft("");
    setHint("");
    return true;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === ";" || event.key === " " || event.key === "Tab") {
      if (!draft.trim()) {
        if (event.key === "Enter" && emails.length) {
          event.preventDefault();
          void send();
        }
        return;
      }
      if (take(draft)) event.preventDefault();
      else if (event.key !== "Tab") {
        event.preventDefault();
        setHint(`“${draft.trim()}” is not a full email address.`);
      }
    } else if (event.key === "Backspace" && !draft && emails.length) {
      setEmails((current) => current.slice(0, -1));
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (take(`${draft} ${event.clipboardData.getData("text")} `)) event.preventDefault();
  };

  async function send() {
    const pending = draft.trim() ? [...emails, ...readEmails(draft).filter((email) => !emails.includes(email))] : emails;
    if (!pending.length) {
      setHint("Add at least one email address.");
      return;
    }
    setSending(true);
    const results: Outcome[] = [];
    for (const email of pending) {
      try {
        const result = await mutateAdministration<InviteResult>("invite", { email, role, operatorSessionId });
        results.push(
          result.manualInvitationUrl
            ? { email, state: "manual", url: result.manualInvitationUrl, reason: result.delivery.reason }
            : { email, state: "sent" },
        );
      } catch (error) {
        results.push({ email, state: "failed", reason: humanizePublicFailure(error ?? "Could not invite them.") });
      }
    }
    setSending(false);
    setOutcomes(results);
    setEmails([]);
    setDraft("");
    if (results.some((outcome) => outcome.state !== "failed")) onInvited();
  }

  const count = emails.length + (draft.trim() ? readEmails(draft).length : 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !sending && onClose()}>
      <DialogContent className="invite-people max-w-[520px] gap-0 p-0">
        <header className="invite-people-head">
          <DialogTitle className="invite-people-title">{outcomes ? "Invitations" : "Invite people"}</DialogTitle>
          <DialogDescription className="invite-people-quiet">
            {outcomes
              ? "Each link works once, for the address it was sent to, and expires in 7 days."
              : "They get an email with a link to join your school. It works only for the address it was sent to."}
          </DialogDescription>
        </header>

        {outcomes ? (
          <InviteOutcomes outcomes={outcomes} />
        ) : (
          <div className="invite-people-body">
            <div className="invite-people-field" onClick={() => input.current?.focus()}>
              {emails.map((email) => (
                <span key={email} className="invite-people-email">
                  {email}
                  <button type="button" aria-label={`Remove ${email}`} onClick={() => setEmails((current) => current.filter((item) => item !== email))}>
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
              <input
                ref={input}
                autoFocus
                aria-label="School email addresses"
                aria-describedby="invite-people-hint"
                type="email"
                multiple
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setHint("");
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={() => draft.trim() && take(draft)}
                placeholder={emails.length ? "Add another" : "name@school.org, or paste a list"}
              />
            </div>
            <p id="invite-people-hint" className="invite-people-hint" data-problem={hint ? true : undefined} aria-live="polite">
              {hint || "Separate addresses with commas or new lines. A list copied from email works too."}
            </p>
            <div className="invite-people-role">
              <span>They join as</span>
              <Segmented label="They join as" value={role} onChange={setRole} options={ROLE_OPTIONS} />
            </div>
            {role === "school_admin" ? (
              <p className="invite-people-quiet">School admins can see this page, manage people and change school settings. They still cannot open anyone’s artifact.</p>
            ) : null}
          </div>
        )}

        <footer className="invite-people-foot">
          {outcomes ? (
            <>
              <Button variant="ghost" onClick={() => setOutcomes(null)}>
                Invite more
              </Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={sending} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={sending || !count} onClick={() => void send()}>
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {count > 1 ? `Invite ${count} ${role === "student" ? "students" : role === "teacher" ? "teachers" : "admins"}` : `Invite as ${roleName(role).toLowerCase()}`}
              </Button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function InviteOutcomes({ outcomes }: { outcomes: Outcome[] }) {
  const copy = (url: string) =>
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Invitation link copied."),
      () => toast.error("Copying was blocked. Select the link and copy it."),
    );
  return (
    <ul className="invite-people-body invite-people-outcomes">
      {outcomes.map((outcome) => (
        <li key={outcome.email} data-state={outcome.state}>
          {outcome.state === "sent" ? <Check className="size-4" aria-hidden /> : outcome.state === "manual" ? <Mail className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
          <div>
            <strong>{outcome.email}</strong>
            <span>
              {outcome.state === "sent"
                ? "Invitation emailed."
                : outcome.state === "manual"
                  ? "The email could not go out. Send them this link yourself; it is shown only now."
                  : outcome.reason}
            </span>
            {outcome.state === "manual" ? (
              <div className="invite-people-link">
                <input readOnly value={outcome.url} aria-label={`Invitation link for ${outcome.email}`} onFocus={(event) => event.currentTarget.select()} />
                <Button variant="secondary" size="sm" onClick={() => copy(outcome.url)}>
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
