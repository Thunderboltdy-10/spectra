// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ files: vi.fn(), topic: vi.fn(), update: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../data/api", () => ({ getSpectraMemoryFiles: api.files, getSpectraMemoryTopic: api.topic, updateSpectraMemoryFile: api.update }));
vi.mock("@/components/ui/toast", () => ({ toast: toasts }));
import { MemoryFilesSettings } from "../settings/ui/memory-files-settings";

const head = {
  enabled: true,
  about: "IB student in Madrid.",
  preferences: "Everywhere: short answers first.",
  topics: [{ slug: "physics-ia", title: "Physics IA", summary: "Pendulum damping" }],
};

beforeEach(() => {
  vi.resetAllMocks();
  api.files.mockResolvedValue(head);
  api.update.mockResolvedValue({ ok: true });
  api.topic.mockResolvedValue({ content: "Damping varies with length." });
});
afterEach(cleanup);

describe("Spectra's notes about you", () => {
  it("lists the two files and each topic, and says when memory is off", async () => {
    render(<MemoryFilesSettings />);
    expect(await screen.findByDisplayValue("IB student in Madrid.")).toBeTruthy();
    expect(screen.getByDisplayValue("Everywhere: short answers first.")).toBeTruthy();
    expect(screen.getByText("Physics IA")).toBeTruthy();
    cleanup();
    api.files.mockResolvedValue({ ...head, enabled: false });
    render(<MemoryFilesSettings />);
    expect(await screen.findByText("Memory is turned off, so Spectra is not keeping notes.")).toBeTruthy();
  });

  it("offers Save only for a change, refuses one over the cap, and sends the rewrite", async () => {
    render(<MemoryFilesSettings />);
    const about = await screen.findByDisplayValue("IB student in Madrid.");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.change(about, { target: { value: "x".repeat(100_000) } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(about, { target: { value: "IB student in Madrid, Physics HL." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ file: "about", rewrite: "IB student in Madrid, Physics HL." }));
    await waitFor(() => expect(api.files).toHaveBeenCalledTimes(2));
  });

  it("opens a topic once and forgets it on request; a refusal is said", async () => {
    render(<MemoryFilesSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /Physics IA/ }));
    expect(await screen.findByText("Damping varies with length.")).toBeTruthy();
    expect(api.topic).toHaveBeenCalledWith("physics-ia");
    api.update.mockResolvedValue({ ok: false, message: "That note is being written. Try again in a moment." });
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ file: "topic", slug: "physics-ia", remove: true }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("That note is being written. Try again in a moment."));
  });
});
