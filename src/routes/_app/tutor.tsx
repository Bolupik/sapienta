import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Brain, Send, Loader2, Sparkles, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/tutor")({
  head: () => ({ meta: [{ title: "AI Tutor — Sapientia" }] }),
  component: TutorPage,
});

type Subject = { id: string; slug: string; name: string };
type Msg = { role: "user" | "assistant"; content: string };

function TutorPage() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("subjects")
        .select("id, slug, name")
        .order("name");
      setSubjects((data as Subject[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const ensureConversation = async (subId: string | null): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (!user) return null;
    const subjName = subjects.find((s) => s.id === subId)?.name ?? "Study";
    const { data, error } = await supabase
      .from("tutor_conversations")
      .insert({ user_id: user.id, subject_id: subId, title: `${subjName} chat` })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Could not start a chat");
      return null;
    }
    setConversationId(data.id);
    return data.id;
  };

  const startNew = () => {
    setConversationId(null);
    setMessages([]);
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");

    const userMsg: Msg = { role: "user", content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const convId = await ensureConversation(subjectId || null);
    if (!convId) {
      setLoading(false);
      return;
    }

    // Persist user message
    await supabase.from("tutor_messages").insert({
      conversation_id: convId,
      role: "user",
      content: userText,
    });

    const subjectName = subjects.find((s) => s.id === subjectId)?.name;

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantSoFar } : m
          );
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tutor-chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          subject: subjectName,
        }),
      });

      if (resp.status === 429) {
        toast.error("Rate limit reached. Please wait a moment and try again.");
        setLoading(false);
        return;
      }
      if (resp.status === 402) {
        toast.error("AI credits exhausted. Add credits in workspace settings.");
        setLoading(false);
        return;
      }
      if (!resp.ok || !resp.body) {
        toast.error("Tutor is unavailable right now.");
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, nl);
          textBuffer = textBuffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            streamDone = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Persist assistant message
      if (assistantSoFar) {
        await supabase.from("tutor_messages").insert({
          conversation_id: convId,
          role: "assistant",
          content: assistantSoFar,
        });
      }
    } catch (e) {
      console.error(e);
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-elevated">
            <Brain className="h-5 w-5 text-emerald-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold">AI Tutor</h1>
            <p className="text-sm text-muted-foreground">Ask anything. Understand everything.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Select
            value={subjectId}
            onValueChange={(v) => {
              setSubjectId(v);
              startNew();
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Pick a subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={startNew} title="New chat">
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-paper overflow-hidden flex flex-col h-[70vh] min-h-[500px]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {messages.length === 0 ? (
            <Empty onPick={(q) => setInput(q)} />
          ) : (
            messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)
          )}
          {loading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold">
                AI
              </div>
              <div className="rounded-2xl bg-muted px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-emerald" />
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-border p-3 sm:p-4 bg-background/40">
          <div className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about a concept, paste a question, or request a worked example…"
              rows={2}
              className="resize-none"
              disabled={loading}
            />
            <Button
              onClick={send}
              disabled={loading || !input.trim()}
              className="bg-emerald text-emerald-foreground hover:bg-emerald/90 h-auto py-3"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-emerald text-emerald-foreground px-4 py-2.5 text-sm leading-relaxed">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold">
        AI
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm leading-relaxed prose prose-sm prose-headings:font-display prose-p:my-2 prose-pre:bg-card prose-pre:border prose-pre:border-border max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function Empty({ onPick }: { onPick: (q: string) => void }) {
  const prompts = [
    "Explain Newton's third law with a real-world example.",
    "Walk me through solving a quadratic equation.",
    "What's the difference between mitosis and meiosis?",
    "Help me understand why pH 7 is neutral.",
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-12">
      <Sparkles className="h-10 w-10 text-accent mb-4" />
      <h3 className="font-display text-2xl font-semibold mb-2">What shall we learn today?</h3>
      <p className="text-muted-foreground text-sm max-w-md mb-6">
        Pick a subject above for sharper answers, or just ask anything.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="text-left text-sm rounded-xl border border-border bg-card hover:border-emerald/40 hover:bg-emerald/5 transition-colors p-3"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
