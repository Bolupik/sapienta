/**
 * Question helpers shared across exam, mock, review and bank flows.
 *
 * Database stores `options` as a JSONB object: { A: "...", B: "...", C: "...", D: "..." }
 * but our UI components consume `{ label, text }[]` arrays, so we normalise on load.
 */

export type Difficulty = "easy" | "medium" | "hard";
export type ExamType = "waec" | "jamb" | "both";

export type RawOptions =
  | { [key: string]: string }
  | { label: string; text: string }[]
  | null
  | undefined;

export type NormalizedOption = { label: string; text: string };

export type NormalizedQuestion = {
  id: string;
  question_text: string;
  options: NormalizedOption[];
  correct_answer: string;
  explanation: string | null;
  topic: string | null;
  year?: number | null;
  image_url: string | null;
  difficulty: Difficulty;
  exam_type?: ExamType;
  subject_id?: string;
};

const LABEL_ORDER = ["A", "B", "C", "D", "E", "F"];

/** Convert any supported `options` shape to `{label,text}[]` (sorted A-F). */
export function normalizeOptions(opts: RawOptions): NormalizedOption[] {
  if (!opts) return [];
  if (Array.isArray(opts)) {
    // Already in label/text shape — defensive copy and sort.
    return [...opts]
      .map((o) => ({ label: String(o.label), text: String(o.text ?? "") }))
      .sort(
        (a, b) =>
          LABEL_ORDER.indexOf(a.label.toUpperCase()) -
          LABEL_ORDER.indexOf(b.label.toUpperCase())
      );
  }
  // Object form { A: "...", B: "..." }
  return LABEL_ORDER.filter((k) => k in (opts as Record<string, unknown>)).map(
    (k) => ({
      label: k,
      text: String((opts as Record<string, string>)[k] ?? ""),
    })
  );
}

/** Normalize a single question row from the DB. */
export function normalizeQuestion<T extends Record<string, unknown>>(
  row: T
): NormalizedQuestion {
  return {
    id: String(row.id),
    question_text: String(row.question_text ?? ""),
    options: normalizeOptions(row.options as RawOptions),
    correct_answer: String(row.correct_answer ?? ""),
    explanation: (row.explanation as string | null) ?? null,
    topic: (row.topic as string | null) ?? null,
    year: (row.year as number | null | undefined) ?? null,
    image_url: (row.image_url as string | null) ?? null,
    difficulty: ((row.difficulty as Difficulty) ?? "medium"),
    exam_type: row.exam_type as ExamType | undefined,
    subject_id: row.subject_id as string | undefined,
  };
}

/** Shuffle in place (Fisher-Yates) returning the same reference. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Format seconds as MM:SS or HH:MM:SS. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Build a deep-link to the AI tutor with a specific question's context. */
export function tutorLinkForQuestion(q: NormalizedQuestion, subjectId?: string) {
  return {
    to: "/tutor" as const,
    search: {
      questionId: q.id,
      subjectId: subjectId ?? q.subject_id ?? "",
    },
  };
}