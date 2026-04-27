import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Brain,
  Target,
  TrendingUp,
  Flame,
  ArrowRight,
  BookOpen,
  Sparkles,
  RotateCw,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Sapientia" }] }),
  component: Dashboard,
});

type Attempt = {
  id: string;
  subject_id: string;
  exam_type: string;
  score_percent: number | null;
  total_questions: number;
  correct_count: number;
  completed_at: string | null;
  started_at: string;
  subjects?: { name: string; slug: string };
};

type StatsRow = {
  xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  daily_goal: number;
};

type EarnedBadge = {
  earned_at: string;
  badges: { slug: string; name: string; icon: string; description: string } | null;
};

function Dashboard() {
  const { user, profile } = useAuth();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [todayAnswered, setTodayAnswered] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [a, s, b, d] = await Promise.all([
        supabase
          .from("exam_attempts")
          .select("*, subjects(name, slug)")
          .eq("user_id", user.id)
          .order("started_at", { ascending: false })
          .limit(20),
        supabase.from("user_stats").select("*").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("user_badges")
          .select("earned_at, badges(slug, name, icon, description)")
          .eq("user_id", user.id)
          .order("earned_at", { ascending: false }),
        supabase
          .from("daily_activity")
          .select("questions_answered")
          .eq("user_id", user.id)
          .eq("activity_date", today)
          .maybeSingle(),
      ]);
      setAttempts((a.data as Attempt[]) ?? []);
      setStats((s.data as StatsRow) ?? null);
      setBadges((b.data as EarnedBadge[]) ?? []);
      setTodayAnswered(d.data?.questions_answered ?? 0);
      setLoading(false);
    })();
  }, [user]);

  const completedAttempts = attempts.filter((a) => a.completed_at && a.score_percent != null);
  const avgScore = completedAttempts.length
    ? Math.round(
        completedAttempts.reduce((s, a) => s + Number(a.score_percent), 0) /
          completedAttempts.length
      )
    : 0;

  // Per-subject averages
  const bySubject: Record<string, { name: string; scores: number[] }> = {};
  for (const a of completedAttempts) {
    const key = a.subjects?.slug ?? a.subject_id;
    const name = a.subjects?.name ?? "Subject";
    if (!bySubject[key]) bySubject[key] = { name, scores: [] };
    bySubject[key].scores.push(Number(a.score_percent));
  }

  const trendData = [...completedAttempts]
    .reverse()
    .slice(-10)
    .map((a, i) => ({
      x: i + 1,
      score: Number(a.score_percent),
    }));

  // Streak: prefer DB-backed streak, fall back to derived from attempts
  const streak = stats?.current_streak ?? computeStreak(completedAttempts.map((a) => a.completed_at!));
  const xp = stats?.xp ?? 0;
  const level = stats?.level ?? 1;
  const dailyGoal = stats?.daily_goal ?? 10;
  const goalProgress = Math.min(100, Math.round((todayAnswered / dailyGoal) * 100));

  const firstName = (profile?.display_name || profile?.full_name || "Student").split(" ")[0];

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
      {/* Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-emerald font-semibold">
            Welcome back
          </div>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            Good to see you, {firstName}.
          </h1>
          <p className="mt-2 text-muted-foreground">
            {profile?.target_exam === "both"
              ? "Preparing for WAEC + JAMB"
              : `Preparing for ${profile?.target_exam?.toUpperCase()}`}
            {profile?.exam_year && ` · ${profile.exam_year}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/review">
            <Button variant="outline" className="gap-2">
              <RotateCw className="h-4 w-4" /> Review due
            </Button>
          </Link>
          <Link to="/analytics">
            <Button variant="outline" className="gap-2">
              <TrendingUp className="h-4 w-4" /> Analytics
            </Button>
          </Link>
          <Link to="/tutor">
            <Button variant="outline" className="gap-2">
              <Brain className="h-4 w-4" /> Ask AI Tutor
            </Button>
          </Link>
          <Link to="/exam">
            <Button className="bg-emerald text-emerald-foreground hover:bg-emerald/90 gap-2">
              <Target className="h-4 w-4" /> Take Mock Exam
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Sparkles} label={`Level ${level} · XP`} value={String(xp)} accent />
        <StatCard icon={Flame} label="Day streak" value={String(streak)} />
        <StatCard icon={TrendingUp} label="Average score" value={`${avgScore}%`} />
        <StatCard icon={Target} label="Exams taken" value={String(completedAttempts.length)} />
      </div>

      {/* Daily goal + badges */}
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <div className="md:col-span-2 rounded-2xl border border-border bg-card shadow-paper p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-semibold">Today's goal</h3>
            <span className="text-sm tabular-nums text-muted-foreground">
              {todayAnswered}/{dailyGoal} questions
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-gradient-hero rounded-full transition-all"
              style={{ width: `${goalProgress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {goalProgress >= 100
              ? "🎉 Goal smashed for today — your streak is safe!"
              : `${dailyGoal - todayAnswered} to go to keep your streak alive.`}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card shadow-paper p-5">
          <h3 className="font-display font-semibold mb-3">Badges</h3>
          {badges.length === 0 ? (
            <p className="text-xs text-muted-foreground">Earn badges by hitting streaks and XP milestones.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {badges.slice(0, 8).map((b, i) => (
                <span
                  key={i}
                  title={`${b.badges?.name} — ${b.badges?.description}`}
                  className="text-2xl"
                >
                  {b.badges?.icon}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Trend + subjects */}
      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-paper p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display text-xl font-semibold">Score trajectory</h2>
              <p className="text-sm text-muted-foreground">Last {trendData.length} mock exams</p>
            </div>
            <Sparkles className="h-5 w-5 text-accent" />
          </div>
          {trendData.length === 0 ? (
            <EmptyTrend />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="x" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="oklch(0.32 0.09 158)"
                    strokeWidth={2.5}
                    dot={{ fill: "oklch(0.78 0.17 75)", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-paper p-6">
          <h2 className="font-display text-xl font-semibold mb-1">By subject</h2>
          <p className="text-sm text-muted-foreground mb-5">Average score</p>
          <div className="space-y-4">
            {Object.entries(bySubject).length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Take a mock exam to see your stats here.
              </p>
            ) : (
              Object.entries(bySubject).map(([key, val]) => {
                const avg = Math.round(
                  val.scores.reduce((s, x) => s + x, 0) / val.scores.length
                );
                return (
                  <div key={key}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-medium">{val.name}</span>
                      <span className="font-display tabular-nums">{avg}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-gradient-hero rounded-full transition-all"
                        style={{ width: `${avg}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Recent attempts */}
      <div className="rounded-2xl border border-border bg-card shadow-paper p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl font-semibold">Recent activity</h2>
          <Link to="/exam" className="text-sm text-emerald hover:underline">
            New exam <ArrowRight className="inline h-3 w-3" />
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : attempts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-display text-lg">No attempts yet.</p>
            <p className="text-sm text-muted-foreground mt-1 mb-5">
              Take your first mock exam — it only takes a few minutes.
            </p>
            <Link to="/exam">
              <Button className="bg-emerald text-emerald-foreground hover:bg-emerald/90">
                Start a mock exam
              </Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {attempts.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{a.subjects?.name ?? "Subject"}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.exam_type.toUpperCase()} ·{" "}
                    {new Date(a.started_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <div className="text-right">
                  {a.score_percent != null ? (
                    <>
                      <div className="font-display text-lg font-semibold tabular-nums text-emerald">
                        {Math.round(Number(a.score_percent))}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.correct_count}/{a.total_questions}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">In progress</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        accent
          ? "bg-gradient-hero border-transparent text-emerald-foreground shadow-elevated"
          : "bg-card border-border shadow-paper"
      }`}
    >
      <Icon className={`h-5 w-5 ${accent ? "text-accent" : "text-emerald"}`} />
      <div
        className={`mt-3 text-xs uppercase tracking-wider ${
          accent ? "text-emerald-foreground/70" : "text-muted-foreground"
        }`}
      >
        {label}
      </div>
      <div className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EmptyTrend() {
  return (
    <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
      Take a few mock exams to see your trajectory.
    </div>
  );
}

function computeStreak(timestamps: string[]): number {
  if (timestamps.length === 0) return 0;
  const days = new Set(
    timestamps.map((t) => new Date(t).toISOString().slice(0, 10))
  );
  let streak = 0;
  const cur = new Date();
  while (true) {
    const key = cur.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}
