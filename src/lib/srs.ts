/**
 * Lightweight SuperMemo SM-2 spaced-repetition implementation.
 *
 * Quality scale 0–5:
 *   5 = perfect recall
 *   4 = correct, slight hesitation
 *   3 = correct with effort
 *   2 = incorrect, easy to remember once shown
 *   1 = incorrect, hard
 *   0 = blackout
 *
 * In our app we map a binary correct/incorrect to quality:
 *   correct -> 5, incorrect -> 2
 */
import { supabase } from "@/integrations/supabase/client";

export type ReviewItem = {
  id: string;
  user_id: string;
  question_id: string;
  due_at: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  last_reviewed_at: string | null;
  last_correct: boolean | null;
};

export function nextSchedule(prev: {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
}, quality: number) {
  const q = Math.max(0, Math.min(5, quality));
  let { ease_factor: ef, interval_days, repetitions } = prev;
  // Update ease factor (clamped at 1.3)
  ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  if (q < 3) {
    repetitions = 0;
    interval_days = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) interval_days = 1;
    else if (repetitions === 2) interval_days = 3;
    else interval_days = Math.round(interval_days * ef);
  }
  const due = new Date();
  due.setDate(due.getDate() + interval_days);
  return {
    ease_factor: Math.round(ef * 100) / 100,
    interval_days,
    repetitions,
    due_at: due.toISOString(),
  };
}

/** Record an answer for a question and reschedule it in the review queue. */
export async function recordReview(
  userId: string,
  questionId: string,
  correct: boolean
) {
  const { data: existing } = await supabase
    .from("review_queue")
    .select("*")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .maybeSingle();

  const quality = correct ? 5 : 2;
  const base = existing ?? { ease_factor: 2.5, interval_days: 1, repetitions: 0 };
  const next = nextSchedule(base, quality);

  if (existing) {
    await supabase
      .from("review_queue")
      .update({
        ...next,
        last_correct: correct,
        last_reviewed_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("review_queue").insert({
      user_id: userId,
      question_id: questionId,
      ...next,
      last_correct: correct,
      last_reviewed_at: new Date().toISOString(),
    });
  }
}

/** Bulk-add questions to the review queue for a user (skipping ones already there). */
export async function enqueueQuestions(userId: string, questionIds: string[]) {
  if (questionIds.length === 0) return;
  const { data: existing } = await supabase
    .from("review_queue")
    .select("question_id")
    .eq("user_id", userId)
    .in("question_id", questionIds);
  const have = new Set((existing ?? []).map((r) => r.question_id));
  const rows = questionIds
    .filter((q) => !have.has(q))
    .map((qid) => ({ user_id: userId, question_id: qid }));
  if (rows.length) await supabase.from("review_queue").insert(rows);
}

/** How many items are due for this user right now. */
export async function dueCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from("review_queue")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .lte("due_at", new Date().toISOString());
  return count ?? 0;
}