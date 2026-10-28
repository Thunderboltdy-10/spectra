"use client";

import { useEffect, useMemo, useState } from "react";
import { Send, X } from "@/components/icons/glyph-icons";
import { SearchField } from "@/components/ui/search-field";
import { SelectField } from "@/components/ui/select";
import { getAdministration } from "../api";
import { AdminButton, AdminDialog, TextAreaField, TextField } from "../shared";
import { roleName, type Person } from "./people-model";

/*
 * A school message, written once and sent to whoever the admin names: the
 * whole school, some roles, some groups or classes, or chosen people. It
 * lands in each person's notifications, and the admin sees who read it.
 * People rows open it already addressed to that person.
 */

type Mutate = <T>(label: string, action: string, payload: Record<string, unknown>, success: string | null) => Promise<{ result: T } | null>;
type Group = { groupId: string; name: string; memberCount: number };
export type MessageAudience = "school" | "roles" | "groups" | "people";

const ROLES = [
  ["student", "Students"],
  ["teacher", "Teachers"],
  ["school_admin", "School admins"],
] as const;

export function MessageDialog({
  open,
  onClose,
  operatorSessionId,
  busy,
  mutate,
  to,
}: {
  open: boolean;
  onClose: () => void;
  operatorSessionId?: string;
  busy: string;
  mutate: Mutate;
  /** Already addressed: these people, and the audience starts as "Some people". */
  to?: Pick<Person, "accountId" | "name" | "email">[];
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<MessageAudience>("school");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Pick<Person, "accountId" | "name" | "email">[]>([]);
  const [sendNow, setSendNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setAudience(to?.length ? "people" : "school");
    setChosen(to ?? []);
    setTargetIds([]);
    // Opened again for someone else: the address is theirs, the words start fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    if (audience === "groups" && !groups)
      void getAdministration<{ groups: Group[] }>("groups", { operatorSessionId })
        .then((result) => live && setGroups(result.groups))
        .catch(() => live && setGroups([]));
    if (audience === "people" && !people)
      void getAdministration<{ people: Person[] }>("people", { operatorSessionId, status: "active", limit: 500 })
        .then((result) => live && setPeople(result.people))
        .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [audience, groups, open, operatorSessionId, people]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const picked = new Set(chosen.map((person) => person.accountId));
    return (people ?? [])
      .filter((person) => !picked.has(person.accountId))
      .filter((person) => !needle || `${person.name}\n${person.email}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [chosen, people, search]);

  const toggle = (id: string, checked: boolean) => setTargetIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  const ids = audience === "people" ? chosen.map((person) => person.accountId) : targetIds;
  const addressed = audience === "school" || ids.length > 0;
  const close = () => {
    onClose();
    setSearch("");
  };

  return (
    <AdminDialog
      open={open}
      onClose={close}
      title={to?.length === 1 ? `Message ${to[0].name}` : "New message"}
      detail="It reaches only the people you choose, in their Spectra notifications. You can see who has read it."
      footer={
        <>
          <AdminButton onClick={close}>Cancel</AdminButton>
          <AdminButton
            tone="primary"
            disabled={!title.trim() || !body.trim() || !addressed || (!sendNow && !scheduledAt) || busy === "announcement"}
            onClick={() =>
              void mutate(
                "announcement",
                "createAnnouncement",
                {
                  title,
                  body,
                  targetKind: audience,
                  targetIds: ids,
                  sendNow,
                  scheduledAt: sendNow ? undefined : new Date(scheduledAt).getTime(),
                },
                sendNow ? "Message sent." : "Message scheduled.",
              ).then((done) => {
                if (!done) return;
                close();
                setTitle("");
                setBody("");
                setTargetIds([]);
                setChosen([]);
              })
            }
          >
            <Send size={12} />
            {sendNow ? "Send now" : "Schedule"}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Who receives it"
          value={audience}
          onChange={(value) => {
            setAudience(value as MessageAudience);
            setTargetIds([]);
          }}
          options={[
            { value: "school", label: "Everyone at school" },
            { value: "roles", label: "Some roles" },
            { value: "groups", label: "Some groups or classes" },
            { value: "people", label: "Some people" },
          ]}
        />
        {audience === "roles" ? (
          <div className="flex flex-wrap gap-4 text-ui">
            {ROLES.map(([role, label]) => (
              <label key={role} className="flex items-center gap-2">
                <input type="checkbox" checked={targetIds.includes(role)} onChange={(event) => toggle(role, event.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        ) : null}
        {audience === "groups" ? (
          <div className="max-h-44 overflow-y-auto rounded-control border border-[var(--border-default)] p-2">
            {groups === null ? (
              <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">Reading the groups</p>
            ) : groups.length ? (
              groups.map((group) => (
                <label key={group.groupId} className="flex items-center gap-2 rounded-chip px-2 py-2 text-micro hover:bg-[var(--bg-secondary)]">
                  <input type="checkbox" checked={targetIds.includes(group.groupId)} onChange={(event) => toggle(group.groupId, event.target.checked)} />
                  <span className="flex-1">{group.name}</span>
                  <span className="text-[var(--text-tertiary)]">{group.memberCount}</span>
                </label>
              ))
            ) : (
              <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">No groups yet. Make one in Groups, or choose people instead.</p>
            )}
          </div>
        ) : null}
        {audience === "people" ? (
          <div className="space-y-2">
            {chosen.length ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Receives it">
                {chosen.map((person) => (
                  <li key={person.accountId} className="flex items-center gap-1 rounded-chip border border-[var(--border-default)] py-0.5 pl-2 pr-1 text-micro">
                    {person.name}
                    <button
                      type="button"
                      aria-label={`Take ${person.name} off`}
                      className="grid size-4 place-items-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                      onClick={() => setChosen((current) => current.filter((item) => item.accountId !== person.accountId))}
                    >
                      <X size={10} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <SearchField value={search} onChange={setSearch} label="Find someone to add" placeholder="Find someone by name or email" />
            <div className="max-h-44 overflow-y-auto rounded-control border border-[var(--border-default)] p-1">
              {people === null ? (
                <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">Reading the school’s members</p>
              ) : matches.length ? (
                matches.map((person) => (
                  <button
                    key={person.accountId}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-chip px-2 py-1.5 text-left text-micro hover:bg-[var(--bg-secondary)]"
                    onClick={() => setChosen((current) => [...current, person])}
                  >
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate">{person.name}</strong>
                      <span className="block truncate text-[var(--text-tertiary)]">{person.email}</span>
                    </span>
                    <span className="shrink-0 text-[var(--text-tertiary)]">{roleName(person.role)}</span>
                  </button>
                ))
              ) : (
                <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">{search ? `No one else matches “${search}”.` : "Everyone is already on it."}</p>
              )}
            </div>
          </div>
        ) : null}
        <TextField label="Title" value={title} onChange={setTitle} />
        <TextAreaField label="Message" value={body} onChange={setBody} rows={6} />
        <label className="flex items-center gap-2 text-ui">
          <input type="checkbox" checked={sendNow} onChange={(event) => setSendNow(event.target.checked)} />
          Send it now
        </label>
        {!sendNow ? <TextField label="When it goes out" value={scheduledAt} onChange={setScheduledAt} type="datetime-local" /> : null}
      </div>
    </AdminDialog>
  );
}
