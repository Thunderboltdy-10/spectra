import Link from "next/link";
import { PublicFrame } from "@/components/public-frame";
import { Button } from "@/components/ui/button";

const STEPS = [
  "Choose the school email you'll sign up with.",
  "Ask a teacher or your school's Spectra admin to invite that email.",
  "Open the invitation link, make your account, and join.",
];

export default function RequestAccessPage() {
  return (
    <PublicFrame>
      <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.03em]">
        Getting into Spectra
      </h1>
      <p className="mt-3 text-ui leading-6 text-[var(--text-secondary)]">
        Spectra works by school invitation. Ask your school to invite the email you&rsquo;ll sign up with. If your school
        isn&rsquo;t on Spectra yet, your school&rsquo;s admin can get in touch with us.
      </p>
      <ol className="mt-6 space-y-1">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-baseline gap-3 rounded-control px-2.5 py-2 text-ui">
            <span className="w-4 shrink-0 text-caption font-semibold text-[var(--text-tertiary)]">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap gap-2">
        <Button asChild variant="primary" size="lg">
          <Link href="/join">I have an invitation</Link>
        </Button>
        <Button asChild size="lg">
          <Link href="/sign-up">Sign up</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </PublicFrame>
  );
}
