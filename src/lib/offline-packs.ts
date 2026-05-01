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
const DB_VERSION = 1;
const PACKS_STORE = "packs";
const QUESTIONS_STORE = "questions";

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
      },
    });
  }
  return dbPromise;
}

const packKey = (userId: string, subjectId: string) => `${userId}:${subjectId}`;

/** Download (or refresh) all questions for a subject and store them locally. */
export async function downloadPack(
  userId: string,
  subject: { id: string; slug: string; name: string },
  onProgress?: (loaded: number, total: number) => void
): Promise<PackMeta> {
  // Pull every question for the subject in pages of 1000 to dodge Supabase's row cap.
  const PAGE = 1000;
  let from = 0;
  const all: Record<string, unknown>[] = [];
  // First request gives us a total count.
  let total = 0;

  // Loop until we've fetched everything.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error, count } = await supabase
      .from("questions")
      .select(
        "id, question_text, options, correct_answer, explanation, topic, year, image_url, difficulty, exam_type, subject_id",
        { count: from === 0 ? "exact" : undefined }
      )
      .eq("subject_id", subject.id)
      .order("year", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (from === 0) total = count ?? data?.length ?? 0;

    const rows = data ?? [];
    all.push(...(rows as Record<string, unknown>[]));
    onProgress?.(Math.min(all.length, total), total || all.length);

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const normalized: OfflineQuestion[] = all.map((row) => {
    const q = normalizeQuestion(row);
    return {
      ...q,
      subject_id: subject.id,
      exam_type: (row.exam_type as OfflineQuestion["exam_type"]) ?? "both",
    };
  });

  const db = await getDB();
  const tx = db.transaction([PACKS_STORE, QUESTIONS_STORE], "readwrite");
  const qStore = tx.objectStore(QUESTIONS_STORE);
  for (const q of normalized) await qStore.put(q);

  const sizeEstimate = Math.round(
    JSON.stringify(normalized).length / 1024
  );

  const meta: PackMeta = {
    key: packKey(userId, subject.id),
    user_id: userId,
    subject_id: subject.id,
    subject_slug: subject.slug,
    subject_name: subject.name,
    question_ids: normalized.map((q) => q.id),
    question_count: normalized.length,
    downloaded_at: new Date().toISOString(),
    size_estimate_kb: sizeEstimate,
  };
  await tx.objectStore(PACKS_STORE).put(meta);
  await tx.done;
  return meta;
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