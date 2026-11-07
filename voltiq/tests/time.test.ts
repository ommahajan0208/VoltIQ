import { describe, it, expect } from "vitest";
import {
  addSourceMinutes,
  inclusiveEndToExclusive,
  exclusiveEndToInclusive,
  sourceLabel,
  sourceTimestampLabel,
  inRange,
  isSourceTimestamp,
  csvCell,
} from "../src/lib/time";
describe("source wall-clock dates", () => {
  it("converts an inclusive calendar end across month and year boundaries", () => {
    expect(inclusiveEndToExclusive("2007-12-31")).toBe("2008-01-01T00:00:00");
    expect(inclusiveEndToExclusive("2008-02-29")).toBe("2008-03-01T00:00:00");
  });
  it("preserves exact source timestamp precision", () => {
    expect(sourceTimestampLabel("2007-05-01T08:15:42")).toBe("2007-05-01 08:15:42");
  });

  it("round-trips an inclusive day without a viewer time-zone conversion", () => {
    expect(exclusiveEndToInclusive(inclusiveEndToExclusive("2007-05-01"))).toBe(
      "2007-05-01",
    );
    expect(sourceLabel("2007-05-01T00:15:00")).toBe("2007-05-01 00:15");
  });
  it("includes start and excludes end", () => {
    expect(
      inRange(
        "2007-05-01T00:00:00",
        "2007-05-01T00:00:00",
        "2007-05-02T00:00:00",
      ),
    ).toBe(true);
    expect(
      inRange(
        "2007-05-02T00:00:00",
        "2007-05-01T00:00:00",
        "2007-05-02T00:00:00",
      ),
    ).toBe(false);
  });
  it("rejects offset-bearing and invalid source labels", () => {
    expect(isSourceTimestamp("2007-05-01T00:00:00Z")).toBe(false);
    expect(isSourceTimestamp("2007-02-30T00:00:00")).toBe(false);
    expect(isSourceTimestamp("2007-05-01T00:00:00")).toBe(true);
  });
  it("steps a historical origin across midnight while preserving source time", () =>
    expect(addSourceMinutes("2007-05-01T00:00:00", -15)).toBe(
      "2007-04-30T23:45:00",
    ));
});
describe("CSV export cells", () => {
  it("escapes user-entered formula prefixes without changing numeric negatives", () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell("  @SUM(A1)")).toBe("'  @SUM(A1)");
    expect(csvCell(-1.25)).toBe("-1.25");
  });
  it("quotes commas, newlines and quotation marks", () =>
    expect(csvCell('one,"two"\nthree')).toBe('"one,""two""\nthree"'));
  it("retains null as missing instead of a numeric zero", () =>
    expect(csvCell(null)).toBe(""));
});
