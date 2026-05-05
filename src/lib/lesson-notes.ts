import { supabase } from "@/integrations/supabase/client";
import { jsPDF } from "jspdf";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
} from "docx";

export const CLASS_LEVELS = [
  "JSS1",
  "JSS2",
  "JSS3",
  "SS1",
  "SS2",
  "SS3",
] as const;
export type ClassLevel = (typeof CLASS_LEVELS)[number];

export type LessonNote = {
  id: string;
  teacher_id: string;
  subject_id: string | null;
  class_level: string;
  term: number;
  week: number;
  topic: string;
  sub_topic: string | null;
  objectives: string | null;
  content: string;
  resources: string | null;
  evaluation: string | null;
  assignment: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type LessonNoteInput = Omit<
  LessonNote,
  "id" | "teacher_id" | "created_at" | "updated_at"
>;

function trigger(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeName(s: string) {
  return s.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
}

export async function exportLessonNotePdf(note: LessonNote, subjectName?: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensure = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const heading = (txt: string, size = 18) => {
    ensure(size + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.text(txt, margin, y);
    y += size + 6;
  };

  const meta = (label: string, value: string) => {
    ensure(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 90, y);
    y += 14;
  };

  const section = (title: string, body?: string | null) => {
    if (!body || !body.trim()) return;
    y += 8;
    ensure(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(title, margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(body, maxW);
    for (const line of lines) {
      ensure(14);
      doc.text(line, margin, y);
      y += 14;
    }
  };

  heading("Lesson Note", 20);
  heading(note.topic, 16);
  if (note.sub_topic) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(12);
    ensure(14);
    doc.text(note.sub_topic, margin, y);
    y += 16;
  }
  y += 6;
  if (subjectName) meta("Subject", subjectName);
  meta("Class", note.class_level);
  meta("Term", String(note.term));
  meta("Week", String(note.week));

  section("Objectives", note.objectives);
  section("Content", note.content);
  section("Resources / Materials", note.resources);
  section("Evaluation", note.evaluation);
  section("Assignment", note.assignment);

  const blob = doc.output("blob");
  trigger(
    blob,
    `lesson-${safeName(note.class_level)}-w${note.week}-${safeName(note.topic)}.pdf`,
  );
}

export async function exportLessonNoteDocx(note: LessonNote, subjectName?: string) {
  const children: Paragraph[] = [];
  const para = (text: string, opts: { bold?: boolean; size?: number; italics?: boolean } = {}) =>
    new Paragraph({
      children: [
        new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size }),
      ],
    });

  children.push(new Paragraph({ text: note.topic, heading: HeadingLevel.HEADING_1 }));
  if (note.sub_topic) children.push(para(note.sub_topic, { italics: true }));
  children.push(para(""));
  if (subjectName) children.push(para(`Subject: ${subjectName}`, { bold: true }));
  children.push(para(`Class: ${note.class_level}`, { bold: true }));
  children.push(para(`Term: ${note.term}    Week: ${note.week}`, { bold: true }));

  const section = (title: string, body?: string | null) => {
    if (!body || !body.trim()) return;
    children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 }));
    body.split(/\r?\n/).forEach((line) => children.push(para(line)));
  };
  section("Objectives", note.objectives);
  section("Content", note.content);
  section("Resources / Materials", note.resources);
  section("Evaluation", note.evaluation);
  section("Assignment", note.assignment);

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  trigger(
    blob,
    `lesson-${safeName(note.class_level)}-w${note.week}-${safeName(note.topic)}.docx`,
  );
}

export async function getMyTeacherApplication(userId: string) {
  const { data } = await supabase
    .from("teacher_applications")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function isTeacher(userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role as string);
  return {
    isTeacher: roles.includes("teacher") || roles.includes("admin"),
    isAdmin: roles.includes("admin"),
  };
}