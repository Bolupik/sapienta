
-- 1. Image-based questions: add image_url column
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Gamification: user_stats (per-user xp, current/longest streak, last activity day)
CREATE TABLE IF NOT EXISTS public.user_stats (
  user_id UUID PRIMARY KEY,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_activity_date DATE,
  daily_goal INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own stats" ON public.user_stats
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own stats" ON public.user_stats
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own stats" ON public.user_stats
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER tg_user_stats_updated
  BEFORE UPDATE ON public.user_stats
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. Daily activity (one row per user per day)
CREATE TABLE IF NOT EXISTS public.daily_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  activity_date DATE NOT NULL,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  goal_met BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_date)
);
ALTER TABLE public.daily_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own activity" ON public.daily_activity
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own activity" ON public.daily_activity
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own activity" ON public.daily_activity
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- 4. Badges catalogue + user_badges
CREATE TABLE IF NOT EXISTS public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  criteria JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Badges readable" ON public.badges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins write badges" ON public.badges
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  badge_id UUID NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_id)
);
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own badges" ON public.user_badges
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own badges" ON public.user_badges
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 5. Seed badges
INSERT INTO public.badges (slug, name, description, icon, criteria) VALUES
  ('first-steps','First Steps','Complete your first mock exam','🌱', '{"type":"attempts","value":1}'::jsonb),
  ('streak-3','On Fire','3-day study streak','🔥', '{"type":"streak","value":3}'::jsonb),
  ('streak-7','Week Warrior','7-day study streak','⚡', '{"type":"streak","value":7}'::jsonb),
  ('streak-30','Iron Will','30-day study streak','💎', '{"type":"streak","value":30}'::jsonb),
  ('xp-100','Rising Star','Earn 100 XP','⭐', '{"type":"xp","value":100}'::jsonb),
  ('xp-1000','Sapientia Scholar','Earn 1000 XP','🏆', '{"type":"xp","value":1000}'::jsonb),
  ('perfect-score','Flawless','Score 100% on a mock exam','🎯', '{"type":"perfect","value":1}'::jsonb),
  ('subject-master','Subject Master','Average 80%+ across 5 attempts in one subject','🎓', '{"type":"subject_master","value":80}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- 6. Indexes for adaptive engine performance
CREATE INDEX IF NOT EXISTS idx_questions_subject_difficulty ON public.questions (subject_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_attempt_answers_question ON public.attempt_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_subject ON public.exam_attempts (user_id, subject_id);
