import {
  normalizeDailyPlanClock,
  parseDurationMinutes,
  parseTimedLine,
} from "../daily-plan-command";

describe("daily plan command parser", () => {
  it("parses compact and colon-delimited timed lines", () => {
    expect(parseTimedLine("1100-1200 論文読み")).toEqual({
      start: "11:00",
      end: "12:00",
      title: "論文読み",
    });
    expect(parseTimedLine("13:00–14:30 図を直す")).toEqual({
      start: "13:00",
      end: "14:30",
      title: "図を直す",
    });
  });

  it("rejects invalid and reversed time ranges", () => {
    expect(normalizeDailyPlanClock("2500")).toBeNull();
    expect(parseTimedLine("1200-1100 invalid")).toBeNull();
  });

  it("parses per-day duration overrides", () => {
    expect(parseDurationMinutes("/schedule @paper (1h30m)")).toBe(90);
    expect(parseDurationMinutes("/schedule project:A")).toBeUndefined();
  });
});
