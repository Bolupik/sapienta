import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Download,
  Trash2,
  WifiOff,
  Wifi,
  Loader2,
  HardDrive,
  BookOpen,
  Play,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Clock,
  Library,
  AlertTriangle,
  Pause,
  X,
  Save,
  Upload,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import {
  downloadPack,
  listPacks,
  deletePack,
  getPackQuestions,
  cancelDownload,
  listInProgressDownloads,
  clearDownloadProgress,
  downloadPackToFile,
  downloadPackAsPdf,
  downloadPackAsDocx,
  importPackFromFile,
  DownloadCancelled,
  type PackMeta,
  type OfflineQuestion,
  type DownloadProgress,
} from "@/lib/offline-packs";
import { shuffle, formatDuration } from "@/lib/question-utils";
import { useOnlineStatus } from "@/hooks/use-online-status";

export const Route = createFileRoute("/_app/offline")({
  head: () => ({
    meta: [
      { title: "Offline Packs — Sapientia" },
      {
        name: "description",
        content:
          "Download subjects to your device and keep practising even with no internet. Built for spotty Nigerian networks.",
      },
    ],
  }),
  component: OfflinePage,
});

type Subject = { id: string; slug: string; name: string };
type Mode =
  | { kind: "list" }
  | { kind: "browse"; pack: PackMeta }
  | { kind: "practice"; pack: PackMeta; mock?: boolean };

