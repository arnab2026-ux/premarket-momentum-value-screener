import { describe, expect, it } from "vitest";
import { isTradingDay, nyClock, previousTradingDay, withinRunWindow } from "../src/lib/calendar";
import { mergeConfig, semanticErrors, validateConfig } from "../src/lib/config";
import { defaultConfig } from "@config/screener.config";

const W = { hour: 8, minute: 30, toleranceMinutes: 5 };

describe("NYSE calendar", () => {
  it("weekends closed", () => { expect(isTradingDay("2026-10-03")).toBe(false); expect(isTradingDay("2026-10-05")).toBe(true); });
  it("2026 holidays", () => {
    for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"])
      expect(isTradingDay(d), d).toBe(false);
  });
  it("observed rules: Jul 4 2027 (Sun) -> Mon Jul 5; Dec 31 2027 stays open", () => {
    expect(isTradingDay("2027-07-05")).toBe(false);
    expect(isTradingDay("2027-12-31")).toBe(true);
    expect(isTradingDay("2027-12-24")).toBe(false); // Christmas Sat -> Fri
  });
  it("early-close days (day after Thanksgiving) still trading", () => expect(isTradingDay("2026-11-27")).toBe(true));
  it("previousTradingDay skips weekend", () => expect(previousTradingDay("2026-10-05")).toBe("2026-10-02"));
});

describe("08:30 New York window across DST", () => {
  it("EDT: 12:30Z is 08:30; 13:30Z is not", () => {
    expect(withinRunWindow(new Date("2026-07-15T12:30:00Z"), W)).toBe(true);
    expect(withinRunWindow(new Date("2026-07-15T13:30:00Z"), W)).toBe(false);
  });
  it("EST: 13:30Z is 08:30; 12:30Z is not", () => {
    expect(withinRunWindow(new Date("2026-12-15T13:30:00Z"), W)).toBe(true);
    expect(withinRunWindow(new Date("2026-12-15T12:30:00Z"), W)).toBe(false);
  });
  it("tolerance edges and date rollover", () => {
    expect(withinRunWindow(new Date("2026-07-15T12:35:00Z"), W)).toBe(true);
    expect(withinRunWindow(new Date("2026-07-15T12:36:00Z"), W)).toBe(false);
    expect(nyClock(new Date("2026-07-15T03:00:00Z")).date).toBe("2026-07-14"); // still previous NY day
  });
  it("DST switch days (Mar 8 and Nov 1, 2026)", () => {
    expect(withinRunWindow(new Date("2026-03-09T12:30:00Z"), W)).toBe(true); // first EDT Monday
    expect(withinRunWindow(new Date("2026-11-02T13:30:00Z"), W)).toBe(true); // first EST Monday
  });
});

describe("config", () => {
  it("defaults validate", () => { expect(validateConfig(defaultConfig)).toEqual([]); expect(semanticErrors(defaultConfig)).toEqual([]); });
  it("merge overrides deeply, replaces arrays", () => {
    const m = mergeConfig(defaultConfig, { ranking: { topN: 20 }, universe: { exchanges: ["NYSE"] } });
    expect(m.ranking.topN).toBe(20); expect(m.ranking.maxPerSector).toBe(6); expect(m.universe.exchanges).toEqual(["NYSE"]);
  });
  it("catches bad types, unknown keys, bad weights", () => {
    expect(validateConfig(mergeConfig(defaultConfig, { ranking: { topN: "x" } }))).not.toEqual([]);
    expect(validateConfig(mergeConfig(defaultConfig, { bogus: 1 }))).not.toEqual([]);
    expect(semanticErrors(mergeConfig(defaultConfig, { momentum: { weights: { ret6m: -1 } } }))).not.toEqual([]);
  });
});
