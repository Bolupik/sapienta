import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { GraduationCap, LogOut, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteHeader() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/" });
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-hero shadow-elevated transition-transform group-hover:rotate-3">
            <GraduationCap className="h-5 w-5 text-emerald-foreground" />
          </div>
          <div className="leading-none">
            <div className="font-display text-lg font-semibold tracking-tight">Sapientia</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              WAEC / JAMB AI
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {user ? (
            <>
              <NavLink to="/dashboard">Dashboard</NavLink>
              <NavLink to="/tutor">AI Tutor</NavLink>
              <NavLink to="/exam">Mock Exams</NavLink>
              <NavLink to="/question-bank">Question Bank</NavLink>
              <NavLink to="/sovereignty">My Data</NavLink>
            </>
          ) : (
            <>
              <a href="#features" className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Features
              </a>
              <a href="#trust" className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Trust
              </a>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald text-emerald-foreground text-xs font-semibold">
                    {(profile?.display_name || profile?.full_name || user.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline text-sm">{profile?.display_name || profile?.full_name?.split(" ")[0] || "Student"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => navigate({ to: "/dashboard" })}>Dashboard</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/sovereignty" })}>My Learning Data</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/auth" })}>
                Sign in
              </Button>
              <Button
                size="sm"
                className="bg-emerald text-emerald-foreground hover:bg-emerald/90 shadow-elevated"
                onClick={() => navigate({ to: "/auth", search: { mode: "signup" } })}
              >
                Get started
              </Button>
            </>
          )}

          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate({ to: "/dashboard" })}>Dashboard</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/tutor" })}>AI Tutor</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/exam" })}>Mock Exams</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/question-bank" })}>Question Bank</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/sovereignty" })}>My Data</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      activeProps={{ className: "px-3 py-2 text-sm font-medium text-emerald" }}
    >
      {children}
    </Link>
  );
}
