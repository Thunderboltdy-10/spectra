import { createServer } from "node:http";

const DEFAULT_TOKEN = "spectra-managebac-fixture-token";

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
  return {
    resources: [
      {
        id: classId === "202" ? 5202 : 5101,
        title: classId === "202" ? "Primary sources pack" : "Functions reference sheet",
        description: "Fixture resource with a deterministic source URL.",
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
} = {}) {
  const requests = [];
  let revision = initialRevision;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams) });
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
    if (url.pathname === "/v2p2/memberships")
      return send(response, 200, {
        memberships: [
          { id: 1001, user_id: 9001, class_id: 101, class_name: "Mathematics HL", user_email: "student@example.test" },
          { id: 1002, user_id: 9001, class_id: 202, class_name: "History HL", user_email: "student@example.test" },
        ],
        meta: { next_page: null },
      });
    const classMatch = url.pathname.match(/^\/v2p2\/classes\/(\d+)(?:\/(tasks|timetable|resources))?$/);
    if (classMatch) {
      const [, classId, child] = classMatch;
      if (child === "tasks") return send(response, 200, taskPayload(classId, revision));
      if (child === "timetable") return send(response, 200, timetablePayload(classId, revision));
      if (child === "resources") return send(response, 200, resourcePayload(classId, revision));
      return send(response, 200, classPayload(classId, revision));
    }
    if (url.pathname.includes("/cas/experiences/students"))
      return send(response, 200, { students: [{ id: 9001, experiences: [] }], meta: { next_page: null } });
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
