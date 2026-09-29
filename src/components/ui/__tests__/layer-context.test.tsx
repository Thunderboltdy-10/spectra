// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "../dialog";
import { resolveFloatingLayer } from "../layer-context";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";

afterEach(cleanup);

describe("floating layer resolution", () => {
  it("opens over its host dialog or sheet unless a layer is named", () => {
    expect(resolveFloatingLayer(undefined, null)).toBe("dropdown");
    expect(resolveFloatingLayer(undefined, "modal")).toBe("modal");
    expect(resolveFloatingLayer(undefined, "composer-dock")).toBe("composer-dock");
    // A host below dropdown never lowers a menu.
    expect(resolveFloatingLayer(undefined, "chrome")).toBe("dropdown");
    expect(resolveFloatingLayer("toast", "modal")).toBe("toast");
  });

  it("a popover opened inside a dialog takes the dialog's layer", () => {
    render(
      <Dialog open>
        <DialogContent layer="composer-dock">
          <DialogTitle>Invite</DialogTitle>
          <Popover open>
            <PopoverTrigger>Profile</PopoverTrigger>
            <PopoverContent>Student</PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>,
    );
    const list = screen.getByText("Student");
    // Before: the list sat at z-dropdown (60), under the dialog's veil (120).
    expect(list.className).toContain("z-composer-dock");
    expect(list.className).not.toContain("z-dropdown");
  });
});
