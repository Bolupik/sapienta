
-- ENUMS
create type public.app_role as enum ('admin', 'student');
create type public.exam_type as enum ('waec', 'jamb', 'both');
create type public.question_format as enum ('objective', 'theory');
create type public.difficulty_level as enum ('easy', 'medium', 'hard');

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  display_name text,
  school text,
  target_exam exam_type not null default 'both',
  exam_year int,
  selected_subjects text[] not null default '{}',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Profiles viewable by owner" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

-- USER ROLES
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users view own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);
create policy "Admins manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- SUBJECTS
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  icon text,
  created_at timestamptz not null default now()
);
alter table public.subjects enable row level security;
create policy "Subjects readable" on public.subjects for select to authenticated using (true);
create policy "Admins write subjects" on public.subjects for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- QUESTIONS
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  exam_type exam_type not null,
  format question_format not null default 'objective',
  difficulty difficulty_level not null default 'medium',
  topic text,
  question_text text not null,
  options jsonb,
  correct_answer text not null,
  explanation text,
  year int,
  created_at timestamptz not null default now()
);
alter table public.questions enable row level security;
create policy "Questions readable" on public.questions for select to authenticated using (true);
create policy "Admins write questions" on public.questions for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- EXAM ATTEMPTS
create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  exam_type exam_type not null,
  total_questions int not null default 0,
  correct_count int not null default 0,
  score_percent numeric(5,2),
  duration_seconds int,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.exam_attempts enable row level security;
create policy "Users view own attempts" on public.exam_attempts for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own attempts" on public.exam_attempts for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own attempts" on public.exam_attempts for update to authenticated using (auth.uid() = user_id);
create policy "Users delete own attempts" on public.exam_attempts for delete to authenticated using (auth.uid() = user_id);

-- ATTEMPT ANSWERS
create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  user_answer text,
  is_correct boolean not null default false,
  time_spent_seconds int,
  created_at timestamptz not null default now()
);
alter table public.attempt_answers enable row level security;
create policy "Users view own answers" on public.attempt_answers for select to authenticated
  using (exists (select 1 from public.exam_attempts ea where ea.id = attempt_answers.attempt_id and ea.user_id = auth.uid()));
create policy "Users insert own answers" on public.attempt_answers for insert to authenticated
  with check (exists (select 1 from public.exam_attempts ea where ea.id = attempt_answers.attempt_id and ea.user_id = auth.uid()));
create policy "Users delete own answers" on public.attempt_answers for delete to authenticated
  using (exists (select 1 from public.exam_attempts ea where ea.id = attempt_answers.attempt_id and ea.user_id = auth.uid()));

-- TUTOR CONVERSATIONS + MESSAGES
create table public.tutor_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tutor_conversations enable row level security;
create policy "Users view own conv" on public.tutor_conversations for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own conv" on public.tutor_conversations for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own conv" on public.tutor_conversations for update to authenticated using (auth.uid() = user_id);
create policy "Users delete own conv" on public.tutor_conversations for delete to authenticated using (auth.uid() = user_id);

create table public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.tutor_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.tutor_messages enable row level security;
create policy "Users view own msgs" on public.tutor_messages for select to authenticated
  using (exists (select 1 from public.tutor_conversations c where c.id = tutor_messages.conversation_id and c.user_id = auth.uid()));
create policy "Users insert own msgs" on public.tutor_messages for insert to authenticated
  with check (exists (select 1 from public.tutor_conversations c where c.id = tutor_messages.conversation_id and c.user_id = auth.uid()));
create policy "Users delete own msgs" on public.tutor_messages for delete to authenticated
  using (exists (select 1 from public.tutor_conversations c where c.id = tutor_messages.conversation_id and c.user_id = auth.uid()));

-- TIMESTAMP TRIGGER
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create trigger trg_tutor_conversations_updated before update on public.tutor_conversations
  for each row execute function public.tg_set_updated_at();

-- AUTO PROFILE + ROLE on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, display_name, target_exam, exam_year, selected_subjects, school)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', null),
    coalesce((new.raw_user_meta_data->>'target_exam')::public.exam_type, 'both'::public.exam_type),
    nullif(new.raw_user_meta_data->>'exam_year','')::int,
    coalesce(
      (select array_agg(value)::text[] from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'selected_subjects','[]'::jsonb))),
      '{}'::text[]
    ),
    new.raw_user_meta_data->>'school'
  );
  insert into public.user_roles (user_id, role) values (new.id, 'student');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- SEED SUBJECTS
insert into public.subjects (slug, name, description, icon) values
  ('mathematics', 'Mathematics', 'Algebra, geometry, calculus, statistics', 'calculator'),
  ('english', 'English Language', 'Comprehension, lexis, oral, essay', 'book-open'),
  ('physics', 'Physics', 'Mechanics, waves, electricity, modern physics', 'atom'),
  ('chemistry', 'Chemistry', 'Inorganic, organic, physical chemistry', 'flask-conical'),
  ('biology', 'Biology', 'Cells, genetics, ecology, physiology', 'leaf');

