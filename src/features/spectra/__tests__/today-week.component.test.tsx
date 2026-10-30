// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CalendarItem } from "../calendar/domain/model";
import { TodayWeek } from "../today/today-week";

vi.mock("../data/use-catalog-pages", () => ({ useWorkspaceCatalog: () => ({ items: [{ _id: "physics-workspace", title: "Physics HL" }] }) }));
vi.mock("../school/school-classes", () => ({ useDueByClass: () => ({ tasks: [] }) }));
vi.mock("../school/use-deadline-classes", () => ({ useDeadlineClasses: () => () => null }));
vi.mock("../school/open-school-task", () => ({ schoolTaskHref: (id: string) => `/school?task=${id}`, useOpenSchoolTask: () => ({ onTaskClick: vi.fn() }) }));
vi.mock("../calendar/ui/calendar-plans", () => ({ usePlanGroups: () => ({ toDo: [], own: [] }), planWorkId: () => undefined }));

it("opens a class's matching workspace from Home and keeps Calendar as the fallback", () => {
  const now = new Date(2026, 9, 30, 12).getTime();
  const item = (title: string, kind: CalendarItem["kind"]): CalendarItem => ({ id: title, title, kind, startAt: now, endAt: now + 3_600_000, allDay: false, sourceLocked: false, status: "active", timePrecision: "exact", timezone: "Europe/Madrid", revision: 1, linkedWorkIds: [] });
  render(<TodayWeek now={now} failed={false} agenda={{ today: [item("Physics HL", "official_event"), item("Unfiled class", "official_event"), item("Reading", "personal_event")], upcoming: [], open: [] }} />);
  expect(screen.getByRole("link", { name: /Physics HL/ }).getAttribute("href")).toBe("/library?workspaceId=physics-workspace");
  expect(screen.getByRole("link", { name: /Unfiled class/ }).getAttribute("href")).toBe("/calendar");
  expect(screen.getByRole("link", { name: /Reading/ }).getAttribute("href")).toBe("/calendar");
});
