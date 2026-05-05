import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Check, X } from "lucide-react";
import { toast } from "sonner";
import { isTeacher } from "@/lib/lesson-notes";

export const Route = createFileRoute("/_app/teachers/admin")({
  head: () => ({ meta: [{ title: "Teacher applications — Sapientia" }] }),
  component: AdminPage,
});

type App = {
  id: string;
  user_id: string;
  full_name: string;
  school: string | null;
  subjects: string[];
  message: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

function AdminPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [apps, setApps] = useState<App[]>([]);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    const r = await isTeacher(user.id);
    setAllowed(r.isAdmin);
    if (r.isAdmin) {
      const { data } = await supabase
        .from("teacher_applications")
        .select("*")
        .order("created_at", { ascending: false });
      setApps((data ?? []) as App[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const decide = async (a: App, status: "approved" | "rejected") => {
    const { error: aerr } = await supabase
      .from("teacher_applications")
      .update({ status, reviewed_by: user!.id, reviewed_at: new Date().toISOString() })
      .eq("id", a.id);
    if (aerr) return toast.error(aerr.message);

    if (status === "approved") {
      const { error: rerr } = await supabase
        .from("user_roles")
        .insert({ user_id: a.user_id, role: "teacher" });
      if (rerr && !/duplicate/i.test(rerr.message)) {
        return toast.error(rerr.message);
      }
    }
    toast.success(`Application ${status}`);
    refresh();
  };

  if (loading)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </div>
    );

  if (!allowed)
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Admins only. <Link to="/dashboard" className="text-emerald underline">Back to dashboard</Link>
        </p>
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-2xl font-semibold flex items-center gap-2 mb-6">
        <ShieldCheck className="h-6 w-6 text-emerald" /> Teacher applications
      </h1>
      {apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications yet.</p>
      ) : (
        <div className="space-y-3">
          {apps.map((a) => (
            <div key={a.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-medium">{a.full_name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {a.school || "—"} · {new Date(a.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge
                  variant={
                    a.status === "approved"
                      ? "default"
                      : a.status === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {a.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {a.subjects.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
              {a.message && (
                <p className="text-sm text-muted-foreground mb-3 whitespace-pre-wrap">
                  {a.message}
                </p>
              )}
              {a.status === "pending" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(a, "approved")} className="bg-emerald text-emerald-foreground hover:bg-emerald/90">
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide(a, "rejected")}>
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}