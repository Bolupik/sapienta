/**
 * Offline question packs — per-subject downloads stored in IndexedDB so
 * students can browse, practise and take mock exams when their connection
 * drops. Pure client-side; no service worker, no PWA install required.
 *
 * Storage model:
 *   packs:     keyed by `${userId}:${subjectId}` -> PackMeta
 *   questions: keyed by question id -> NormalizedQuestion (+ subject_id, exam_type)
 *
 * "Offline = practice only" — answers given offline are NOT synced back to
 * the server. They live only inside the running session.
 */
import { openDB, type IDBPDatabase } from "idb";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizeQuestion,
  type NormalizedQuestion,
} from "@/lib/question-utils";

const DB_NAME = "sapientia-offline";
const DB_VERSION = 2;
const PACKS_STORE = "packs";
const QUESTIONS_STORE = "questions";
const PROGRESS_STORE = "download_progress";

export type PackMeta = {
  key: string; // `${userId}:${subjectId}`
  user_id: string;
  subject_id: string;
  subject_slug: string;
  subject_name: string;
  question_ids: string[];
  question_count: number;
  downloaded_at: string; // ISO
  size_estimate_kb: number;
};

export type OfflineQuestion = NormalizedQuestion & {
  subject_id: string;
  exam_type?: "waec" | "jamb" | "both";
};

/**
 * Checkpoint for an in-flight download. We persist after every page so a
 * dropped connection / closed tab can resume from `next_offset` instead of
 * starting from scratch.
 */
