import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

type SoulDoc = {
  title: string;
  section: string;
  content: string;
};

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 24);
}

function chunkText(value: string, size = 420) {
  const text = value.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + size);
    out.push(text.slice(cursor, end));
    if (end === text.length) break;
    cursor = Math.max(0, end - 120);
  }
  return out;
}

function lexicalPreview(query: string, docs: SoulDoc[], limit = 8) {
  const queryTokens = tokenize(query);
  const scored = docs.flatMap((doc) =>
    chunkText(doc.content)
      .slice(0, 10)
      .map((piece, index) => {
        const haystack = `${doc.title} ${doc.section} ${piece}`.toLowerCase();
        const score = queryTokens.length === 0
          ? 1
          : queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0) / queryTokens.length;
        return { score, index, piece, docTitle: doc.title };
      }),
  );

  const selected = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .filter((row) => row.score > 0)
    .slice(0, Math.min(10, Math.max(4, limit)));

  if (selected.length === 0) {
    return docs
      .flatMap((doc) => chunkText(doc.content).slice(0, 1).map((piece) => ({ docTitle: doc.title, piece })))
      .slice(0, Math.min(10, Math.max(4, limit)))
      .map((row) => `- [${row.docTitle}] ${row.piece.slice(0, 220)}`);
  }

  return selected.map((row) => `- [${row.docTitle}] ${row.piece.slice(0, 220)}`);
}

function shouldFallbackToLexical(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("OPENROUTER_API_KEY missing") ||
    message.includes("OPENROUTER_API_KEY") ||
    message.toLowerCase().includes("embedding failed") ||
    message.toLowerCase().includes("embedding missing")
  );
}

function soulActionErrorResponse(error: unknown, action: "preview" | "publish") {
  console.error("[api/admin/soul] SOUL action failed", error);
  return badRequest(
    action === "publish" ? "Failed to publish SOUL due to a server error." : "Failed to preview SOUL due to a server error.",
    500,
  );
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "teacher" && actor.role !== "admin") {
      return badRequest("Only teacher/admin", 403);
    }

    const previewQuery = request.nextUrl.searchParams.get("preview");
    if (previewQuery && previewQuery.trim()) {
      try {
        const guidance = await convexAction("soul:retrieveSoulGuidance", {
          actorClerkId: actor.clerkId,
          query: previewQuery,
          limit: 8,
        });
        return ok({ preview: guidance, embeddingsConfigured: Boolean(process.env.OPENROUTER_API_KEY) });
      } catch (error) {
        try {
          const docs = await convexQuery("soul:listSoulDocs", {
            actorClerkId: actor.clerkId,
          }) as SoulDoc[];
          return ok({
            preview: { bullets: lexicalPreview(previewQuery, docs, 8) },
            embeddingsConfigured: false,
            fallback: shouldFallbackToLexical(error) ? "lexical" : "lexical-recovery",
          });
        } catch {
          return soulActionErrorResponse(error, "preview");
        }
      }
    }

    const docs = await convexQuery("soul:listSoulDocs", {
      actorClerkId: actor.clerkId,
    });
    return ok({ docs, embeddingsConfigured: Boolean(process.env.OPENROUTER_API_KEY) });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "teacher" && actor.role !== "admin") {
      return badRequest("Only teacher/admin", 403);
    }

    const body = (await request.json()) as {
      title?: string;
      section?: string;
      content?: string;
    };

    if (!body.title?.trim() || !body.section?.trim() || !body.content?.trim()) {
      return badRequest("title, section, content are required");
    }

    const result = await convexMutation("soul:upsertSoulDoc", {
      actorClerkId: actor.clerkId,
      title: body.title.trim(),
      section: body.section.trim(),
      content: body.content.trim(),
    });
    return ok(result);
  });
}

export async function PATCH() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    if (actor.role !== "teacher" && actor.role !== "admin") {
      return badRequest("Only teacher/admin", 403);
    }

    try {
      const result = await convexAction("soul:publishSoul", {
        actorClerkId: actor.clerkId,
      });
      return ok(result);
    } catch (error) {
      try {
        const lexical = await convexMutation<{ actorClerkId: string }, {
          ok?: boolean;
          chunkCount?: number;
          fallback?: string;
          docsPublished?: number;
        }>("soul:publishSoulLexical", {
          actorClerkId: actor.clerkId,
        });
        return ok({
          ...lexical,
          fallback: "lexical",
          warning: shouldFallbackToLexical(error)
            ? "Embeddings unavailable. SOUL is published via lexical fallback."
            : "Publish recovered through lexical fallback.",
        });
      } catch {
        if (shouldFallbackToLexical(error)) {
          return ok({
            ok: true,
            chunkCount: 0,
            fallback: "lexical",
            warning: "Embeddings unavailable. SOUL will run via lexical fallback.",
          });
        }
        return soulActionErrorResponse(error, "publish");
      }
    }
  });
}
