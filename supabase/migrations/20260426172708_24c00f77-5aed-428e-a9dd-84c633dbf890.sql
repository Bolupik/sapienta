
INSERT INTO public.subjects (slug, name, description, icon) VALUES
  ('mathematics', 'Mathematics', 'Algebra, geometry, statistics & calculus foundations.', '📐'),
  ('english', 'English Language', 'Comprehension, lexis, structure & oral English.', '📖'),
  ('physics', 'Physics', 'Mechanics, waves, electricity & modern physics.', '⚛️'),
  ('chemistry', 'Chemistry', 'Atomic structure, organic & inorganic chemistry.', '🧪'),
  ('biology', 'Biology', 'Cells, ecology, genetics & human physiology.', '🧬'),
  ('agricultural-science', 'Agricultural Science', 'Crops, livestock, soil & farm economics.', '🌾'),
  ('further-mathematics', 'Further Mathematics', 'Vectors, matrices, dynamics & advanced calculus.', '🧮'),
  ('geography', 'Geography', 'Physical, human & regional geography of Africa.', '🌍'),
  ('economics', 'Economics', 'Micro & macro principles, Nigerian economy.', '💹'),
  ('government', 'Government', 'Constitutions, political theory & Nigerian government.', '🏛️'),
  ('literature-in-english', 'Literature in English', 'Prose, poetry, drama & literary appreciation.', '✍️'),
  ('crs', 'Christian Religious Studies', 'Old & New Testament, themes & ethics.', '✝️'),
  ('irs', 'Islamic Religious Studies', 'Qur''an, Hadith, Fiqh & Islamic history.', '☪️'),
  ('history', 'History', 'Pre-colonial, colonial & post-colonial Nigeria & Africa.', '📜'),
  ('civic-education', 'Civic Education', 'Rights, duties, democracy & national values.', '🤝'),
  ('commerce', 'Commerce', 'Trade, business organisation, banking & insurance.', '🏪'),
  ('financial-accounting', 'Financial Accounting', 'Bookkeeping, ledgers, final accounts & ratios.', '📊'),
  ('marketing', 'Marketing', 'Consumer behaviour, channels, pricing & promotion.', '📣'),
  ('computer-studies', 'Computer Studies', 'Hardware, software, networks & basic programming.', '💻')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon;
