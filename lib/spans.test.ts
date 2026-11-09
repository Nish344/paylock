// lib/spans.test.ts
import { describe, it, expect } from "vitest";
import { segments, mask, find, codePointLength, codePointSlice } from "./spans";

describe("lib/spans", () => {
  it("splits around one mark", () => {
    const text = "Total due: USD 6,680.00 today.";
    // "6,680.00" is at index 15..23
    const mark = { start: 15, end: 23, kind: "used" as const };
    const segs = segments(text, [mark]);

    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({
      text: "Total due: USD ",
      start: 0,
      end: 15,
    });
    expect(segs[1]).toEqual({
      text: "6,680.00",
      start: 15,
      end: 23,
      mark,
    });
    expect(segs[2]).toEqual({
      text: " today.",
      start: 23,
      end: 30,
    });
  });

  it("handles an emoji before the mark without shifting offsets", () => {
    // "🍅 Total: 100"
    // "🍅" is 1 code point (UTF-16 length is 2)
    const text = "🍅 Total: 100";
    expect(codePointLength("🍅")).toBe(1);
    expect("🍅".length).toBe(2);

    // Code point 0 is "🍅", 1 is " ", 2..6 is "Total", 7 is ":", 8 is " ", 9..12 is "100"
    const mark = { start: 9, end: 12, kind: "used" as const };
    const segs = segments(text, [mark]);

    expect(segs[0].text).toBe("🍅 Total: ");
    expect(segs[1].text).toBe("100");
    expect(segs[1].mark).toEqual(mark);
  });

  it("drops overlapping and out-of-range marks", () => {
    const text = "Hello world"; // 11 code points (0..11)
    const marks = [
      { start: 0, end: 5, kind: "used" as const }, // "Hello"
      { start: 3, end: 8, kind: "removed" as const }, // overlaps 0..5 -> dropped
      { start: 6, end: 11, kind: "backed" as const }, // "world" -> kept
      { start: 10, end: 15, kind: "unbacked" as const }, // past length (15 > 11) -> dropped
      { start: -2, end: 4, kind: "masked" as const }, // negative -> dropped
    ];

    const segs = segments(text, marks);
    expect(segs).toHaveLength(3);
    expect(segs[0].text).toBe("Hello");
    expect(segs[0].mark?.kind).toBe("used");
    expect(segs[1].text).toBe(" ");
    expect(segs[2].text).toBe("world");
    expect(segs[2].mark?.kind).toBe("backed");
  });

  it("mask keeps the exact length and preserves newlines", () => {
    const text = "Account: 000123456789\nRouting: 000000123\nEnd";
    const originalLen = codePointLength(text);

    // Mask account number (9..21) and routing (31..40)
    const masked = mask(text, [
      { start: 9, end: 21 },
      { start: 31, end: 40 },
    ]);

    expect(codePointLength(masked)).toBe(originalLen);
    expect(masked).toContain("Account: ████████████\n");
    expect(masked).toContain("Routing: █████████\nEnd");

    // Test a span spanning across a newline
    const multiLine = "Line 1\nLine 2";
    const maskedMulti = mask(multiLine, [{ start: 4, end: 9 }]);
    // "Line 1\nLine 2": indices: L(0) i(1) n(2) e(3) ' '(4) 1(5) \n(6) L(7) i(8) n(9)
    // 4..9 replaces ' ', '1', 'L', 'i' with '█', but keeps '\n'
    expect(codePointLength(maskedMulti)).toBe(codePointLength(multiLine));
    expect(maskedMulti).toBe("Line██\n██ne 2");
  });

  it("find returns code-point offsets after an emoji, and returns null when not found", () => {
    const text = "📦 Shipment arrived today: 420 cases accepted.";
    // "📦" is 1 code point, followed by space
    const target = "420 cases accepted";

    const span = find(text, target);
    expect(span).not.toBeNull();
    if (span) {
      expect(codePointSlice(text, span.start, span.end)).toBe(target);
      // Let's verify that the offset in code points is correct
      expect(span.start).toBe(26);
      expect(span.end).toBe(26 + codePointLength(target));
    }

    const notFound = find(text, "500 cases accepted");
    expect(notFound).toBeNull();

    const empty = find(text, "");
    expect(empty).toBeNull();
  });
});
