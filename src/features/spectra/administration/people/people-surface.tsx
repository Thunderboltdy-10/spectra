"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, UserPlus } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OverflowMenu, type OverflowItem } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { LifeKey } from "@/components/ui/life-moments";
import { SearchField } from "@/components/ui/search-field";
import { SelectField } from "@/components/ui/select";
import { describeFailure } from "@/components/ui/truthful-state";
import { getAdministration } from "../api";
import { formatRelative } from "../shared";
import { InvitePeopleDialog } from "./invite-people-dialog";
import { MessageDialog } from "./message-dialog";
import { ROLE_OPTIONS, roleName, type Invitation, type Person, type SchoolRole } from "./people-model";

/*
 * The admin People tab: who is in the school, who has been invited and not
 * joined yet, and the way to invite more. One line per person, shown by
 * role; the role changes in place, and the rest (a message, suspending,
 * removing) is in each person's menu. Changes that take access away or give
 * admin power are asked first. Earlier invitations stay folded away.
 */

type Mutate = <T>(label: string, action: string, payload: Record<string, unknown>, success: string | null) => Promise<{ result: T } | null>;

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** A list read from the server: null until the first answer, kept through a failed refresh. */
function useServerList<T>(read: () => Promise<T[]>, deps: readonly unknown[], failure: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void read()
      .then((result) => active && setRows(result))
      .catch((cause) => active && setError(describeFailure(cause, { fallback: failure }).message));
    return () => {
      active = false;
    };
    // The caller names what the read depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { rows, error, retry: () => setAttempt((value) => value + 1) };
}

function useSchoolPeople(operatorSessionId: string | undefined, refreshKey: number) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  /* The search asks the server once typing settles, and the list stays on
     screen while it does; invitations do not depend on it. */
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const people = useServerList(
    () => getAdministration<{ people: Person[] }>("people", { operatorSessionId, search: query, limit: 500 }).then((result) => result.people),
    [operatorSessionId, refreshKey, query],
    "Couldn’t read the school’s members.",
  );
  const invitations = useServerList(
    () => getAdministration<{ invitations: Invitation[] }>("invitations", { operatorSessionId }).then((result) => result.invitations),
    [operatorSessionId, refreshKey],
    "Couldn’t read the invitations.",
  );
  return { search, setSearch, query, people, invitations };
}

/** A list that could not be read: what happened and the way to ask again, never "none". */
function ReadFailure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <p className="admin-people-quiet" role="alert">
      <AlertCircle className="size-3.5 text-[var(--danger)]" aria-hidden />
      {message}
      <button type="button" className="admin-link" onClick={retry}>
        Try again
      </button>
    </p>
  );
}

type Filter = "all" | "student" | "teacher" | "school_admin" | "away";

/** Who the list shows: everyone in the school, one role, or those suspended or gone. */
function inFilter(person: Person, filter: Filter) {
  const present = person.status === "active" || person.status === "invited";
  if (filter === "all") return present;
  if (filter === "away") return !present;
  return present && person.role === filter;
}

/** A change to someone's place in the school that has to be meant, so it is asked first. */
type Pending = {
  person: Person;
  patch: { role?: string; status?: string };
  title: string;
  detail: string;
  confirm: string;
  done: string;
  destructive?: boolean;
};

