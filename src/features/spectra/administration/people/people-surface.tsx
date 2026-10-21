"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Loader2, UserPlus } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { LifeKey } from "@/components/ui/life-moments";
import { SearchField } from "@/components/ui/search-field";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
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

function useSchoolPeople(operatorSessionId: string | undefined, refreshKey: number) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  /* The search asks the server once typing settles, and the list stays on
     screen while it does; invitations do not depend on it. */
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    void getAdministration<{ people: Person[] }>("people", { operatorSessionId, search: query })
      .then((result) => active && setPeople(result.people))
      .catch((error) => active && toast.error(describeFailure(error, { fallback: "Could not read the school’s members." }).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [operatorSessionId, refreshKey, query]);
  useEffect(() => {
    let active = true;
    void getAdministration<{ invitations: Invitation[] }>("invitations", { operatorSessionId })
      .then((result) => active && setInvitations(result.invitations))
      .catch((error) => active && toast.error(describeFailure(error, { fallback: "Could not read the invitations." }).message));
    return () => {
      active = false;
    };
  }, [operatorSessionId, refreshKey]);

  return { search, setSearch, query, people, invitations, loading };
}

export function PeopleSurface({
  operatorSessionId,
  busy,
  mutate,
  refreshKey,
  onRefresh,
}: {
  operatorSessionId?: string;
  busy: string;
  mutate: Mutate;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const { search, setSearch, query, people, invitations, loading } = useSchoolPeople(operatorSessionId, refreshKey);
  const [inviting, setInviting] = useState(false);
  const waiting = invitations.filter((invite) => invite.status === "pending");
  const earlier = invitations.filter((invite) => invite.status !== "pending");

  return (
    <div className="admin-people">
      <div className="admin-people-bar">
        <SearchField value={search} onChange={setSearch} label="Find someone in the school" placeholder="Find someone by name or email" className="w-[320px] max-w-full" />
        <Button variant="primary" onClick={() => setInviting(true)}>
          <UserPlus className="size-4" />
          Invite people
        </Button>
      </div>

      <section className="admin-people-section" aria-labelledby="admin-members-title">
        <h2 id="admin-members-title">
          Members <span>{loading ? "" : people.length}</span>
        </h2>
        {loading ? (
          <p className="admin-people-quiet" role="status">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading the school’s members
          </p>
        ) : people.length === 0 ? (
          <p className="admin-people-quiet">{query ? `No one matches “${query}”.` : "No one has joined yet. Invite people to bring them in."}</p>
        ) : (
          <ul className="admin-people-list">
            {people.map((person) => (
              <MemberLine key={person.membershipId} person={person} busy={busy === `member-${person.membershipId}`} mutate={mutate} />
            ))}
          </ul>
        )}
      </section>

      <section className="admin-people-section" aria-labelledby="admin-waiting-title">
        <h2 id="admin-waiting-title">
          Waiting to join <span>{waiting.length}</span>
        </h2>
        {waiting.length === 0 ? (
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
                  disabled={busy === `invite-${invite.invitationId}`}
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
