import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../../config/metrics";
import { sortEvents } from "../../../compute/eventPredicates";
import { ALERTS } from "../../../source/fake/fixtureAlerts";
import { FIXTURE_APP_ID, FIXTURE_CONFIG, FIXTURE_NOW, FIXTURES } from "../../../source/fake/fixtures";

const { EVENT_TYPES, PIPELINE_EVENTS_START } = METRICS_CONFIG;

describe("fixture dataset invariants (instructions §11)", () => {
  it("has the documented size", () => {
    expect(FIXTURES.items).toHaveLength(40);
    expect(ALERTS).toHaveLength(70);
    expect(FIXTURES.openAlerts).toHaveLength(48);
    expect(FIXTURES.risk).toHaveLength(30);
    // One event per ALERTS script token: 164 (lead note L3: fewer than the ~300 of instructions §11, accepted).
    expect(FIXTURES.events).toHaveLength(164);
  });

  it("has no opened/closed event before PIPELINE_EVENTS_START and no event after now", () => {
    const lifecycle = FIXTURES.events.filter((e) => e.eventType === EVENT_TYPES.opened || e.eventType === EVENT_TYPES.closed);
    expect(lifecycle.filter((e) => e.eventTimestamp.slice(0, 10) < PIPELINE_EVENTS_START)).toEqual([]);
    expect(FIXTURES.events.filter((e) => Date.parse(e.eventTimestamp) > FIXTURE_NOW.getTime())).toEqual([]);
  });

  it("keeps AlertOrderFulfillment = alerts whose latest lifecycle event is not closed", () => {
    const byAlert = new Map<string, string>();
    for (const e of sortEvents(FIXTURES.events, METRICS_CONFIG)) {
      if (e.eventType === EVENT_TYPES.opened || e.eventType === EVENT_TYPES.closed) byAlert.set(e.riskAlertId, e.eventType);
    }
    const expectedOpen = ALERTS.map((a) => a[0]).filter((id) => byAlert.get(id) !== EVENT_TYPES.closed);
    expect(FIXTURES.openAlerts.map((a) => a.riskAlertId)).toEqual(expectedOpen);
  });

  it("links every alert and risk row to an existing item; risk rows only for open items", () => {
    const items = new Map(FIXTURES.items.map((i) => [i.salesOrderId, i]));
    expect(FIXTURES.openAlerts.every((a) => items.has(a.salesOrderId))).toBe(true);
    expect(FIXTURES.events.every((e) => e.salesOrderId !== null && items.has(e.salesOrderId))).toBe(true);
    expect(FIXTURES.risk.every((r) => items.get(r.salesOrderId)?.isOpen === true)).toBe(true);
  });

  it("has unique primary keys", () => {
    const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;
    expect(unique(FIXTURES.events.map((e) => e.historyEventId))).toBe(true);
    expect(unique(FIXTURES.items.map((i) => i.salesOrderId))).toBe(true);
    expect(unique(FIXTURES.verdicts.map((v) => v.otifOrderId))).toBe(true);
  });

  it("overrides the integration placeholders in FIXTURE_CONFIG only", () => {
    expect(FIXTURE_CONFIG.ALERT_APP_ID).toBe(FIXTURE_APP_ID);
    expect(FIXTURE_CONFIG.VERDICT_DATE_PROPERTY).not.toBe(METRICS_CONFIG.PLACEHOLDER);
    expect({ ...FIXTURE_CONFIG, ALERT_APP_ID: 0, VERDICT_DATE_PROPERTY: 0 }).toEqual({
      ...METRICS_CONFIG,
      ALERT_APP_ID: 0,
      VERDICT_DATE_PROPERTY: 0,
    });
  });

  it("encodes the documented edge cases", () => {
    const ev = (id: string) => FIXTURES.events.filter((e) => e.riskAlertId === id);
    // A13: view at its opened build stamp (tie). A44: view at its closed build stamp.
    expect(new Set(ev("A13").map((e) => e.eventTimestamp)).size).toBe(1);
    expect(ev("A44")[1].eventTimestamp).toBe(ev("A44")[2].eventTimestamp);
    // A55: attributes change between the opened and closed events.
    expect(ev("A55").map((e) => [e.eventType, e.persona, e.priorityAtEvent])).toEqual([
      ["opened", "Planner", "High"],
      ["opened_by_user", "CustomerService", "High"],
      ["closed", "Logistics", "Medium"],
    ]);
    // A59: opened exactly at the 7-day window start.
    expect(ev("A59")[0].eventTimestamp).toBe("2026-08-25T12:00:00.000Z");
    // A32: raised before the pipeline start (no opened event), viewed 120 days ago.
    expect(ev("A32").map((e) => e.eventType)).toEqual(["opened_by_user", "status_changed"]);
  });
});