export function PeopleSurface({
  operatorSessionId,
  busy,
  mutate,
  refreshKey,
  onRefresh,
  readOnly = false,
}: {
  operatorSessionId?: string;
  busy: string;
  mutate: Mutate;
  refreshKey: number;
  onRefresh: () => void;
  /** An operator inspecting the school reads the lists and changes nothing. */
  readOnly?: boolean;
}) {
  const { search, setSearch, query, people, invitations } = useSchoolPeople(operatorSessionId, refreshKey);
  const [inviting, setInviting] = useState(false);
  const [again, setAgain] = useState<{ email: string; role: SchoolRole } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [writingTo, setWritingTo] = useState<Person | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const everyone = people.rows ?? [];
  const members = everyone.filter((person) => inFilter(person, filter));
  const waiting = (invitations.rows ?? []).filter((invite) => invite.status === "pending");
  const earlier = (invitations.rows ?? []).filter((invite) => invite.status !== "pending");
  const count = (value: Filter) => everyone.filter((person) => inFilter(person, value)).length;
  const inviteAgain = (invite: Invitation) => {
    setAgain({ email: invite.email, role: ROLE_OPTIONS.some((option) => option.value === invite.role) ? (invite.role as SchoolRole) : "student" });
    setInviting(true);
  };

  /** A role or status change: made at once when it is small, asked first when it gives or takes power. */
  const ask = (person: Person, next: { role?: string; status?: string }) => {
    const change = (done: string) =>
      void mutate(`member-${person.membershipId}`, "changeMember", { membershipId: person.membershipId, ...next }, done);
    if (next.role) {
      const done = `${person.name} is a ${roleName(next.role).toLowerCase()} now.`;
      if (next.role === "school_admin")
        return setPending({
          person,
          patch: next,
          done,
          title: `Make ${person.name} a school admin?`,
          detail: "They will be able to invite and remove people, message the school, change groups and settings, and read the school’s activity log. They still can’t open anyone’s work.",
          confirm: "Make admin",
        });
      if (person.role === "school_admin")
        return setPending({
          person,
          patch: next,
          done,
          title: `Remove ${person.name} as an admin?`,
          detail: `They stay in the school as a ${roleName(next.role).toLowerCase()} and lose the School admin page. The school always keeps at least one admin.`,
          confirm: "Remove as admin",
        });
      return change(done);
    }
    if (next.status === "suspended")
      return setPending({
        person,
        patch: next,
        done: `${person.name} is suspended.`,
        title: `Suspend ${person.name}?`,
        detail: "They can’t use the school until you restore them. Their work stays as it is; what was shared with them directly is taken back.",
        confirm: "Suspend",
        destructive: true,
      });
    if (next.status === "ended")
      return setPending({
        person,
        patch: next,
        done: `${person.name} is no longer in the school.`,
        title: `Remove ${person.name} from the school?`,
        detail: "They lose the school and everything shared through it. Their own work is kept. You can bring them back later.",
        confirm: "Remove from school",
        destructive: true,
      });
    return change(`${person.name} can use the school again.`);
  };

  return (
    <div className="admin-people">
      <div className="admin-people-bar">
        <SearchField value={search} onChange={setSearch} label="Find someone in the school" placeholder="Find someone by name or email" className="w-[320px] max-w-full" />
        <Button
          variant="primary"
          disabled={readOnly}
          title={readOnly ? "You are inspecting this school, so nobody can be invited from here." : undefined}
          onClick={() => {
            setAgain(null);
            setInviting(true);
          }}
        >
          <UserPlus className="size-4" />
          Invite people
        </Button>
      </div>

      <section className="admin-people-section" aria-labelledby="admin-members-title">
        <div className="admin-people-head">
          <h2 id="admin-members-title">
            Members <span>{people.rows ? count("all") : ""}</span>
          </h2>
          {people.rows ? (
            <Segmented
              label="Show"
              size="compact"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `Everyone ${count("all")}` },
                { value: "student", label: `Students ${count("student")}` },
                { value: "teacher", label: `Teachers ${count("teacher")}` },
                { value: "school_admin", label: `Admins ${count("school_admin")}` },
                { value: "away", label: `Suspended or removed ${count("away")}` },
              ]}
            />
          ) : null}
        </div>
        {people.error ? <ReadFailure message={people.error} retry={people.retry} /> : null}
        {!people.rows ? (
          people.error ? null : (
            <p className="admin-people-quiet" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading the school’s members
            </p>
          )
        ) : members.length === 0 ? (
          <p className="admin-people-quiet">
            {query
              ? `No one matches “${query}”.`
              : filter === "all"
                ? "No one has joined yet. Invite people to bring them in."
                : filter === "away"
                  ? "No one is suspended or removed."
                  : "No one with this role yet."}
          </p>
        ) : (
          <ul className="admin-people-list">
            {members.map((person) => (
              <MemberLine
                key={person.membershipId}
                person={person}
                busy={readOnly || busy === `member-${person.membershipId}`}
                onChange={(next) => ask(person, next)}
                onMessage={() => setWritingTo(person)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="admin-people-section" aria-labelledby="admin-waiting-title">
        <h2 id="admin-waiting-title">
          Waiting to join <span>{invitations.rows ? waiting.length : ""}</span>
        </h2>
        {invitations.error ? <ReadFailure message={invitations.error} retry={invitations.retry} /> : null}
        {!invitations.rows ? (
          invitations.error ? null : (
            <p className="admin-people-quiet" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading the invitations
            </p>
          )
        ) : waiting.length === 0 ? (
          <p className="admin-people-quiet">Everyone you invited has joined, or their invitation ended.</p>
        ) : (
          <ul className="admin-people-list">
            {waiting.map((invite) => {
              const lapsed = invite.expiresAt <= Date.now();
              return (
                <li key={invite.invitationId} className="admin-person" data-status={lapsed ? "ended" : undefined}>
                  <LifeKey id={`invitation:${invite.invitationId}`} />
                  <div className="admin-person-who">
                    <strong>{invite.email}</strong>
                    <span>
                      {roleName(invite.role)}, invited {day.format(invite.createdAt)},{" "}
                      {lapsed ? `link ran out ${day.format(invite.expiresAt)}` : `link works until ${day.format(invite.expiresAt)}`}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" disabled={readOnly} onClick={() => inviteAgain(invite)}>
                    Send again
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={readOnly || busy === `invite-${invite.invitationId}`}
                    onClick={() => void mutate(`invite-${invite.invitationId}`, "revokeInvitation", { invitationId: invite.invitationId }, "Invitation withdrawn.")}
                  >
                    Withdraw
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {earlier.length ? <EarlierInvitations invitations={earlier} onAgain={readOnly ? undefined : inviteAgain} /> : null}
      </section>

      <InvitePeopleDialog
        open={inviting}
        again={again}
        operatorSessionId={operatorSessionId}
        onClose={() => {
          setInviting(false);
          setAgain(null);
        }}
        onInvited={onRefresh}
      />
      <MessageDialog
        open={Boolean(writingTo)}
        onClose={() => setWritingTo(null)}
        operatorSessionId={operatorSessionId}
        busy={busy}
        mutate={mutate}
        to={writingTo ? [writingTo] : undefined}
      />
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.title ?? ""}
        detail={pending?.detail ?? ""}
        confirmLabel={pending?.confirm ?? "Confirm"}
        destructive={pending?.destructive}
        pending={Boolean(pending && busy === `member-${pending.person.membershipId}`)}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          void mutate(`member-${pending.person.membershipId}`, "changeMember", { membershipId: pending.person.membershipId, ...pending.patch }, pending.done).then(() =>
            setPending(null),
          );
        }}
      />
    </div>
  );
}

const STATUS_WORD: Record<string, string> = { invited: "Invited", suspended: "Suspended", ended: "Removed" };

function MemberLine({
  person,
  busy,
  onChange,
  onMessage,
}: {
  person: Person;
  busy: boolean;
  onChange: (next: { role?: string; status?: string }) => void;
  onMessage: () => void;
}) {
  const away = person.status === "suspended" || person.status === "ended";
  const items: OverflowItem<"message" | "suspend" | "restore" | "remove">[] = [
    { key: "message", label: "Send a message", icon: "mail", disabled: busy || person.status !== "active" },
    away
      ? { key: "restore", label: person.status === "ended" ? "Bring back to the school" : "Restore access", icon: "check", disabled: busy }
      : { key: "suspend", label: "Suspend", icon: "pause", disabled: busy },
    ...(person.status !== "ended" ? [{ key: "remove" as const, label: "Remove from school", icon: "trash" as const, disabled: busy }] : []),
  ];
  return (
    <li className="admin-person" data-status={person.status}>
      <div className="admin-person-who">
        <strong>{person.name}</strong>
        <span>{person.email}</span>
      </div>
      <span className="admin-person-seen">
        {STATUS_WORD[person.status] ? `${STATUS_WORD[person.status]}, ` : ""}
        {person.lastSeenAt ? `seen ${formatRelative(person.lastSeenAt).toLowerCase()}` : "not signed in yet"}
      </span>
      <SelectField
        ariaLabel={`Role for ${person.name}`}
        value={person.role}
        disabled={busy || away}
        onChange={(role) => onChange({ role })}
        options={ROLE_OPTIONS}
        size="sm"
        triggerClassName="admin-quiet-select w-[128px]"
      />
      <OverflowMenu
        label={`More for ${person.name}`}
        size={30}
        items={items}
        onSelect={(key) => {
          if (key === "message") onMessage();
          else if (key === "suspend") onChange({ status: "suspended" });
          else if (key === "remove") onChange({ status: "ended" });
          else onChange({ status: "active" });
        }}
      />
    </li>
  );
}

const ENDED: Record<string, string> = { accepted: "Joined", revoked: "Withdrawn", expired: "Link expired" };

function EarlierInvitations({ invitations, onAgain }: { invitations: Invitation[]; onAgain?: (invite: Invitation) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="admin-people-fold" data-open={open || undefined}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight className="size-3.5" aria-hidden />
        Earlier invitations <span>{invitations.length}</span>
      </button>
      {open ? (
        <ul className="admin-people-list">
          {invitations.slice(0, 100).map((invite) => (
            <li key={invite.invitationId} className="admin-person">
              <div className="admin-person-who">
                <strong>{invite.email}</strong>
                <span>
                  {roleName(invite.role)}, invited {day.format(invite.createdAt)}
                </span>
              </div>
              <span className="admin-person-seen">{ENDED[invite.status] ?? invite.status}</span>
              {onAgain && invite.status !== "accepted" ? (
                <Button variant="ghost" size="sm" onClick={() => onAgain(invite)}>
                  Invite again
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
