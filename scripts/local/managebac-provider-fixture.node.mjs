import { test } from "node:test";
import assert from "node:assert/strict";
import { createManageBacProviderFixture } from "./managebac-provider-fixture.mjs";

const token = "spectra-managebac-fixture-token";

test("ManageBac resource fixture serves bounded PDF and Office bytes with revocation controls", async () => {
  const fixture = createManageBacProviderFixture();
  const origin = await fixture.start();
  try {
    const pdf = await fetch(`${origin}/v2p2/classes/101/resources/5101/download`, {
      headers: { "auth-token": token },
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(Buffer.from(await pdf.arrayBuffer()).toString("ascii"), /^%PDF-/);

    fixture.setResourceFormat("office");
    const office = await fetch(`${origin}/v2p2/classes/101/resources/5101/download`, {
      headers: { "auth-token": token },
    });
    assert.equal(office.status, 200);
    assert.equal(office.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(Buffer.from(await office.arrayBuffer()).subarray(0, 2).toString("ascii"), "PK");

    fixture.setResourceState("revoked");
    assert.equal((await fetch(`${origin}/v2p2/classes/101/resources/5101/download`, { headers: { "auth-token": token } })).status, 403);
    fixture.setResourceState("missing");
    assert.equal((await fetch(`${origin}/v2p2/classes/101/resources/5101/download`, { headers: { "auth-token": token } })).status, 404);
    fixture.setResourceState("available");
    fixture.setRedirectResource(true);
    assert.equal((await fetch(`${origin}/v2p2/classes/101/resources/5101/download`, { headers: { "auth-token": token }, redirect: "manual" })).status, 302);
    assert.ok(fixture.requests.filter((request) => request.path.endsWith("/download")).length >= 5);
  } finally {
    await fixture.stop();
  }
});
