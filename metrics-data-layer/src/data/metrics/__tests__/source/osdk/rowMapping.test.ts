// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PLACEHOLDER } from "../../../../../config/metrics";
import {
  isoTimestamp,
  toAlertEventRow,
  toItemRow,
  toOpenAlertRow,
  toVerdictRow,
  verdictDateReader,
} from "../../../source/osdk/rowMapping";
import { chunkIds, fetchAllPages, mergePaged, runLimited } from "../../../source/osdk/paging";
import { TEST_CONFIG } from "./osdkTestUtils";

describe("row mapping (decision D15)", () => {
  it("maps AlertHistory rows; drops rows without riskAlertId, eventType or a valid timestamp", () => {
    expect(toAlertEventRow({ riskAlertId: "a", eventType: "opened", eventTimestamp: "2026-09-01T10:00:00+02:00", persona: null })).toEqual({
      riskAlertId: "a",
      salesOrderId: null,
      eventType: "opened",
      eventSource: null,
      eventTimestamp: "2026-09-01T08:00:00.000Z",
      persona: null,
      riskType: null,
      priorityAtEvent: null,
    });
    expect(toAlertEventRow({ eventType: "opened", eventTimestamp: "2026-09-01T00:00:00Z" })).toBeNull();
    expect(toAlertEventRow({ riskAlertId: "a", eventType: "opened" })).toBeNull();
    expect(toAlertEventRow({ riskAlertId: "a", eventTimestamp: "2026-09-01T00:00:00Z" })).toBeNull();
    expect(toAlertEventRow({ riskAlertId: "a", eventType: "x", eventTimestamp: "not a date" })).toBeNull();
    expect(isoTimestamp("")).toBeNull();
  });

  it("maps open alerts; drops rows without riskAlertId or salesOrderId", () => {
    expect(toOpenAlertRow({ riskAlertId: "a", salesOrderId: "s", escalated: false, priority: "High" })).toEqual({
      riskAlertId: "a",
      salesOrderId: "s",
      persona: null,
      priority: "High",
      riskType: null,
      escalated: false,
    });
    expect(toOpenAlertRow({ riskAlertId: "a" })).toBeNull();
    expect(toOpenAlertRow({ salesOrderId: "s" })).toBeNull();
  });

  it("maps items to business dimension names; drops rows without salesOrderId", () => {
    expect(
      toItemRow({
        salesOrderId: "s",
        businessLineName: "BL",
        productLineName: "PL",
        iscRegionName: "EU",
        plantCode: "P1",
        valueUsd: 12.5,
        isOpen: true,
      }),
    ).toEqual({ salesOrderId: "s", businessLine: "BL", productLine: "PL", region: "EU", plant: "P1", valueUsd: 12.5, isOpen: true });
    expect(toItemRow({ salesOrderId: "s", valueUsd: Number.NaN })).toMatchObject({ valueUsd: null, isOpen: null });
    expect(toItemRow({ businessLineName: "BL" })).toBeNull();
  });

  it("maps verdicts with verdictDate from VERDICT_DATE_PROPERTY", () => {
    const row = {
      otifOrderId: "o",
      initOtifClassification: "OTIF",
      critClassification: "Not CRIT",
      officialExclusionOtif: "No",
      officialExclusionCrit: "Yes",
      otifOtShipmentEndDate: "2026-09-20T00:00:00Z",
      otifFirstInitialDeliveryDateTarget: "2026-09-02",
    };
    expect(toVerdictRow(row, verdictDateReader(TEST_CONFIG))).toEqual({
      otifOrderId: "o",
      otifVerdict: "OTIF",
      critVerdict: "Not CRIT",
      otifExclusion: "No",
      critExclusion: "Yes",
      verdictDate: "2026-09-20",
    });
    const other = verdictDateReader({ ...TEST_CONFIG, VERDICT_DATE_PROPERTY: "otifFirstInitialDeliveryDateTarget" });
    expect(toVerdictRow(row, other)?.verdictDate).toBe("2026-09-02");
    expect(toVerdictRow({ otifOrderId: "o" }, other)?.verdictDate).toBeNull();
    expect(toVerdictRow({ initOtifClassification: "OTIF" }, other)).toBeNull();
    expect(() => verdictDateReader({ ...TEST_CONFIG, VERDICT_DATE_PROPERTY: PLACEHOLDER })).toThrow();
  });
});

describe("paging helpers", () => {
  it("chunkIds splits and yields nothing for no ids", () => {
    expect(chunkIds(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(chunkIds([], 2)).toEqual([]);
  });

  it("runLimited keeps order and never exceeds the limit", async () => {
    let inFlight = 0;
    let max = 0;
    const out = await runLimited([1, 2, 3, 4, 5, 6], 2, new AbortController().signal, async (n) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 7 - n));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(max).toBe(2);
  });

  it("runLimited stops starting tasks after a failure", async () => {
    const started: number[] = [];
    const run = runLimited([1, 2, 3, 4], 1, new AbortController().signal, async (n) => {
      started.push(n);
      if (n === 2) throw new Error("boom");
      return n;
    });
    await expect(run).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
  });

  it("fetchAllPages tolerates a missing data array and a null token", async () => {
    const page = () => Promise.resolve({ data: [], nextPageToken: undefined, totalCount: "0" });
    expect(await fetchAllPages(page, new AbortController().signal, 10, () => undefined)).toEqual({ rows: [], capped: false });
  });

  it("mergePaged propagates capped", () => {
    expect(mergePaged([{ rows: [1], capped: true }, { rows: [2], capped: false }], 10)).toEqual({ rows: [1, 2], capped: true });
    expect(mergePaged([{ rows: [1, 2], capped: false }, { rows: [3], capped: false }], 2)).toEqual({ rows: [1, 2], capped: true });
  });
});
