import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import {
  actionTypeGroups,
  alertFunnelSets,
  alertIdsByEventType,
  alertIdsWhere,
  eventTypeGroups,
  intersectIds,
  rowsOfAlerts,
  subtractIds,
  writebackTypeGroups,
} from "../../compute/alertSets";
import { isActionEvent, isViewedEvent } from "../../compute/eventPredicates";
import type { AlertEventRow } from "../../types";

const C = METRICS_CONFIG;
function ev(riskAlertId: string, eventType: string, eventSource: string | null = "user"): AlertEventRow {
  return {
    riskAlertId,
    salesOrderId: `SO_${riskAlertId}`,
    eventType,
    eventSource,
    eventTimestamp: "2026-06-01T00:00:00Z",
    persona: null,
    riskType: null,
    priorityAtEvent: null,
  };
}
const VIEW = "opened_by_user";
// V: viewed only. VA: viewed + two action types. A: acted without a view. VAW: viewed, acted, written back.
// W: write-back only (written back outside the path). VW: viewed + write-back from a non-action source.
const rows: AlertEventRow[] = [
  ev("V", VIEW, "user view"),
  ev("VA", VIEW, "user view"),
  ev("VA", "resolved"),
  ev("VA", "snoozed", "user action"),
  ev("VA", "resolved"),
  ev("A", "deeplink_clicked", "user deeplink"),
  ev("VAW", VIEW, "user view"),
  ev("VAW", "resolved"),
  ev("VAW", "delivery_block_removed"),
  ev("VAW", "delivery_tolerance_corrected"),
  ev("W", "allocation_rejection_lifted", "user"),
  ev("VW", VIEW, "user view"),
  ev("VW", "delivery_block_removed", null),
  ev("U", "updated"),
];
const ids = (s: ReadonlySet<string>) => [...s].sort();

describe("alertFunnelSets (spec §9 2.2–2.4 alert view)", () => {
  const sets = alertFunnelSets(rows, C);
  it("viewed / acted / writtenBack sets", () => {
    expect(ids(sets.viewed)).toEqual(["V", "VA", "VAW", "VW"]);
    expect(ids(sets.acted)).toEqual(["A", "VA", "VAW", "W"]);
    expect(ids(sets.writtenBack)).toEqual(["VAW", "VW", "W"]);
    expect(sets.stage22).toBe(sets.viewed);
  });
  it("2.3 = acted ∩ viewed; outside path = acted ∖ viewed", () => {
    expect(ids(sets.stage23)).toEqual(["VA", "VAW"]);
    expect(ids(sets.outside23)).toEqual(["A", "W"]);
  });
  it("2.4 = writtenBack ∩ 2.3; outside = writtenBack ∖ 2.3", () => {
    expect(ids(sets.stage24)).toEqual(["VAW"]);
    expect(ids(sets.outside24)).toEqual(["VW", "W"]);
  });
  it("keep restricts every set first (open-now alerts under now)", () => {
    const kept = alertFunnelSets(rows, C, new Set(["VA", "W"]));
    expect(ids(kept.viewed)).toEqual(["VA"]);
    expect(ids(kept.stage23)).toEqual(["VA"]);
    expect(ids(kept.outside24)).toEqual(["W"]);
  });
});

describe("eventType groups (spec §5 B10)", () => {
  const sets = alertFunnelSets(rows, C);
  it("actionType counts each 2.3 alert once per type; one alert can be in two groups", () => {
    // A write-back row from a user source is also an action_event (spec §4 literal; W2: a write-back is
    // an action), so VAW's write-back types appear too; VA's two "resolved" rows count once.
    expect(actionTypeGroups(rows, sets, C)).toEqual([
      { group: "resolved", count: 2 },
      { group: "delivery_block_removed", count: 1 },
      { group: "delivery_tolerance_corrected", count: 1 },
      { group: "snoozed", count: 1 },
    ]);
  });
  it("writebackType groups the 2.4 alerts' write-back rows", () => {
    expect(writebackTypeGroups(rows, sets, C)).toEqual([
      { group: "delivery_block_removed", count: 1 },
      { group: "delivery_tolerance_corrected", count: 1 },
    ]);
  });
  it("alertIdsByEventType restricts to the given alerts and predicate", () => {
    const byType = alertIdsByEventType(rows, isActionEvent, new Set(["A", "VA"]), C);
    expect([...byType.keys()].sort()).toEqual(["deeplink_clicked", "resolved", "snoozed"]);
    expect(ids(byType.get("resolved") ?? new Set())).toEqual(["VA"]);
  });
  it("eventTypeGroups sorts by count desc then name and is empty for no alerts", () => {
    expect(eventTypeGroups(rows, isViewedEvent, new Set(["V", "VA"]), C)).toEqual([{ group: VIEW, count: 2 }]);
    expect(eventTypeGroups(rows, isActionEvent, new Set(), C)).toEqual([]);
  });
});

describe("set helpers", () => {
  it("alertIdsWhere, intersect, subtract, rowsOfAlerts", () => {
    expect(ids(alertIdsWhere(rows, isViewedEvent, C))).toEqual(["V", "VA", "VAW", "VW"]);
    expect(ids(intersectIds(new Set(["a", "b"]), new Set(["b", "c"])))).toEqual(["b"]);
    expect(ids(subtractIds(new Set(["a", "b"]), new Set(["b", "c"])))).toEqual(["a"]);
    expect(rowsOfAlerts(rows, null)).toBe(rows);
    expect(rowsOfAlerts(rows, new Set(["U"]))).toEqual([rows[13]]);
  });
});
