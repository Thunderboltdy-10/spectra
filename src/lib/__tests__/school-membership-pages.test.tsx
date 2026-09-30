import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireActor: vi.fn() }));
const readers = vi.hoisted(() => ({ school: vi.fn(), managebac: vi.fn() }));
vi.mock("@/lib/auth-server", async (original) => ({
  ...(await original<typeof import("@/lib/auth-server")>()),
  requireActor: auth.requireActor,
}));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: ({children}: {children: ReactNode}) => children }));
vi.mock("@/features/spectra/pages/school-data-shell", () => ({ SchoolDataShell: () => { readers.school(); return <p>School reader mounted</p>; } }));
vi.mock("@/features/spectra/pages/managebac-integration-shell", () => ({ ManageBacIntegrationShell: () => { readers.managebac(); return <p>ManageBac reader mounted</p>; } }));

import SchoolPage from "@/app/school/page";
import SchoolDataPage from "@/app/school-data/page";
import ManageBacPage from "@/app/managebac/page";

// Resolve the server boundary before rendering client children, as Next does.
async function renderPage(page: typeof SchoolPage) {
  const shell = await page();
  const boundary = shell.props.children as ReactElement<{children: ReactNode}>;
  const resolve = boundary.type as (props: {children: ReactNode}) => ReactNode | Promise<ReactNode>;
  return renderToStaticMarkup(await resolve(boundary.props));
}

beforeEach(() => { vi.clearAllMocks(); auth.requireActor.mockResolvedValue({schoolId:"school",schoolRole:"student"}); });

describe.each([["/school",SchoolPage],["/school-data",SchoolDataPage],["/managebac",ManageBacPage]] as const)("school membership boundary on %s", (_path, page) => {
  it("explains missing membership before mounting school readers", async () => {
    auth.requireActor.mockRejectedValue(new Error("AUTH_NO_SCHOOL: This account does not have an active school membership."));
    const html = await renderPage(page);
    expect(html).toContain("Join your school to view school data");
    expect(html).toContain("Accept your school invitation");
    expect(html).toContain('href="/join"');
    expect(readers.school).not.toHaveBeenCalled();
    expect(readers.managebac).not.toHaveBeenCalled();
    expect(auth.requireActor).toHaveBeenCalledWith({fresh:true});
  });
  it("mounts the existing surface for a current member", async () => {
    expect(await renderPage(page)).toContain("reader mounted");
    expect(auth.requireActor).toHaveBeenCalledWith({fresh:true});
  });
  it.each(["AUTH_NOT_SIGNED_IN", "AUTH_EMAIL_UNVERIFIED", "CONVEX_UNAVAILABLE"])("preserves %s failures", async code => {
    const error = new Error(code + ": request failed");
    auth.requireActor.mockRejectedValue(error);
    await expect(renderPage(page)).rejects.toBe(error);
    expect(readers.school).not.toHaveBeenCalled();
    expect(readers.managebac).not.toHaveBeenCalled();
  });
});
