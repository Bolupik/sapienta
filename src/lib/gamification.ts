import { supabase } from "@/integrations/supabase/client";

export type UserStats = {
  user_id: string;
  xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  daily_goal: number;
};

export type Badge = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  criteria: { type: string; value: number };
};

export type AwardResult = {
  xpEarned: number;
  newStats: UserStats;
  newBadges: Badge[];
  streakIncreased: boolean;
};

export const xpForLevel = (level: number) => level * 100;
export const levelFromXP = (xp: number) => Math.max(1, Math.floor(xp / 100) + 1);

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function ensureUserStats(userId: string): Promise<UserStats> {
  const { data } = await supabase
    .from("user_stats")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as UserStats;
  const { data: created } = await supabase
    .from("user_stats")
    .insert({ user_id: userId })
    .select("*")
    .single();
  return created as UserStats;
}

/**
 * Award XP for completing a mock exam, update streak + daily activity, evaluate badges.
 */
export async function awardExamXP(
  userId: string,
  questionsAnswered: number,
  correctAnswers: number,
  scorePercent: number,
  subjectId: string
): Promise<AwardResult> {
  const stats = await ensureUserStats(userId);
  const today = todayLocal();

  // XP formula: 5 XP per question + 2 bonus XP per correct + 50 XP for perfect score
  const xpEarned =
    questionsAnswered * 5 + correctAnswers * 2 + (scorePercent === 100 ? 50 : 0);

  // Streak update
  let newStreak = stats.current_streak;
  let streakIncreased = false;
  if (stats.last_activity_date === today) {
    // already active today; streak unchanged
  } else if (stats.last_activity_date === dayBefore(today)) {
    newStreak += 1;
    streakIncreased = true;
  } else {
    newStreak = 1;
    streakIncreased = stats.current_streak !== 1;
  }
  const longest = Math.max(stats.longest_streak, newStreak);
  const newXP = stats.xp + xpEarned;
  const newLevel = levelFromXP(newXP);

  const { data: updated } = await supabase
    .from("user_stats")
    .update({
      xp: newXP,
      level: newLevel,
      current_streak: newStreak,
      longest_streak: longest,
      last_activity_date: today,
    })
    .eq("user_id", userId)
    .select("*")
    .single();

  // Daily activity upsert
  const { data: existingDay } = await supabase
    .from("daily_activity")
    .select("*")
    .eq("user_id", userId)
    .eq("activity_date", today)
    .maybeSingle();

  const dailyTotal =
    (existingDay?.questions_answered ?? 0) + questionsAnswered;
  const goalMet = dailyTotal >= (stats.daily_goal ?? 10);

  if (existingDay) {
    await supabase
      .from("daily_activity")
      .update({
        questions_answered: dailyTotal,
        correct_answers: (existingDay.correct_answers ?? 0) + correctAnswers,
        xp_earned: (existingDay.xp_earned ?? 0) + xpEarned,
        goal_met: goalMet,
      })
      .eq("id", existingDay.id);
  } else {
    await supabase.from("daily_activity").insert({
      user_id: userId,
      activity_date: today,
      questions_answered: questionsAnswered,
      correct_answers: correctAnswers,
      xp_earned: xpEarned,
      goal_met: goalMet,
    });
  }

  // Evaluate badges
  const newBadges = await evaluateBadges(
    userId,
    updated as UserStats,
    scorePercent,
    subjectId
  );

  return {
    xpEarned,
    newStats: updated as UserStats,
    newBadges,
    streakIncreased,
  };
}

async function evaluateBadges(
  userId: string,
  stats: UserStats,
  scorePercent: number,
  subjectId: string
): Promise<Badge[]> {
  const [{ data: badges }, { data: owned }, { count: attemptCount }] =
    await Promise.all([
      supabase.from("badges").select("*"),
      supabase.from("user_badges").select("badge_id").eq("user_id", userId),
      supabase
        .from("exam_attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("completed_at", "is", null),
    ]);

  const ownedIds = new Set((owned ?? []).map((b) => b.badge_id));
  const newlyEarned: Badge[] = [];

  // Subject mastery check (avg >= 80% across 5+ attempts)
  let subjectMastery = false;
  const { data: subjectAttempts } = await supabase
    .from("exam_attempts")
    .select("score_percent")
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .not("completed_at", "is", null);
  if (subjectAttempts && subjectAttempts.length >= 5) {
    const avg =
      subjectAttempts.reduce((s, a) => s + Number(a.score_percent ?? 0), 0) /
      subjectAttempts.length;
    if (avg >= 80) subjectMastery = true;
  }

  for (const badge of (badges ?? []) as Badge[]) {
    if (ownedIds.has(badge.id)) continue;
    let earned = false;
    const { type, value } = badge.criteria;
    switch (type) {
      case "attempts":
        earned = (attemptCount ?? 0) >= value;
        break;
      case "streak":
        earned = stats.current_streak >= value;
        break;
      case "xp":
        earned = stats.xp >= value;
        break;
      case "perfect":
        earned = scorePercent === 100;
        break;
      case "subject_master":
        earned = subjectMastery;
        break;
    }
    if (earned) {
      const { error } = await supabase
        .from("user_badges")
        .insert({ user_id: userId, badge_id: badge.id });
      if (!error) newlyEarned.push(badge);
    }
  }
  return newlyEarned;
}

/**
 * Adaptive difficulty: pick a difficulty bucket based on user's recent
 * accuracy in this subject. >75% → harder, <50% → easier, else mixed.
 */
export async function pickDifficultyForSubject(
  userId: string,
  subjectId: string
): Promise<"easy" | "medium" | "hard" | "mixed"> {
  const { data } = await supabase
    .from("attempt_answers")
    .select("is_correct, exam_attempts!inner(user_id, subject_id)")
    .eq("exam_attempts.user_id", userId)
    .eq("exam_attempts.subject_id", subjectId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data || data.length < 5) return "mixed"; // not enough signal yet

  const correct = data.filter((d) => d.is_correct).length;
  const acc = correct / data.length;
  if (acc >= 0.75) return "hard";
  if (acc < 0.5) return "easy";
  return "medium";
}
