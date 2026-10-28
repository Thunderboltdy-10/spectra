// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const plain = vi.hoisted(() => ({ success: vi.fn(() => "plain"), error: vi.fn(() => "plain"), warning: vi.fn(), message: vi.fn(), dismiss: vi.fn(), custom: vi.fn() }));
vi.mock("sonner", () => ({ toast: plain }));

import { toast } from "@/components/ui/toast";

afterEach(() => vi.clearAllMocks());

describe("the app's words", () => {
  it("always reach the toaster, exactly as said", () => {
    toast.success("Saved");
    toast.error("Could not move it", { id: "move" });
    toast("Offline");
    expect(plain.success).toHaveBeenCalledWith("Saved");
    expect(plain.error).toHaveBeenCalledWith("Could not move it", { id: "move" });
    expect(plain.message).toHaveBeenCalledWith("Offline");
  });

  it("dismisses the toast by its id", () => {
    toast.dismiss("move");
    expect(plain.dismiss).toHaveBeenCalledWith("move");
  });
});
