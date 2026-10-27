"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, UserPlus } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { LifeKey } from "@/components/ui/life-moments";
import { SearchField } from "@/components/ui/search-field";
import { SelectField } from "@/components/ui/select";
import { describeFailure } from "@/components/ui/truthful-state";
import { getAdministration } from "../api";
import { formatRelative } from "../shared";
import { InvitePeopleDialog } from "./invite-people-dialog";
import { ROLE_OPTIONS, STATUS_OPTIONS, roleName, type Invitation, type Person } from "./people-model";

/*
 * The admin People tab: who is in the school, who has been invited and not
 * joined yet, and the way to invite more. One line per person; role and
 * status change in place, and earlier invitations stay folded away.
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
    () => getAdministration<{ people: Person[] }>("people", { operatorSessionId, search: query }).then((result) => result.people),
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
  const members = people.rows ?? [];
  const waiting = (invitations.rows ?? []).filter((invite) => invite.status === "pending");
  const earlier = (invitations.rows ?? []).filter((invite) => invite.status !== "pending");

  return (
    <div className="admin-people">
      <div className="admin-people-bar">
        <SearchField value={search} onChange={setSearch} label="Find someone in the school" placeholder="Find someone by name or email" className="w-[320px] max-w-full" />
        <Button variant="primary" disabled={readOnly} title={readOnly ? "You are inspecting this school, so nobody can be invited from here." : undefined} onClick={() => setInviting(true)}>
          <UserPlus className="size-4" />
          Invite people
        </Button>
      </div>

      <section className="admin-people-section" aria-labelledby="admin-members-title">
        <h2 id="admin-members-title">
          Members <span>{people.rows ? members.length : ""}</span>
        </h2>
        {people.error ? <ReadFailure message={people.error} retry={people.retry} /> : null}
        {!people.rows ? (
          people.error ? null : (
            <p className="admin-people-quiet" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading the school’s members
            </p>
          )
        ) : members.length === 0 ? (
          <p className="admin-people-quiet">{query ? `No one matches “${query}”.` : "No one has joined yet. Invite people to bring them in."}</p>
        ) : (
          <ul className="admin-people-list">
            {members.map((person) => (
              <MemberLine key={person.membershipId} person={person} busy={readOnly || busy === `member-${person.membershipId}`} mutate={mutate} />
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
            {waiting.map((invite) => (
              <li key={invite.invitationId} className="admin-person">
                <LifeKey id={`invitation:${invite.invitationId}`} />
                <div className="admin-person-who">
                  <strong>{invite.email}</strong>
                  <span>
                    {roleName(invite.role)}, invited {day.format(invite.createdAt)}, link works until {day.format(invite.expiresAt)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={readOnly || busy === `invite-${invite.invitationId}`}
                  onClick={() => void mutate(`invite-${invite.invitationId}`, "revokeInvitation", { invitationId: invite.invitationId }, "Invitation withdrawn.")}
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        )}
        {earlier.length ? <EarlierInvitations invitations={earlier} /> : null}
      </section>

      <InvitePeopleDialog open={inviting} operatorSessionId={operatorSessionId} onClose={() => setInviting(false)} onInvited={onRefresh} />
    </div>
  );
}

function MemberLine({ person, busy, mutate }: { person: Person; busy: boolean; mutate: Mutate }) {
  const change = (patch: { role?: string; status?: string }, done: string) =>
    void mutate(`member-${person.membershipId}`, "changeMember", { membershipId: person.membershipId, ...patch }, done);
  return (
    <li className="admin-person" data-status={person.status}>
      <div className="admin-person-who">
        <strong>{person.name}</strong>
        <span>{person.email}</span>
      </div>
      <span className="admin-person-seen">{person.lastSeenAt ? `Seen ${formatRelative(person.lastSeenAt).toLowerCase()}` : "Not signed in yet"}</span>
      <SelectField ariaLabel={`Role for ${person.name}`} value={person.role} disabled={busy} onChange={(role) => change({ role }, `${person.name} is a ${roleName(role).toLowerCase()} now.`)} options={ROLE_OPTIONS} size="sm" triggerClassName="admin-quiet-select w-[128px]" />
      <SelectField ariaLabel={`Status for ${person.name}`} value={person.status} disabled={busy} onChange={(status) => change({ status }, `${person.name}: ${STATUS_OPTIONS.find((option) => option.value === status)?.label.toLowerCase()}.`)} options={STATUS_OPTIONS} size="sm" triggerClassName="admin-quiet-select w-[144px]" />
    </li>
  );
}

const ENDED: Record<string, string> = { accepted: "Joined", revoked: "Withdrawn", expired: "Link expired" };

function EarlierInvitations({ invitations }: { invitations: Invitation[] }) {
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
