import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  Plus,
  Loader2,
  GraduationCap,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  FileText,
  FileType2,
  ChevronDown,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CLASS_LEVELS,
  exportLessonNoteDocx,
  exportLessonNotePdf,
  getMyTeacherApplication,
  isTeacher,
  type LessonNote,
} from "@/lib/lesson-notes";

export const Route = createFileRoute("/_app/teachers")({
  head: () => ({
    meta: [
      { title: "Teachers — Sapientia" },
      {
        name: "description",
        content:
          "Create and share NERDC scheme-aligned lesson notes for Nigerian secondary school students.",
      },
    ],
  }),
  component: TeachersPage,
});

type Subject = { id: string; name: string; slug: string };
type Application = {
  id: string;
  status: "pending" | "approved" | "rejected";
  full_name: string;
  school: string | null;
  subjects: string[];
  message: string | null;
};

function TeachersPage() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<{ isTeacher: boolean; isAdmin: boolean }>({
    isTeacher: false,
    isAdmin: false,
  });
  const [application, setApplication] = useState<Application | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [notes, setNotes] = useState<LessonNote[]>([]);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    const r = await isTeacher(user.id);
    setRole(r);
    const app = await getMyTeacherApplication(user.id);
    setApplication(app as Application | null);
    const { data: subs } = await supabase
      .from("subjects")
      .select("id,name,slug")
      .order("name");
    setSubjects((subs ?? []) as Subject[]);
    if (r.isTeacher) {
      const { data: ln } = await supabase
        .from("lesson_notes")
        .select("*")
        .eq("teacher_id", user.id)
        .order("updated_at", { ascending: false });
      setNotes((ln ?? []) as LessonNote[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </div>
    );
  }

  if (!role.isTeacher) {
    return (
      <ApplyPanel
        existing={application}
        subjects={subjects}
        defaultName={profile?.full_name || ""}
        defaultSchool={profile?.school || ""}
        onSubmitted={refresh}
      />
    );
  }

  return (
    <TeacherDashboard
      subjects={subjects}
      notes={notes}
      isAdmin={role.isAdmin}
      onChange={refresh}
    />
  );
}

