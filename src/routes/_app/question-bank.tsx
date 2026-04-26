import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Library,
  Search,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  CheckCircle2,
  Image as ImageIcon,
} from "lucide-react";
import { normalizeQuestion, type NormalizedQuestion } from "@/lib/question-utils";

const searchSchema = z.object({
  subject: fallback(z.string(), "all").default("all"),
  exam: fallback(z.enum(["all", "waec", "jamb"]), "all").default("all"),
  year: fallback(z.string(), "all").default("all"),
  topic: fallback(z.string(), "all").default("all"),
  difficulty: fallback(z.enum(["all", "easy", "medium", "hard"]), "all").default("all"),
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_app/question-bank")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({ meta: [{ title: "Question Bank — Sapientia" }] }),
  component: QuestionBankPage,
});

type Subject = { id: string; slug: string; name: string };
type Question = NormalizedQuestion & { exam_type: "waec" | "jamb" | "both" };

const PAGE_SIZE = 20;

function QuestionBankPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/question-bank" });

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState(search.q);

  // Load subjects once
  useEffect(() => {
    supabase
      .from("subjects")
      .select("id, slug, name")
      .order("name")
      .then(({ data }) => {
        if (data) setSubjects(data as Subject[]);
      });
  }, []);

  const subjectId = useMemo(() => {
    if (search.subject === "all") return null;
    return subjects.find((s) => s.slug === search.subject)?.id ?? null;
  }, [search.subject, subjects]);

  // Load filter options (years/topics) when subject changes
  useEffect(() => {
    let q = supabase.from("questions").select("year, topic");
    if (subjectId) q = q.eq("subject_id", subjectId);
    if (search.exam !== "all") q = q.eq("exam_type", search.exam);

    q.then(({ data }) => {
      if (!data) return;
      const ys = Array.from(
        new Set(data.map((r: any) => r.year).filter((y: any) => y != null))
      ).sort((a: any, b: any) => b - a);
      const ts = Array.from(
        new Set(data.map((r: any) => r.topic).filter((t: any) => !!t))
      ).sort();
      setYears(ys as number[]);
      setTopics(ts as string[]);
    });
  }, [subjectId, search.exam]);

  // Load questions when filters change
  useEffect(() => {
    setLoading(true);
    setPage(1);
    let q = supabase
      .from("questions")
      .select(
        "id, question_text, options, correct_answer, explanation, topic, year, image_url, difficulty, exam_type, subject_id"
      )
      .order("year", { ascending: false, nullsFirst: false })
      .limit(500);

    if (subjectId) q = q.eq("subject_id", subjectId);
    if (search.exam !== "all") q = q.eq("exam_type", search.exam);
    if (search.year !== "all") q = q.eq("year", Number(search.year));
    if (search.topic !== "all") q = q.eq("topic", search.topic);
    if (search.difficulty !== "all") q = q.eq("difficulty", search.difficulty);
    if (search.q.trim()) q = q.ilike("question_text", `%${search.q.trim()}%`);

    q.then(({ data, error }) => {
      if (error) {
        console.error(error);
        setQuestions([]);
      } else {
        setQuestions(
          (data ?? []).map((r) => normalizeQuestion(r as Record<string, unknown>) as Question)
        );
      }
      setLoading(false);
    });
  }, [subjectId, search.exam, search.year, search.topic, search.difficulty, search.q]);

  // Sync local search input -> URL with debounce
  useEffect(() => {
    if (searchInput === search.q) return;
    const t = setTimeout(() => {
      navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, q: searchInput }) });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const updateFilter = (key: string, value: string) => {
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, [key]: value }) });
  };

  const resetFilters = () => {
    setSearchInput("");
    navigate({
      search: {
        subject: "all",
        exam: "all",
        year: "all",
        topic: "all",
        difficulty: "all",
        q: "",
      },
    });
  };

  const subjectMap = useMemo(() => {
    const m = new Map<string, string>();
    subjects.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [subjects]);

  const totalPages = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
  const paged = questions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeFilterCount = [
    search.subject !== "all",
    search.exam !== "all",
    search.year !== "all",
    search.topic !== "all",
    search.difficulty !== "all",
    search.q.trim() !== "",
  ].filter(Boolean).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald/10 text-emerald">
            <Library className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Question Bank
            </h1>
            <p className="text-sm text-muted-foreground">
              Browse past WAEC & JAMB questions by year, topic and difficulty.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5 shadow-sm mb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Subject
            </label>
            <Select
              value={search.subject}
              onValueChange={(v) => updateFilter("subject", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.slug}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Exam
            </label>
            <Select
              value={search.exam}
              onValueChange={(v) => updateFilter("exam", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All exams</SelectItem>
                <SelectItem value="waec">WAEC</SelectItem>
                <SelectItem value="jamb">JAMB</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Year
            </label>
            <Select
              value={search.year}
              onValueChange={(v) => updateFilter("year", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Topic
            </label>
            <Select
              value={search.topic}
              onValueChange={(v) => updateFilter("topic", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All topics</SelectItem>
                {topics.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Difficulty
            </label>
            <Select
              value={search.difficulty}
              onValueChange={(v) => updateFilter("difficulty", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search question text..."
              className="pl-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear filters ({activeFilterCount})
            </Button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
            </span>
          ) : (
            <>
              <span className="font-medium text-foreground">{questions.length}</span>{" "}
              question{questions.length === 1 ? "" : "s"} found
              {questions.length > PAGE_SIZE && (
                <>
                  {" "}— showing {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, questions.length)}
                </>
              )}
            </>
          )}
        </p>
      </div>

      {!loading && questions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
          <Library className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="font-medium">No questions match your filters</p>
          <p className="text-sm text-muted-foreground mt-1">
            Try clearing some filters to see more results.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {paged.map((q, i) => {
          const isOpen = expanded.has(q.id);
          const isRevealed = revealed.has(q.id);
          const idx = (page - 1) * PAGE_SIZE + i + 1;
          return (
            <div
              key={q.id}
              className="rounded-xl border border-border/60 bg-card overflow-hidden transition-shadow hover:shadow-sm"
            >
              <button
                onClick={() => toggleExpand(q.id)}
                className="w-full text-left p-4 sm:p-5 flex gap-4"
              >
                <span className="text-xs font-mono text-muted-foreground pt-1 w-6 shrink-0">
                  {idx}.
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm sm:text-base leading-relaxed line-clamp-2">
                    {q.question_text}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {q.exam_type}
                    </Badge>
                    {q.year && (
                      <Badge variant="outline" className="text-[10px]">
                        {q.year}
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="text-[10px] capitalize"
                    >
                      {q.difficulty}
                    </Badge>
                    {q.topic && (
                      <Badge variant="outline" className="text-[10px]">
                        {q.topic}
                      </Badge>
                    )}
                    {subjectMap.get(q.subject_id) && (
                      <span className="text-[10px] text-muted-foreground">
                        · {subjectMap.get(q.subject_id)}
                      </span>
                    )}
                    {q.image_url && (
                      <ImageIcon className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="shrink-0 self-start pt-1 text-muted-foreground">
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border/60 bg-muted/20 p-4 sm:p-5 space-y-4">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {q.question_text}
                  </p>

                  {q.image_url && (
                    <img
                      src={q.image_url}
                      alt="Question diagram"
                      className="rounded-lg border border-border max-h-64"
                    />
                  )}

                  {q.options && q.options.length > 0 && (
                    <div className="space-y-1.5">
                      {q.options.map((opt) => {
                        const isCorrect =
                          isRevealed && opt.label === q.correct_answer;
                        return (
                          <div
                            key={opt.label}
                            className={`flex gap-3 rounded-lg border px-3 py-2 text-sm ${
                              isCorrect
                                ? "border-emerald/40 bg-emerald/5 text-foreground"
                                : "border-border/60 bg-background"
                            }`}
                          >
                            <span className="font-mono font-medium text-muted-foreground">
                              {opt.label}.
                            </span>
                            <span className="flex-1">{opt.text}</span>
                            {isCorrect && (
                              <CheckCircle2 className="h-4 w-4 text-emerald shrink-0" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!isRevealed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleReveal(q.id)}
                    >
                      Show answer & explanation
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-emerald/30 bg-emerald/5 p-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald">
                        Correct answer: {q.correct_answer}
                      </p>
                      {q.explanation && (
                        <p className="text-sm leading-relaxed text-foreground/90">
                          {q.explanation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {questions.length > PAGE_SIZE && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-3">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </main>
  );
}