export type DownloadProgress = {
  key: string; // `${userId}:${subjectId}`
  user_id: string;
  subject_id: string;
  subject_slug: string;
  subject_name: string;
  next_offset: number;
  total: number;
  fetched_ids: string[];
  updated_at: string;
  status: "in_progress" | "paused" | "error";
  error?: string;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PACKS_STORE)) {
          db.createObjectStore(PACKS_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(QUESTIONS_STORE)) {
          db.createObjectStore(QUESTIONS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
          db.createObjectStore(PROGRESS_STORE, { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

const packKey = (userId: string, subjectId: string) => `${userId}:${subjectId}`;

const PAGE = 500;

// Cancellation registry — map of pack key -> { cancelled: boolean }
const cancelTokens = new Map<string, { cancelled: boolean }>();

/** Ask an in-flight download to stop after the current page. */
export function cancelDownload(userId: string, subjectId: string) {
  const tok = cancelTokens.get(packKey(userId, subjectId));
  if (tok) tok.cancelled = true;
}

/** Read the saved progress checkpoint (if any) for a subject. */
export async function getDownloadProgress(
  userId: string,
  subjectId: string
): Promise<DownloadProgress | undefined> {
  const db = await getDB();
  return (await db.get(PROGRESS_STORE, packKey(userId, subjectId))) as
    | DownloadProgress
    | undefined;
}

/** List every pending / paused / errored download for the user. */
export async function listInProgressDownloads(
  userId: string
): Promise<DownloadProgress[]> {
  const db = await getDB();
  const all = (await db.getAll(PROGRESS_STORE)) as DownloadProgress[];
  return all.filter((p) => p.user_id === userId);
}

/** Discard a saved checkpoint (used when user gives up on a partial). */
export async function clearDownloadProgress(userId: string, subjectId: string) {
  const db = await getDB();
  await db.delete(PROGRESS_STORE, packKey(userId, subjectId));
}

/**
 * Download (or refresh) all questions for a subject, with checkpointing so
 * we can resume after a network drop / tab close.
 *
 * If a saved checkpoint exists for this subject, it picks up at
 * `next_offset` instead of restarting. Throws `DownloadCancelled` if the
 * caller fired `cancelDownload`.
 */
export class DownloadCancelled extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "DownloadCancelled";
  }
}

export async function downloadPack(
  userId: string,
  subject: { id: string; slug: string; name: string },
  onProgress?: (loaded: number, total: number) => void
): Promise<PackMeta> {
  const key = packKey(userId, subject.id);
  const db = await getDB();

  // Resume from a checkpoint if one exists.
  const existing = (await db.get(PROGRESS_STORE, key)) as
    | DownloadProgress
    | undefined;

  let from = existing?.next_offset ?? 0;
  let total = existing?.total ?? 0;
  const fetchedIds = new Set<string>(existing?.fetched_ids ?? []);

  // Track cancellation.
  const token = { cancelled: false };
  cancelTokens.set(key, token);

  // Mark as in-progress immediately so the UI sees it.
  await db.put(PROGRESS_STORE, {
    key,
    user_id: userId,
    subject_id: subject.id,
    subject_slug: subject.slug,
    subject_name: subject.name,
    next_offset: from,
    total,
    fetched_ids: Array.from(fetchedIds),
    updated_at: new Date().toISOString(),
    status: "in_progress",
  } satisfies DownloadProgress);

  onProgress?.(fetchedIds.size, total || fetchedIds.size);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (token.cancelled) throw new DownloadCancelled();

      const { data, error, count } = await supabase
        .from("questions")
        .select(
          "id, question_text, options, correct_answer, explanation, topic, year, image_url, difficulty, exam_type, subject_id",
          { count: total === 0 ? "exact" : undefined }
        )
        .eq("subject_id", subject.id)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (total === 0) total = count ?? data?.length ?? 0;

      const rows = (data ?? []) as Record<string, unknown>[];

      // Persist the fetched questions for this page.
      const tx = db.transaction(QUESTIONS_STORE, "readwrite");
      const qStore = tx.objectStore(QUESTIONS_STORE);
      for (const row of rows) {
        const q = normalizeQuestion(row);
        const offlineQ: OfflineQuestion = {
          ...q,
          subject_id: subject.id,
          exam_type: (row.exam_type as OfflineQuestion["exam_type"]) ?? "both",
        };
        await qStore.put(offlineQ);
        fetchedIds.add(offlineQ.id);
      }
      await tx.done;

      from += PAGE;

      // Checkpoint progress.
      await db.put(PROGRESS_STORE, {
        key,
        user_id: userId,
        subject_id: subject.id,
        subject_slug: subject.slug,
        subject_name: subject.name,
        next_offset: from,
        total,
        fetched_ids: Array.from(fetchedIds),
        updated_at: new Date().toISOString(),
        status: "in_progress",
      } satisfies DownloadProgress);

      onProgress?.(fetchedIds.size, total || fetchedIds.size);

      if (rows.length < PAGE) break;
    }

    // Build the final pack meta, sample question size for estimate.
    const ids = Array.from(fetchedIds);
    const sampleSize = Math.min(50, ids.length);
    let sampleBytes = 0;
    if (sampleSize > 0) {
      const stx = db.transaction(QUESTIONS_STORE, "readonly");
      const sStore = stx.objectStore(QUESTIONS_STORE);
      for (let i = 0; i < sampleSize; i++) {
        const q = await sStore.get(ids[i]);
        if (q) sampleBytes += JSON.stringify(q).length;
      }
      await stx.done;
    }
    const avgBytes = sampleSize > 0 ? sampleBytes / sampleSize : 800;
    const sizeEstimateKb = Math.max(
      1,
      Math.round((avgBytes * ids.length) / 1024)
    );

    const meta: PackMeta = {
      key,
      user_id: userId,
      subject_id: subject.id,
      subject_slug: subject.slug,
      subject_name: subject.name,
      question_ids: ids,
      question_count: ids.length,
      downloaded_at: new Date().toISOString(),
      size_estimate_kb: sizeEstimateKb,
    };
    const ftx = db.transaction([PACKS_STORE, PROGRESS_STORE], "readwrite");
    await ftx.objectStore(PACKS_STORE).put(meta);
    await ftx.objectStore(PROGRESS_STORE).delete(key);
    await ftx.done;
    return meta;
  } catch (err) {
    // Save the checkpoint state with status reflecting why we stopped.
    const status: DownloadProgress["status"] =
      err instanceof DownloadCancelled ? "paused" : "error";
    await db.put(PROGRESS_STORE, {
      key,
      user_id: userId,
      subject_id: subject.id,
      subject_slug: subject.slug,
      subject_name: subject.name,
      next_offset: from,
      total,
      fetched_ids: Array.from(fetchedIds),
      updated_at: new Date().toISOString(),
      status,
      error:
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Unknown error",
    } satisfies DownloadProgress);
    throw err;
  } finally {
    cancelTokens.delete(key);
  }
}

/** List every pack for the user (sorted newest first). */
export async function listPacks(userId: string): Promise<PackMeta[]> {
  const db = await getDB();
  const all = (await db.getAll(PACKS_STORE)) as PackMeta[];
  return all
    .filter((p) => p.user_id === userId)
    .sort((a, b) => b.downloaded_at.localeCompare(a.downloaded_at));
}

export async function getPack(
  userId: string,
  subjectId: string
): Promise<PackMeta | undefined> {
  const db = await getDB();
  return (await db.get(PACKS_STORE, packKey(userId, subjectId))) as
    | PackMeta
    | undefined;
}

/** Read all questions belonging to a pack. */
export async function getPackQuestions(
  userId: string,
  subjectId: string
): Promise<OfflineQuestion[]> {
  const meta = await getPack(userId, subjectId);
  if (!meta) return [];
  const db = await getDB();
  const tx = db.transaction(QUESTIONS_STORE, "readonly");
  const store = tx.objectStore(QUESTIONS_STORE);
  const out: OfflineQuestion[] = [];
  for (const id of meta.question_ids) {
    const q = (await store.get(id)) as OfflineQuestion | undefined;
    if (q) out.push(q);
  }
  await tx.done;
  return out;
}

/** Delete a pack — and any questions that no other pack references. */
export async function deletePack(userId: string, subjectId: string) {
  const db = await getDB();
  const meta = (await db.get(PACKS_STORE, packKey(userId, subjectId))) as
    | PackMeta
    | undefined;
  if (!meta) return;

  // Find which question ids are still referenced by other packs.
  const otherPacks = ((await db.getAll(PACKS_STORE)) as PackMeta[]).filter(
    (p) => p.key !== meta.key
  );
  const stillReferenced = new Set<string>();
  for (const p of otherPacks) for (const id of p.question_ids) stillReferenced.add(id);

  const tx = db.transaction([PACKS_STORE, QUESTIONS_STORE], "readwrite");
  await tx.objectStore(PACKS_STORE).delete(meta.key);
  const qStore = tx.objectStore(QUESTIONS_STORE);
  for (const id of meta.question_ids) {
    if (!stillReferenced.has(id)) await qStore.delete(id);
  }
  await tx.done;
}

/** Read aggregate offline storage stats for the user. */
export async function getOfflineStats(userId: string) {
  const packs = await listPacks(userId);
  const totalQuestions = packs.reduce((s, p) => s + p.question_count, 0);
  const totalKb = packs.reduce((s, p) => s + p.size_estimate_kb, 0);
  return { packs, totalPacks: packs.length, totalQuestions, totalKb };
}

/** Wipe everything offline for the user (used when signing out, optional). */
export async function clearAllOffline(userId: string) {
  const packs = await listPacks(userId);
  for (const p of packs) await deletePack(userId, p.subject_id);
}

/* ---------- Export / import (download to phone) ---------- */

const EXPORT_VERSION = 1;

type PackExport = {
  format: "sapientia-offline-pack";
  version: number;
  exported_at: string;
  meta: Omit<PackMeta, "user_id" | "key">;
  questions: OfflineQuestion[];
};

/**
 * Build a JSON Blob for a downloaded pack so the user can save it to their
 * phone's Downloads folder (or AirDrop / share to another device).
 */
export async function exportPackToBlob(
  userId: string,
  subjectId: string
): Promise<{ blob: Blob; filename: string } | null> {
  const meta = await getPack(userId, subjectId);
  if (!meta) return null;
  const questions = await getPackQuestions(userId, subjectId);
  const payload: PackExport = {
    format: "sapientia-offline-pack",
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    meta: {
      subject_id: meta.subject_id,
      subject_slug: meta.subject_slug,
      subject_name: meta.subject_name,
      question_ids: meta.question_ids,
      question_count: meta.question_count,
      downloaded_at: meta.downloaded_at,
      size_estimate_kb: meta.size_estimate_kb,
    },
    questions,
  };
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/json",
  });
  const safeSlug = meta.subject_slug.replace(/[^a-z0-9-]/gi, "-");
  const filename = `sapientia-${safeSlug}-pack.json`;
  return { blob, filename };
}

