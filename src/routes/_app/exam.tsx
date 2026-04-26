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
import {
  Target,
  Clock,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  Flame,
  Trophy,
  Brain,
} from "lucide-react";
import { toast } from "sonner";
import {
  awardExamXP,
  pickDifficultyForSubject,
  type Badge as BadgeType,
} from "@/lib/gamification";
import {
  normalizeQuestion,
  shuffle,
  type NormalizedQuestion,
} from "@/lib/question-utils";
import { recordReview } from "@/lib/srs";

export const Route = createFileRoute("/_app/exam")({
  head: () => ({ meta: [{ title: "Mock Exams — Sapientia" }] }),
  component: ExamPage,
});

type Subject = { id: string; slug: string; name: string };
type ExamType = "waec" | "jamb";
type Question = NormalizedQuestion;

type Phase = "setup" | "active" | "results";

function ExamPage() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [phase, setPhase] = useState<Phase>("setup");

  const [subjectId, setSubjectId] = useState("");
  const [examType, setExamType] = useState<ExamType>("jamb");
  const [questionCount, setQuestionCount] = useState("5");
  const [starting, setStarting] = useState(false);
  const [adaptiveLabel, setAdaptiveLabel] = useState<string | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [elapsed, setElapsed] = useState(0);

  const [results, setResults] = useState<{
    score: number;
    correct: number;
    total: number;
    items: { q: Question; userAnswer: string | null; correct: boolean }[];
    xpEarned: number;
    streak: number;
    newBadges: BadgeType[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("subjects").select("id, slug, name").order("name");
      setSubjects((data as Subject[]) ?? []);
    })();
  }, []);

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

    // Adaptive: pick a difficulty bucket from past performance
    const bucket = await pickDifficultyForSubject(user.id, subjectId);
    setAdaptiveLabel(bucket);

    let query = supabase
      .from("questions")
      .select("id, question_text, options, correct_answer, explanation, topic, image_url, difficulty")
      .eq("subject_id", subjectId)
      .in("exam_type", [examType, "both"]);
    if (bucket !== "mixed") {
      query = query.eq("difficulty", bucket);
    }
    let { data: qData } = await query;

    // Fallback: if difficulty filter returns too few, broaden
    if (!qData || qData.length < limit) {
      const { data: fallback } = await supabase
        .from("questions")
        .select("id, question_text, options, correct_answer, explanation, topic, image_url, difficulty")
        .eq("subject_id", subjectId)
        .in("exam_type", [examType, "both"]);
      qData = fallback;
    }
    if (!qData || qData.length === 0) {
      setStarting(false);
      toast.error("No questions available for this combination yet.");
      return;
    }
    const normalised = (qData ?? []).map((r) =>
      normalizeQuestion(r as Record<string, unknown>)
    );
    const shuffled = shuffle([...normalised]).slice(0, limit);

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
    setRevealed({});
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

    // Spaced repetition scheduling
    await Promise.all(
      items.map((it) => recordReview(user.id, it.q.id, it.correct))
    );

    // Award XP, update streak, evaluate badges
    const award = await awardExamXP(user.id, total, correct, score, subjectId);
    if (award.streakIncreased) {
      toast.success(`🔥 ${award.newStats.current_streak}-day streak!`);
    }
    award.newBadges.forEach((b) => {
      toast.success(`${b.icon} Badge unlocked: ${b.name}`);
    });

    setResults({
      score,
      correct,
      total,
      items,
      xpEarned: award.xpEarned,
      streak: award.newStats.current_streak,
      newBadges: award.newBadges,
    });
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
            <p className="text-sm text-muted-foreground">
              Adaptive difficulty tunes itself to your past performance.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <Link
            to="/mock/waec"
            className="rounded-2xl border border-border bg-card shadow-paper p-5 hover:border-emerald/40 hover:shadow-elevated transition group"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-emerald font-semibold">
                Full mock
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald transition" />
            </div>
            <div className="font-display text-lg font-semibold">WAEC Mock</div>
            <p className="text-sm text-muted-foreground mt-1">
              Single subject · 50 questions · 60-minute timer.
            </p>
          </Link>
          <Link
            to="/mock/jamb"
            className="rounded-2xl border border-border bg-card shadow-paper p-5 hover:border-emerald/40 hover:shadow-elevated transition group"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-emerald font-semibold">
                Full mock
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald transition" />
            </div>
            <div className="font-display text-lg font-semibold">JAMB Mock</div>
            <p className="text-sm text-muted-foreground mt-1">
              English + 3 subjects · 160 questions · 2-hour timer.
            </p>
          </Link>
        </div>

        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-3">
          Or quick practice
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
          Tip: a focused exam every day keeps your streak alive 🔥
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
        revealed={revealed}
        setRevealed={setRevealed}
        elapsed={elapsed}
        submit={submit}
        adaptiveLabel={adaptiveLabel}
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
  revealed,
  setRevealed,
  elapsed,
  submit,
  adaptiveLabel,
}: {
  questions: Question[];
  currentIdx: number;
  setCurrentIdx: (i: number) => void;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  revealed: Record<string, boolean>;
  setRevealed: (r: Record<string, boolean>) => void;
  elapsed: number;
  submit: () => void;
  adaptiveLabel: string | null;
}) {
  const q = questions[currentIdx];
  const answered = Object.keys(answers).length;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const isRevealed = !!revealed[q.id];
  const userAnswer = answers[q.id];

  const choose = (label: string) => {
    if (isRevealed) return; // lock in once shown
    setAnswers({ ...answers, [q.id]: label });
  };

  const showExplanation = () => {
    if (!userAnswer) {
      toast.error("Pick an answer first");
      return;
    }
    setRevealed({ ...revealed, [q.id]: true });
  };

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-5">
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          Question{" "}
          <span className="font-display font-semibold text-foreground">{currentIdx + 1}</span> of{" "}
          {questions.length}
          {adaptiveLabel && adaptiveLabel !== "mixed" && (
            <span className="ml-2 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/20 text-accent-foreground">
              adaptive · {adaptiveLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm font-mono tabular-nums bg-card border border-border px-3 py-1.5 rounded-lg">
          <Clock className="h-3.5 w-3.5 text-emerald" />
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-muted mb-6 overflow-hidden">
        <div
          className="h-full bg-gradient-hero transition-all"
          style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-paper p-6 sm:p-8">
        {q.topic && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-emerald font-semibold mb-3">
            {q.topic} · {q.difficulty}
          </div>
        )}
        <p className="font-display text-xl sm:text-2xl font-medium leading-snug mb-4">
          {q.question_text}
        </p>
        {q.image_url && (
          <div className="mb-6 rounded-xl overflow-hidden border border-border bg-white">
            <img
              src={q.image_url}
              alt="Question diagram"
              loading="lazy"
              className="w-full h-auto max-h-80 object-contain"
            />
          </div>
        )}
        <div className="space-y-2.5">
          {q.options.map((opt) => {
            const selected = userAnswer === opt.label;
            const isCorrect = opt.label === q.correct_answer;
            const showState = isRevealed;
            const stateClass = showState
              ? isCorrect
                ? "border-emerald bg-emerald/10"
                : selected
                  ? "border-destructive bg-destructive/10"
                  : "border-border opacity-60"
              : selected
                ? "border-emerald bg-emerald/5 shadow-paper"
                : "border-border hover:border-emerald/40 hover:bg-muted/40";
            return (
              <button
                key={opt.label}
                onClick={() => choose(opt.label)}
                disabled={isRevealed}
                className={`w-full text-left flex items-center gap-3 rounded-xl border p-4 transition ${stateClass}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display font-semibold text-sm ${
                    selected || (showState && isCorrect)
                      ? "bg-emerald text-emerald-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </div>
                <span className="text-sm sm:text-base flex-1">{opt.text}</span>
                {showState && isCorrect && (
                  <CheckCircle2 className="h-4 w-4 text-emerald shrink-0" />
                )}
                {showState && selected && !isCorrect && (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Post-answer explanation */}
        {isRevealed && q.explanation && (
          <div
            className={`mt-5 rounded-xl border p-4 ${
              userAnswer === q.correct_answer
                ? "border-emerald/30 bg-emerald/5"
                : "border-accent/30 bg-accent/5"
            }`}
          >
            <div className="flex items-center gap-2 font-display font-semibold text-sm mb-2">
              <Sparkles className="h-4 w-4 text-emerald" />
              {userAnswer === q.correct_answer
                ? "Correct — here's why"
                : `Not quite — the answer is ${q.correct_answer}`}
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{q.explanation}</p>
          </div>
        )}

        {!isRevealed && userAnswer && (
          <Button
            onClick={showExplanation}
            variant="outline"
            className="mt-5 w-full border-emerald/40 text-emerald hover:bg-emerald/10"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Check answer & see explanation
          </Button>
        )}
      </div>

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
  results: {
    score: number;
    correct: number;
    total: number;
    items: { q: Question; userAnswer: string | null; correct: boolean }[];
    xpEarned: number;
    streak: number;
    newBadges: BadgeType[];
  };
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
        <div className="mt-5 flex items-center justify-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-foreground/10">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> +{results.xpEarned} XP
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-foreground/10">
            <Flame className="h-3.5 w-3.5 text-accent" /> {results.streak}-day streak
          </div>
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

      {results.newBadges.length > 0 && (
        <div className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg font-semibold">New badges unlocked!</h3>
          </div>
          <div className="flex flex-wrap gap-3">
            {results.newBadges.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 text-sm shadow-paper"
              >
                <span className="text-lg">{b.icon}</span>
                <span className="font-medium">{b.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
            {q.image_url && (
              <div className="ml-8 mb-3 rounded-lg overflow-hidden border border-border bg-white max-w-sm">
                <img
                  src={q.image_url}
                  alt="Question diagram"
                  loading="lazy"
                  className="w-full h-auto"
                />
              </div>
            )}
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
