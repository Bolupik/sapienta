
-- Teacher applications
CREATE TABLE public.teacher_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  full_name text not null,
  school text,
  subjects text[] not null default '{}',
  message text,
  status text not null default 'pending', -- pending | approved | rejected
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.teacher_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own application" ON public.teacher_applications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users view own application" ON public.teacher_applications
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Users update own pending application" ON public.teacher_applications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "Admins manage applications" ON public.teacher_applications
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_ta_updated BEFORE UPDATE ON public.teacher_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Lesson notes (NERDC: class -> term -> week -> topic)
CREATE TABLE public.lesson_notes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null,
  subject_id uuid references public.subjects(id) on delete set null,
  class_level text not null, -- e.g. JSS1, JSS2, SS1, SS2, SS3
  term int not null check (term in (1,2,3)),
  week int not null check (week between 1 and 14),
  topic text not null,
  sub_topic text,
  objectives text,
  content text not null,
  resources text,
  evaluation text,
  assignment text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
ALTER TABLE public.lesson_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_lesson_notes_teacher ON public.lesson_notes(teacher_id);
CREATE INDEX idx_lesson_notes_subject ON public.lesson_notes(subject_id);
CREATE INDEX idx_lesson_notes_class ON public.lesson_notes(class_level, term, week);

CREATE POLICY "Teachers insert own notes" ON public.lesson_notes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = teacher_id AND (public.has_role(auth.uid(),'teacher') OR public.has_role(auth.uid(),'admin')));

CREATE POLICY "Teachers update own notes" ON public.lesson_notes
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Teachers delete own notes" ON public.lesson_notes
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Read published notes or own" ON public.lesson_notes
  FOR SELECT TO authenticated
  USING (is_published = true OR auth.uid() = teacher_id OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_ln_updated BEFORE UPDATE ON public.lesson_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