/** Trigger a browser save dialog so the file lands in Downloads. */
export async function downloadPackToFile(userId: string, subjectId: string) {
  const out = await exportPackToBlob(userId, subjectId);
  if (!out) return false;
  triggerBrowserDownload(out.blob, out.filename);
  return true;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function letterLabel(i: number): string {
  return String.fromCharCode(65 + i); // A, B, C...
}

function correctIndexFor(q: OfflineQuestion): number {
  // Try to align correct_answer to options index, supports letter or text.
  const ans = (q.correct_answer ?? "").toString().trim();
  if (!ans) return -1;
  const upper = ans.toUpperCase();
  if (/^[A-Z]$/.test(upper)) {
    const idx = upper.charCodeAt(0) - 65;
    if (idx >= 0 && idx < q.options.length) return idx;
  }
  const idx = q.options.findIndex(
    (o) => o.text.trim().toLowerCase() === ans.toLowerCase()
  );
  return idx;
}

/* ---------- PDF export ---------- */

export async function downloadPackAsPdf(userId: string, subjectId: string) {
  const meta = await getPack(userId, subjectId);
  if (!meta) return false;
  const questions = await getPackQuestions(userId, subjectId);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const marginX = 54;
  const marginTop = 72; // room for running header
  const marginBottom = 56; // room for footer
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - marginX * 2;

  // Section spacing (consistent throughout the document)
  const SP = {
    afterMeta: 4,
    afterQuestion: 6,
    betweenOptions: 2,
    afterOptions: 6,
    afterAnswer: 2,
    afterExplanation: 0,
    betweenQuestions: 16,
  };

  // Group questions by exam type so WAEC + JAMB get clear sections.
  const groupOrder: ("waec" | "jamb" | "both" | "other")[] = [
    "waec",
    "jamb",
    "both",
    "other",
  ];
  const groups = new Map<string, OfflineQuestion[]>();
  for (const q of questions) {
    const key = (q.exam_type ?? "other") as string;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
  }
  const orderedKeys = [
    ...groupOrder.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !groupOrder.includes(k as never)),
  ];

  let currentSectionLabel = "";
  let y = marginTop;

  const drawHeaderFooter = () => {
    const pageNum = doc.getNumberOfPages();
    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40);
    doc.text(meta.subject_name, marginX, 36);
    if (currentSectionLabel) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(110);
      doc.text(currentSectionLabel, pageW - marginX, 36, { align: "right" });
    }
    doc.setDrawColor(220);
    doc.setLineWidth(0.5);
    doc.line(marginX, 44, pageW - marginX, 44);

    // Footer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(130);
    doc.text("Sapientia · Offline Pack", marginX, pageH - 28);
    doc.text(`Page ${pageNum}`, pageW - marginX, pageH - 28, {
      align: "right",
    });
    doc.setTextColor(0);
  };

  const newPage = () => {
    doc.addPage();
    y = marginTop;
    drawHeaderFooter();
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - marginBottom) newPage();
  };

  const measureLines = (
    text: string,
    size: number,
    width: number
  ): string[] => {
    doc.setFontSize(size);
    return doc.splitTextToSize(text, width) as string[];
  };

  // Draw text with optional hanging indent (continuation lines indent further).
  const drawText = (
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      x?: number;
      width?: number;
      hangingIndent?: number;
      color?: number;
      gap?: number;
    } = {}
  ) => {
    const size = opts.size ?? 11;
    const x = opts.x ?? marginX;
    const width = opts.width ?? pageW - marginX - x;
    const hang = opts.hangingIndent ?? 0;
    const lineH = size * 1.35;

    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(opts.color ?? 0);

    const firstLines = measureLines(text, size, width);
    if (firstLines.length === 0) return;

    // First line at x, remaining lines wrap with hanging indent.
    ensureSpace(lineH);
    doc.text(firstLines[0], x, y);
    y += lineH;

    if (firstLines.length > 1 && hang > 0) {
      // Re-wrap the remainder against narrower width
      const remainder = firstLines.slice(1).join(" ");
      const wrapped = measureLines(remainder, size, width - hang);
      for (const ln of wrapped) {
        ensureSpace(lineH);
        doc.text(ln, x + hang, y);
        y += lineH;
      }
    } else {
      for (let i = 1; i < firstLines.length; i++) {
        ensureSpace(lineH);
        doc.text(firstLines[i], x, y);
        y += lineH;
      }
    }
    if (opts.gap) y += opts.gap;
  };

  const sectionLabelFor = (key: string) =>
    key === "waec"
      ? "WAEC Questions"
      : key === "jamb"
        ? "JAMB Questions"
        : key === "both"
          ? "WAEC & JAMB Questions"
          : "Additional Questions";

  // Cover page
  drawHeaderFooter();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text(meta.subject_name, marginX, marginTop + 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(90);
  doc.text(
    `${meta.question_count} questions · WAEC & JAMB practice pack`,
    marginX,
    marginTop + 54
  );
  doc.setFontSize(10);
  doc.text(
    `Exported ${new Date().toLocaleString()}`,
    marginX,
    marginTop + 72
  );
  doc.setTextColor(0);
  y = marginTop + 110;

  let qIndex = 0;
  type AnswerEntry = {
    n: number;
    section: string;
    questionText: string;
    answer: string | null;
    explanation: string | null;
  };
  const answerKey: AnswerEntry[] = [];

  for (const key of orderedKeys) {
    const list = groups.get(key)!;
    if (list.length === 0) continue;
    currentSectionLabel = sectionLabelFor(key);

    // Section header — always start on a fresh page for clarity
    newPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(currentSectionLabel, marginX, y);
    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(`${list.length} questions`, marginX, y);
    doc.setTextColor(0);
    y += 18;

    for (const q of list) {
      qIndex += 1;

      // Estimate the height of the question header to keep it with at least
      // one option.
      const questionLines = measureLines(
        `Q${qIndex}. ${q.question_text}`,
        11,
        usableW
      );
      const minBlock = questionLines.length * 11 * 1.35 + 11 * 1.35 + 12;
      ensureSpace(minBlock);

      const tags = [q.topic, q.year ? `${q.year}` : null]
        .filter(Boolean)
        .join(" · ");
      if (tags) {
        drawText(tags, { size: 9, color: 130, gap: 2 });
      }

      drawText(`Q${qIndex}. ${q.question_text}`, {
        size: 11,
        bold: true,
        hangingIndent: 22,
        gap: SP.afterQuestion,
      });

      q.options.forEach((opt, oi) => {
        const label = `${opt.label || letterLabel(oi)}.`;
        // Draw the letter, then the option text with hanging indent so wrapped
        // lines align with the option text rather than the letter.
        const letterX = marginX + 14;
        const textX = letterX + 18;
        const textW = pageW - marginX - textX;
        const lineH = 11 * 1.35;

        const lines = measureLines(opt.text, 11, textW);
        ensureSpace(lineH);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(label, letterX, y);
        doc.setFont("helvetica", "normal");
        doc.text(lines[0] ?? "", textX, y);
        y += lineH;
        for (let i = 1; i < lines.length; i++) {
          ensureSpace(lineH);
          doc.text(lines[i], textX, y);
          y += lineH;
        }
        if (oi < q.options.length - 1) y += SP.betweenOptions;
      });
      y += SP.afterOptions;

      const ci = correctIndexFor(q);
      answerKey.push({
        n: qIndex,
        section: currentSectionLabel,
        questionText: q.question_text,
        answer: ci >= 0 ? letterLabel(ci) : null,
        explanation: q.explanation || null,
      });

      y += SP.betweenQuestions;
      // Light divider between questions
      if (y < pageH - marginBottom) {
        doc.setDrawColor(235);
        doc.setLineWidth(0.4);
        doc.line(marginX, y - 10, pageW - marginX, y - 10);
      }
    }
  }

  // ------- Answer key & explanations appendix -------
  if (answerKey.length > 0) {
    currentSectionLabel = "Answer Key & Explanations";
    newPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Answer Key & Explanations", marginX, y);
    y += 24;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(
      "Use this section to check your answers after attempting the questions.",
      marginX,
      y
    );
    doc.setTextColor(0);
    y += 22;

    let lastSection = "";
    for (const a of answerKey) {
      if (a.section && a.section !== lastSection) {
        ensureSpace(40);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text(a.section, marginX, y);
        y += 18;
        lastSection = a.section;
      }

      drawText(
        `Q${a.n}. Answer: ${a.answer ?? "—"}`,
        {
          size: 11,
          bold: true,
          hangingIndent: 22,
          gap: 2,
        }
      );
      if (a.explanation) {
        drawText(a.explanation, {
          size: 10,
          color: 80,
          hangingIndent: 14,
          gap: 8,
        });
      } else {
        y += 8;
      }
    }
  }

  const safe = meta.subject_slug.replace(/[^a-z0-9-]/gi, "-");
  const blob = doc.output("blob");
  triggerBrowserDownload(blob, `sapientia-${safe}-pack.pdf`);
  return true;
}

