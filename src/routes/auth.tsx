import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SUBJECTS = [
  { slug: "mathematics", name: "Mathematics" },
  { slug: "english", name: "English Language" },
  { slug: "physics", name: "Physics" },
  { slug: "chemistry", name: "Chemistry" },
  { slug: "biology", name: "Biology" },
];

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Sapientia" },
      { name: "description", content: "Sign in or create your free Sapientia student account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode = "signin" } = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [user, authLoading, navigate]);

  return (
    <div className="min-h-screen bg-background paper-grain flex flex-col">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-hero">
              <GraduationCap className="h-5 w-5 text-emerald-foreground" />
            </div>
            <span className="font-display text-lg font-semibold">Sapientia</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              {mode === "signup" ? "Begin your prep" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "signup"
                ? "Create a free account to start learning."
                : "Sign in to continue where you left off."}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-elevated p-6 sm:p-8">
            {mode === "signup" ? <SignUpForm /> : <SignInForm />}
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link to="/auth" search={{ mode: "signin" }} className="font-medium text-emerald hover:underline">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link to="/auth" search={{ mode: "signup" }} className="font-medium text-emerald hover:underline">
                  Create an account
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
});

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Welcome back!");
    navigate({ to: "/dashboard" });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@school.edu.ng"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <Button
        type="submit"
        disabled={loading}
        className="w-full bg-emerald text-emerald-foreground hover:bg-emerald/90 h-11"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>
    </form>
  );
}

const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
  school: z.string().trim().max(160).optional(),
  targetExam: z.enum(["waec", "jamb", "both"]),
  examYear: z
    .number()
    .int()
    .min(new Date().getFullYear())
    .max(new Date().getFullYear() + 5),
  selectedSubjects: z.array(z.string()).min(1, "Pick at least one subject"),
});

function SignUpForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [school, setSchool] = useState("");
  const [targetExam, setTargetExam] = useState<"waec" | "jamb" | "both">("both");
  const [examYear, setExamYear] = useState<string>(String(new Date().getFullYear() + 1));
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(["mathematics", "english"]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const toggleSubject = (slug: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signUpSchema.safeParse({
      fullName,
      email,
      password,
      school: school || undefined,
      targetExam,
      examYear: parseInt(examYear, 10),
      selectedSubjects,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          full_name: parsed.data.fullName,
          school: parsed.data.school ?? null,
          target_exam: parsed.data.targetExam,
          exam_year: String(parsed.data.examYear),
          selected_subjects: parsed.data.selectedSubjects,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Account created — let's go!");
    navigate({ to: "/dashboard" });
  };

  const currentYear = new Date().getFullYear();

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Adaeze Okafor"
          required
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="school">School (optional)</Label>
        <Input
          id="school"
          value={school}
          onChange={(e) => setSchool(e.target.value)}
          placeholder="e.g. Federal Government College"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Target exam</Label>
          <Select value={targetExam} onValueChange={(v) => setTargetExam(v as never)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="waec">WAEC</SelectItem>
              <SelectItem value="jamb">JAMB</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Exam year</Label>
          <Select value={examYear} onValueChange={setExamYear}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3].map((offset) => (
                <SelectItem key={offset} value={String(currentYear + offset)}>
                  {currentYear + offset}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Subjects</Label>
        <div className="grid grid-cols-2 gap-2">
          {SUBJECTS.map((s) => {
            const checked = selectedSubjects.includes(s.slug);
            return (
              <label
                key={s.slug}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer transition ${
                  checked
                    ? "border-emerald bg-emerald/5"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleSubject(s.slug)}
                />
                <span className="text-sm font-medium">{s.name}</span>
              </label>
            );
          })}
        </div>
      </div>
      <Button
        type="submit"
        disabled={loading}
        className="w-full bg-emerald text-emerald-foreground hover:bg-emerald/90 h-11"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create my account"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        By signing up you agree that your learning data belongs to you.
      </p>
    </form>
  );
}
