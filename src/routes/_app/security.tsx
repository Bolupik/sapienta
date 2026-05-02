import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Smartphone,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/security")({
  head: () => ({
    meta: [
      { title: "Security — Sapientia" },
      {
        name: "description",
        content:
          "Enable two-factor authentication with an authenticator app to keep your Sapientia account secure.",
      },
    ],
  }),
  component: SecurityPage,
});

type Factor = {
  id: string;
  friendly_name?: string | null;
  factor_type: string;
  status: string;
  created_at: string;
};

function SecurityPage() {
  const { user } = useAuth();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollState, setEnrollState] = useState<{
    factorId: string;
    qr: string;
    secret: string;
    uri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setFactors([...(data?.totp ?? []), ...(data?.phone ?? [])] as Factor[]);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [user]);

  const verifiedTotp = factors.filter(
    (f) => f.factor_type === "totp" && f.status === "verified"
  );
  const has2FA = verifiedTotp.length > 0;

  const startEnroll = async () => {
    setEnrolling(true);
    // Clean up any prior un-verified factor first so we don't pile them up.
    const unverified = factors.filter(
      (f) => f.factor_type === "totp" && f.status !== "verified"
    );
    for (const f of unverified) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator (${new Date().toLocaleDateString()})`,
    });
    setEnrolling(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not start setup.");
      return;
    }
    setEnrollState({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    });
    setCode("");
  };

  const cancelEnroll = async () => {
    if (!enrollState) return;
    await supabase.auth.mfa.unenroll({ factorId: enrollState.factorId });
    setEnrollState(null);
    setCode("");
    await refresh();
  };

  const verifyEnroll = async () => {
    if (!enrollState) return;
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setVerifying(true);
    const challenge = await supabase.auth.mfa.challenge({
      factorId: enrollState.factorId,
    });
    if (challenge.error || !challenge.data) {
      setVerifying(false);
      toast.error(challenge.error?.message ?? "Could not start verification.");
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: enrollState.factorId,
      challengeId: challenge.data.id,
      code,
    });
    setVerifying(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Two-factor authentication is now active.");
    setEnrollState(null);
    setCode("");
    await refresh();
  };

  const remove = async (factor: Factor) => {
    if (!confirm("Disable two-factor authentication on this account?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Two-factor authentication disabled.");
    await refresh();
  };

  const copySecret = async () => {
    if (!enrollState) return;
    try {
      await navigator.clipboard.writeText(enrollState.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Long-press the code instead.");
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12">
      <div className="flex items-start gap-4 mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated shrink-0">
          <Shield className="h-6 w-6 text-emerald-foreground" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Security
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl mt-1">
            Protect your study history with a second factor. We recommend Google
            Authenticator, Authy, or 1Password.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card shadow-paper p-5 sm:p-6 mb-6">
        <div className="flex items-start gap-3 mb-4">
          {has2FA ? (
            <ShieldCheck className="h-6 w-6 text-emerald shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="h-6 w-6 text-accent shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold">
                Two-factor authentication
              </h2>
              <Badge
                variant="outline"
                className={
                  has2FA
                    ? "border-emerald/40 text-emerald"
                    : "border-accent/50 text-accent-foreground"
                }
              >
                {has2FA ? "On" : "Off"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {has2FA
                ? "We'll ask for a 6-digit code each time you sign in."
                : "Add a second step at sign-in using a code from your authenticator app."}
            </p>
          </div>
        </div>

        {/* Active factors */}
        {verifiedTotp.length > 0 && (
          <ul className="space-y-2 mb-4">
            {verifiedTotp.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
              >
                <Smartphone className="h-4 w-4 text-emerald" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {f.friendly_name || "Authenticator app"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Added {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(f)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Enrollment flow */}
        {!enrollState ? (
          <Button
            onClick={() => void startEnroll()}
            disabled={enrolling}
            className="bg-emerald text-emerald-foreground hover:bg-emerald/90 gap-2"
          >
            {enrolling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Shield className="h-4 w-4" />
            )}
            {has2FA ? "Add another device" : "Set up authenticator app"}
          </Button>
        ) : (
          <div className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="font-display font-semibold mb-1">
                Step 1 — Scan this QR code
              </h3>
              <p className="text-xs text-muted-foreground">
                Open Google Authenticator (or any TOTP app) and scan, or enter
                the secret manually.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="rounded-xl bg-white p-3 border border-border shrink-0">
                {/* Supabase returns either an SVG string or a data: URL — handle both */}
                {enrollState.qr.startsWith("data:") ? (
                  <img
                    src={enrollState.qr}
                    alt="2FA QR code"
                    width={160}
                    height={160}
                    className="block"
                  />
                ) : (
                  <div
                    className="w-40 h-40"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: enrollState.qr }}
                  />
                )}
              </div>
              <div className="flex-1 w-full">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Or paste this secret
                </Label>
                <div className="mt-1.5 flex gap-2">
                  <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono break-all">
                    {enrollState.secret}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copySecret()}
                    className="gap-1.5 shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <h3 className="font-display font-semibold mb-1">
                Step 2 — Enter the 6-digit code
              </h3>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123 456"
                className="font-mono tracking-[0.4em] text-center text-lg h-12"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void verifyEnroll()}
                disabled={verifying || code.length !== 6}
                className="bg-emerald text-emerald-foreground hover:bg-emerald/90 gap-2"
              >
                {verifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Verify & enable
              </Button>
              <Button variant="ghost" onClick={() => void cancelEnroll()}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground text-center">
        Lost your phone? Email support — we'll verify your identity and reset
        2FA.
      </p>
    </main>
  );
}