/* ---------- DOCX export ---------- */

export async function downloadPackAsDocx(userId: string, subjectId: string) {
  const meta = await getPack(userId, subjectId);
  if (!meta) return false;
  const questions = await getPackQuestions(userId, subjectId);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } =
    await import("docx");

  const children: InstanceType<typeof Paragraph>[] = [];
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: meta.subject_name, bold: true })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${meta.question_count} questions · Sapientia offline pack`,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: `Exported ${new Date().toLocaleString()}`,
          size: 18,
        }),
      ],
    }),
    new Paragraph({ children: [new TextRun("")] })
  );

  type DocxAnswer = {
    n: number;
    section: string;
    answer: string | null;
    explanation: string | null;
  };
  const answerKey: DocxAnswer[] = [];

  // Group by exam type for clearer sections (mirrors PDF layout).
  const groupOrder: ("waec" | "jamb" | "both" | "other")[] = [
    "waec",
    "jamb",
    "both",
    "other",
  ];
  const groups = new Map<string, OfflineQuestion[]>();
  for (const q of questions) {
    const key = (q.exam_type ?? "other") as string;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
  }
  const orderedKeys = [
    ...groupOrder.filter((k) => groups.has(k)),
    ...[...groups.keys()].filter((k) => !groupOrder.includes(k as never)),
  ];
  const sectionLabelFor = (k: string) =>
    k === "waec"
      ? "WAEC Questions"
      : k === "jamb"
        ? "JAMB Questions"
        : k === "both"
          ? "WAEC & JAMB Questions"
          : "Additional Questions";

  let qIndex = 0;
  for (const key of orderedKeys) {
    const list = groups.get(key) ?? [];
    if (list.length === 0) continue;
    const sectionLabel = sectionLabelFor(key);
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: sectionLabel, bold: true })],
      })
    );
    for (const q of list) {
      qIndex += 1;
    const meta2 = [q.topic, q.year ? `${q.year}` : null, q.exam_type?.toUpperCase()]
      .filter(Boolean)
      .join(" · ");
    if (meta2) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: meta2, size: 18, color: "666666" })],
        })
      );
    }
    children.push(
      new Paragraph({
        children: [
            new TextRun({ text: `Q${qIndex}. `, bold: true }),
          new TextRun({ text: q.question_text }),
        ],
      })
    );
    q.options.forEach((opt, oi) => {
      children.push(
        new Paragraph({
          children: [new TextRun(`${opt.label || letterLabel(oi)}. ${opt.text}`)],
        })
      );
    });
      const ci = correctIndexFor(q);
      answerKey.push({
        n: qIndex,
        section: sectionLabel,
        answer: ci >= 0 ? letterLabel(ci) : null,
        explanation: q.explanation || null,
      });
    children.push(new Paragraph({ children: [new TextRun("")] }));
    }
  }

  // Appendix: answer key + explanations at the end of the document.
  if (answerKey.length > 0) {
    children.push(
      new Paragraph({ children: [new TextRun("")] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({ text: "Answer Key & Explanations", bold: true }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text:
              "Use this section to check your answers after attempting the questions.",
            italics: true,
            color: "666666",
          }),
        ],
      }),
      new Paragraph({ children: [new TextRun("")] })
    );

    let lastSection = "";
    for (const a of answerKey) {
      if (a.section && a.section !== lastSection) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: a.section, bold: true })],
          })
        );
        lastSection = a.section;
      }
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Q${a.n}. `, bold: true }),
            new TextRun({ text: "Answer: ", bold: true }),
            new TextRun(a.answer ?? "—"),
          ],
        })
      );
      if (a.explanation) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Explanation: ", bold: true }),
              new TextRun(a.explanation),
            ],
          })
        );
      }
      children.push(new Paragraph({ children: [new TextRun("")] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const safe = meta.subject_slug.replace(/[^a-z0-9-]/gi, "-");
  triggerBrowserDownload(blob, `sapientia-${safe}-pack.docx`);
  return true;
}

/** Restore a pack from a previously-exported JSON file. */
export async function importPackFromFile(
  userId: string,
  file: File
): Promise<PackMeta> {
  const text = await file.text();
  let parsed: PackExport;
  try {
    parsed = JSON.parse(text) as PackExport;
  } catch {
    throw new Error("That file isn't a valid Sapientia pack.");
  }
  if (parsed?.format !== "sapientia-offline-pack" || !Array.isArray(parsed.questions)) {
    throw new Error("Unrecognised pack file format.");
  }

  const db = await getDB();
  const tx = db.transaction([PACKS_STORE, QUESTIONS_STORE], "readwrite");
  const qStore = tx.objectStore(QUESTIONS_STORE);
  for (const q of parsed.questions) {
    await qStore.put({
      ...q,
      subject_id: parsed.meta.subject_id,
      exam_type: q.exam_type ?? "both",
    });
  }

  const meta: PackMeta = {
    key: packKey(userId, parsed.meta.subject_id),
    user_id: userId,
    subject_id: parsed.meta.subject_id,
    subject_slug: parsed.meta.subject_slug,
    subject_name: parsed.meta.subject_name,
    question_ids: parsed.questions.map((q) => q.id),
    question_count: parsed.questions.length,
    downloaded_at: new Date().toISOString(),
    size_estimate_kb: parsed.meta.size_estimate_kb,
  };
  await tx.objectStore(PACKS_STORE).put(meta);
  await tx.done;
  return meta;
}