import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Mode = "term" | "single";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const mode: Mode = body.mode ?? "single";
    const subject: string = body.subject ?? "";
    const classLevel: string = body.classLevel ?? "JSS1";
    const term: number = Number(body.term ?? 1);
    const week: number | undefined = body.week ? Number(body.week) : undefined;
    const topic: string | undefined = body.topic;
    const weeks: number = Math.max(1, Math.min(14, Number(body.weeks ?? 13)));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are an expert Nigerian curriculum designer who writes lesson notes that strictly follow the NERDC / NEPS scheme of work for secondary schools (JSS1–SS3).
Write rich, classroom-ready notes. Use clear language appropriate to the class level. Reference Nigerian context where helpful.
Each note must include: objectives (3-5 bullets), full content/lesson body (multiple paragraphs and sub-sections, with examples), resources/materials, evaluation (5 short questions), and an assignment.
Return ONLY valid JSON matching the requested tool schema. Do not include commentary.`;

    const userPrompt =
      mode === "term"
        ? `Generate a complete NERDC scheme-of-work-aligned set of lesson notes for:
Subject: ${subject}
Class: ${classLevel}
Term: ${term}
Number of weeks: ${weeks}

Cover the standard NERDC topics for this subject/class/term in proper sequence (week 1 to week ${weeks}). For each week return one note.`
        : `Generate a single NERDC-aligned lesson note for:
Subject: ${subject}
Class: ${classLevel}
Term: ${term}
Week: ${week ?? 1}
${topic ? `Topic: ${topic}` : "Pick the standard NERDC topic for this week."}`;

    const noteSchema = {
      type: "object",
      properties: {
        week: { type: "integer" },
        topic: { type: "string" },
        sub_topic: { type: "string" },
        objectives: { type: "string", description: "Bullet list, one per line, prefixed with '- '" },
        content: { type: "string", description: "Full lesson body, markdown allowed" },
        resources: { type: "string" },
        evaluation: { type: "string", description: "Numbered list of 5 questions" },
        assignment: { type: "string" },
      },
      required: ["week", "topic", "objectives", "content", "resources", "evaluation", "assignment"],
      additionalProperties: false,
    };

    const tools = [
      {
        type: "function",
        function: {
          name: "return_notes",
          description: "Return the generated NERDC lesson note(s).",
          parameters: {
            type: "object",
            properties: {
              notes: { type: "array", items: noteSchema },
            },
            required: ["notes"],
            additionalProperties: false,
          },
        },
      },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "return_notes" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429)
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      if (response.status === 402)
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : { notes: [] };

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("draft-lesson-notes error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});