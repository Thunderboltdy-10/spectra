"use client";

import { useEffect, useState } from "react";
import { Plus, Send } from "@/components/icons/glyph-icons";
import { SearchField } from "@/components/ui/search-field";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import { getAdministration, mutateAdministration } from "./api";
import { auditActionWords } from "./audit-words";
import {
  AdminButton,
  AdminDialog,
  AdminSectionHeader,
  ErrorPanel,
  formatCompact,
  formatRelative,
  LoadingPanel,
  MetricCard,
  SelectField,
  TallySheet,
  TextAreaField,
  TextField,
} from "./shared";

/*
 * The platform operator's two ways of keeping the schools in view (the
 * Platform page): messages from Spectra to every school, their admins or one
 * person, with who read them; and one school seen whole — who runs it, who is
 * in it, who is waiting to join and what its admins changed lately. Both
 * count and name; neither opens anyone's work.
 */

type Audience = "everyone" | "admins" | "person";
type SchoolOption = { schoolId: string; name: string; status: string };

type PlatformMessage = {
  key: string;
  title: string;
  body: string;
  audience: Audience;
  schools: number;
  schoolNames: string[];
  recipients: number;
  read: number;
  sentAt: number;
};

const AUDIENCE_WORDS: Record<Audience, string> = {
  everyone: "everyone",
  admins: "school admins",
  person: "one person",
};

/** A prefilled message, as "Message admins" on a school opens it. */
export type PlatformDraft = { audience: Audience; schoolIds: string[]; schoolName?: string };

