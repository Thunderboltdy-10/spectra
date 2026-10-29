import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const DEFAULT_TOKEN = "spectra-managebac-fixture-token";
const SUBMITTED_TEXT = "Sequences essay. An arithmetic sequence adds the same difference each step.\n";

function json(value) {
  return JSON.stringify(value);
}

function send(response, status, value) {
  const body = json(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function classPayload(classId, revision) {
  const classes = {
    "101": {
      id: 101,
      uniq_class_id: "math-101",
      name: "Mathematics HL",
      description: "Fixture class catalogue entry",
      year_group_id: 12,
    },
    "202": {
      id: 202,
      uniq_class_id: "history-202",
      name: "History HL",
      description: "Second fixture class for selection coverage",
      year_group_id: 12,
    },
  };
  const value = classes[classId] ?? classes["101"];
  return { class: { ...value, revision } };
}

function taskPayload(classId, revision) {
  const changed = revision > 1;
  const tasks = {
    "101": [
      {
        id: 3001,
        title: changed ? "Functions problem set — updated" : "Functions problem set",
        description: "Fixture task for selected-class polling.",
        due_at: changed ? "2026-09-19T16:30:00Z" : "2026-09-18T16:00:00Z",
        updated_at: revision,
      },
      {
        id: 3003,
        title: "Sequences essay",
        description: "A task already due, with a grade and a handed-in file.",
        due_at: "2026-09-10T16:00:00Z",
        updated_at: revision,
      },
    ],
    "202": [
      {
        id: 3002,
        title: "Primary sources reflection",
        description: "Fixture task for the second class.",
        due_at: "2026-09-20T16:00:00Z",
        updated_at: revision,
      },
    ],
  };
  return { tasks: tasks[classId] ?? [], meta: { next_page: null } };
}

function timetablePayload(classId, revision) {
  const title = classId === "202" ? "History HL" : revision > 1 ? "Mathematics HL — changed" : "Mathematics HL";
  return {
    timetable: {
      academic_years: [
        {
          id: 2026,
          slots: [
            {
              id: classId === "202" ? 4202 : 4101,
              title,
              day: 2,
              period: classId === "202" ? 2 : 1,
              start_at: "2026-09-15T08:30:00Z",
              end_at: "2026-09-15T09:20:00Z",
              room: classId === "202" ? "Room 202" : "Room 101",
              updated_at: revision,
            },
          ],
        },
      ],
    },
  };
}

function resourcePayload(classId, revision) {
  const office = classId === "202";
  return {
    resources: [
      {
        id: classId === "202" ? 5202 : 5101,
        title: classId === "202" ? "Primary sources pack.xlsx" : "Functions reference sheet.pdf",
        filename: classId === "202" ? "primary-sources-pack.xlsx" : "functions-reference-sheet.pdf",
        mime_type: office
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
        description: "Fixture resource with a deterministic provider identity.",
        url: `https://fixture.invalid/resources/${classId}/${revision}`,
        updated_at: revision,
      },
    ],
    meta: { next_page: null },
  };
}

/**
 * Start a deterministic local ManageBac-shaped API. The returned request log
 * is intentionally in-memory so tests can assert actual outbound route calls
 * without persisting credentials or provider payloads.
 */
export function createManageBacProviderFixture({
  token = DEFAULT_TOKEN,
  initialRevision = 1,
  noMatch = false,
  delayMs = 0,
  resourceState = "available",
  resourceFormat = "mixed",
  redirectResource = false,
} = {}) {
  const requests = [];
  let revision = initialRevision;
  let currentDelayMs = delayMs;
  let currentResourceState = resourceState;
  let currentResourceFormat = resourceFormat;
  let currentRedirectResource = redirectResource;
  const officeBytes = readFileSync(new URL("../../fixtures/office/xlsx/representative.xlsm", import.meta.url));
  const pdfBytes = (nextRevision) => Buffer.from(`%PDF-1.4\n% Spectra fixture revision ${nextRevision}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "ascii");
  function sendBytes(response, status, bytes, contentType) {
    response.writeHead(status, {
      "content-type": contentType,
      "content-length": bytes.byteLength,
      "cache-control": "no-store",
    });
    response.end(bytes);
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const authenticated = request.headers["x-api-key"] === token || request.headers["auth-token"] === token;
    requests.push({ method: request.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), authenticated });
    if (Number.isFinite(currentDelayMs) && currentDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, currentDelayMs));
    // Short-lived file storage a download redirects to. It never needs, and
    // must never receive, the school's API key.
    if (url.pathname === "/signed/8801") {
      if (request.headers["x-api-key"] || request.headers["auth-token"])
        return send(response, 400, { error: "fixture storage received an API key" });
      return sendBytes(response, 200, Buffer.from(SUBMITTED_TEXT, "utf8"), "text/plain");
    }
    if (
      request.headers["x-api-key"] !== token &&
      request.headers["auth-token"] !== token
    )
      return send(response, 401, { error: "fixture credential rejected" });
    if (request.method !== "GET")
      return send(response, 405, { error: "fixture is read-only" });
    if (url.pathname === "/v2p2/students")
      return send(response, 200, {
        students: noMatch
          ? []
          : [
              {
                id: 9001,
                email: url.searchParams.get("q") ?? "student@example.test",
                first_name: "Fixture",
                last_name: "Student",
                role: "student",
                year_group_id: 12,
              },
            ],
      });
    if (url.pathname === "/v2p2/students/9001/memberships")
      return send(response, 200, {
        memberships: url.searchParams.get("archived") === "true" ? [] : [
          { id: 1001, user_id: 9001, class_id: 101, class_name: "Mathematics HL", archived: false },
          { id: 1002, user_id: 9001, class_id: 202, class_name: "History HL", archived: false },
          // Another student's row never reaches Spectra.
          { id: 1003, user_id: 9002, class_id: 303, class_name: "Someone else's class", archived: false },
        ],
        meta: { next_page: null },
      });
    const resultMatch = url.pathname.match(/^\/v2p2\/classes\/(\d+)\/tasks\/(\d+)\/students$/);
    if (resultMatch)
      return send(response, 200, {
        students: [
          { id: 9001, grade: "6", score: 18, max_score: 24, comments: "Clear argument; cite the sources.", updated_at: revision },
          // Answered even when the request named one student: dropped by Spectra.
          { id: 9002, grade: "3", comments: "Not yours." },
        ].filter((row) => resultMatch[2] === "3003" || row.id === 0),
      });
    const submissionMatch = url.pathname.match(/^\/v2p2\/classes\/(\d+)\/tasks\/(\d+)\/submissions\/(\d+)$/);
    if (submissionMatch) {
      if (submissionMatch[2] !== "3003" || submissionMatch[3] !== "9001")
        return send(response, 404, { error: "no submission" });
      return send(response, 200, {
        submission: {
          id: 7703,
          student_id: 9001,
          status: "submitted",
          submitted_at: "2026-09-10T15:00:00Z",
          files: [
            {
              id: 8801,
              filename: "sequences-essay.txt",
              file_size: Buffer.byteLength(SUBMITTED_TEXT, "utf8"),
              content_type: "text/plain",
              download_path: "/v2p2/files/8801/download",
            },
          ],
        },
      });
    }
    if (url.pathname === "/v2p2/files/8801/download") {
      response.writeHead(302, { location: "/signed/8801" });
      return response.end();
    }
    const downloadMatch = url.pathname.match(/^\/v2p2\/classes\/(\d+)\/resources\/(\d+)\/download$/);
    if (downloadMatch) {
      if (currentRedirectResource) {
        response.writeHead(302, { location: "https://not-allowed.invalid/redirect" });
        return response.end();
      }
      if (currentResourceState === "missing") return send(response, 404, { error: "fixture resource missing" });
      if (currentResourceState === "revoked") return send(response, 403, { error: "fixture resource revoked" });
      const isOffice = currentResourceFormat === "office" ||
        (currentResourceFormat === "mixed" && downloadMatch[1] === "202");
      return sendBytes(
        response,
        200,
        isOffice ? officeBytes : pdfBytes(revision),
        isOffice ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
      );
    }
    const classMatch = url.pathname.match(/^\/v2p2\/classes\/(\d+)(?:\/(tasks|timetable|resources))?$/);
    if (classMatch) {
      const [, classId, child] = classMatch;
      if (child === "tasks") return send(response, 200, taskPayload(classId, revision));
      if (child === "timetable") return send(response, 200, timetablePayload(classId, revision));
      if (child === "resources") return send(response, 200, resourcePayload(classId, revision));
      return send(response, 200, classPayload(classId, revision));
    }
    if (url.pathname.includes("/cas/experiences/students"))
      return send(response, 200, {
        students: [
          { id: 9001, experiences: [{ id: 6601, name: "Beach clean-up", status: "approved", service: true, updated_at: revision }] },
          // Asked for one student, answered with two: the other's are dropped.
          { id: 9002, experiences: [{ id: 6602, name: "Someone else's experience" }] },
        ],
        meta: { next_page: null },
      });
    return send(response, 404, { error: "fixture route not found" });
  });

  return {
    server,
    requests,
    get revision() {
      return revision;
    },
    setRevision(nextRevision) {
      if (!Number.isInteger(nextRevision) || nextRevision < 1)
        throw new Error("Fixture revision must be a positive integer.");
      revision = nextRevision;
    },
    setResourceState(nextState) {
      if (!["available", "missing", "revoked"].includes(nextState)) throw new Error("Fixture resource state is invalid.");
      currentResourceState = nextState;
    },
    setDelay(nextDelayMs) {
      if (!Number.isFinite(nextDelayMs) || nextDelayMs < 0) throw new Error("Fixture delay must be non-negative.");
      currentDelayMs = nextDelayMs;
    },
    setResourceFormat(nextFormat) {
      if (!["mixed", "pdf", "office"].includes(nextFormat)) throw new Error("Fixture resource format is invalid.");
      currentResourceFormat = nextFormat;
    },
    setRedirectResource(enabled) {
      currentRedirectResource = Boolean(enabled);
    },
    async start(port = 0) {
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture did not bind.");
      return `http://127.0.0.1:${address.port}`;
    },
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const fixture = createManageBacProviderFixture({
    token: process.env.MANAGEBAC_FIXTURE_TOKEN ?? DEFAULT_TOKEN,
    initialRevision: Number(process.env.MANAGEBAC_FIXTURE_REVISION ?? 1),
  });
  const origin = await fixture.start(Number(process.env.MANAGEBAC_FIXTURE_PORT ?? 0));
  console.log(JSON.stringify({ origin, token: process.env.MANAGEBAC_FIXTURE_TOKEN ?? DEFAULT_TOKEN }));
  const stop = async () => {
    await fixture.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
