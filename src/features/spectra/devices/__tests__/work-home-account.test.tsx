// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn(), restore: vi.fn(async () => 1), summary: vi.fn(async () => ({})), adopt: vi.fn(async () => ({ adopted: 1 })), success: vi.fn(), error: vi.fn() }));
vi.mock("../../../../../convex/_generated/api", () => ({ api: {
  bridge: { overview: { _name: "overview" } },
  deviceWorks: Object.fromEntries(["settings", "counts", "choose", "deleteBackups", "onThisComputer", "movable", "backupUploadUrl", "recordBackup", "adoptRestored", "backupsToRestore"].map(_name => [_name, { _name }])),
} }));
vi.mock("convex/react", () => ({ useConvexAuth: () => ({ isAuthenticated: true }), useConvex: () => ({ query: h.query }), useMutation: (ref: { _name: string }) => ref._name === "adoptRestored" ? h.adopt : vi.fn() }));
vi.mock("@/features/spectra/data/use-kept-query", () => ({ useQuery: (ref: { _name: string }) => ref._name === "settings" ? { storage: "device_backup", backupEveryHours: 24, lastBackupAt: null, lastFullBackupAt: null } : ref._name === "counts" ? { elsewhere: 1, here: 0, cloud: 0 } : { devices: [] } }));
vi.mock("../../bridge/availability", () => ({ useBridgeAvailability: () => "ready", bridgeUnavailableHere: () => null, bridgeUnavailableReason: () => null }));
vi.mock("../../bridge/device-works", () => ({ useDeviceState: () => ({ storeId: "store-A" }), deviceStoreSummary: h.summary, moveWorkToCloud: vi.fn(), moveWorkToDevice: vi.fn() }));
vi.mock("../../bridge/device-backup", () => ({ restoreBackups: h.restore, backUpNow: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: h.success, error: h.error, info: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/devices" }));
import { bindAccountStorageScope } from "@/lib/account-storage";
import { WorkHomeChoice } from "../work-home-choice";
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); });

it("does not restore, adopt or show completion after an old account's backup query arrives late", async () => {
  bindAccountStorageScope("deployment/account-A");
  let finish!: (backups: Array<{ url: string }>) => void;
  h.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<WorkHomeChoice />);
  fireEvent.click(screen.getByRole("button", { name: "Bring back the backup" }));
  expect(h.query).toHaveBeenCalledOnce();
  view.unmount();
  bindAccountStorageScope("deployment/account-B");
  await act(async () => { finish([{ url: "https://fixture-only-backup" }]); });
  expect(h.restore).not.toHaveBeenCalled();
  expect(h.adopt).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});