function ApplyPanel({
  existing,
  subjects,
  defaultName,
  defaultSchool,
  onSubmitted,
}: {
  existing: Application | null;
  subjects: Subject[];
  defaultName: string;
  defaultSchool: string;
  onSubmitted: () => void;
}) {
  const { user } = useAuth();
  const [fullName, setFullName] = useState(existing?.full_name || defaultName);
  const [school, setSchool] = useState(existing?.school || defaultSchool);
  const [picked, setPicked] = useState<string[]>(existing?.subjects || []);
  const [message, setMessage] = useState(existing?.message || "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!user) return;
    if (!fullName.trim() || picked.length === 0) {
      toast.error("Please add your name and pick at least one subject");
      return;
    }
    setSaving(true);
    const payload = {
      user_id: user.id,
      full_name: fullName.trim().slice(0, 120),
      school: school.trim().slice(0, 200) || null,
      subjects: picked,
      message: message.trim().slice(0, 1000) || null,
      status: "pending" as const,
    };
    const { error } = await supabase
      .from("teacher_applications")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Application submitted — an admin will review it shortly");
    onSubmitted();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-lg bg-gradient-hero flex items-center justify-center">
          <GraduationCap className="h-5 w-5 text-emerald-foreground" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold">Become a teacher</h1>
          <p className="text-sm text-muted-foreground">
            Write NERDC scheme-aligned lesson notes and share them with students.
          </p>
        </div>
      </div>

      {existing && (
        <div className="mb-6 rounded-lg border p-4 bg-muted/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Your application</span>
            <Badge
              variant={
                existing.status === "approved"
                  ? "default"
                  : existing.status === "rejected"
                    ? "destructive"
                    : "secondary"
              }
            >
              {existing.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {existing.status === "pending"
              ? "Awaiting admin review. You can update your details below."
              : existing.status === "rejected"
                ? "Your application was not approved. You may submit a revised request."
                : "Approved — refresh to access the teacher tools."}
          </p>
        </div>
      )}

      <div className="space-y-4 rounded-xl border p-5 bg-card">
        <div>
          <Label>Full name</Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div>
          <Label>School (optional)</Label>
          <Input
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <Label>Subjects you teach</Label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {subjects.map((s) => {
              const on = picked.includes(s.slug);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    setPicked((p) =>
                      on ? p.filter((x) => x !== s.slug) : [...p, s.slug],
                    )
                  }
                  className={`rounded-md border px-3 py-2 text-sm text-left transition ${
                    on
                      ? "border-emerald bg-emerald/10 text-foreground"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label>Why you want to teach here (optional)</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            rows={4}
          />
        </div>
        <Button
          onClick={submit}
          disabled={saving}
          className="w-full bg-emerald text-emerald-foreground hover:bg-emerald/90"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : existing ? (
            "Update application"
          ) : (
            "Submit application"
          )}
        </Button>
      </div>
    </div>
  );
}

const EMPTY_NOTE = {
  subject_id: "",
  class_level: "SS1",
  term: 1,
  week: 1,
  topic: "",
  sub_topic: "",
  objectives: "",
  content: "",
  resources: "",
  evaluation: "",
  assignment: "",
  is_published: false,
};

function TeacherDashboard({
  subjects,
  notes,
  isAdmin,
  onChange,
}: {
  subjects: Subject[];
  notes: LessonNote[];
  isAdmin: boolean;
  onChange: () => void;
}) {
  const { user } = useAuth();
  const [editing, setEditing] = useState<LessonNote | null>(null);
  const [creating, setCreating] = useState(false);

  const subjectName = (id: string | null) =>
    subjects.find((s) => s.id === id)?.name || "—";

  const togglePublish = async (n: LessonNote) => {
    const { error } = await supabase
      .from("lesson_notes")
      .update({ is_published: !n.is_published })
      .eq("id", n.id);
    if (error) toast.error(error.message);
    else {
      toast.success(n.is_published ? "Unpublished" : "Published");
      onChange();
    }
  };

  const remove = async (n: LessonNote) => {
    if (!confirm(`Delete note "${n.topic}"?`)) return;
    const { error } = await supabase.from("lesson_notes").delete().eq("id", n.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Deleted");
      onChange();
    }
  };

  if (creating || editing) {
    return (
      <NoteEditor
        subjects={subjects}
        initial={editing ?? null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          onChange();
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-emerald" />
            Teacher workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your lesson notes. Published notes appear in the student notes
            library.
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link to="/teachers/admin">
                <ShieldCheck className="mr-2 h-4 w-4" /> Admin
              </Link>
            </Button>
          )}
          <AiDraftDialog subjects={subjects} onCreated={onChange} />
          <Button
            onClick={() => setCreating(true)}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
            size="sm"
          >
            <Plus className="mr-2 h-4 w-4" /> New note
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No lesson notes yet. Click <strong>New note</strong> to begin.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div
              key={n.id}
              className="rounded-lg border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Badge variant="outline">{n.class_level}</Badge>
                  <Badge variant="outline">Term {n.term}</Badge>
                  <Badge variant="outline">Week {n.week}</Badge>
                  <Badge variant={n.is_published ? "default" : "secondary"}>
                    {n.is_published ? "Published" : "Draft"}
                  </Badge>
                </div>
                <h3 className="font-medium truncate">{n.topic}</h3>
                <p className="text-xs text-muted-foreground">
                  {subjectName(n.subject_id)}
                  {n.sub_topic ? ` · ${n.sub_topic}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => togglePublish(n)}>
                  {n.is_published ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      Export <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => exportLessonNotePdf(n, subjectName(n.subject_id))}
                    >
                      <FileText className="mr-2 h-4 w-4" /> PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => exportLessonNoteDocx(n, subjectName(n.subject_id))}
                    >
                      <FileType2 className="mr-2 h-4 w-4" /> Word (.docx)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="ghost" onClick={() => setEditing(n)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => remove(n)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteEditor({
  subjects,
  initial,
  onClose,
  onSaved,
}: {
  subjects: Subject[];
  initial: LessonNote | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState(() => ({
    ...EMPTY_NOTE,
    ...(initial ?? {}),
    subject_id: initial?.subject_id ?? subjects[0]?.id ?? "",
    sub_topic: initial?.sub_topic ?? "",
    objectives: initial?.objectives ?? "",
    resources: initial?.resources ?? "",
    evaluation: initial?.evaluation ?? "",
    assignment: initial?.assignment ?? "",
  }));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!user) return;
    if (!form.topic.trim() || !form.content.trim() || !form.subject_id) {
      toast.error("Subject, topic and content are required");
      return;
    }
    setSaving(true);
    const payload = {
      teacher_id: user.id,
      subject_id: form.subject_id,
      class_level: form.class_level,
      term: Number(form.term),
      week: Number(form.week),
      topic: form.topic.trim().slice(0, 200),
      sub_topic: form.sub_topic?.trim().slice(0, 200) || null,
      objectives: form.objectives?.trim() || null,
      content: form.content.trim(),
      resources: form.resources?.trim() || null,
      evaluation: form.evaluation?.trim() || null,
      assignment: form.assignment?.trim() || null,
      is_published: form.is_published,
    };
    const q = initial
      ? supabase.from("lesson_notes").update(payload).eq("id", initial.id)
      : supabase.from("lesson_notes").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(initial ? "Note updated" : "Note created");
    onSaved();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl font-semibold">
          {initial ? "Edit lesson note" : "New lesson note"}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Subject</Label>
            <Select value={form.subject_id} onValueChange={(v) => set("subject_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Class</Label>
            <Select value={form.class_level} onValueChange={(v) => set("class_level", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CLASS_LEVELS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Term</Label>
            <Select value={String(form.term)} onValueChange={(v) => set("term", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((t) => (
                  <SelectItem key={t} value={String(t)}>Term {t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Week (1–14)</Label>
            <Input
              type="number"
              min={1}
              max={14}
              value={form.week}
              onChange={(e) => set("week", Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
        <div>
          <Label>Topic</Label>
          <Input value={form.topic} onChange={(e) => set("topic", e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label>Sub-topic (optional)</Label>
          <Input value={form.sub_topic} onChange={(e) => set("sub_topic", e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label>Objectives</Label>
          <Textarea rows={3} value={form.objectives} onChange={(e) => set("objectives", e.target.value)} />
        </div>
        <div>
          <Label>Content / lesson body</Label>
          <Textarea rows={10} value={form.content} onChange={(e) => set("content", e.target.value)} />
        </div>
        <div>
          <Label>Resources / materials</Label>
          <Textarea rows={2} value={form.resources} onChange={(e) => set("resources", e.target.value)} />
        </div>
        <div>
          <Label>Evaluation</Label>
          <Textarea rows={2} value={form.evaluation} onChange={(e) => set("evaluation", e.target.value)} />
        </div>
        <div>
          <Label>Assignment</Label>
          <Textarea rows={2} value={form.assignment} onChange={(e) => set("assignment", e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_published}
            onChange={(e) => set("is_published", e.target.checked)}
          />
          Publish to students
        </label>
        <Button
          onClick={save}
          disabled={saving}
          className="w-full bg-emerald text-emerald-foreground hover:bg-emerald/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save lesson note"}
        </Button>
      </div>
    </div>
  );
}
function AiDraftDialog({
  subjects,
  onCreated,
}: {
  subjects: Subject[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"term" | "single">("term");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [classLevel, setClassLevel] = useState("JSS1");
  const [term, setTerm] = useState(1);
  const [week, setWeek] = useState(1);
  const [topic, setTopic] = useState("");
  const [weeks, setWeeks] = useState(13);
  const [busy, setBusy] = useState(false);

  const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? "";

  const generate = async () => {
    if (!user || !subjectId) {
      toast.error("Pick a subject first");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("draft-lesson-notes", {
        body: {
          mode,
          subject: subjectName,
          classLevel,
          term,
          week: mode === "single" ? week : undefined,
          topic: mode === "single" ? topic || undefined : undefined,
          weeks: mode === "term" ? weeks : undefined,
        },
      });
      if (error) throw error;
      const notes: any[] = (data as any)?.notes ?? [];
      if (notes.length === 0) throw new Error("AI returned no notes");

      const rows = notes.map((n) => ({
        teacher_id: user.id,
        subject_id: subjectId,
        class_level: classLevel,
        term,
        week: Number(n.week) || (mode === "single" ? week : 1),
        topic: String(n.topic || "Untitled").slice(0, 200),
        sub_topic: n.sub_topic ? String(n.sub_topic).slice(0, 200) : null,
        objectives: n.objectives ?? null,
        content: String(n.content ?? ""),
        resources: n.resources ?? null,
        evaluation: n.evaluation ?? null,
        assignment: n.assignment ?? null,
        is_published: false,
      }));

      const { error: insErr } = await supabase.from("lesson_notes").insert(rows);
      if (insErr) throw insErr;
      toast.success(`Drafted ${rows.length} note${rows.length === 1 ? "" : "s"}`);
      setOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to draft notes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="mr-2 h-4 w-4" /> AI draft
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI draft NERDC notes</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("term")}
              className={`rounded-md border px-3 py-2 text-sm ${mode === "term" ? "border-emerald bg-emerald/10" : ""}`}
            >
              Full term plan
            </button>
            <button
              type="button"
              onClick={() => setMode("single")}
              className={`rounded-md border px-3 py-2 text-sm ${mode === "single" ? "border-emerald bg-emerald/10" : ""}`}
            >
              Single week
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Subject</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Class</Label>
              <Select value={classLevel} onValueChange={setClassLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLASS_LEVELS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Term</Label>
              <Select value={String(term)} onValueChange={(v) => setTerm(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((t) => (
                    <SelectItem key={t} value={String(t)}>Term {t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mode === "term" ? (
              <div>
                <Label>Weeks</Label>
                <Input
                  type="number"
                  min={1}
                  max={14}
                  value={weeks}
                  onChange={(e) => setWeeks(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
                />
              </div>
            ) : (
              <div>
                <Label>Week</Label>
                <Input
                  type="number"
                  min={1}
                  max={14}
                  value={week}
                  onChange={(e) => setWeek(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
                />
              </div>
            )}
          </div>
          {mode === "single" && (
            <div>
              <Label>Topic (optional — leave blank to use NERDC topic)</Label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Notes are saved as drafts. Review and publish them to share with students.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={generate}
            disabled={busy || !subjectId}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="mr-2 h-4 w-4" /> Generate</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
