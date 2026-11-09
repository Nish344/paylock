// lib/spans.ts
import type { Span } from "./types";

export type MarkKind =
  | "used"
  | "removed"
  | "masked"
  | "backed"
  | "unbacked";

export interface Mark extends Span {
  kind: MarkKind;
  label?: string;
  [key: string]: unknown;
}

export interface Segment {
  text: string;
  start: number;
  end: number;
  mark?: Mark;
}

/**
 * Splits text into plain and marked pieces.
 * Drops marks that overlap an earlier mark, or run past the end of the text.
 * Offsets are measured in Unicode code points.
 */
export function segments(text: string, marks: Mark[]): Segment[] {
  const points = Array.from(text);
  if (points.length === 0) {
    return [];
  }

  // Sort by start ascending, then end ascending
  const sorted = [...marks].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });

  // Filter overlapping and out-of-range marks
  const validMarks: Mark[] = [];
  let lastEnd = 0;

  for (const m of sorted) {
    if (m.start < 0 || m.end <= m.start || m.end > points.length) {
      continue;
    }
    if (m.start < lastEnd) {
      // Overlaps earlier mark; drop it
      continue;
    }
    validMarks.push(m);
    lastEnd = m.end;
  }

  const result: Segment[] = [];
  let cursor = 0;

  for (const mark of validMarks) {
    if (mark.start > cursor) {
      result.push({
        text: points.slice(cursor, mark.start).join(""),
        start: cursor,
        end: mark.start,
      });
    }
    result.push({
      text: points.slice(mark.start, mark.end).join(""),
      start: mark.start,
      end: mark.end,
      mark,
    });
    cursor = mark.end;
  }

  if (cursor < points.length) {
    result.push({
      text: points.slice(cursor, points.length).join(""),
      start: cursor,
      end: points.length,
    });
  }

  return result;
}

/**
 * Replaces every character inside the spans with █ and keeps newlines.
 * The output has exactly the same length in code points.
 */
export function mask(text: string, spans: Span[]): string {
  const points = Array.from(text);
  if (points.length === 0 || spans.length === 0) {
    return text;
  }

  for (const span of spans) {
    const start = Math.max(0, Math.min(span.start, points.length));
    const end = Math.max(start, Math.min(span.end, points.length));
    for (let i = start; i < end; i++) {
      if (points[i] === "\n" || points[i] === "\r") {
        continue; // Keep newlines intact
      }
      points[i] = "█";
    }
  }

  return points.join("");
}

/**
 * Returns the code-point span of the first exact occurrence of sentence, or null.
 */
export function find(text: string, sentence: string): Span | null {
  if (!sentence || !text) return null;
  const points = Array.from(text);
  const target = Array.from(sentence);
  if (target.length === 0 || target.length > points.length) return null;

  for (let i = 0; i <= points.length - target.length; i++) {
    let match = true;
    for (let j = 0; j < target.length; j++) {
      if (points[i + j] !== target[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return { start: i, end: i + target.length };
    }
  }

  return null;
}

/**
 * Helper to get code point length of a string.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Helper to slice a string by code point offsets.
 */
export function codePointSlice(text: string, start: number, end?: number): string {
  return Array.from(text).slice(start, end).join("");
}
