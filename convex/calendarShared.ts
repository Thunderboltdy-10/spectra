import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type SourceCalendarInput = {
  ownerAccountId: Id<"accounts">;
  schoolId: Id<"schools">;
  sourceRecordId: Id<"externalRecords">;
  /** Reuse a legacy source row while its projection is upgraded to this key. */
  existingItemId?: Id<"calendarItems">;
  sourceKey: string;
  sourceHash: string;
  sourceUrl?: string;
  fetchedAt: number;
  recordType: string;
  normalized: Record<string, unknown>;
};

function text(value: unknown, maximum = 500) {
  if (typeof value === "number" && Number.isFinite(value))
    return String(value).slice(0, maximum);
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

function dateOnly(value: unknown) {
  const candidate = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
}

export function zonedDateTimeToUtc(
  date: string,
  minutes: number,
  timezone: string,
) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const desired = Date.UTC(year!, month! - 1, day!, hour, minute);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(guess)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const rendered = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour!,
      parts.minute!,
    );
    guess += desired - rendered;
  }
  return guess;
}

async function resolveSourceTime(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  normalized: Record<string, unknown>,
) {
  const exactStart = timestamp(
    normalized.startAt ?? normalized.start ?? normalized.beginsAt,
  );
  const exactEnd = timestamp(
    normalized.endAt ?? normalized.end ?? normalized.finishesAt,
  );
  const dueAt = timestamp(normalized.dueAt ?? normalized.deadlineAt);
  if (exactStart !== undefined && exactEnd !== undefined)
    return {
      startAt: exactStart,
      endAt: exactEnd,
      timezone: text(normalized.timezone, 100) || "UTC",
      precision: "exact" as const,
    };
  if (exactStart !== undefined)
    return {
      startAt: exactStart,
      endAt: exactStart + 24 * 60 * 60_000,
      timezone: text(normalized.timezone, 100) || "UTC",
      precision: "date_only" as const,
    };
  if (dueAt !== undefined)
    return {
      startAt: dueAt,
      endAt: dueAt,
      timezone: text(normalized.timezone, 100) || "UTC",
      precision: "exact" as const,
    };
  const periodKey = text(
    normalized.periodKey ?? normalized.period ?? normalized.period_id,
    120,
  );
  const date = dateOnly(
    normalized.date ?? normalized.dayDate ?? normalized.occurrenceDate,
  );
  if (periodKey && date) {
    const period = await ctx.db
      .query("calendarPeriodMaps")
      .withIndex("by_school_period", (q) =>
        q.eq("schoolId", schoolId).eq("periodKey", periodKey),
      )
      .unique();
    if (period) {
      const startAt = zonedDateTimeToUtc(
        date,
        period.startMinutes,
        period.timezone,
      );
      const endAt = zonedDateTimeToUtc(
        date,
        period.endMinutes,
        period.timezone,
      );
      return {
        startAt,
        endAt,
        timezone: period.timezone,
        precision: "verified_period" as const,
      };
    }
  }
  if (date) {
    const startAt = Date.parse(`${date}T00:00:00.000Z`);
    return {
      startAt,
      endAt: startAt + 24 * 60 * 60_000,
      timezone: text(normalized.timezone, 100) || "UTC",
      precision: "date_only" as const,
    };
  }
  return {
    timezone: text(normalized.timezone, 100) || "UTC",
    precision: "unknown" as const,
  };
}

