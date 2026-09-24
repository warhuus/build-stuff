import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import {
  NULL_ALERT_ATTRS,
  alertAttrsOf,
  alertFactsForIds,
  alertFactsOf,
  attrsEventOf,
  closureGroupOf,
  groupEventsByAlert,
} from "../../compute/alertLifecycle";
import type { AlertEventRow } from "../../types";

const C = METRICS_CONFIG;
const T = (hour: number, day = 1) => `2026-06-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

function ev(eventType: string, eventTimestamp: string, extra: Partial<AlertEventRow> = {}): AlertEventRow {
  const pipeline = eventType === "opened" || eventType === "closed";
  return {
    riskAlertId: "A1",
    salesOrderId: "SO1_10",
    eventType,
    eventSource: pipeline ? "pipeline" : eventType === "opened_by_user" ? "user view" : "user",
    eventTimestamp,
    persona: pipeline ? "Planner" : "QueueFilterX",
    riskType: pipeline ? "Late supply" : "HumanType",
    priorityAtEvent: pipeline ? "High" : "HumanPrio",
    ...extra,
  };
}

describe("alertFactsOf (spec §9.0.1, Appendix A W6)", () => {
  it("raisedAt = min opened, closedAt = max closed, closed when not open now", () => {
    const events = [ev("opened", T(5)), ev("opened", T(3)), ev("closed", T(8)), ev("closed", T(12)), ev("opened", T(9))];
    const facts = alertFactsOf("A1", events, false, C);
    expect(facts.raisedAt).toBe(T(3));
    expect(facts.closedAt).toBe(T(12));
    expect(facts.isClosed).toBe(true);
    expect(facts.worked).toBe(false);
    expect(facts.closureGroup).toBe("noHuman");
    expect(facts.firstViewAt).toBeNull();
    expect(facts.firstActionAt).toBeNull();
    expect(facts.firstWritebackAt).toBeNull();
  });

  it("closedAt = max closed regardless of input order", () => {
    expect(alertFactsOf("A1", [ev("closed", T(12)), ev("closed", T(8))], false, C).closedAt).toBe(T(12));
  });

  it("reopened alert (has closed but open now) → isClosed false, closureGroup null", () => {
    const events = [ev("opened", T(1)), ev("closed", T(2)), ev("opened", T(3)), ev("opened_by_user", T(4))];
    const facts = alertFactsOf("A1", events, true, C);
    expect(facts.closedAt).toBe(T(2));
    expect(facts.isClosed).toBe(false);
    expect(facts.closureGroup).toBeNull();
    expect(facts.worked).toBe(true);
  });

  it("alert without an opened event (raised before PIPELINE_EVENTS_START) → raisedAt null", () => {
    const facts = alertFactsOf("A1", [ev("opened_by_user", T(1)), ev("closed", T(2))], false, C);
    expect(facts.raisedAt).toBeNull();
    expect(facts.isClosed).toBe(true);
    expect(facts.closureGroup).toBe("viewOnly");
  });

  it("first view / action / write-back over all events given (all-time, any order)", () => {
    const events = [
      ev("resolved", T(9, 3)),
      ev("opened_by_user", T(7, 2)),
      ev("opened_by_user", T(1, 2)),
      ev("delivery_block_removed", T(4, 4)),
      ev("snoozed", T(2, 3)),
      ev("opened", T(0, 1)),
    ];
    const facts = alertFactsOf("A1", events, true, C);
    expect(facts.firstViewAt).toBe(T(1, 2));
    expect(facts.firstActionAt).toBe(T(2, 3));
    expect(facts.firstWritebackAt).toBe(T(4, 4));
    expect(facts.worked).toBe(true);
  });

  it("an updated event is not human and does not make the alert worked", () => {
    const facts = alertFactsOf("A1", [ev("opened", T(1)), ev("updated", T(2))], true, C);
    expect(facts.worked).toBe(false);
    expect(facts.firstActionAt).toBeNull();
  });

  it("ignores events of other alerts", () => {
    const facts = alertFactsOf("A1", [ev("opened", T(1)), ev("opened", T(0), { riskAlertId: "A2" })], true, C);
    expect(facts.raisedAt).toBe(T(1));
  });

  it("tie rule: a view at the closed timestamp counts before closure", () => {
    const facts = alertFactsOf("A1", [ev("opened", T(1)), ev("closed", T(5)), ev("opened_by_user", T(5))], false, C);
    expect(facts.closureGroup).toBe("viewOnly");
  });

  it("closure before first view: view after closedAt ignored for the group, still first view", () => {
    const facts = alertFactsOf("A1", [ev("opened", T(1)), ev("closed", T(5)), ev("opened_by_user", T(6))], false, C);
    expect(facts.closureGroup).toBe("noHuman");
    expect(facts.firstViewAt).toBe(T(6));
    expect(facts.worked).toBe(true);
  });

  it("attrs come from the latest pipeline event, not a human event", () => {
    const events = [
      ev("opened", T(1), { persona: "P-open", riskType: "R-open", priorityAtEvent: "Low" }),
      ev("opened_by_user", T(2)),
      ev("closed", T(3), { persona: "P-close1", riskType: "R1", priorityAtEvent: "Medium" }),
      ev("closed", T(4), { persona: "P-close2", riskType: "R2", priorityAtEvent: "Urgent" }),
      ev("resolved", T(5)),
    ];
    expect(alertFactsOf("A1", events, false, C).attrs).toEqual({ routingPersona: "P-close2", alertType: "R2", priority: "Urgent" });
    // open now → latest opened event
    expect(alertFactsOf("A1", events, true, C).attrs).toEqual({ routingPersona: "P-open", alertType: "R-open", priority: "Low" });
  });

  it("no pipeline event → null attrs, salesOrderId from the human events", () => {
    const facts = alertFactsOf("A1", [ev("opened_by_user", T(2), { salesOrderId: "SO9_10" })], true, C);
    expect(facts.attrs).toEqual(NULL_ALERT_ATTRS);
    expect(facts.salesOrderId).toBe("SO9_10");
  });

  it("salesOrderId prefers the attrs event, else the earliest non-null, else null", () => {
    const withIds = [ev("opened_by_user", T(1), { salesOrderId: "SO_H" }), ev("opened", T(2), { salesOrderId: "SO_P" })];
    expect(alertFactsOf("A1", withIds, true, C).salesOrderId).toBe("SO_P");
    const nullOnPipeline = [ev("opened", T(2), { salesOrderId: null }), ev("resolved", T(3), { salesOrderId: "SO_R" }), ev("resolved", T(1), { salesOrderId: "SO_E" })];
    expect(alertFactsOf("A1", nullOnPipeline, true, C).salesOrderId).toBe("SO_E");
    expect(alertFactsOf("A1", [ev("opened", T(2), { salesOrderId: null })], true, C).salesOrderId).toBeNull();
  });

  it("no events at all → empty facts", () => {
    expect(alertFactsOf("A9", [], false, C)).toEqual({
      riskAlertId: "A9",
      salesOrderId: null,
      raisedAt: null,
      closedAt: null,
      isClosed: false,
      firstViewAt: null,
      firstActionAt: null,
      firstWritebackAt: null,
      worked: false,
      closureGroup: null,
      attrs: NULL_ALERT_ATTRS,
    });
  });
});

describe("attrsEventOf", () => {
  it("open alert without opened event falls back to its latest closed event", () => {
    const closed = ev("closed", T(3), { persona: "P-c" });
    expect(attrsEventOf([ev("resolved", T(1)), closed], false, C)).toBe(closed);
    expect(alertAttrsOf([closed], false, C).routingPersona).toBe("P-c");
  });
  it("closed alert uses the latest closed event; a later one in input order wins a full tie", () => {
    const first = ev("closed", T(3), { persona: "first" });
    const second = ev("closed", T(3), { persona: "second" });
    expect(attrsEventOf([first, second, ev("opened", T(9))], true, C)).toBe(second);
  });
  it("returns null without pipeline events", () => {
    expect(attrsEventOf([ev("resolved", T(1))], true, C)).toBeNull();
  });
});

describe("closureGroupOf (spec §9 4.6)", () => {
  const closedAt = T(10);
  it("null when not closed", () => {
    expect(closureGroupOf([ev("delivery_block_removed", T(1))], null, C)).toBeNull();
  });
  it("write-back beats action beats view", () => {
    const all = [ev("opened_by_user", T(1)), ev("resolved", T(2)), ev("delivery_block_removed", T(3))];
    expect(closureGroupOf(all, closedAt, C)).toBe("writeBack");
    expect(closureGroupOf(all.slice(0, 2), closedAt, C)).toBe("action");
    expect(closureGroupOf(all.slice(0, 1), closedAt, C)).toBe("viewOnly");
    expect(closureGroupOf([], closedAt, C)).toBe("noHuman");
  });
  it("events after closedAt are ignored; equal timestamp counts", () => {
    const events = [ev("opened_by_user", T(9)), ev("resolved", T(10)), ev("delivery_block_removed", T(11))];
    expect(closureGroupOf(events, closedAt, C)).toBe("action");
  });
  it("non-human events never count (updated, pipeline)", () => {
    expect(closureGroupOf([ev("updated", T(1)), ev("opened", T(1))], closedAt, C)).toBe("noHuman");
  });
});

describe("groupEventsByAlert / alertFactsForIds", () => {
  const rows = [
    ev("opened", T(1), { riskAlertId: "B" }),
    ev("opened", T(2), { riskAlertId: "A" }),
    ev("closed", T(3), { riskAlertId: "B" }),
  ];
  it("groups by riskAlertId in first-appearance order", () => {
    const grouped = groupEventsByAlert(rows);
    expect([...grouped.keys()]).toEqual(["B", "A"]);
    expect(grouped.get("B")).toEqual([rows[0], rows[2]]);
    expect(groupEventsByAlert([]).size).toBe(0);
  });
  it("builds facts per id, de-duplicated, open-now from the set, missing ids empty", () => {
    const facts = alertFactsForIds(["B", "A", "B", "Z"], rows, new Set(["A"]), C);
    expect(facts.map((f) => f.riskAlertId)).toEqual(["B", "A", "Z"]);
    expect(facts[0].isClosed).toBe(true);
    expect(facts[1].isClosed).toBe(false);
    expect(facts[2].raisedAt).toBeNull();
  });
});
