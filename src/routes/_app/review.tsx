import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  normalizeQuestion,
  shuffle,
  type NormalizedQuestion,
} from "@/lib/question-utils";
import { recordReview } from "@/lib/srs";
import {
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  ArrowRight,
  RotateCw,
  Inbox,
} from "lucide-react";

export const Route = createFileRoute("/_app/review")({
  head: () => ({
    meta: [
      { title: "Review Due — Sapientia" },
      {
        name: "description",
        content:
          "Spaced-repetition review of questions you've struggled with — sharpened just before you'd forget.",
      },
    ],
  }),
  component: ReviewPage,
});

type DueRow = {
  id: string;
  question_id: string;
  due_at: string;
  question: NormalizedQuestion;
  subject: { id: string; name: string; slug: string } | null;
};

function ReviewPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<DueRow[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<{ correct: number; total: number }>({
    correct: 0,
    total: 0,
  });
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    if (!user) return;
    setLoading(true);
    setDone(false);
    setIdx(0);
    setSelected(null);
    setRevealed(false);
    setResults({ correct: 0, total: 0 });

    const { data: dueRows } = await supabase
      .from("review_queue")
      .select("id, question_id, due_at")
      .eq("user_id", user.id)
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(40);

    const ids = (dueRows ?? []).map((r) => r.question_id);
    if (ids.length === 0) {
      setQueue([]);
      setLoading(false);
      return;
    }

    const { data: qs } = await supabase
      .from("questions")
      .select("*, subjects(id, name, slug)")
      .in("id", ids);

    const byId = new Map<string, DueRow>();
    for (const r of dueRows ?? []) {
      const raw = (qs ?? []).find((q) => q.id === r.question_id);
      if (!raw) continue;
      byId.set(r.question_id, {
        id: r.id,
        question_id: r.question_id,
        due_at: r.due_at,
        question: normalizeQuestion(raw as Record<string, unknown>),
        subject: (raw as { subjects?: { id: string; name: string; slug: string } | null })
          .subjects ?? null,
      });
    }

    setQueue(shuffle(Array.from(byId.values())));
    setLoading(false);
  }

  const current = queue[idx];

  const onPick = (label: string) => {
    if (revealed) return;
    setSelected(label);
  };

  const onReveal = async () => {
    if (!current || !user || selected == null) return;
    const correct = selected === current.question.correct_answer;
    setRevealed(true);
    setResults((r) => ({
      correct: r.correct + (correct ? 1 : 0),
      total: r.total + 1,
    }));
    await recordReview(user.id, current.question_id, correct);
  };

  const onNext = () => {
    if (idx + 1 >= queue.length) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setSelected(null);
    setRevealed(false);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </main>
    );
  }

  if (queue.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <Header />
        <div className="rounded-2xl border border-border bg-card shadow-paper p-10 text-center">
          <Inbox className="h-10 w-10 text-emerald mx-auto mb-4" />
          <h2 className="font-display text-2xl font-semibold mb-2">
            Nothing due right now.
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Answer questions in mock exams or the question bank — anything you get wrong (or even right) gets queued here for spaced repetition.
          </p>
          <div className="flex gap-2 justify-center">
            <Link to="/exam">
              <Button className="bg-emerald text-emerald-foreground hover:bg-emerald/90">
                Take a mock exam
              </Button>
            </Link>
            <Link to="/question-bank">
              <Button variant="outline">Browse question bank</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (done) {
    const pct =
      results.total === 0 ? 0 : Math.round((results.correct / results.total) * 100);
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <Header />
        <div className="rounded-2xl border border-border bg-card shadow-paper p-10 text-center">
          <Sparkles className="h-10 w-10 text-accent mx-auto mb-4" />
          <h2 className="font-display text-3xl font-semibold mb-2">
            Review complete
          </h2>
          <p className="text-muted-foreground mb-6">
            {results.correct} of {results.total} correct ({pct}%)
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              onClick={() => void load()}
              variant="outline"
              className="gap-2"
            >
              <RotateCw className="h-4 w-4" /> Reload queue
            </Button>
            <Link to="/dashboard">
              <Button className="bg-emerald text-emerald-foreground hover:bg-emerald/90">
                Back to dashboard
              </Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const q = current.question;
  const total = queue.length;

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <Header />

      <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
        <span>
          Card {idx + 1} of {total}
          {current.subject ? ` · ${current.subject.name}` : ""}
        </span>
        <span>
          {results.correct}/{results.total} correct
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-5">
        <div
          className="h-full bg-gradient-hero transition-all"
          style={{ width: `${((idx + (revealed ? 1 : 0)) / total) * 100}%` }}
        />
      </div>

      <article className="rounded-2xl border border-border bg-card shadow-paper p-6 sm:p-8">
        {q.topic && (
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
            {q.topic}
          </div>
        )}
        <h2 className="font-display text-xl sm:text-2xl leading-snug mb-6">
          {q.question_text}
        </h2>

        {q.image_url && (
          <img
            src={q.image_url}
            alt=""
            className="rounded-xl border border-border mb-6 max-h-72 object-contain"
          />
        )}

        <div className="space-y-2.5">
          {q.options.map((opt) => {
            const isSelected = selected === opt.label;
            const isCorrect = opt.label === q.correct_answer;
            const showCorrect = revealed && isCorrect;
            const showWrong = revealed && isSelected && !isCorrect;
            return (
              <button
                key={opt.label}
                onClick={() => onPick(opt.label)}
                disabled={revealed}
                className={[
                  "w-full text-left flex items-start gap-3 rounded-xl border p-3.5 transition-all",
                  showCorrect
                    ? "border-emerald bg-emerald/10"
                    : showWrong
                      ? "border-destructive bg-destructive/10"
                      : isSelected
                        ? "border-emerald bg-emerald/5"
                        : "border-border hover:border-emerald/40 hover:bg-emerald/5",
                  revealed ? "cursor-default" : "cursor-pointer",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    showCorrect
                      ? "bg-emerald text-emerald-foreground"
                      : showWrong
                        ? "bg-destructive text-destructive-foreground"
                        : isSelected
                          ? "bg-emerald/20 text-emerald"
                          : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {opt.label}
                </span>
                <span className="text-sm leading-relaxed pt-0.5">{opt.text}</span>
                {showCorrect && (
                  <CheckCircle2 className="ml-auto h-5 w-5 text-emerald shrink-0" />
                )}
                {showWrong && (
                  <XCircle className="ml-auto h-5 w-5 text-destructive shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {revealed && q.explanation && (
          <div className="mt-6 rounded-xl bg-muted/60 border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald mb-1.5">
              Explanation
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">
              {q.explanation}
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          {revealed ? (
            <Link
              to="/tutor"
              search={{
                questionId: q.id,
                subjectId: current.subject?.id ?? "",
              }}
              className="text-sm text-emerald hover:underline inline-flex items-center gap-1"
            >
              <Brain className="h-4 w-4" /> Explain with Sapientia
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">
              Pick the answer you remember, then reveal.
            </span>
          )}
          {revealed ? (
            <Button
              onClick={onNext}
              className="bg-emerald text-emerald-foreground hover:bg-emerald/90 gap-2"
            >
              {idx + 1 >= total ? "Finish" : "Next"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={onReveal}
              disabled={selected == null}
              className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
            >
              Reveal
            </Button>
          )}
        </div>
      </article>
    </main>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated">
        <RotateCw className="h-5 w-5 text-emerald-foreground" />
      </div>
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">
          Review due
        </h1>
        <p className="text-sm text-muted-foreground">
          Spaced repetition — sharpest right before you'd forget.
        </p>
      </div>
    </div>
  );
}