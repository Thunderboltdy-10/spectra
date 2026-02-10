import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-app px-4 py-8">
      <div className="w-full max-w-4xl rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-lg)] md:grid md:grid-cols-[1.1fr_1fr] md:gap-6 md:p-8">
        <section className="mb-6 md:mb-0">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[var(--text-secondary)]">AI School Assistant</p>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Continue learning with multiple AI models, custom classroom agents, and guided study workflows.
          </p>
        </section>

        <section className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
          <SignIn />
        </section>
      </div>
    </main>
  );
}
