import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/SiteHeader";
import { Loader2, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/auth", search: { mode: "signin" } });
    }
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-emerald" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background paper-grain">
      <SiteHeader />
      {!online && (
        <div className="bg-accent/15 border-b border-accent/30 text-foreground">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 text-accent-foreground" />
              <span>
                You're offline. Practise downloaded packs — answers won't be saved.
              </span>
            </div>
            <Link
              to="/offline"
              className="text-xs font-medium underline underline-offset-2 hover:text-emerald shrink-0"
            >
              Open offline packs
            </Link>
          </div>
        </div>
      )}
      <Outlet />
    </div>
  );
}
