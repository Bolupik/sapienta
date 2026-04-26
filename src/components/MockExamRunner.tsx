import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Brain,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Loader2,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatDuration,
  type NormalizedQuestion,
} from "@/lib/question-utils";

/**
 * Shared timed mock exam runner used by both WAEC and JAMB modes.
 * Caller is responsible for fetching/shuffling questions and persisting
 * the final attempt(s); we just orchestrate timer + answer collection.
 */
export type MockSubmitResult = {
  answers: Record<string, string>; // questionId -> chosen label
  durationSeconds: number;
  autoSubmitted: boolean;
};

export function MockExamRunner({
  questions,
  durationSeconds,
  title,
  subtitle,
  subjectColumns, // optional: { questionId -> subjectName } for JAMB grouping
  onSubmit,
  submitting,
}: {
  questions: NormalizedQuestion[];
  durationSeconds: number;
  title: string;
  subtitle?: string;
  subjectColumns?: Record<string, string>;
  onSubmit: (r: MockSubmitResult) => void;
  submitting?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [remaining, setRemaining] = useState(durationSeconds);
  const startedAtRef = useRef(Date.now());
  const submittedRef = useRef(false);

  const submit = useMemo(
    () => (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      onSubmit({ answers, durationSeconds: elapsed, autoSubmitted: auto });
    },
    [answers, onSubmit]
  );

  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const left = Math.max(0, durationSeconds - elapsed);
      setRemaining(left);
      if (left === 0) {
        clearInterval(id);
        toast.message("Time's up — submitting your exam.");
        submit(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [durationSeconds, submit]);

  const q = questions[currentIdx];
  const answeredCount = Object.keys(answers).length;
  const lowTime = remaining <= 60;

  const choose = (label: string) => {
    setAnswers((prev) => ({ ...prev, [q.id]: label }));
  };

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-6">
      {/* Sticky timer bar */}
      <div className="sticky top-16 z-30 -mx-4 sm:mx-0 mb-4 bg-background/95 backdrop-blur border-b border-border/60 sm:border sm:rounded-2xl sm:shadow-paper px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-display font-semibold text-sm sm:text-base">{title}</div>
          {subtitle && (
            <div className="text-[11px] text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div
          className={`flex items-center gap-2 font-mono tabular-nums px-3 py-1.5 rounded-lg border ${
            lowTime
              ? "border-destructive/40 bg-destructive/10 text-destructive animate-pulse"
              : "border-border bg-card"
          }`}
        >
          <Clock className="h-4 w-4" />
          <span className="text-sm sm:text-base font-semibold">
            {formatDuration(remaining)}
          </span>
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span>
          Question{" "}
          <span className="font-display font-semibold text-foreground">
            {currentIdx + 1}
          </span>{" "}
          of {questions.length}
        </span>
        <span>{answeredCount} answered</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted mb-6 overflow-hidden">
        <div
          className="h-full bg-gradient-hero transition-all"
          style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question */}
      <div className="rounded-2xl border border-border bg-card shadow-paper p-5 sm:p-7">
        {(q.topic || subjectColumns?.[q.id]) && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-emerald font-semibold mb-3">
            {subjectColumns?.[q.id] ? `${subjectColumns[q.id]} · ` : ""}
            {q.topic ?? ""}
          </div>
        )}
        <p className="font-display text-lg sm:text-2xl font-medium leading-snug mb-4 whitespace-pre-wrap">
          {q.question_text}
        </p>
        {q.image_url && (
          <div className="mb-5 rounded-xl overflow-hidden border border-border bg-white">
            <img
              src={q.image_url}
              alt="Question diagram"
              loading="lazy"
              className="w-full h-auto max-h-72 object-contain"
            />
          </div>
        )}
        <div className="space-y-2.5">
          {q.options.map((opt) => {
            const selected = answers[q.id] === opt.label;
            return (
              <button
                key={opt.label}
                onClick={() => choose(opt.label)}
                className={`w-full text-left flex items-center gap-3 rounded-xl border p-3.5 transition ${
                  selected
                    ? "border-emerald bg-emerald/5 shadow-paper"
                    : "border-border hover:border-emerald/40 hover:bg-muted/40"
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display font-semibold text-sm ${
                    selected
                      ? "bg-emerald text-emerald-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </div>
                <span className="text-sm sm:text-base flex-1">{opt.text}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pager */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
          disabled={currentIdx === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Previous
        </Button>

        {currentIdx < questions.length - 1 ? (
          <Button
            onClick={() => setCurrentIdx(currentIdx + 1)}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            Next <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={() => submit(false)}
            disabled={submitting}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>Submit exam</>
            )}
          </Button>
        )}
      </div>

      {/* Question grid (jump) */}
      <div className="mt-8">
        <div className="text-xs text-muted-foreground mb-2">Jump to question</div>
        <div className="grid grid-cols-10 sm:grid-cols-15 md:grid-cols-20 gap-1.5">
          {questions.map((qq, i) => {
            const a = answers[qq.id];
            const isCurrent = i === currentIdx;
            return (
              <button
                key={qq.id}
                onClick={() => setCurrentIdx(i)}
                title={`Q${i + 1}${a ? ` — ${a}` : ""}`}
                className={`h-8 w-8 rounded-md text-[11px] font-mono font-medium border transition ${
                  isCurrent
                    ? "border-emerald bg-emerald text-emerald-foreground"
                    : a
                      ? "border-emerald/40 bg-emerald/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-emerald/30"
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {answeredCount < questions.length && (
        <p className="mt-6 text-xs text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-accent" />
          {questions.length - answeredCount} question
          {questions.length - answeredCount === 1 ? "" : "s"} unanswered.
        </p>
      )}
    </main>
  );
}

/** Generic results view used by both WAEC and JAMB mock pages. */
export function MockResultsView({
  title,
  scorePercent,
  correct,
  total,
  durationSeconds,
  perSubject,
  reviewItems,
  onRetry,
}: {
  title: string;
  scorePercent: number;
  correct: number;
  total: number;
  durationSeconds: number;
  perSubject?: { name: string; correct: number; total: number }[];
  reviewItems: {
    q: NormalizedQuestion;
    userAnswer: string | null;
    correct: boolean;
    subjectName?: string;
  }[];
  onRetry: () => void;
}) {
  const score = Math.round(scorePercent);
  const grade =
    score >= 80
      ? { label: "Outstanding", tone: "text-emerald" }
      : score >= 60
        ? { label: "Solid pass", tone: "text-emerald" }
        : score >= 40
          ? { label: "Keep pushing", tone: "text-accent-foreground" }
          : { label: "Time to revise", tone: "text-destructive" };

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <div className="rounded-2xl border border-border bg-gradient-hero text-emerald-foreground p-8 sm:p-10 mb-6 shadow-elevated text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-emerald-foreground/70 mb-2">
          {title}
        </div>
        <div className="font-display text-7xl sm:text-8xl font-semibold tabular-nums">
          {score}%
        </div>
        <div className={`mt-2 font-display text-xl ${grade.tone}`}>{grade.label}</div>
        <div className="mt-3 text-sm text-emerald-foreground/80">
          {correct} correct out of {total} · {formatDuration(durationSeconds)}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
          <Link to="/dashboard">
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Trophy className="h-4 w-4 mr-2" /> Dashboard
            </Button>
          </Link>
          <Link to="/analytics">
            <Button variant="outline" className="border-emerald-foreground/30 text-emerald-foreground hover:bg-emerald-foreground/10">
              View analytics
            </Button>
          </Link>
        </div>
      </div>

      {perSubject && perSubject.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-paper p-6 mb-6">
          <h3 className="font-display text-lg font-semibold mb-4">By subject</h3>
          <div className="space-y-3">
            {perSubject.map((s) => {
              const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0;
              return (
                <div key={s.name}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="font-medium">{s.name}</span>
                    <span className="font-display tabular-nums">
                      {s.correct}/{s.total} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-hero rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="font-display text-2xl font-semibold mb-4">Review</h2>
      <div className="space-y-4">
        {reviewItems.map(({ q, userAnswer, correct: isCorrect, subjectName }, i) => (
          <div key={q.id} className="rounded-2xl border border-border bg-card shadow-paper p-5">
            <div className="flex items-start gap-3 mb-3">
              {isCorrect ? (
                <CheckCircle2 className="h-5 w-5 text-emerald shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">
                  Question {i + 1}
                  {subjectName && ` · ${subjectName}`}
                </div>
                <p className="font-medium leading-snug">{q.question_text}</p>
              </div>
            </div>
            <div className="ml-8 space-y-1.5 text-sm">
              {q.options.map((o) => {
                const isAnswer = o.label === q.correct_answer;
                const isYours = o.label === userAnswer;
                return (
                  <div
                    key={o.label}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                      isAnswer
                        ? "bg-emerald/10 text-emerald font-medium"
                        : isYours
                          ? "bg-destructive/10 text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-display font-semibold w-5">{o.label}.</span>
                    <span>{o.text}</span>
                    {isAnswer && <span className="ml-auto text-xs">correct</span>}
                    {isYours && !isAnswer && (
                      <span className="ml-auto text-xs">your answer</span>
                    )}
                  </div>
                );
              })}
            </div>
            {q.explanation && (
              <div className="mt-3 ml-8 rounded-lg bg-muted/50 border border-border p-3 text-sm">
                <span className="font-display font-semibold text-emerald">Why: </span>
                {q.explanation}
              </div>
            )}
            <div className="mt-3 ml-8">
              <Link
                to="/tutor"
                search={{ questionId: q.id, subjectId: q.subject_id ?? "" }}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="border-emerald/40 text-emerald hover:bg-emerald/10"
                >
                  <Brain className="h-3.5 w-3.5 mr-1.5" />
                  Explain with Sapientia
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}