import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Loader2, Timer, BookOpen } from "lucide-react";
import { toast } from "sonner";
import {
  MockExamRunner,
  MockResultsView,
  type MockSubmitResult,
} from "@/components/MockExamRunner";
import {
  normalizeQuestion,
  shuffle,
  type NormalizedQuestion,
} from "@/lib/question-utils";
import { awardExamXP, type Badge as BadgeType } from "@/lib/gamification";
import { recordReview } from "@/lib/srs";

export const Route = createFileRoute("/_app/mock/waec")({
  head: () => ({ meta: [{ title: "WAEC Mock — Sapientia" }] }),
  component: WaecMockPage,
});

type Subject = { id: string; slug: string; name: string };
type Phase = "setup" | "active" | "results";

const QUESTION_COUNT = 50;
const DURATION_SECONDS = 60 * 60; // 60 min

function WaecMockPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [phase, setPhase] = useState<Phase>("setup");
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [questions, setQuestions] = useState<NormalizedQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);

  const [results, setResults] = useState<{
    score: number;
    correct: number;
    total: number;
    duration: number;
    items: { q: NormalizedQuestion; userAnswer: string | null; correct: boolean }[];
    xpEarned: number;
    badges: BadgeType[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("subjects")
        .select("id, slug, name")
        .order("name");
      setSubjects((data as Subject[]) ?? []);
    })();
  }, []);

  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) ?? null,
    [subjectId, subjects]
  );

  const start = async () => {
    if (!user) return;
    if (!subjectId) {
      toast.error("Pick a subject");
      return;
    }
    setStarting(true);
    const { data: pool } = await supabase
      .from("questions")
      .select("id, question_text, options, correct_answer, explanation, topic, image_url, difficulty, exam_type, subject_id, year")
      .eq("subject_id", subjectId)
      .in("exam_type", ["waec", "both"]);

    if (!pool || pool.length === 0) {
      setStarting(false);
      toast.error("No WAEC questions available for this subject yet.");
      return;
    }
    const normalised = pool.map((r) =>
      normalizeQuestion(r as Record<string, unknown>)
    );
    const target = Math.min(QUESTION_COUNT, normalised.length);
    const picked = shuffle([...normalised]).slice(0, target);

    const { data: attempt, error } = await supabase
      .from("exam_attempts")
      .insert({
        user_id: user.id,
        subject_id: subjectId,
        exam_type: "waec",
        total_questions: picked.length,
      })
      .select("id")
      .single();

    if (error || !attempt) {
      setStarting(false);
      toast.error("Could not start exam");
      return;
    }
    setAttemptId(attempt.id);
    setQuestions(picked);
    setPhase("active");
    setStarting(false);
  };

  const submit = async (r: MockSubmitResult) => {
    if (!user || !attemptId) return;
    setSubmitting(true);
    let correct = 0;
    const items = questions.map((q) => {
      const userAnswer = r.answers[q.id] ?? null;
      const isCorrect = userAnswer === q.correct_answer;
      if (isCorrect) correct++;
      return { q, userAnswer, correct: isCorrect };
    });
    const total = questions.length;
    const score = total ? (correct / total) * 100 : 0;

    await supabase
      .from("exam_attempts")
      .update({
        correct_count: correct,
        score_percent: score,
        duration_seconds: r.durationSeconds,
        completed_at: new Date().toISOString(),
      })
      .eq("id", attemptId);

    const answerRows = items.map((it) => ({
      attempt_id: attemptId,
      question_id: it.q.id,
      user_answer: it.userAnswer,
      is_correct: it.correct,
    }));
    if (answerRows.length) {
      await supabase.from("attempt_answers").insert(answerRows);
    }

    await Promise.all(
      items.map((it) => recordReview(user.id, it.q.id, it.correct))
    );

    const award = await awardExamXP(user.id, total, correct, score, subjectId);
    if (award.streakIncreased) {
      toast.success(`🔥 ${award.newStats.current_streak}-day streak!`);
    }
    award.newBadges.forEach((b) =>
      toast.success(`${b.icon} Badge unlocked: ${b.name}`)
    );
    if (r.autoSubmitted) toast.info("Time expired — exam auto-submitted.");

    setResults({
      score,
      correct,
      total,
      duration: r.durationSeconds,
      items,
      xpEarned: award.xpEarned,
      badges: award.newBadges,
    });
    setPhase("results");
    setSubmitting(false);
  };

  if (phase === "setup") {
    return (
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated">
            <BookOpen className="h-5 w-5 text-emerald-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold">
              WAEC Mock Exam
            </h1>
            <p className="text-sm text-muted-foreground">
              Single subject · {QUESTION_COUNT} questions · 60-minute timer.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-paper p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Subject</label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a subject" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl bg-muted/40 border border-border p-4 text-sm">
            <div className="font-display font-semibold mb-2 flex items-center gap-2">
              <Timer className="h-4 w-4 text-emerald" /> Exam rules
            </div>
            <ul className="space-y-1 text-muted-foreground text-xs">
              <li>• Timer starts immediately and auto-submits when it hits zero.</li>
              <li>• You can navigate between questions and change answers.</li>
              <li>• Answers contribute to your spaced-repetition review queue.</li>
            </ul>
          </div>

          <Button
            onClick={start}
            disabled={starting}
            className="w-full bg-emerald text-emerald-foreground hover:bg-emerald/90 h-12"
          >
            {starting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Start exam <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/exam"
            className="text-sm text-emerald hover:underline"
          >
            ← Back to exam picker
          </Link>
        </div>
      </main>
    );
  }

  if (phase === "active") {
    return (
      <MockExamRunner
        questions={questions}
        durationSeconds={DURATION_SECONDS}
        title="WAEC Mock"
        subtitle={subject?.name}
        onSubmit={submit}
        submitting={submitting}
      />
    );
  }

  if (phase === "results" && results) {
    return (
      <MockResultsView
        title={`WAEC Mock · ${subject?.name ?? ""}`}
        scorePercent={results.score}
        correct={results.correct}
        total={results.total}
        durationSeconds={results.duration}
        reviewItems={results.items}
        onRetry={() => {
          setResults(null);
          setQuestions([]);
          setAttemptId(null);
          setPhase("setup");
        }}
      />
    );
  }

  return null;
}