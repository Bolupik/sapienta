import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Target, Clock, ArrowRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/exam")({
  head: () => ({ meta: [{ title: "Mock Exams — Sapientia" }] }),
  component: ExamPage,
});

type Subject = { id: string; slug: string; name: string };
type ExamType = "waec" | "jamb";
type Question = {
  id: string;
  question_text: string;
  options: { label: string; text: string }[];
  correct_answer: string;
  explanation: string | null;
  topic: string | null;
};

type Phase = "setup" | "active" | "results";

function ExamPage() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [phase, setPhase] = useState<Phase>("setup");

  // Setup state
  const [subjectId, setSubjectId] = useState("");
  const [examType, setExamType] = useState<ExamType>("jamb");
  const [questionCount, setQuestionCount] = useState("5");
  const [starting, setStarting] = useState(false);

  // Active exam state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [elapsed, setElapsed] = useState(0);

  // Results
  const [results, setResults] = useState<{
    score: number;
    correct: number;
    total: number;
    items: { q: Question; userAnswer: string | null; correct: boolean }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("subjects").select("id, slug, name").order("name");
      setSubjects((data as Subject[]) ?? []);
    })();
  }, []);

  // Timer
  useEffect(() => {
    if (phase !== "active") return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  const startExam = async () => {
    if (!subjectId) {
      toast.error("Pick a subject first");
      return;
    }
    if (!user) return;
    setStarting(true);
    const limit = parseInt(questionCount, 10);
    // Pull questions by subject + exam_type (random)
    const { data: qData, error: qErr } = await supabase
      .from("questions")
      .select("id, question_text, options, correct_answer, explanation, topic")
      .eq("subject_id", subjectId)
      .in("exam_type", [examType, "both"]);
    if (qErr || !qData || qData.length === 0) {
      setStarting(false);
      toast.error("No questions available for this combination yet.");
      return;
    }
    const shuffled = [...qData].sort(() => Math.random() - 0.5).slice(0, limit) as Question[];

    const { data: attempt, error: aErr } = await supabase
      .from("exam_attempts")
      .insert({
        user_id: user.id,
        subject_id: subjectId,
        exam_type: examType,
        total_questions: shuffled.length,
      })
      .select("id")
      .single();
    if (aErr || !attempt) {
      setStarting(false);
      toast.error("Could not start the exam");
      return;
    }

    setQuestions(shuffled);
    setAnswers({});
    setCurrentIdx(0);
    setAttemptId(attempt.id);
    setStartedAt(Date.now());
    setElapsed(0);
    setPhase("active");
    setStarting(false);
  };

  const submit = async () => {
    if (!attemptId || !user) return;
    let correct = 0;
    const items = questions.map((q) => {
      const userAns = answers[q.id] ?? null;
      const isCorrect = userAns === q.correct_answer;
      if (isCorrect) correct++;
      return { q, userAnswer: userAns, correct: isCorrect };
    });
    const total = questions.length;
    const score = total > 0 ? (correct / total) * 100 : 0;
    const duration = Math.floor((Date.now() - startedAt) / 1000);

    // Save attempt + answers
    await supabase
      .from("exam_attempts")
      .update({
        correct_count: correct,
        score_percent: score,
        duration_seconds: duration,
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

    setResults({ score, correct, total, items });
    setPhase("results");
  };

  if (phase === "setup") {
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated">
            <Target className="h-5 w-5 text-emerald-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold">Mock Exam</h1>
            <p className="text-sm text-muted-foreground">Set up your practice session.</p>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Exam format</label>
              <Select value={examType} onValueChange={(v) => setExamType(v as ExamType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jamb">JAMB (CBT)</SelectItem>
                  <SelectItem value="waec">WAEC (Objective)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Questions</label>
              <Select value={questionCount} onValueChange={setQuestionCount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 questions</SelectItem>
                  <SelectItem value="10">10 questions</SelectItem>
                  <SelectItem value="20">20 questions</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={startExam}
            disabled={starting}
            className="w-full bg-emerald text-emerald-foreground hover:bg-emerald/90 h-12"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start exam"}
            {!starting && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Tip: take a short, focused exam every day to build the streak.
        </p>
      </main>
    );
  }

  if (phase === "active") {
    return (
      <ActiveExam
        questions={questions}
        currentIdx={currentIdx}
        setCurrentIdx={setCurrentIdx}
        answers={answers}
        setAnswers={setAnswers}
        elapsed={elapsed}
        submit={submit}
      />
    );
  }

  if (phase === "results" && results) {
    return <ResultsView results={results} reset={() => setPhase("setup")} />;
  }

  return null;
}

function ActiveExam({
  questions,
  currentIdx,
  setCurrentIdx,
  answers,
  setAnswers,
  elapsed,
  submit,
}: {
  questions: Question[];
  currentIdx: number;
  setCurrentIdx: (i: number) => void;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  elapsed: number;
  submit: () => void;
}) {
  const q = questions[currentIdx];
  const answered = Object.keys(answers).length;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  const choose = (label: string) => {
    setAnswers({ ...answers, [q.id]: label });
  };

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-sm text-muted-foreground">
          Question{" "}
          <span className="font-display font-semibold text-foreground">{currentIdx + 1}</span> of{" "}
          {questions.length}
        </div>
        <div className="flex items-center gap-2 text-sm font-mono tabular-nums bg-card border border-border px-3 py-1.5 rounded-lg">
          <Clock className="h-3.5 w-3.5 text-emerald" />
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </div>
      </div>

      {/* Progress */}
      <div className="h-1.5 rounded-full bg-muted mb-6 overflow-hidden">
        <div
          className="h-full bg-gradient-hero transition-all"
          style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question */}
      <div className="rounded-2xl border border-border bg-card shadow-paper p-6 sm:p-8">
        {q.topic && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-emerald font-semibold mb-3">
            {q.topic}
          </div>
        )}
        <p className="font-display text-xl sm:text-2xl font-medium leading-snug mb-6">
          {q.question_text}
        </p>
        <div className="space-y-2.5">
          {q.options.map((opt) => {
            const selected = answers[q.id] === opt.label;
            return (
              <button
                key={opt.label}
                onClick={() => choose(opt.label)}
                className={`w-full text-left flex items-center gap-3 rounded-xl border p-4 transition ${
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
                <span className="text-sm sm:text-base">{opt.text}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
          disabled={currentIdx === 0}
        >
          Previous
        </Button>
        <div className="text-xs text-muted-foreground">
          {answered}/{questions.length} answered
        </div>
        {currentIdx < questions.length - 1 ? (
          <Button
            onClick={() => setCurrentIdx(currentIdx + 1)}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            Next
          </Button>
        ) : (
          <Button
            onClick={submit}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            Submit
          </Button>
        )}
      </div>
    </main>
  );
}

function ResultsView({
  results,
  reset,
}: {
  results: NonNullable<ReturnType<typeof useState<{
    score: number;
    correct: number;
    total: number;
    items: { q: Question; userAnswer: string | null; correct: boolean }[];
  }>>[0]>;
  reset: () => void;
}) {
  const score = Math.round(results.score);
  const grade = useMemo(() => {
    if (score >= 80) return { label: "Excellent", tone: "text-emerald" };
    if (score >= 60) return { label: "Good", tone: "text-emerald" };
    if (score >= 40) return { label: "Fair", tone: "text-accent-foreground" };
    return { label: "Keep practising", tone: "text-destructive" };
  }, [score]);

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <div className="rounded-2xl border border-border bg-gradient-hero text-emerald-foreground p-8 sm:p-10 mb-6 shadow-elevated text-center">
        <div className="text-xs uppercase tracking-[0.2em] text-emerald-foreground/70 mb-2">
          Your score
        </div>
        <div className="font-display text-7xl sm:text-8xl font-semibold tabular-nums">{score}%</div>
        <div className={`mt-2 font-display text-xl ${grade.tone}`}>{grade.label}</div>
        <div className="mt-3 text-sm text-emerald-foreground/80">
          {results.correct} correct out of {results.total}
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="secondary" onClick={reset}>
            Try another
          </Button>
          <Link to="/dashboard">
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
              Back to dashboard
            </Button>
          </Link>
        </div>
      </div>

      <h2 className="font-display text-2xl font-semibold mb-4">Review</h2>
      <div className="space-y-4">
        {results.items.map(({ q, userAnswer, correct }, i) => (
          <div key={q.id} className="rounded-2xl border border-border bg-card shadow-paper p-6">
            <div className="flex items-start gap-3 mb-3">
              {correct ? (
                <CheckCircle2 className="h-5 w-5 text-emerald shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Question {i + 1}</div>
                <p className="font-medium leading-snug">{q.question_text}</p>
              </div>
            </div>
            <div className="ml-8 space-y-1.5 text-sm">
              {q.options.map((o) => {
                const isCorrect = o.label === q.correct_answer;
                const isYours = o.label === userAnswer;
                return (
                  <div
                    key={o.label}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                      isCorrect
                        ? "bg-emerald/10 text-emerald font-medium"
                        : isYours
                          ? "bg-destructive/10 text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-display font-semibold w-5">{o.label}.</span>
                    <span>{o.text}</span>
                    {isCorrect && <span className="ml-auto text-xs">correct</span>}
                    {isYours && !isCorrect && <span className="ml-auto text-xs">your answer</span>}
                  </div>
                );
              })}
            </div>
            {q.explanation && (
              <div className="mt-4 ml-8 rounded-lg bg-muted/50 border border-border p-3 text-sm">
                <span className="font-display font-semibold text-emerald">Why: </span>
                {q.explanation}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
