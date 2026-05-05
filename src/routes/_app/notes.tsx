import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookOpen,
  Loader2,
  Search,
  FileText,
  FileType2,
  ChevronDown,
  ArrowLeft,
} from "lucide-react";
import {
  CLASS_LEVELS,
  exportLessonNoteDocx,
  exportLessonNotePdf,
  type LessonNote,
} from "@/lib/lesson-notes";

export const Route = createFileRoute("/_app/notes")({
  head: () => ({
    meta: [
      { title: "Lesson notes — Sapientia" },
      {
        name: "description",
        content:
          "Browse NERDC scheme-aligned lesson notes published by teachers on Sapientia.",
      },
    ],
  }),
  component: NotesPage,
});

type Subject = { id: string; name: string };

function NotesPage() {
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<LessonNote[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [open, setOpen] = useState<LessonNote | null>(null);
  const [q, setQ] = useState("");
  const [klass, setKlass] = useState<string>("all");
  const [subj, setSubj] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const [{ data: ln }, { data: subs }] = await Promise.all([
        supabase
          .from("lesson_notes")
          .select("*")
          .eq("is_published", true)
          .order("updated_at", { ascending: false })
          .limit(500),
        supabase.from("subjects").select("id,name").order("name"),
      ]);
      setNotes((ln ?? []) as LessonNote[]);
      setSubjects((subs ?? []) as Subject[]);
      setLoading(false);
    })();
  }, []);

  const subjectName = (id: string | null) =>
    subjects.find((s) => s.id === id)?.name || "—";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return notes.filter((n) => {
      if (klass !== "all" && n.class_level !== klass) return false;
      if (subj !== "all" && n.subject_id !== subj) return false;
      if (
        needle &&
        !`${n.topic} ${n.sub_topic ?? ""}`.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [notes, q, klass, subj]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </div>
    );
  }

  if (open) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Button variant="ghost" size="sm" onClick={() => setOpen(null)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to notes
        </Button>
        <article className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge variant="outline">{subjectName(open.subject_id)}</Badge>
            <Badge variant="outline">{open.class_level}</Badge>
            <Badge variant="outline">Term {open.term}</Badge>
            <Badge variant="outline">Week {open.week}</Badge>
          </div>
          <h1 className="font-display text-2xl font-semibold">{open.topic}</h1>
          {open.sub_topic && <p className="italic text-muted-foreground">{open.sub_topic}</p>}
          <Section title="Objectives" body={open.objectives} />
          <Section title="Content" body={open.content} />
          <Section title="Resources / materials" body={open.resources} />
          <Section title="Evaluation" body={open.evaluation} />
          <Section title="Assignment" body={open.assignment} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Download <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => exportLessonNotePdf(open, subjectName(open.subject_id))}>
                <FileText className="mr-2 h-4 w-4" /> PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportLessonNoteDocx(open, subjectName(open.subject_id))}>
                <FileType2 className="mr-2 h-4 w-4" /> Word (.docx)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </article>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-2xl font-semibold flex items-center gap-2 mb-1">
        <BookOpen className="h-6 w-6 text-emerald" /> Lesson notes
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        NERDC scheme-aligned notes published by Sapientia teachers.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="relative sm:col-span-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search topic"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={subj} onValueChange={setSubj}>
          <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subjects</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={klass} onValueChange={setKlass}>
          <SelectTrigger><SelectValue placeholder="Class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {CLASS_LEVELS.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No published notes match your filters yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => setOpen(n)}
              className="text-left rounded-lg border bg-card p-4 hover:border-emerald/60 transition"
            >
              <div className="flex flex-wrap items-center gap-1 mb-2">
                <Badge variant="outline" className="text-xs">{subjectName(n.subject_id)}</Badge>
                <Badge variant="outline" className="text-xs">{n.class_level}</Badge>
                <Badge variant="outline" className="text-xs">T{n.term} W{n.week}</Badge>
              </div>
              <h3 className="font-medium leading-tight mb-1">{n.topic}</h3>
              {n.sub_topic && <p className="text-xs text-muted-foreground">{n.sub_topic}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, body }: { title: string; body?: string | null }) {
  if (!body || !body.trim()) return null;
  return (
    <section>
      <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-1">{title}</h2>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{body}</div>
    </section>
  );
}