-- SEED QUESTIONS (with explicit enum casts)
with s as (select id, slug from public.subjects)
insert into public.questions (subject_id, exam_type, format, difficulty, topic, question_text, options, correct_answer, explanation, year)
select s.id, 'jamb'::public.exam_type, 'objective'::public.question_format, 'easy'::public.difficulty_level, 'Algebra',
  'If 2x + 3 = 11, what is the value of x?',
  '[{"label":"A","text":"3"},{"label":"B","text":"4"},{"label":"C","text":"5"},{"label":"D","text":"6"}]'::jsonb,
  'B', 'Subtract 3 from both sides: 2x = 8, then divide by 2.', 2022
from s where slug='mathematics'
union all
select s.id, 'jamb'::public.exam_type, 'objective'::public.question_format, 'medium'::public.difficulty_level, 'Geometry',
  'The sum of the interior angles of a hexagon is:',
  '[{"label":"A","text":"540°"},{"label":"B","text":"720°"},{"label":"C","text":"900°"},{"label":"D","text":"1080°"}]'::jsonb,
  'B', 'Sum = (n-2)×180 = (6-2)×180 = 720°.', 2021
from s where slug='mathematics'
union all
select s.id, 'waec'::public.exam_type, 'objective'::public.question_format, 'easy'::public.difficulty_level, 'Lexis',
  'Choose the word nearest in meaning to "diligent":',
  '[{"label":"A","text":"lazy"},{"label":"B","text":"hardworking"},{"label":"C","text":"clever"},{"label":"D","text":"honest"}]'::jsonb,
  'B', 'Diligent means showing care and conscientiousness; hardworking is the closest synonym.', 2023
from s where slug='english'
union all
select s.id, 'jamb'::public.exam_type, 'objective'::public.question_format, 'medium'::public.difficulty_level, 'Comprehension',
  'The antonym of "abundant" is:',
  '[{"label":"A","text":"plentiful"},{"label":"B","text":"scarce"},{"label":"C","text":"rich"},{"label":"D","text":"vast"}]'::jsonb,
  'B', 'Abundant means a lot of something; scarce is its opposite.', 2022
from s where slug='english'
union all
select s.id, 'jamb'::public.exam_type, 'objective'::public.question_format, 'medium'::public.difficulty_level, 'Mechanics',
  'A body of mass 5kg moving with velocity 10 m/s has kinetic energy of:',
  '[{"label":"A","text":"50 J"},{"label":"B","text":"100 J"},{"label":"C","text":"250 J"},{"label":"D","text":"500 J"}]'::jsonb,
  'C', 'KE = ½mv² = ½ × 5 × 10² = 250 J.', 2021
from s where slug='physics'
union all
select s.id, 'waec'::public.exam_type, 'objective'::public.question_format, 'easy'::public.difficulty_level, 'Electricity',
  'The SI unit of electric current is:',
  '[{"label":"A","text":"Volt"},{"label":"B","text":"Ampere"},{"label":"C","text":"Ohm"},{"label":"D","text":"Watt"}]'::jsonb,
  'B', 'The ampere (A) is the SI base unit of electric current.', 2023
from s where slug='physics'
union all
select s.id, 'jamb'::public.exam_type, 'objective'::public.question_format, 'medium'::public.difficulty_level, 'Periodic Table',
  'Which of these elements is a noble gas?',
  '[{"label":"A","text":"Chlorine"},{"label":"B","text":"Oxygen"},{"label":"C","text":"Neon"},{"label":"D","text":"Sodium"}]'::jsonb,
  'C', 'Neon (Ne) belongs to Group 18 — the noble gases.', 2022
from s where slug='chemistry'
union all
select s.id, 'waec'::public.exam_type, 'objective'::public.question_format, 'easy'::public.difficulty_level, 'Acids and Bases',
  'The pH of a neutral solution is:',
  '[{"label":"A","text":"0"},{"label":"B","text":"7"},{"label":"C","text":"10"},{"label":"D","text":"14"}]'::jsonb,
  'B', 'Pure water at 25°C has a pH of 7 — neutral on the pH scale.', 2023
from s where slug='chemistry'
union all
select s.id, 'jamb'::public.exam_type, 'objective'::public.question_format, 'easy'::public.difficulty_level, 'Cell Biology',
  'The powerhouse of the cell is the:',
  '[{"label":"A","text":"Nucleus"},{"label":"B","text":"Ribosome"},{"label":"C","text":"Mitochondrion"},{"label":"D","text":"Golgi body"}]'::jsonb,
  'C', 'Mitochondria generate ATP through cellular respiration — the cell''s energy.', 2022
from s where slug='biology'
union all
select s.id, 'waec'::public.exam_type, 'objective'::public.question_format, 'medium'::public.difficulty_level, 'Genetics',
  'A pair of contrasting characters is called:',
  '[{"label":"A","text":"Genes"},{"label":"B","text":"Alleles"},{"label":"C","text":"Chromosomes"},{"label":"D","text":"Traits"}]'::jsonb,
  'B', 'Alleles are alternative forms of a gene that produce contrasting traits.', 2023
from s where slug='biology';
