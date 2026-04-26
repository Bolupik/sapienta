import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShieldCheck, Download, Trash2, MessageSquare, Target, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/sovereignty")({
  head: () => ({ meta: [{ title: "My Data — Sapientia" }] }),
  component: SovereigntyPage,
});

function SovereigntyPage() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<{ attempts: number; messages: number; conversations: number }>({
    attempts: 0,
    messages: 0,
    conversations: 0,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [a, c, m] = await Promise.all([
        supabase.from("exam_attempts").select("*", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("tutor_conversations").select("*", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("tutor_messages").select("id, conversation_id, tutor_conversations!inner(user_id)", { count: "exact", head: true }).eq("tutor_conversations.user_id", user.id),
      ]);
      setCounts({
        attempts: a.count ?? 0,
        conversations: c.count ?? 0,
        messages: m.count ?? 0,
      });
    })();
  }, [user]);

  const exportData = async () => {
    if (!user) return;
    const [profileRes, attempts, answers, conversations, messages] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("exam_attempts").select("*").eq("user_id", user.id),
      supabase
        .from("attempt_answers")
        .select("*, exam_attempts!inner(user_id)")
        .eq("exam_attempts.user_id", user.id),
      supabase.from("tutor_conversations").select("*").eq("user_id", user.id),
      supabase
        .from("tutor_messages")
        .select("*, tutor_conversations!inner(user_id)")
        .eq("tutor_conversations.user_id", user.id),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      profile: profileRes.data,
      exam_attempts: attempts.data,
      attempt_answers: answers.data,
      tutor_conversations: conversations.data,
      tutor_messages: messages.data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sapientia-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Your data has been exported.");
  };

  const wipeLearningData = async () => {
    if (!user) return;
    // Delete attempts (cascades to attempt_answers) and conversations (cascades to messages)
    await supabase.from("exam_attempts").delete().eq("user_id", user.id);
    await supabase.from("tutor_conversations").delete().eq("user_id", user.id);
    setCounts({ attempts: 0, messages: 0, conversations: 0 });
    toast.success("Your learning history has been erased.");
  };

  const deleteAccount = async () => {
    if (!user) return;
    // Delete all user-owned data first; auth.users deletion requires admin
    await supabase.from("exam_attempts").delete().eq("user_id", user.id);
    await supabase.from("tutor_conversations").delete().eq("user_id", user.id);
    await supabase.from("profiles").delete().eq("id", user.id);
    await signOut();
    toast.success("Your data has been removed. Goodbye 👋");
    navigate({ to: "/" });
  };

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated">
          <ShieldCheck className="h-5 w-5 text-emerald-foreground" />
        </div>
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold">Trust & Sovereignty</h1>
          <p className="text-sm text-muted-foreground">Your learning history is yours.</p>
        </div>
      </div>

      {/* Promise card */}
      <div className="rounded-2xl border border-emerald/20 bg-emerald/5 p-6 mb-8">
        <div className="flex items-start gap-3">
          <Lock className="h-5 w-5 text-emerald shrink-0 mt-0.5" />
          <div>
            <h2 className="font-display text-lg font-semibold mb-1">Our promise to you, {profile?.full_name?.split(" ")[0] ?? "student"}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sapientia never sells your learning data. You can export everything we hold about you,
              wipe your study history at any time, or close your account in one click.
            </p>
          </div>
        </div>
      </div>

      {/* Data summary */}
      <div className="grid sm:grid-cols-3 gap-3 mb-8">
        <SmallStat icon={Target} label="Exam attempts" value={counts.attempts} />
        <SmallStat icon={MessageSquare} label="Tutor conversations" value={counts.conversations} />
        <SmallStat icon={MessageSquare} label="Tutor messages" value={counts.messages} />
      </div>

      {/* Actions */}
      <div className="space-y-4">
        <ActionRow
          icon={Download}
          title="Export your data"
          description="Download a complete JSON copy of your profile, attempts, answers, and tutor chats."
          action={
            <Button variant="outline" onClick={exportData} className="gap-2">
              <Download className="h-4 w-4" /> Download .json
            </Button>
          }
        />

        <ActionRow
          icon={Trash2}
          title="Erase learning history"
          description="Wipe all your exam attempts and tutor conversations. Your profile stays."
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5 gap-2">
                  <Trash2 className="h-4 w-4" /> Erase
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Erase your learning history?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes all {counts.attempts} exam attempts and {counts.conversations} tutor conversations. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={wipeLearningData}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, erase it
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />

        <ActionRow
          icon={Trash2}
          title="Close account"
          description="Remove your profile and all associated data. You'll be signed out."
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2">
                  <Trash2 className="h-4 w-4" /> Close account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Close your Sapientia account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes your profile and all study data. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={deleteAccount}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, close it
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
      </div>
    </main>
  );
}

function SmallStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-paper p-4">
      <Icon className="h-4 w-4 text-emerald" />
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ActionRow({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-paper p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
      <div className="flex items-start gap-3 flex-1">
        <Icon className="h-5 w-5 text-emerald shrink-0 mt-0.5" />
        <div>
          <div className="font-display text-base font-semibold">{title}</div>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
