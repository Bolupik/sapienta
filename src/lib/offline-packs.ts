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
    (o) => o.toString().trim().toLowerCase() === ans.toLowerCase()
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

  const marginX = 48;
  const marginY = 56;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - marginX * 2;
  let y = marginY;

  const addLine = (
    text: string,
    opts: { size?: number; bold?: boolean; gap?: number; indent?: number } = {}
  ) => {
    const size = opts.size ?? 11;
    const indent = opts.indent ?? 0;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, usableW - indent) as string[];
    for (const ln of wrapped) {
      if (y > pageH - marginY) {
        doc.addPage();
        y = marginY;
      }
      doc.text(ln, marginX + indent, y);
      y += size * 1.25;
    }
    if (opts.gap) y += opts.gap;
  };

  // Cover
  addLine(meta.subject_name, { size: 22, bold: true, gap: 6 });
  addLine(`${meta.question_count} questions · Sapientia offline pack`, {
    size: 11,
    gap: 4,
  });
  addLine(`Exported ${new Date().toLocaleString()}`, { size: 10, gap: 14 });

  questions.forEach((q, i) => {
    if (y > pageH - marginY - 80) {
      doc.addPage();
      y = marginY;
    }
    const meta2 = [q.topic, q.year ? `${q.year}` : null, q.exam_type?.toUpperCase()]
      .filter(Boolean)
      .join(" · ");
    if (meta2) addLine(meta2, { size: 9 });
    addLine(`Q${i + 1}. ${q.question_text}`, { size: 11, bold: true, gap: 2 });
    q.options.forEach((opt, oi) => {
      addLine(`${letterLabel(oi)}. ${opt}`, { size: 11, indent: 16 });
    });
    const ci = correctIndexFor(q);
    if (ci >= 0) addLine(`Answer: ${letterLabel(ci)}`, { size: 10, bold: true });
    if (q.explanation) addLine(`Explanation: ${q.explanation}`, { size: 10 });
    y += 10;
  });

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

  questions.forEach((q, i) => {
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
          new TextRun({ text: `Q${i + 1}. `, bold: true }),
          new TextRun({ text: q.question_text }),
        ],
      })
    );
    q.options.forEach((opt, oi) => {
      children.push(
        new Paragraph({
          children: [new TextRun(`${letterLabel(oi)}. ${opt}`)],
        })
      );
    });
    const ci = correctIndexFor(q);
    if (ci >= 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Answer: ", bold: true }),
            new TextRun(letterLabel(ci)),
          ],
        })
      );
    }
    if (q.explanation) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Explanation: ", bold: true }),
            new TextRun(q.explanation),
          ],
        })
      );
    }
    children.push(new Paragraph({ children: [new TextRun("")] }));
  });

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