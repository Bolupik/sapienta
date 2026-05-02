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
  const url = URL.createObjectURL(out.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = out.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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