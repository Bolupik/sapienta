import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Loader2, Timer, GraduationCap } from "lucide-react";
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

export const Route = createFileRoute("/_app/mock/jamb")({
  head: () => ({ meta: [{ title: "JAMB Mock — Sapientia" }] }),
  component: JambMockPage,
});

type Subject = { id: string; slug: string; name: string };
type Phase = "setup" | "active" | "results";

const QUESTIONS_PER_SUBJECT = 40;
const DURATION_SECONDS = 2 * 60 * 60; // 2 hours
const ENGLISH_SLUG = "english-language";

function JambMockPage() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [phase, setPhase] = useState<Phase>("setup");
  const [otherSubjects, setOtherSubjects] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [questions, setQuestions] = useState<NormalizedQuestion[]>([]);
  const [questionSubjectMap, setQuestionSubjectMap] = useState<Record<string, string>>(
    {}
  );
  const [attemptIds, setAttemptIds] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chosenSubjectIds, setChosenSubjectIds] = useState<string[]>([]);

  const [results, setResults] = useState<{
    score: number;
    correct: number;
    total: number;
    duration: number;
    items: {
      q: NormalizedQuestion;
      userAnswer: string | null;
      correct: boolean;
      subjectName?: string;
    }[];
    perSubject: { name: string; correct: number; total: number }[];
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

  const english = useMemo(
    () => subjects.find((s) => s.slug === ENGLISH_SLUG) ?? null,
    [subjects]
  );
  const selectableSubjects = useMemo(
    () => subjects.filter((s) => s.slug !== ENGLISH_SLUG),
    [subjects]
  );

  const toggleSubject = (id: string) => {
    setOtherSubjects((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        toast.message("Pick exactly 3 subjects (in addition to English).");
        return prev;
      }
      return [...prev, id];
    });
  };

  const start = async () => {
    if (!user || !english) return;
    if (otherSubjects.length !== 3) {
      toast.error("Pick exactly 3 subjects (English is included automatically).");
      return;
    }
    setStarting(true);
    const subjectIds = [english.id, ...otherSubjects];

    // Pull a pool per subject and pick QUESTIONS_PER_SUBJECT
    const allQuestions: NormalizedQuestion[] = [];
    const subjectMap: Record<string, string> = {};
    const subjectNameById = new Map(subjects.map((s) => [s.id, s.name] as const));
    for (const sid of subjectIds) {
      const { data: pool } = await supabase
        .from("questions")
        .select(
          "id, question_text, options, correct_answer, explanation, topic, image_url, difficulty, exam_type, subject_id, year"
        )
        .eq("subject_id", sid)
        .in("exam_type", ["jamb", "both"]);
      if (!pool || pool.length === 0) {
        toast.error(
          `Not enough JAMB questions for ${subjectNameById.get(sid) ?? "subject"}.`
        );
        setStarting(false);
        return;
      }
      const normalised = pool.map((r) =>
        normalizeQuestion(r as Record<string, unknown>)
      );
      const picked = shuffle([...normalised]).slice(
        0,
        Math.min(QUESTIONS_PER_SUBJECT, normalised.length)
      );
      picked.forEach((q) => {
        subjectMap[q.id] = subjectNameById.get(sid) ?? "Subject";
      });
      allQuestions.push(...picked);
    }

    // Create one exam_attempt per subject for analytics
    const ids: string[] = [];
    for (const sid of subjectIds) {
      const subjQs = allQuestions.filter((q) => q.subject_id === sid);
      const { data: attempt } = await supabase
        .from("exam_attempts")
        .insert({
          user_id: user.id,
          subject_id: sid,
          exam_type: "jamb",
          total_questions: subjQs.length,
        })
        .select("id")
        .single();
      if (attempt) ids.push(attempt.id);
    }

    const { data: session } = await supabase
      .from("mock_sessions")
      .insert({
        user_id: user.id,
        mode: "jamb",
        subject_ids: subjectIds,
        attempt_ids: ids,
        total_questions: allQuestions.length,
      })
      .select("id")
      .single();

    setQuestions(allQuestions);
    setQuestionSubjectMap(subjectMap);
    setChosenSubjectIds(subjectIds);
    setAttemptIds(ids);
    setSessionId(session?.id ?? null);
    setPhase("active");
    setStarting(false);
  };

  const submit = async (r: MockSubmitResult) => {
    if (!user) return;
    setSubmitting(true);

    // Group answers by subject
    const items = questions.map((q) => {
      const userAnswer = r.answers[q.id] ?? null;
      const isCorrect = userAnswer === q.correct_answer;
      return {
        q,
        userAnswer,
        correct: isCorrect,
        subjectName: questionSubjectMap[q.id],
      };
    });
    const total = items.length;
    const correct = items.filter((i) => i.correct).length;
    const score = total ? (correct / total) * 100 : 0;

    // Update each subject attempt
    let totalXp = 0;
    const allBadges: BadgeType[] = [];
    const perSubject: { name: string; correct: number; total: number }[] = [];

    for (let i = 0; i < chosenSubjectIds.length; i++) {
      const sid = chosenSubjectIds[i];
      const aid = attemptIds[i];
      const subjItems = items.filter((it) => it.q.subject_id === sid);
      const subjCorrect = subjItems.filter((s) => s.correct).length;
      const subjTotal = subjItems.length;
      const subjScore = subjTotal ? (subjCorrect / subjTotal) * 100 : 0;
      const subjName =
        subjects.find((s) => s.id === sid)?.name ?? "Subject";
      perSubject.push({ name: subjName, correct: subjCorrect, total: subjTotal });

      if (aid) {
        await supabase
          .from("exam_attempts")
          .update({
            correct_count: subjCorrect,
            score_percent: subjScore,
            duration_seconds: Math.floor(r.durationSeconds / chosenSubjectIds.length),
            completed_at: new Date().toISOString(),
          })
          .eq("id", aid);
        const rows = subjItems.map((it) => ({
          attempt_id: aid,
          question_id: it.q.id,
          user_answer: it.userAnswer,
          is_correct: it.correct,
        }));
        if (rows.length) await supabase.from("attempt_answers").insert(rows);
      }
      const award = await awardExamXP(
        user.id,
        subjTotal,
        subjCorrect,
        subjScore,
        sid
      );
      totalXp += award.xpEarned;
      allBadges.push(...award.newBadges);
    }

    if (sessionId) {
      await supabase
        .from("mock_sessions")
        .update({
          correct_count: correct,
          score_percent: score,
          duration_seconds: r.durationSeconds,
          completed_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
    }

    await Promise.all(
      items.map((it) => recordReview(user.id, it.q.id, it.correct))
    );

    if (r.autoSubmitted) toast.info("Time expired — exam auto-submitted.");
    allBadges.forEach((b) =>
      toast.success(`${b.icon} Badge unlocked: ${b.name}`)
    );

    setResults({
      score,
      correct,
      total,
      duration: r.durationSeconds,
      items,
      perSubject,
      xpEarned: totalXp,
      badges: allBadges,
    });
    setPhase("results");
    setSubmitting(false);
  };

  if (phase === "setup") {
    return (
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated">
            <GraduationCap className="h-5 w-5 text-emerald-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold">
              JAMB Mock Exam
            </h1>
            <p className="text-sm text-muted-foreground">
              English + 3 subjects · 160 questions · 2-hour timer.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-paper p-6 sm:p-8 space-y-6">
          <div>
            <div className="text-sm font-medium mb-2">English Language</div>
            <div className="rounded-xl border border-emerald/40 bg-emerald/5 px-4 py-3 text-sm">
              📘 English is compulsory and included automatically.
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">
              Pick 3 more subjects ({otherSubjects.length}/3)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {selectableSubjects.map((s) => {
                const checked = otherSubjects.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-sm cursor-pointer transition ${
                      checked
                        ? "border-emerald bg-emerald/5"
                        : "border-border hover:border-emerald/30"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSubject(s.id)}
                    />
                    <span>{s.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl bg-muted/40 border border-border p-4 text-sm">
            <div className="font-display font-semibold mb-2 flex items-center gap-2">
              <Timer className="h-4 w-4 text-emerald" /> Exam rules
            </div>
            <ul className="space-y-1 text-muted-foreground text-xs">
              <li>• 40 questions per subject (160 total).</li>
              <li>• 2-hour timer auto-submits when zero.</li>
              <li>• Per-subject score breakdown shown at the end.</li>
            </ul>
          </div>

          <Button
            onClick={start}
            disabled={starting || otherSubjects.length !== 3}
            className="w-full bg-emerald text-emerald-foreground hover:bg-emerald/90 h-12"
          >
            {starting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Start JAMB exam <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        <div className="mt-6 text-center">
          <Link to="/exam" className="text-sm text-emerald hover:underline">
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
        title="JAMB Mock"
        subtitle="English + 3 subjects"
        subjectColumns={questionSubjectMap}
        onSubmit={submit}
        submitting={submitting}
      />
    );
  }

  if (phase === "results" && results) {
    return (
      <MockResultsView
        title="JAMB Mock"
        scorePercent={results.score}
        correct={results.correct}
        total={results.total}
        durationSeconds={results.duration}
        perSubject={results.perSubject}
        reviewItems={results.items}
        onRetry={() => {
          setResults(null);
          setQuestions([]);
          setQuestionSubjectMap({});
          setAttemptIds([]);
          setSessionId(null);
          setOtherSubjects([]);
          setPhase("setup");
        }}
      />
    );
  }

  return null;
}