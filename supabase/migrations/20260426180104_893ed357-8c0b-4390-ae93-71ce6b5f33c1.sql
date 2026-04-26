-- Re-seed core subjects (idempotent on slug) and add SRS + Mock Session schemas

-- 1. Subjects (19 across Science, Arts, Commercial)
INSERT INTO public.subjects (slug, name, description, icon) VALUES
  ('english-language', 'English Language', 'Comprehension, lexis, structure, oral and essay.', '📘'),
  ('mathematics', 'Mathematics', 'Algebra, geometry, statistics, calculus and more.', '📐'),
  ('further-mathematics', 'Further Mathematics', 'Advanced calculus, vectors, mechanics, statistics.', '∑'),
  ('physics', 'Physics', 'Mechanics, waves, electricity, modern physics.', '⚛️'),
  ('chemistry', 'Chemistry', 'Atomic structure, reactions, organic and physical chemistry.', '🧪'),
  ('biology', 'Biology', 'Cells, ecology, genetics, human physiology.', '🧬'),
  ('agricultural-science', 'Agricultural Science', 'Crops, livestock, soil, farm economics.', '🌾'),
  ('geography', 'Geography', 'Physical, human, and Nigerian geography.', '🌍'),
  ('government', 'Government', 'Constitutions, institutions, Nigerian political history.', '🏛️'),
  ('history', 'History', 'African and Nigerian historical movements.', '📜'),
  ('crs', 'Christian Religious Studies', 'Old & New Testament narratives and themes.', '✝️'),
  ('irs', 'Islamic Religious Studies', 'Quran, Hadith, Seerah and Fiqh.', '☪️'),
  ('literature-in-english', 'Literature-in-English', 'Prose, drama, poetry — Nigerian and global.', '📚'),
  ('civic-education', 'Civic Education', 'Rights, duties, democracy, national values.', '🤝'),
  ('economics', 'Economics', 'Micro, macro, Nigerian and international economics.', '💹'),
  ('financial-accounting', 'Financial Accounting', 'Books of accounts, ledger, final accounts.', '📒'),
  ('commerce', 'Commerce', 'Trade, distribution, business institutions.', '🛒'),
  ('marketing', 'Marketing', 'Marketing mix, channels, consumer behaviour.', '📣'),
  ('book-keeping', 'Book Keeping', 'Records of transactions, trial balance, errors.', '📗')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon;

-- 2. Spaced Repetition Queue
CREATE TABLE IF NOT EXISTS public.review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  question_id UUID NOT NULL,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  interval_days INT NOT NULL DEFAULT 1,
  ease_factor NUMERIC(4,2) NOT NULL DEFAULT 2.50,
  repetitions INT NOT NULL DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  last_correct BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_review_queue_user_due ON public.review_queue(user_id, due_at);

ALTER TABLE public.review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own review queue" ON public.review_queue
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own review queue" ON public.review_queue
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own review queue" ON public.review_queue
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own review queue" ON public.review_queue
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_review_queue_updated_at
  BEFORE UPDATE ON public.review_queue
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. Mock Sessions (for JAMB-style multi-subject mocks)
CREATE TABLE IF NOT EXISTS public.mock_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('waec','jamb')),
  subject_ids UUID[] NOT NULL,
  attempt_ids UUID[] NOT NULL DEFAULT '{}',
  total_questions INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  score_percent NUMERIC,
  duration_seconds INT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mock_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own mock sessions" ON public.mock_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own mock sessions" ON public.mock_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own mock sessions" ON public.mock_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own mock sessions" ON public.mock_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);