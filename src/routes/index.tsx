import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import {
  Brain,
  Target,
  LineChart,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  BookMarked,
  Zap,
  Lock,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sapientia — Learn deeply for WAEC & JAMB" },
      {
        name: "description",
        content:
          "Stop memorising. Start understanding. Adaptive AI tutor, realistic mock exams and honest performance tracking — built for Nigerian students.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background paper-grain">
      <SiteHeader />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -top-32 -right-24 h-96 w-96 rounded-full bg-emerald/10 blur-3xl" />
          <div className="absolute top-40 -left-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        </div>

        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald/20 bg-emerald/5 px-4 py-1.5 text-xs font-medium text-emerald">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Built for WAEC · JAMB · UTME</span>
            </div>

            <h1 className="mt-6 font-display text-5xl sm:text-6xl md:text-7xl font-semibold leading-[1.02] tracking-tight text-balance">
              Stop memorising.
              <br />
              <span className="italic text-emerald">Start understanding.</span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-muted-foreground text-balance leading-relaxed">
              Sapientia is an adaptive AI study companion that teaches you how to think —
              not just what to write. Mock exams, personalised tutoring, and a clear view
              of where you stand.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/auth" search={{ mode: "signup" }}>
                <Button
                  size="lg"
                  className="w-full sm:w-auto bg-emerald text-emerald-foreground hover:bg-emerald/90 shadow-elevated text-base h-12 px-8"
                >
                  Start preparing free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#features">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto h-12 px-8 text-base border-border"
                >
                  See how it works
                </Button>
              </a>
            </div>

            <div className="mt-8 flex items-center justify-center gap-6 text-xs uppercase tracking-wider text-muted-foreground">
              <span>5 core subjects</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <span>WAEC + JAMB formats</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <span>Free to start</span>
            </div>
          </div>

          {/* Hero "paper" mock card */}
          <div className="mt-16 mx-auto max-w-3xl">
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-gold opacity-30 blur-2xl rounded-3xl" />
              <div className="relative rounded-2xl border border-border bg-card shadow-elevated overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/30">
                  <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-accent" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald" />
                  <div className="ml-3 text-xs text-muted-foreground font-mono">sapientia · physics · jamb 2024</div>
                </div>
                <div className="p-6 sm:p-8 space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald text-emerald-foreground text-xs font-bold">
                      Q
                    </div>
                    <p className="text-base sm:text-lg text-foreground leading-relaxed">
                      A body of mass 5kg moves with velocity 10 m/s. What is its kinetic energy?
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold">
                      AI
                    </div>
                    <div className="space-y-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
                      <p>
                        Don't just memorise the formula. Picture <em className="text-foreground">why</em> it's there.
                        Kinetic energy = ½mv². Mass measures inertia, velocity squared captures how dramatically
                        speed amplifies energy.
                      </p>
                      <p className="text-foreground font-medium">
                        ½ × 5 × 10² = <span className="text-emerald">250 J</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-emerald font-semibold mb-4">
                The Problem
              </div>
              <h2 className="font-display text-4xl sm:text-5xl font-semibold leading-tight text-balance">
                Students are taught to memorise — not to learn.
              </h2>
            </div>
            <div className="space-y-4 text-lg text-muted-foreground leading-relaxed">
              <p>
                You cram formulas, definitions, and past questions. You walk into the exam hall
                hoping the right ones come up. When they don't, the wall comes down.
              </p>
              <p className="text-foreground font-medium">
                Sapientia builds the bridge from "I memorised it" to "I understand it" — so
                exam day is recognition, not roulette.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SOLUTION / FEATURES */}
      <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="text-xs uppercase tracking-[0.2em] text-emerald font-semibold mb-4">
            The Solution
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold leading-tight text-balance">
            One companion. Three ways to grow.
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={Brain}
            label="Adaptive AI Tutor"
            title="Ask anything. Understand everything."
            description="A patient AI that explains concepts the way a great teacher would — with context, analogies, and worked examples tuned to WAEC & JAMB."
          />
          <FeatureCard
            icon={Target}
            label="Mock Exams"
            title="Real exam, real pressure."
            description="Timed CBT-style mock exams with authentic WAEC and JAMB question patterns. Get scored instantly with explanations."
            highlighted
          />
          <FeatureCard
            icon={LineChart}
            label="Performance Tracking"
            title="Know exactly where you stand."
            description="See your weakest topics, your study streak, and your trajectory by subject. No false confidence."
          />
        </div>
      </section>

      {/* TRUST & SOVEREIGNTY */}
      <section id="trust" className="bg-emerald text-emerald-foreground">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <div className="grid md:grid-cols-5 gap-12 items-center">
            <div className="md:col-span-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-foreground/20 px-3 py-1 text-xs uppercase tracking-[0.18em]">
                <ShieldCheck className="h-3.5 w-3.5" />
                Trust & Sovereignty
              </div>
              <h2 className="mt-5 font-display text-4xl sm:text-5xl font-semibold leading-tight">
                Your learning history is <span className="italic text-accent">yours</span>.
              </h2>
            </div>
            <div className="md:col-span-3 space-y-6">
              <p className="text-lg leading-relaxed text-emerald-foreground/85">
                Every question you answer, every concept you struggled with, every gain you make
                — it belongs to you. Not to your school. Not to advertisers. Not to us.
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                <TrustPill icon={Lock} title="You own it" sub="Export anytime" />
                <TrustPill icon={Zap} title="You control it" sub="Pause learning trail" />
                <TrustPill icon={BookMarked} title="You delete it" sub="One-click wipe" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 py-24 text-center">
        <h2 className="font-display text-4xl sm:text-5xl font-semibold leading-tight text-balance">
          Your exam is coming.
          <br />
          <span className="italic text-emerald">So is your edge.</span>
        </h2>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
          Join the students preparing the smarter way.
        </p>
        <Link to="/auth" search={{ mode: "signup" }}>
          <Button
            size="lg"
            className="mt-8 bg-emerald text-emerald-foreground hover:bg-emerald/90 shadow-elevated h-12 px-8 text-base"
          >
            Create free account
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div>© {new Date().getFullYear()} Sapientia · #SW-07</div>
          <div className="font-display italic">Sapientia est potentia.</div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  label,
  title,
  description,
  highlighted,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  description: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`group rounded-2xl border p-7 transition-all hover:-translate-y-1 ${
        highlighted
          ? "bg-card border-emerald/30 shadow-elevated"
          : "bg-card border-border shadow-paper hover:shadow-elevated"
      }`}
    >
      <div
        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${
          highlighted ? "bg-gradient-hero text-emerald-foreground" : "bg-muted text-emerald"
        }`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-5 text-[10px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">
        {label}
      </div>
      <h3 className="mt-2 font-display text-xl font-semibold leading-snug">{title}</h3>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

function TrustPill({
  icon: Icon,
  title,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-emerald-foreground/15 bg-emerald-foreground/5 p-4">
      <Icon className="h-5 w-5 text-accent" />
      <div className="mt-2 font-semibold">{title}</div>
      <div className="text-xs text-emerald-foreground/70 mt-0.5">{sub}</div>
    </div>
  );
}
