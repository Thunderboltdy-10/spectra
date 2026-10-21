"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search, Send, X } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { searchSpectraSchoolMembers, type SpectraSchoolMember } from "../../data/api";
import { SHARE_LEVEL_OPTIONS, type ShareAccess, type ShareLevel } from "./use-share-access";

/*
 * Inviting people: find them by name or email, gather one or several, then
 * say what they may do and, if it helps, why. Nothing is sent until Send, so
 * a slip of the mouse in the results never invites anyone.
 */

const ROLE = { student: "Student", teacher: "Teacher", school_admin: "School admin" } as const;
const NOTE_LIMIT = 500;

function useMemberSearch(query: string) {
  const [members, setMembers] = useState<SpectraSchoolMember[]>([]);
  const [searching, setSearching] = useState(false);
  const sequence = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    const current = ++sequence.current;
    if (needle.length < 2) {
      setMembers([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = window.setTimeout(() => {
      void searchSpectraSchoolMembers(needle)
        .then((result) => {
          if (current === sequence.current) setMembers(result.members);
        })
        .catch((error) => {
          if (current === sequence.current) toast.error(error instanceof Error ? error.message : "Could not search your school.");
        })
        .finally(() => {
          if (current === sequence.current) setSearching(false);
        });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [query]);

  return { members, searching };
}

export function ShareInvite({
  access,
  hasAccess,
  defaultLevel = "read",
}: {
  access: ShareAccess;
  hasAccess: ReadonlySet<string>;
  /** View unless the author has let everyone edit. */
  defaultLevel?: ShareLevel;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<SpectraSchoolMember[]>([]);
  const [level, setLevel] = useState<ShareLevel>(defaultLevel);
  useEffect(() => setLevel(defaultLevel), [defaultLevel]);
  const [note, setNote] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const { members, searching } = useMemberSearch(query);
  const sending = access.busyKey === "invite";

  const chosenIds = new Set(chosen.map((person) => person.accountId));
  const results = members.filter((member) => !chosenIds.has(member.accountId));
  const showing = query.trim().length >= 2;

  const choose = (member: SpectraSchoolMember) => {
    if (hasAccess.has(member.accountId)) return;
    setChosen((current) => [...current, member]);
    setQuery("");
    setActive(0);
    input.current?.focus();
  };
  const send = async () => {
    const sent = await access.invite(chosen, level, note);
    if (!sent) return;
    setChosen([]);
    setNote("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!results.length) return;
      event.preventDefault();
      setActive((at) => (at + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const member = results[active];
      if (member) choose(member);
    } else if (event.key === "Backspace" && !query && chosen.length) {
      setChosen((current) => current.slice(0, -1));
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  };

  return (
    <section className="share-invite" aria-label="Invite people">
      <div className="share-invite-field">
        <Search className="size-4 shrink-0" aria-hidden />
        {chosen.map((person) => (
          <span key={person.accountId} className="share-invite-person">
            {person.name}
            <button type="button" aria-label={`Remove ${person.name}`} onClick={() => setChosen((current) => current.filter((item) => item !== person))}>
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-label="Invite people by name or email"
          aria-expanded={showing}
          aria-controls={listId}
          aria-activedescendant={showing && results[active] ? `${listId}-${results[active]!.accountId}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={chosen.length ? "Add someone else" : "Invite people by name or email"}
        />
        {searching ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : null}
      </div>

      {showing ? (
        <ul id={listId} role="listbox" aria-label="People in your school" className="share-invite-results">
          {results.map((member, index) => {
            const already = hasAccess.has(member.accountId);
            return (
              <li
                key={member.accountId}
                id={`${listId}-${member.accountId}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={already || undefined}
                data-active={index === active || undefined}
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(member)}
              >
                <span className="share-invite-name">{member.name}</span>
                <span className="share-invite-meta">{already ? "Already has access" : `${ROLE[member.role]}, ${member.email}`}</span>
              </li>
            );
          })}
          {!searching && results.length === 0 ? (
            <li className="share-invite-empty" role="presentation">
              No one in your school matches “{query.trim()}”. Only people in your school can be invited.
            </li>
          ) : null}
        </ul>
      ) : null}

      {chosen.length ? (
        <div className="share-invite-send">
          <input
            aria-label="Note for them"
            value={note}
            maxLength={NOTE_LIMIT}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a note, if it helps"
          />
          <SelectField layer="modal" ariaLabel="What they can do" value={level} onChange={(next) => setLevel(next as ShareLevel)} options={SHARE_LEVEL_OPTIONS} size="md" triggerClassName="share-quiet-select w-[112px]" />
          <Button variant="primary" size="md" disabled={sending} onClick={() => void send()}>
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {chosen.length === 1 ? "Send invite" : `Send ${chosen.length} invites`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
