import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import {
  TrendingUp,
  Loader2,
  AlertTriangle,
  Sparkles,
  Brain,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({
    meta: [
      { title: "Performance Analytics — Sapientia" },
      {
        name: "description",
        content:
          "See how you're trending across subjects and topics — and where to focus next.",
      },
    ],
  }),
  component: AnalyticsPage,
});

type Attempt = {
  id: string;
  user_id: string;
  subject_id: string;
  exam_type: string;
  score_percent: number | null;
  total_questions: number;
  correct_count: number;
  completed_at: string | null;
  started_at: string;
  duration_seconds: number | null;
  subjects?: { id: string; name: string; slug: string };
};

type AnswerRow = {
  id: string;
  attempt_id: string;
  question_id: string;
  is_correct: boolean;
  question?: {
    id: string;
    topic: string | null;
    subject_id: string;
    subjects?: { name: string; slug: string };
  };
};

function AnalyticsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: att } = await supabase
        .from("exam_attempts")
        .select("*, subjects(id, name, slug)")
        .eq("user_id", user.id)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: true });

      const attemptList = (att as Attempt[]) ?? [];
      setAttempts(attemptList);

      if (attemptList.length === 0) {
        setAnswers([]);
        setLoading(false);
        return;
      }

      const ids = attemptList.map((a) => a.id);
      const { data: ans } = await supabase
        .from("attempt_answers")
        .select(
          "id, attempt_id, question_id, is_correct, question:questions(id, topic, subject_id, subjects(name, slug))"
        )
        .in("attempt_id", ids);

      setAnswers((ans as unknown as AnswerRow[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  const overall = useMemo(() => {
    const completed = attempts.filter((a) => a.score_percent != null);
    const totalQ = completed.reduce((s, a) => s + a.total_questions, 0);
    const totalC = completed.reduce((s, a) => s + a.correct_count, 0);
    const avg =
      completed.length === 0
        ? 0
        : Math.round(
            completed.reduce((s, a) => s + Number(a.score_percent), 0) /
              completed.length
          );
    const totalTime = completed.reduce(
      (s, a) => s + (a.duration_seconds ?? 0),
      0
    );
    return {
      examsCompleted: completed.length,
      questionsAnswered: totalQ,
      accuracyAllTime: totalQ ? Math.round((totalC / totalQ) * 100) : 0,
      avgScore: avg,
      hoursStudied: Math.round((totalTime / 3600) * 10) / 10,
    };
  }, [attempts]);

  const trend = useMemo(() => {
    return attempts
      .filter((a) => a.score_percent != null)
      .slice(-20)
      .map((a, i) => ({
        idx: i + 1,
        score: Math.round(Number(a.score_percent)),
        label: a.subjects?.name ?? "",
      }));
  }, [attempts]);

  const bySubject = useMemo(() => {
    const m = new Map<
      string,
      { name: string; total: number; correct: number; attempts: number }
    >();
    for (const a of attempts) {
      if (a.score_percent == null) continue;
      const key = a.subjects?.slug ?? a.subject_id;
      const name = a.subjects?.name ?? "Subject";
      const cur = m.get(key) ?? { name, total: 0, correct: 0, attempts: 0 };
      cur.total += a.total_questions;
      cur.correct += a.correct_count;
      cur.attempts += 1;
      m.set(key, cur);
    }
    return Array.from(m.values())
      .map((s) => ({
        ...s,
        accuracy: s.total ? Math.round((s.correct / s.total) * 100) : 0,
      }))
      .sort((a, b) => b.accuracy - a.accuracy);
  }, [attempts]);

  const byTopic = useMemo(() => {
    const m = new Map<
      string,
      {
        topic: string;
        subject: string;
        total: number;
        correct: number;
      }
    >();
    for (const a of answers) {
      const topic = a.question?.topic ?? "(Untagged)";
      const subject = a.question?.subjects?.name ?? "—";
      const key = `${subject}::${topic}`;
      const cur = m.get(key) ?? { topic, subject, total: 0, correct: 0 };
      cur.total += 1;
      if (a.is_correct) cur.correct += 1;
      m.set(key, cur);
    }
    return Array.from(m.values())
      .map((t) => ({
        ...t,
        accuracy: t.total ? Math.round((t.correct / t.total) * 100) : 0,
      }))
      .filter((t) => t.total >= 2);
  }, [answers]);

  const weakSpots = useMemo(
    () =>
      [...byTopic]
        .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)
        .slice(0, 6),
    [byTopic]
  );

  const strongSpots = useMemo(
    () =>
      [...byTopic]
        .sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)
        .slice(0, 6),
    [byTopic]
  );

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </main>
    );
  }

  if (attempts.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <PageHeader />
        <div className="rounded-2xl border border-border bg-card shadow-paper p-10 text-center">
          <Sparkles className="h-10 w-10 text-accent mx-auto mb-4" />
          <h2 className="font-display text-2xl font-semibold mb-2">
            Nothing to analyse yet.
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Take a mock exam or two — we'll surface your trajectory, subject mastery, and weakest topics here.
          </p>
          <Link
            to="/exam"
            className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-medium text-emerald-foreground hover:bg-emerald/90"
          >
            Take a mock exam <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
      <PageHeader />

      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Avg score" value={`${overall.avgScore}%`} accent />
        <Stat label="All-time accuracy" value={`${overall.accuracyAllTime}%`} />
        <Stat label="Exams completed" value={String(overall.examsCompleted)} />
        <Stat label="Questions answered" value={String(overall.questionsAnswered)} />
        <Stat label="Hours studied" value={`${overall.hoursStudied}h`} />
      </div>

      {/* Trend chart */}
      <section className="rounded-2xl border border-border bg-card shadow-paper p-6 mb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-display text-xl font-semibold">Score trajectory</h2>
            <p className="text-sm text-muted-foreground">
              Last {trend.length} completed exams
            </p>
          </div>
          <TrendingUp className="h-5 w-5 text-emerald" />
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="idx" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(v: number) => [`${v}%`, "Score"]}
                labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""}
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
      </section>

      {/* Subject mastery */}
      <section className="rounded-2xl border border-border bg-card shadow-paper p-6 mb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-display text-xl font-semibold">Subject mastery</h2>
            <p className="text-sm text-muted-foreground">
              Accuracy across all questions, per subject
            </p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bySubject} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                type="number"
                domain={[0, 100]}
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                width={120}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(v: number) => [`${v}%`, "Accuracy"]}
              />
              <Bar dataKey="accuracy" fill="oklch(0.32 0.09 158)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Weak / Strong spots */}
      <section className="grid lg:grid-cols-2 gap-6">
        <TopicList
          title="Weakest topics"
          subtitle="Where to focus next"
          icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
          items={weakSpots}
          tone="weak"
        />
        <TopicList
          title="Strongest topics"
          subtitle="Locked in"
          icon={<Sparkles className="h-5 w-5 text-emerald" />}
          items={strongSpots}
          tone="strong"
        />
      </section>

      <div className="mt-8 rounded-2xl border border-border bg-card shadow-paper p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-emerald" /> Turn weak spots into wins
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Run a spaced-repetition session on questions you've missed.
          </p>
        </div>
        <Link
          to="/review"
          className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-medium text-emerald-foreground hover:bg-emerald/90"
        >
          Start review <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </main>
  );
}

function PageHeader() {
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated">
        <TrendingUp className="h-5 w-5 text-emerald-foreground" />
      </div>
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">
          Performance analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          The story your scores are telling.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
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
      <div
        className={`text-xs uppercase tracking-wider ${
          accent ? "text-emerald-foreground/70" : "text-muted-foreground"
        }`}
      >
        {label}
      </div>
      <div className="mt-1 font-display text-3xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function TopicList({
  title,
  subtitle,
  icon,
  items,
  tone,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: { topic: string; subject: string; total: number; accuracy: number }[];
  tone: "weak" | "strong";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-paper p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {icon}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Need a few more answers per topic to surface this.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((t) => (
            <li
              key={`${t.subject}-${t.topic}`}
              className="flex items-center justify-between py-3"
            >
              <div className="min-w-0 pr-3">
                <div className="text-sm font-medium truncate">{t.topic}</div>
                <div className="text-xs text-muted-foreground">
                  {t.subject} · {t.total} answered
                </div>
              </div>
              <div
                className={`font-display text-lg font-semibold tabular-nums ${
                  tone === "weak" ? "text-destructive" : "text-emerald"
                }`}
              >
                {t.accuracy}%
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}