export function PlatformMessagesSurface({ refreshKey, draft, onDraftUsed }: { refreshKey: number; draft?: PlatformDraft | null; onDraftUsed?: () => void }) {
  const [messages, setMessages] = useState<PlatformMessage[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sent, setSent] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setError("");
    void getAdministration<{ messages: PlatformMessage[] }>("platformMessages")
      .then((result) => live && setMessages(result.messages))
      .catch((cause) => live && setError(describeFailure(cause, { fallback: "Couldn’t read what Spectra has sent." }).message));
    return () => {
      live = false;
    };
  }, [refreshKey, attempt, sent]);

  useEffect(() => {
    if (draft) setOpen(true);
  }, [draft]);

  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="Messages from Spectra"
          count={messages ? messages.length : undefined}
          detail="Write to everyone at every school, to school admins only, or to one person. It lands in their notifications as from Spectra, and each school’s admins can see what was sent to their school."
          action={
            <AdminButton tone="primary" onClick={() => setOpen(true)}>
              <Plus size={13} />
              New message
            </AdminButton>
          }
        />
        {error ? (
          <ErrorPanel message={error} retry={() => setAttempt((value) => value + 1)} />
        ) : !messages ? (
          <LoadingPanel label="Reading what Spectra has sent" />
        ) : messages.length ? (
          <ul className="admin-ledger">
            {messages.map((message) => (
              <li key={message.key} className="admin-line">
                <span className="admin-line-main">
                  <strong>{message.title}</strong>
                  <span>
                    Sent {formatRelative(message.sentAt).toLowerCase()} to {AUDIENCE_WORDS[message.audience] ?? message.audience}
                    {message.audience === "person"
                      ? `, at ${message.schoolNames[0] ?? "their school"}`
                      : `, at ${message.schools === 1 ? (message.schoolNames[0] ?? "one school") : `${formatCompact(message.schools)} schools`}`}
                  </span>
                </span>
                <span className="admin-line-meta">
                  {formatCompact(message.read)} of {formatCompact(message.recipients)} read
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-ledger-empty">Nothing sent yet. A message reaches people in their notifications, marked as from Spectra.</p>
        )}
      </section>
      <PlatformMessageDialog
        open={open}
        draft={draft ?? null}
        onClose={() => {
          setOpen(false);
          onDraftUsed?.();
        }}
        onSent={() => setSent((value) => value + 1)}
      />
    </div>
  );
}

function PlatformMessageDialog({ open, draft, onClose, onSent }: { open: boolean; draft: PlatformDraft | null; onClose: () => void; onSent: () => void }) {
  const [audience, setAudience] = useState<Audience>("everyone");
  const [where, setWhere] = useState<"all" | "some">("all");
  const [schoolIds, setSchoolIds] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [schools, setSchools] = useState<SchoolOption[] | null>(null);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAudience(draft?.audience ?? "everyone");
    setWhere(draft?.schoolIds.length ? "some" : "all");
    setSchoolIds(draft?.schoolIds ?? []);
    setEmail("");
    setSearch("");
  }, [draft, open]);

  useEffect(() => {
    if (!open || where !== "some" || schools) return;
    let live = true;
    void getAdministration<{ schools: SchoolOption[] }>("schoolDirectory", { search: "" })
      .then((result) => live && setSchools(result.schools.filter((school) => school.status === "active")))
      .catch(() => live && setSchools([]));
    return () => {
      live = false;
    };
  }, [open, schools, where]);

  const needle = search.trim().toLowerCase();
  const shown = (schools ?? []).filter((school) => !needle || school.name.toLowerCase().includes(needle)).slice(0, 60);
  const ready =
    title.trim().length > 1 &&
    body.trim().length > 1 &&
    (audience === "person" ? email.includes("@") : where === "all" || schoolIds.length > 0);

  async function send() {
    setSending(true);
    try {
      const result = await mutateAdministration<{ schools: number; recipients: number }>("sendPlatformMessage", {
        title,
        body,
        audience,
        schoolIds: audience !== "person" && where === "some" ? schoolIds : undefined,
        email: audience === "person" ? email.trim() : undefined,
      });
      toast.success(
        result.recipients === 1
          ? "Message sent."
          : `Message sent to ${formatCompact(result.recipients)} people at ${result.schools === 1 ? "one school" : `${formatCompact(result.schools)} schools`}.`,
      );
      setTitle("");
      setBody("");
      onSent();
      onClose();
    } catch (error) {
      toast.error(humanizePublicFailure(error ?? "The message wasn’t sent."));
    } finally {
      setSending(false);
    }
  }

  return (
    <AdminDialog
      open={open}
      onClose={() => !sending && onClose()}
      title={draft?.schoolName ? `Message ${draft.schoolName}` : "New message from Spectra"}
      detail="People read it in their notifications, marked as from Spectra. It is recorded in each school’s activity log."
      footer={
        <>
          <AdminButton onClick={onClose} disabled={sending}>
            Cancel
          </AdminButton>
          <AdminButton tone="primary" disabled={!ready || sending} onClick={() => void send()}>
            <Send size={12} />
            Send
          </AdminButton>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Who receives it"
          value={audience}
          onChange={(value) => setAudience(value as Audience)}
          options={[
            { value: "everyone", label: "Everyone at the schools" },
            { value: "admins", label: "School admins only" },
            { value: "person", label: "One person" },
          ]}
        />
        {audience === "person" ? (
          <TextField label="Their email" value={email} onChange={setEmail} type="email" />
        ) : (
          <>
            <SelectField
              label="At which schools"
              value={where}
              onChange={(value) => setWhere(value as "all" | "some")}
              options={[
                { value: "all", label: "Every active school" },
                { value: "some", label: "Some schools" },
              ]}
            />
            {where === "some" ? (
              <div className="space-y-2">
                <SearchField value={search} onChange={setSearch} label="Find a school" placeholder="Find a school by name" />
                <div className="max-h-44 overflow-y-auto rounded-control border border-[var(--border-default)] p-2">
                  {schools === null ? (
                    <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">Reading the schools</p>
                  ) : shown.length ? (
                    shown.map((school) => (
                      <label key={school.schoolId} className="flex items-center gap-2 rounded-chip px-2 py-2 text-micro hover:bg-[var(--bg-secondary)]">
                        <input
                          type="checkbox"
                          checked={schoolIds.includes(school.schoolId)}
                          onChange={(event) =>
                            setSchoolIds((current) => (event.target.checked ? [...current, school.schoolId] : current.filter((id) => id !== school.schoolId)))
                          }
                        />
                        <span className="flex-1">{school.name}</span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">No active school matches that.</p>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
        <TextField label="Title" value={title} onChange={setTitle} />
        <TextAreaField label="Message" value={body} onChange={setBody} rows={6} />
      </div>
    </AdminDialog>
  );
}

type SchoolDetail = {
  schoolId: string;
  name: string;
  status: string;
  people: { student: number; teacher: number; school_admin: number; suspended: number; activeThisMonth: number };
  admins: Array<{ accountId: string; name: string; email: string; status: string; lastSeenAt?: number }>;
  invitations: { pending: number; expired: number; adminsInvited: number };
  messagesThisMonth: number;
  recentActions: Array<{ eventId: string; action: string; actor: string; targetType: string; createdAt: number }>;
};

/** One school, seen whole, from its row in Schools. */
export function SchoolDetailDialog({
  school,
  onClose,
  onMessageAdmins,
  onStepIn,
}: {
  school: { schoolId: string; name: string } | null;
  onClose: () => void;
  onMessageAdmins: (school: { schoolId: string; name: string }) => void;
  onStepIn: () => void;
}) {
  const [detail, setDetail] = useState<SchoolDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!school) return;
    let live = true;
    setDetail(null);
    setError("");
    void getAdministration<SchoolDetail>("schoolDetail", { schoolId: school.schoolId })
      .then((result) => live && setDetail(result))
      .catch((cause) => live && setError(describeFailure(cause, { fallback: "Couldn’t read this school." }).message));
    return () => {
      live = false;
    };
  }, [school, attempt]);

  const total = detail ? detail.people.student + detail.people.teacher + detail.people.school_admin : 0;
  return (
    <AdminDialog
      open={Boolean(school)}
      onClose={onClose}
      title={school?.name ?? "School"}
      detail="Who runs this school, who is in it and what its admins changed lately. Nobody’s artifact is opened to show it."
      footer={
        <>
          <AdminButton onClick={onStepIn}>Step in</AdminButton>
          <AdminButton tone="primary" disabled={!school} onClick={() => school && onMessageAdmins(school)}>
            <Send size={12} />
            Message its admins
          </AdminButton>
        </>
      }
    >
      {error ? (
        <ErrorPanel message={error} retry={() => setAttempt((value) => value + 1)} />
      ) : !detail ? (
        <LoadingPanel label="Reading the school" />
      ) : (
        <div className="space-y-6">
          <TallySheet>
            <MetricCard label="People" value={formatCompact(total)} detail={`${formatCompact(detail.people.student)} students, ${formatCompact(detail.people.teacher)} teachers`} />
            <MetricCard label="Active this month" value={formatCompact(detail.people.activeThisMonth)} detail={total ? `${Math.round((detail.people.activeThisMonth / total) * 100)}% of the school` : undefined} />
            <MetricCard
              label="Waiting to join"
              value={formatCompact(detail.invitations.pending)}
              detail={detail.invitations.expired ? `${formatCompact(detail.invitations.expired)} links ran out` : undefined}
            />
            <MetricCard label="School messages" value={formatCompact(detail.messagesThisMonth)} detail="sent this month" />
          </TallySheet>

          <section>
            <h3 className="mb-2 text-caption font-semibold">Admins</h3>
            {detail.admins.length ? (
              <ul className="admin-ledger">
                {detail.admins.map((admin) => (
                  <li key={admin.accountId} className="admin-line">
                    <span className="admin-line-main">
                      <strong>{admin.name}</strong>
                      <span>{admin.email}</span>
                    </span>
                    <span className="admin-line-meta" data-tone={admin.status !== "active" ? "attention" : undefined}>
                      {admin.status === "active" ? (admin.lastSeenAt ? `Seen ${formatRelative(admin.lastSeenAt).toLowerCase()}` : "Not signed in yet") : admin.status === "invited" ? "Invited" : "Suspended"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-ledger-empty">This school has no admin. Step in to invite one.</p>
            )}
            {detail.invitations.adminsInvited ? (
              <p className="mt-2 text-micro text-[var(--text-tertiary)]">
                {detail.invitations.adminsInvited === 1 ? "One more admin is" : `${detail.invitations.adminsInvited} more admins are`} invited and not joined yet.
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 text-caption font-semibold">What its admins changed lately</h3>
            {detail.recentActions.length ? (
              <ul className="admin-ledger">
                {detail.recentActions.map((event) => (
                  <li key={event.eventId} className="admin-line">
                    <span className="admin-line-main">
                      <strong>{auditActionWords(event.action)}</strong>
                      <span>{event.actor}</span>
                    </span>
                    <span className="admin-line-meta">{formatRelative(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-ledger-empty">No changes by its admins yet.</p>
            )}
          </section>
        </div>
      )}
    </AdminDialog>
  );
}
