import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

function getSearchParam(
  value: string | string[] | undefined,
) {
  return Array.isArray(value) ? value[0] : value;
}

function SignUpCard({ redirectUrl }: { redirectUrl?: string }) {
  const invitationFlow = redirectUrl?.includes("/join?token=") ?? false;

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg-primary)] px-4 py-8">
      <div className="w-full max-w-4xl">
        <div className="mx-auto mb-6 flex w-fit rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
          <Link
            href="/sign-in"
            className="rounded-md px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
          <span className="rounded-md bg-[var(--bg-elevated)] px-4 py-1.5 text-sm font-medium text-[var(--text-primary)] shadow-sm">
            Sign up
          </span>
        </div>

        <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)] md:grid md:grid-cols-[1.1fr_1fr] md:gap-6 md:p-8">
          <section className="mb-6 md:mb-0">
            <h1 className="font-display text-2xl text-[var(--text-primary)]">Create your account</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Join your school workspace to chat with AI, use curriculum resources, and build subject-specific agents.
            </p>
            <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
              {invitationFlow ? (
                <>Create the account using the exact email address that received the invitation. After sign-up, the invitation will be completed automatically.</>
              ) : (
                <>
                  School access is invitation-based. If your school has not invited you yet, submit an access request first.
                  {" "}
                  <Link href="/request-access" className="text-[var(--accent-cyan)] hover:underline">
                    Request access
                  </Link>
                </>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <SignUp forceRedirectUrl={redirectUrl} />
          </section>
        </div>
      </div>
    </main>
  );
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectUrl = getSearchParam(params.redirect_url);
  return <SignUpCard redirectUrl={redirectUrl} />;
}