function OfflinePage() {
  const { user } = useAuth();
  const online = useOnlineStatus();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [downloading, setDownloading] = useState<Record<string, { loaded: number; total: number }>>(
    {}
  );
  const [pending, setPending] = useState<DownloadProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  // Initial load
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [subs, ps, inProg] = await Promise.all([
        online
          ? supabase.from("subjects").select("id, slug, name").order("name")
          : Promise.resolve({ data: null }),
        listPacks(user.id),
        listInProgressDownloads(user.id),
      ]);
      if (subs.data) setSubjects(subs.data as Subject[]);
      setPacks(ps);
      setPending(inProg);
      setLoading(false);
    })();
  }, [user, online]);

  const packBySubject = useMemo(() => {
    const m = new Map<string, PackMeta>();
    for (const p of packs) m.set(p.subject_id, p);
    return m;
  }, [packs]);

  const handleDownload = async (subject: Subject) => {
    if (!user) return;
    if (!online) {
      toast.error("You're offline — connect to download a pack.");
      return;
    }
    setDownloading((d) => ({ ...d, [subject.id]: { loaded: 0, total: 0 } }));
    try {
      const meta = await downloadPack(user.id, subject, (loaded, total) => {
        setDownloading((d) => ({ ...d, [subject.id]: { loaded, total } }));
      });
      setPacks((prev) => {
        const others = prev.filter((p) => p.subject_id !== subject.id);
        return [meta, ...others];
      });
      setPending((prev) => prev.filter((p) => p.subject_id !== subject.id));
      toast.success(`${subject.name} ready offline · ${meta.question_count} questions`);
    } catch (e) {
      console.error(e);
      // Refresh pending list — server saved a checkpoint we can resume from.
      const inProg = await listInProgressDownloads(user.id);
      setPending(inProg);
      if (e instanceof DownloadCancelled) {
        toast.info(`${subject.name} download paused — resume any time.`);
      } else {
        toast.error(
          "Download interrupted. Your progress is saved — tap Resume when you're back online."
        );
      }
    } finally {
      setDownloading((d) => {
        const next = { ...d };
        delete next[subject.id];
        return next;
      });
    }
  };

  const handleCancel = (subjectId: string) => {
    cancelDownload(user!.id, subjectId);
  };

  const handleAbandon = async (p: DownloadProgress) => {
    if (!user) return;
    if (!confirm(`Discard partial download of "${p.subject_name}"?`)) return;
    await clearDownloadProgress(user.id, p.subject_id);
    setPending((prev) => prev.filter((x) => x.subject_id !== p.subject_id));
  };

  const handleExport = async (
    pack: PackMeta,
    format: "json" | "pdf" | "docx"
  ) => {
    if (!user) return;
    try {
      const ok =
        format === "pdf"
          ? await downloadPackAsPdf(user.id, pack.subject_id)
          : format === "docx"
            ? await downloadPackAsDocx(user.id, pack.subject_id)
            : await downloadPackToFile(user.id, pack.subject_id);
      if (ok)
        toast.success(
          `Saved ${pack.subject_name} as ${format.toUpperCase()} to your Downloads folder.`
        );
      else toast.error("Couldn't export this pack.");
    } catch (e) {
      console.error(e);
      toast.error("Export failed.");
    }
  };

  const handleImport = async (file: File) => {
    if (!user) return;
    try {
      const meta = await importPackFromFile(user.id, file);
      setPacks((prev) => {
        const others = prev.filter((p) => p.subject_id !== meta.subject_id);
        return [meta, ...others];
      });
      toast.success(`Imported ${meta.subject_name} · ${meta.question_count} questions`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    }
  };

  const handleDelete = async (pack: PackMeta) => {
    if (!user) return;
    if (!confirm(`Remove "${pack.subject_name}" from this device?`)) return;
    await deletePack(user.id, pack.subject_id);
    setPacks((prev) => prev.filter((p) => p.key !== pack.key));
    toast.success(`${pack.subject_name} removed.`);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </main>
    );
  }

  if (mode.kind === "browse" && user) {
    return (
      <BrowsePack
        userId={user.id}
        pack={mode.pack}
        onBack={() => setMode({ kind: "list" })}
        onPractice={(mock) =>
          setMode({ kind: "practice", pack: mode.pack, mock })
        }
      />
    );
  }

  if (mode.kind === "practice" && user) {
    return (
      <PracticeOffline
        userId={user.id}
        pack={mode.pack}
        mock={!!mode.mock}
        onExit={() => setMode({ kind: "browse", pack: mode.pack })}
      />
    );
  }

  // Subject merge — show downloaded packs and (when online) all subjects too.
  const downloadedSubjectIds = new Set(packs.map((p) => p.subject_id));
  const pendingSubjectIds = new Set(pending.map((p) => p.subject_id));
  const availableSubjects = subjects.filter(
    (s) => !downloadedSubjectIds.has(s.id) && !pendingSubjectIds.has(s.id)
  );

  const totalKb = packs.reduce((s, p) => s + p.size_estimate_kb, 0);
  const totalQuestions = packs.reduce((s, p) => s + p.question_count, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-12">
      <div className="flex items-start gap-4 mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated shrink-0">
          <HardDrive className="h-6 w-6 text-emerald-foreground" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Offline Packs
            </h1>
            <Badge
              variant="outline"
              className={
                online
                  ? "border-emerald/40 text-emerald"
                  : "border-accent/50 text-accent-foreground"
              }
            >
              {online ? (
                <>
                  <Wifi className="h-3 w-3 mr-1" /> Online
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 mr-1" /> Offline
                </>
              )}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Download a subject once over Wi-Fi, then practise anywhere — bus,
            classroom, NEPA blackout, anywhere. Offline answers don't sync to
            your stats; treat it as pure practice.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ImportButton onPick={handleImport} />
            <InstallHint />
          </div>
        </div>
      </div>

      {/* Resumable downloads */}
      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="font-display text-xl font-semibold mb-3 flex items-center gap-2">
            <Pause className="h-5 w-5 text-accent" />
            In progress
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {pending.map((p) => {
              const dl = downloading[p.subject_id];
              const liveLoaded = dl?.loaded ?? p.fetched_ids.length;
              const liveTotal = dl?.total || p.total || liveLoaded;
              const pct =
                liveTotal > 0 ? Math.round((liveLoaded / liveTotal) * 100) : 0;
              const active = !!dl;
              return (
                <div
                  key={p.key}
                  className="rounded-2xl border border-accent/30 bg-accent/5 p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display font-semibold leading-tight truncate">
                        {p.subject_name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {liveLoaded}/{liveTotal || "?"} questions ·{" "}
                        {p.status === "error" ? "interrupted" : "paused"}
                      </div>
                    </div>
                    <Badge variant="outline" className="border-accent/40 text-accent-foreground shrink-0">
                      {pct}%
                    </Badge>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-hero transition-all"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancel(p.subject_id)}
                        className="gap-1.5"
                      >
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() =>
                          void handleDownload({
                            id: p.subject_id,
                            slug: p.subject_slug,
                            name: p.subject_name,
                          })
                        }
                        disabled={!online}
                        className="bg-emerald text-emerald-foreground hover:bg-emerald/90 gap-1.5"
                      >
                        <RotateCw className="h-3.5 w-3.5" /> Resume
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleAbandon(p)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                    >
                      <X className="h-3.5 w-3.5" /> Discard
                    </Button>
                  </div>
                  {!online && !active && (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <WifiOff className="h-3 w-3" /> Connect to resume.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Storage summary */}
      {packs.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-paper p-5 mb-8 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="font-display text-2xl font-semibold tabular-nums">
              {packs.length}
            </div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
              packs
            </div>
          </div>
          <div className="border-x border-border">
            <div className="font-display text-2xl font-semibold tabular-nums">
              {totalQuestions}
            </div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
              questions
            </div>
          </div>
          <div>
            <div className="font-display text-2xl font-semibold tabular-nums">
              {totalKb < 1024 ? `${totalKb} KB` : `${(totalKb / 1024).toFixed(1)} MB`}
            </div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
              storage
            </div>
          </div>
        </div>
      )}

      {/* Downloaded packs */}
      {packs.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display text-xl font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald" />
            Downloaded
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {packs.map((p) => (
              <PackCard
                key={p.key}
                pack={p}
                onOpen={() => setMode({ kind: "browse", pack: p })}
                onDelete={() => void handleDelete(p)}
                onExport={(fmt) => void handleExport(p, fmt)}
                onRefresh={
                  online
                    ? () =>
                        void handleDownload({
                          id: p.subject_id,
                          slug: p.subject_slug,
                          name: p.subject_name,
                        })
                    : undefined
                }
                refreshing={!!downloading[p.subject_id]}
              />
            ))}
          </div>
        </section>
      )}

      {/* Available to download */}
      <section>
        <h2 className="font-display text-xl font-semibold mb-3 flex items-center gap-2">
          <Download className="h-5 w-5 text-emerald" />
          {packs.length > 0 ? "Add another subject" : "Pick a subject to download"}
        </h2>

        {!online && availableSubjects.length === 0 && (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-accent" />
            Connect to the internet to see subjects available for download.
          </p>
        )}

        {availableSubjects.length === 0 && online && packs.length > 0 && (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">
            All subjects are downloaded. 🎉
          </p>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {availableSubjects.map((s) => {
            const dl = downloading[s.id];
            const pct = dl && dl.total > 0 ? Math.round((dl.loaded / dl.total) * 100) : 0;
            return (
              <div
                key={s.id}
                className="rounded-2xl border border-border bg-card shadow-paper p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-semibold leading-tight">
                      {s.name}
                    </div>
                  </div>
                  <Library className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
                {dl ? (
                  <div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-gradient-hero transition-all"
                        style={{ width: `${Math.max(5, pct)}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                      Downloading {dl.loaded}/{dl.total || "?"}
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleDownload(s)}
                    disabled={!online}
                    className="gap-2"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

/* ---------- Pack card ---------- */

function PackCard({
  pack,
  onOpen,
  onDelete,
  onRefresh,
  onExport,
  refreshing,
}: {
  pack: PackMeta;
  onOpen: () => void;
  onDelete: () => void;
  onRefresh?: () => void;
  onExport?: () => void;
  refreshing?: boolean;
}) {
  const downloaded = new Date(pack.downloaded_at);
  const days = Math.floor((Date.now() - downloaded.getTime()) / 86400000);
  const ago =
    days === 0
      ? "today"
      : days === 1
        ? "yesterday"
        : days < 7
          ? `${days} days ago`
          : downloaded.toLocaleDateString();
  return (
    <div className="rounded-2xl border border-border bg-card shadow-paper p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-lg font-semibold leading-tight">
            {pack.subject_name}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {pack.question_count} questions ·{" "}
            {pack.size_estimate_kb < 1024
              ? `${pack.size_estimate_kb} KB`
              : `${(pack.size_estimate_kb / 1024).toFixed(1)} MB`}{" "}
            · downloaded {ago}
          </div>
        </div>
        <CheckCircle2 className="h-5 w-5 text-emerald shrink-0" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={onOpen}
          className="bg-emerald text-emerald-foreground hover:bg-emerald/90 gap-1.5"
        >
          <Play className="h-3.5 w-3.5" /> Open
        </Button>
        {onRefresh && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={refreshing}
            className="gap-1.5"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        )}
        {onExport && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onExport}
            className="gap-1.5"
            title="Save this pack as a file in your Downloads folder"
          >
            <Save className="h-3.5 w-3.5" /> Save to phone
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </Button>
      </div>
    </div>
  );
}

/* ---------- Import + install helpers ---------- */

function ImportButton({ onPick }: { onPick: (file: File) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card hover:bg-muted/40 px-3 py-1.5 text-xs font-medium cursor-pointer transition">
      <Upload className="h-3.5 w-3.5" />
      Import pack file
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function InstallHint() {
  // Detect display-mode standalone (already installed) so we don't nag.
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
  }, []);
  if (installed) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
      <Smartphone className="h-3.5 w-3.5" />
      Add to Home Screen for app-style access
    </span>
  );
}

/* ---------- Browse view ---------- */

function BrowsePack({
  userId,
  pack,
  onBack,
  onPractice,
}: {
  userId: string;
  pack: PackMeta;
  onBack: () => void;
  onPractice: (mock: boolean) => void;
}) {
  const [questions, setQuestions] = useState<OfflineQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      const qs = await getPackQuestions(userId, pack.subject_id);
      setQuestions(qs);
      setLoading(false);
    })();
  }, [userId, pack.subject_id]);

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <button
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        ← Back to packs
      </button>

      <div className="rounded-2xl border border-border bg-gradient-hero text-emerald-foreground p-6 mb-6 shadow-elevated">
        <div className="text-xs uppercase tracking-[0.2em] text-emerald-foreground/70">
          Offline pack
        </div>
        <h1 className="font-display text-3xl font-semibold mt-1">{pack.subject_name}</h1>
        <p className="text-sm text-emerald-foreground/80 mt-1">
          {pack.question_count} questions ready on this device.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => onPractice(false)}
            className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2"
          >
            <BookOpen className="h-4 w-4" /> Practice (untimed)
          </Button>
          <Button
            onClick={() => onPractice(true)}
            variant="outline"
            className="border-emerald-foreground/30 text-emerald-foreground hover:bg-emerald-foreground/10 gap-2"
          >
            <Clock className="h-4 w-4" /> 50-question mock (60 min)
          </Button>
        </div>
      </div>

      <h2 className="font-display text-xl font-semibold mb-3">Browse questions</h2>
      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-emerald mx-auto" />
        </div>
      ) : (
        <div className="space-y-2.5">
          {questions.slice(0, 100).map((q, i) => {
            const isOpen = expanded.has(q.id);
            const isRevealed = revealed.has(q.id);
            return (
              <div
                key={q.id}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpanded((p) => {
                      const n = new Set(p);
                      n.has(q.id) ? n.delete(q.id) : n.add(q.id);
                      return n;
                    })
                  }
                  className="w-full text-left p-4 flex gap-3"
                >
                  <span className="text-xs font-mono text-muted-foreground pt-0.5 w-7 shrink-0">
                    {i + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-relaxed line-clamp-2">
                      {q.question_text}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {q.year && (
                        <Badge variant="outline" className="text-[10px]">
                          {q.year}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {q.difficulty}
                      </Badge>
                      {q.topic && (
                        <Badge variant="outline" className="text-[10px]">
                          {q.topic}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-muted-foreground shrink-0 self-start pt-1">
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-3">
                    <div className="space-y-1.5">
                      {q.options.map((opt) => {
                        const isCorrect = isRevealed && opt.label === q.correct_answer;
                        return (
                          <div
                            key={opt.label}
                            className={`flex gap-3 rounded-lg border px-3 py-2 text-sm ${
                              isCorrect
                                ? "border-emerald/40 bg-emerald/10"
                                : "border-border bg-background"
                            }`}
                          >
                            <span className="font-mono text-muted-foreground">
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
                    {!isRevealed ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setRevealed((p) => {
                            const n = new Set(p);
                            n.add(q.id);
                            return n;
                          })
                        }
                      >
                        Show answer
                      </Button>
                    ) : (
                      <div className="rounded-lg border border-emerald/30 bg-emerald/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald mb-1">
                          Correct: {q.correct_answer}
                        </p>
                        {q.explanation && (
                          <p className="text-sm text-foreground/90">{q.explanation}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {questions.length > 100 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              Showing first 100 of {questions.length}. Start a practice session to
              cycle through more.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

/* ---------- Practice (offline-only, no DB writes) ---------- */

function PracticeOffline({
  userId,
  pack,
  mock,
  onExit,
}: {
  userId: string;
  pack: PackMeta;
  mock: boolean;
  onExit: () => void;
}) {
  const [questions, setQuestions] = useState<OfflineQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [remaining, setRemaining] = useState(60 * 60); // 60 min for mock

  useEffect(() => {
    void (async () => {
      const all = await getPackQuestions(userId, pack.subject_id);
      const shuffled = shuffle([...all]);
      const limited = mock ? shuffled.slice(0, Math.min(50, shuffled.length)) : shuffled;
      setQuestions(limited);
      setLoading(false);
    })();
  }, [userId, pack.subject_id, mock]);

  // Timer (mock mode only)
  useEffect(() => {
    if (!mock || done) return;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, 60 * 60 - elapsed);
      setRemaining(left);
      if (left === 0) {
        clearInterval(id);
        setDone(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [mock, done, startedAt]);

  if (loading) {
    return (
      <main className="py-16 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </main>
    );
  }

  if (questions.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-muted-foreground">
          No questions in this pack. Try refreshing it while online.
        </p>
        <Button onClick={onExit} variant="outline" className="mt-4">
          Back
        </Button>
      </main>
    );
  }

  if (done) {
    const correct = questions.filter(
      (q) => answers[q.id] && answers[q.id] === q.correct_answer
    ).length;
    const pct = Math.round((correct / questions.length) * 100);
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <div className="rounded-2xl border border-border bg-gradient-hero text-emerald-foreground p-8 mb-6 shadow-elevated text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-emerald-foreground/70 mb-2">
            Offline practice · {pack.subject_name}
          </div>
          <div className="font-display text-7xl font-semibold tabular-nums">{pct}%</div>
          <div className="mt-2 text-sm text-emerald-foreground/80">
            {correct} of {questions.length} correct · {formatDuration(elapsed)}
          </div>
          <p className="mt-3 text-xs text-emerald-foreground/70">
            Offline session — not saved to your stats. Take it again online to
            count toward XP & streaks.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={onExit}>
              Done
            </Button>
          </div>
        </div>

        <h2 className="font-display text-2xl font-semibold mb-4">Review</h2>
        <div className="space-y-3">
          {questions.map((q, i) => {
            const ua = answers[q.id] ?? null;
            const isCorrect = ua === q.correct_answer;
            return (
              <div
                key={q.id}
                className="rounded-2xl border border-border bg-card shadow-paper p-5"
              >
                <div className="flex items-start gap-3 mb-3">
                  {ua == null ? (
                    <div className="h-5 w-5 rounded-full border border-muted-foreground/40 shrink-0 mt-0.5" />
                  ) : isCorrect ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">
                      Question {i + 1}
                    </div>
                    <p className="font-medium leading-snug">{q.question_text}</p>
                  </div>
                </div>
                <div className="ml-8 space-y-1.5 text-sm">
                  {q.options.map((o) => {
                    const isAnswer = o.label === q.correct_answer;
                    const isYours = o.label === ua;
                    return (
                      <div
                        key={o.label}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                          isAnswer
                            ? "bg-emerald/10 text-emerald font-medium"
                            : isYours
                              ? "bg-destructive/10 text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        <span className="font-display font-semibold w-5">
                          {o.label}.
                        </span>
                        <span>{o.text}</span>
                        {isAnswer && <span className="ml-auto text-xs">correct</span>}
                        {isYours && !isAnswer && (
                          <span className="ml-auto text-xs">your answer</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {q.explanation && (
                  <div className="mt-3 ml-8 rounded-lg bg-muted/50 border border-border p-3 text-sm">
                    <span className="font-display font-semibold text-emerald">
                      Why:{" "}
                    </span>
                    {q.explanation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    );
  }

  const q = questions[idx];
  const answered = Object.keys(answers).length;
  const myAnswer = answers[q.id];

  const choose = (label: string) => {
    if (revealed) return;
    setAnswers((p) => ({ ...p, [q.id]: label }));
  };

  const next = () => {
    setRevealed(false);
    if (idx + 1 >= questions.length) {
      setDone(true);
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
      <div className="sticky top-16 z-30 -mx-4 sm:mx-0 mb-4 bg-background/95 backdrop-blur border-b border-border/60 sm:border sm:rounded-2xl sm:shadow-paper px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-display font-semibold text-sm">
            {mock ? "Offline mock" : "Offline practice"} · {pack.subject_name}
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <WifiOff className="h-3 w-3" /> Not saved to stats
          </div>
        </div>
        {mock ? (
          <div
            className={`flex items-center gap-2 font-mono tabular-nums px-3 py-1.5 rounded-lg border ${
              remaining <= 60
                ? "border-destructive/40 bg-destructive/10 text-destructive animate-pulse"
                : "border-border bg-card"
            }`}
          >
            <Clock className="h-4 w-4" />
            <span className="text-sm font-semibold">{formatDuration(remaining)}</span>
          </div>
        ) : (
          <button
            onClick={() => setDone(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Finish
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span>
          Question{" "}
          <span className="font-display font-semibold text-foreground">
            {idx + 1}
          </span>{" "}
          of {questions.length}
        </span>
        <span>{answered} answered</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted mb-6 overflow-hidden">
        <div
          className="h-full bg-gradient-hero transition-all"
          style={{ width: `${((idx + 1) / questions.length) * 100}%` }}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-paper p-5 sm:p-7">
        {q.topic && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-emerald font-semibold mb-3">
            {q.topic}
          </div>
        )}
        <p className="font-display text-lg sm:text-2xl font-medium leading-snug mb-4 whitespace-pre-wrap">
          {q.question_text}
        </p>
        {q.image_url && (
          <div className="mb-5 rounded-xl overflow-hidden border border-border bg-white">
            <img
              src={q.image_url}
              alt=""
              loading="lazy"
              className="w-full h-auto max-h-72 object-contain"
            />
          </div>
        )}
        <div className="space-y-2.5">
          {q.options.map((opt) => {
            const selected = myAnswer === opt.label;
            const isCorrect = opt.label === q.correct_answer;
            const showCorrect = !mock && revealed && isCorrect;
            const showWrong = !mock && revealed && selected && !isCorrect;
            return (
              <button
                key={opt.label}
                onClick={() => choose(opt.label)}
                disabled={!mock && revealed}
                className={`w-full text-left flex items-start gap-3 rounded-xl border p-3.5 transition ${
                  showCorrect
                    ? "border-emerald bg-emerald/10"
                    : showWrong
                      ? "border-destructive bg-destructive/10"
                      : selected
                        ? "border-emerald bg-emerald/5"
                        : "border-border hover:border-emerald/40 hover:bg-muted/40"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    showCorrect
                      ? "bg-emerald text-emerald-foreground"
                      : showWrong
                        ? "bg-destructive text-destructive-foreground"
                        : selected
                          ? "bg-emerald/20 text-emerald"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </span>
                <span className="text-sm leading-relaxed pt-0.5 flex-1">
                  {opt.text}
                </span>
              </button>
            );
          })}
        </div>

        {!mock && revealed && q.explanation && (
          <div className="mt-5 rounded-xl bg-muted/60 border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald mb-1.5">
              Explanation
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{q.explanation}</p>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="outline" onClick={onExit}>
          Exit
        </Button>
        {mock ? (
          <Button
            onClick={next}
            disabled={!myAnswer}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            {idx + 1 >= questions.length ? "Submit" : "Next"}
          </Button>
        ) : !revealed ? (
          <Button
            onClick={() => setRevealed(true)}
            disabled={!myAnswer}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            Reveal answer
          </Button>
        ) : (
          <Button
            onClick={next}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90"
          >
            {idx + 1 >= questions.length ? "Finish" : "Next"}
          </Button>
        )}
      </div>
    </main>
  );
}