// Event predicates (spec §4) and per-alert facts (spec §9.0.1, W6): raise / close, reopen, tie rule, attrs,
// closure group precedence.
import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { alertFactsOf } from "../../compute/alertLifecycle";
import { isActionEvent, isHumanEvent } from "../../compute/eventPredicates";
import type { AlertEventRow, AlertLifecycleRow } from "../../types";

const C = METRICS_CONFIG;
const T = (hour: number) => `2026-06-01T${String(hour).padStart(2, "0")}:00:00Z`;

/** Pipeline events (opened / closed) carry pipeline attrs; the rest are user events with other attrs. */
function ev(eventType: string, hour: number, extra: Partial<AlertEventRow> = {}): AlertEventRow {
  const pipeline = eventType === "opened" || eventType === "closed";
  return {
    riskAlertId: "A1",
    salesOrderId: "SO1_10",
    eventType,
    eventSource: pipeline ? "pipeline" : eventType === "opened_by_user" ? "user view" : "user",
    eventTimestamp: T(hour),
    persona: pipeline ? "Planner" : "QueueFilterX",
    riskType: pipeline ? "Late supply" : "HumanType",
    priorityAtEvent: pipeline ? "High" : "HumanPrio",
    ...extra,
  };
}

describe("event predicates", () => {
  const e = (eventType: string, eventSource: string | null) => ({ eventType, eventSource, eventTimestamp: T(0) });
  it.each([
    ["a view is not an action", e("opened_by_user", "user view"), false, true],
    ["updated is excluded even from a user (W1)", e("updated", "user"), false, false],
    ["deeplink_clicked is an action", e("deeplink_clicked", "user deeplink"), true, true],
    ["a user write-back is an action", e("delivery_block_removed", "user"), true, true],
  ])("%s", (_, event, action, human) => {
    expect(isActionEvent(event, C)).toBe(action);
    expect(isHumanEvent(event, C)).toBe(human);
  });
});

describe("alertFactsOf", () => {
  const closure = (last: AlertEventRow[]) => [ev("opened", 1), ...last];
  const attrsEvents = [
    ev("opened", 1, { persona: "P-open", riskType: "R-open", priorityAtEvent: "Low" }),
    ev("opened_by_user", 2),
    ev("closed", 3, { persona: "P-close1", riskType: "R1", priorityAtEvent: "Medium" }),
    ev("closed", 4, { persona: "P-close2", riskType: "R2", priorityAtEvent: "Urgent" }),
    ev("resolved", 5),
  ];
  const cases: [string, AlertEventRow[], boolean, Partial<AlertLifecycleRow>][] = [
    [
      "raisedAt = min opened, closedAt = max closed",
      [ev("opened", 5), ev("opened", 3), ev("closed", 8), ev("closed", 12), ev("opened", 9)],
      false,
      { raisedAt: T(3), closedAt: T(12), isClosed: true, worked: false, closureGroup: "noHuman" },
    ],
    [
      "reopened (closed event but open now) → not closed, no group",
      [ev("opened", 1), ev("closed", 2), ev("opened", 3), ev("opened_by_user", 4)],
      true,
      { closedAt: T(2), isClosed: false, closureGroup: null, worked: true },
    ],
    [
      "no opened event (raised before pipeline start) → raisedAt null",
      [ev("opened_by_user", 1), ev("closed", 2)],
      false,
      { raisedAt: null, isClosed: true, closureGroup: "viewOnly" },
    ],
    ["tie rule: a view at the closed timestamp counts before closure", closure([ev("closed", 5), ev("opened_by_user", 5)]), false, { closureGroup: "viewOnly" }],
    [
      "precedence: write-back beats action beats view",
      closure([ev("opened_by_user", 2), ev("resolved", 3), ev("delivery_block_removed", 4), ev("closed", 10)]),
      false,
      { closureGroup: "writeBack", firstViewAt: T(2), firstActionAt: T(3), firstWritebackAt: T(4) },
    ],
    [
      "events after closure are ignored for the group (action at = closedAt counts)",
      closure([ev("opened_by_user", 9), ev("resolved", 10), ev("delivery_block_removed", 11), ev("closed", 10)]),
      false,
      { closureGroup: "action", firstWritebackAt: T(11) },
    ],
    [
      "close before first view: noHuman, but the view still sets firstViewAt and worked",
      closure([ev("closed", 5), ev("opened_by_user", 6)]),
      false,
      { closureGroup: "noHuman", firstViewAt: T(6), worked: true },
    ],
    ["attrs from the latest closed event when closed", attrsEvents, false, { attrs: { routingPersona: "P-close2", alertType: "R2", priority: "Urgent" } }],
    ["attrs from the latest opened event when open now", attrsEvents, true, { attrs: { routingPersona: "P-open", alertType: "R-open", priority: "Low" } }],
  ];
  it.each(cases)("%s", (_, events, openNow, expected) => {
    expect(alertFactsOf("A1", events, openNow, C)).toMatchObject(expected);
  });
});