export async function upsertSourceCalendarItem(
  ctx: MutationCtx,
  input: SourceCalendarInput,
) {
  const normalized = input.normalized;
  const time = await resolveSourceTime(ctx, input.schoolId, normalized);
  const lowerType = input.recordType.toLowerCase();
  const isDeadline = /assignment|deadline|assessment|task/.test(lowerType);
  const kind: "official_deadline" | "official_event" = isDeadline
    ? "official_deadline"
    : "official_event";
  const sourceKey = `${input.sourceKey}:${kind}`.slice(0, 500);
  const existingByKey = await ctx.db
    .query("calendarItems")
    .withIndex("by_source_key", (q) =>
      q.eq("ownerAccountId", input.ownerAccountId).eq("sourceKey", sourceKey),
    )
    .unique();
  const existingById = input.existingItemId
    ? await ctx.db.get(input.existingItemId)
    : null;
  const existing =
    existingByKey ??
    (existingById &&
    existingById.ownerAccountId === input.ownerAccountId &&
    existingById.schoolId === input.schoolId &&
    existingById.sourceLocked
      ? existingById
      : null);
  const now = Date.now();
  const title =
    text(normalized.title ?? normalized.name ?? normalized.subject, 500) ||
    (isDeadline ? "Official deadline" : "Class event");
  const patch = {
    kind,
    title,
    notes: text(normalized.description ?? normalized.notes, 20_000) || undefined,
    startAt: time.startAt,
    endAt: time.endAt,
    allDay: time.precision === "date_only",
    timezone: time.timezone,
    timePrecision: time.precision,
    status: "active" as const,
    sourceLocked: true,
    sourceProvider: "managebac",
    sourceRecordId: input.sourceRecordId,
    sourceKey,
    sourceHash: input.sourceHash,
    sourceUrl: input.sourceUrl,
    sourceFreshAt: input.fetchedAt,
    sourceCapabilityState:
      time.precision === "unknown" ? ("partial" as const) : ("available" as const),
    location: text(normalized.location ?? normalized.room, 300) || undefined,
    teacher: text(normalized.teacher ?? normalized.teacherName, 300) || undefined,
    classId:
      text(normalized.classId ?? normalized.class_id ?? normalized.courseId, 300) ||
      undefined,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: now,
  };
  let itemId: Id<"calendarItems">;
  let created = false;
  if (
    existing?.status === "active" &&
    existing.sourceLocked &&
    existing.sourceHash === input.sourceHash
  ) {
    // Freshness-only syncs do not advance the source row's edit revision.
    if (
      existing.sourceFreshAt !== input.fetchedAt ||
      existing.sourceUrl !== input.sourceUrl ||
      existing.sourceCapabilityState !==
        (time.precision === "unknown" ? "partial" : "available")
    )
      await ctx.db.patch(existing._id, {
        sourceFreshAt: input.fetchedAt,
        sourceUrl: input.sourceUrl,
        sourceCapabilityState:
          time.precision === "unknown" ? "partial" : "available",
      });
    itemId = existing._id;
  } else if (existing) {
    await ctx.db.patch(existing._id, patch);
    itemId = existing._id;
  } else {
    itemId = await ctx.db.insert("calendarItems", {
      ownerAccountId: input.ownerAccountId,
      schoolId: input.schoolId,
      ...patch,
      linkedArtifactIds: [],
      createdBy: "source",
      createdAt: now,
    });
    created = true;
  }
  if (!isDeadline) return { itemId, created, precision: time.precision };

  // A source assignment owns an immutable deadline and a distinct schedulable
  // task. The task can move or complete without ever mutating provider truth.
  const taskSourceKey = `${input.sourceKey}:task`.slice(0, 500);
  const existingTask = await ctx.db
    .query("calendarItems")
    .withIndex("by_source_key", (q) =>
      q.eq("ownerAccountId", input.ownerAccountId).eq("sourceKey", taskSourceKey),
    )
    .unique();
  const taskSourcePatch = {
    sourceProvider: "managebac",
    sourceRecordId: input.sourceRecordId,
    sourceKey: taskSourceKey,
    sourceHash: input.sourceHash,
    sourceUrl: input.sourceUrl,
    sourceFreshAt: input.fetchedAt,
    sourceCapabilityState: "available" as const,
    officialDeadlineItemId: itemId,
    classId: patch.classId,
  };
  let taskItemId: Id<"calendarItems">;
  if (existingTask) {
    // The locked row is also the previous source baseline. Advance copied
    // text only when it still matches that baseline; a personal edit (even
    // clearing notes) wins. Without a matching baseline, preserve the copy.
    // Status and scheduling always belong to the person, across every hash.
    const sourceChanged = existingTask.sourceHash !== input.sourceHash;
    const canMergeText =
      sourceChanged && existing?.sourceLocked &&
      existingTask.sourceHash === existing.sourceHash;
    const taskPatch = {
      ...taskSourcePatch,
      ...(canMergeText && existingTask.title === existing.title ? { title } : {}),
      ...(canMergeText && existingTask.notes === existing.notes
        ? { notes: patch.notes }
        : {}),
    };
    if (
      Object.entries(taskPatch).some(
        ([key, value]) => existingTask[key as keyof typeof existingTask] !== value,
      )
    ) {
      await ctx.db.patch(existingTask._id, {
        ...taskPatch,
        ...(sourceChanged
          ? { revision: existingTask.revision + 1, updatedAt: now }
          : {}),
      });
    }
    taskItemId = existingTask._id;
  } else {
    taskItemId = await ctx.db.insert("calendarItems", {
      ownerAccountId: input.ownerAccountId,
      schoolId: input.schoolId,
      ...taskSourcePatch,
      title,
      notes: patch.notes,
      kind: "task",
      allDay: false,
      timezone: time.timezone,
      timePrecision: "unknown",
      status: "active",
      sourceLocked: false,
      revision: 1,
      updatedAt: now,
      linkedArtifactIds: [],
      createdBy: "source",
      createdAt: now,
    });
  }
  return { itemId, taskItemId, created, precision: time.precision };
}
