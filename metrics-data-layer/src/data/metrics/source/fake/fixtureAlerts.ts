/**
 * Fixture alerts (instructions §11): 70 alerts whose AlertHistory events and AlertOrderFulfillment rows are
 * generated from one readable line each. Hand-check expected outputs from the ALERTS table below.
 *
 * Legend (FIXTURE_NOW = 2026-09-01T12:00:00.000Z; window starts are at 12:00 UTC N days back):
 *   `@d`      = N days before 2026-09-01 at 06:00Z (a pipeline build stamp: all pipeline events of day d share it)
 *   `@d:hh`   = N days before 2026-09-01 at hh:00Z. `@7:12` is exactly the 7-day window start (inclusive).
 *   windows:  7 d ⇔ d < 7 (or @7:12+); 14 d ⇔ d < 14; 30 d ⇔ d < 30; 90 d ⇔ d < 90; now = everything.
 *   Pipeline start 2026-05-15 = @109: no op/cl token is older than that; human tokens may be (d ≥ 110).
 * Tokens (eventType / eventSource / eventActor):
 *   op  opened / pipeline / pipeline            cl  closed / pipeline / pipeline
 *   vw  opened_by_user / user view / user       (viewed; human; NOT an action)
 *   ac  status_changed / user action / user     rs  resolved / user / user      es  escalated / action / user
 *   dl  deeplink_clicked / user deeplink / user (action through eventType)
 *   wb  delivery_block_removed / user / user    wt  delivery_tolerance_corrected  wr  allocation_rejection_lifted
 *       (write-backs; also actions because eventSource "user")
 *   up  updated / action / automation (NOT human: excluded from action)   ag  comment / agent / agent-7 (not human)
 * Human events: persona = the user's queue filter (u1 Planner, u2 All, u3 CustomerService, u4 All,
 * u5 Logistics, u6 null); riskType / priorityAtEvent = the alert's. Pipeline events: persona = routing persona.
 * Items: `I<n>` = salesOrderId `${1000 + n}_10` (see fixtures.ts). Status O = open now (row in AOF), C = closed.
 * `esc` is the AOF `escalated` flag (open alerts only; null = unknown).
 *
 * Groups: A01–A08 open untouched (A08 only `up`) · A09–A14 open viewed only (A13 view tied with its build
 * stamp) · A15–A20 open viewed + acted · A21–A24 open acted without view (A24 agent-only = untouched) ·
 * A25–A28 open write-back (A27 write-back without view) · A29–A31 reopened (op, cl, op → open) ·
 * A32–A34 open, raised before the pipeline start (no op) · A35–A41 closed not worked (A40 no op; A41 op and
 * cl at the same stamp) · A42–A45 closed viewed only (A44 view at the close stamp) · A46–A49 closed acted
 * (A47 without view) · A50–A52 closed write-back (A51 without view) · A53 closed then viewed (close before
 * view) · A54 closed then acted (human only after closure) · A55 closed, attrs change Planner/High (op) →
 * Logistics/Medium (cl) · A56 closed, raised before pipeline start, viewed before it · A57–A70 more open alerts.
 */
import {
  ACTION_EVENT_SOURCES,
  EVENT_TYPES,
  PIPELINE_EVENT_SOURCE,
  VIEW_EVENT_SOURCE,
} from "../../../../config/metrics";
import type { FixtureEvent, FixtureOpenAlert } from "./fakeTypes";

/** One alert line: id, item number, routing persona, alert type, priority, escalated, status, script. */
type AlertLine = readonly [string, number, string, string, string, boolean | null, "O" | "C", string];

/** Closed-event attributes that differ from the opened event (A55 only): [persona, priority]. */
const CLOSED_ATTRS: Readonly<Record<string, readonly [string, string]>> = { A55: ["Logistics", "Medium"] };

/** The fixture alerts. Columns: id, item, routing persona, alert type, priority, esc, status, events. */
export const ALERTS: readonly AlertLine[] = [
  ["A01", 1, "Planner", "LateGI", "High", false, "O", "op@2"],
  ["A02", 2, "Logistics", "CreditBlock", "Medium", false, "O", "op@12"],
  ["A03", 3, "CustomerService", "Allocation", "Low", true, "O", "op@25"],
  ["A04", 4, "Planner", "LateGI", "Urgent", false, "O", "op@60"],
  ["A05", 5, "Logistics", "LateGI", "Unclassified", false, "O", "op@1"],
  ["A06", 6, "Planner", "Allocation", "High", null, "O", "op@3"],
  ["A07", 7, "CustomerService", "CreditBlock", "Medium", false, "O", "op@100"],
  ["A08", 8, "Planner", "LateGI", "Low", false, "O", "op@0 up@0:08"],
  ["A09", 9, "Planner", "LateGI", "High", false, "O", "op@3 vw:u1@2:09"],
  ["A10", 10, "Logistics", "CreditBlock", "Medium", true, "O", "op@10 vw:u2@9:10"],
  ["A11", 11, "CustomerService", "Allocation", "Low", false, "O", "op@20 vw:u1@18:10 vw:u3@5:10"],
  ["A12", 12, "Planner", "LateGI", "Urgent", false, "O", "op@40 vw:u2@35:10"],
  ["A13", 13, "Logistics", "LateGI", "High", false, "O", "op@1 vw:u4@1"],
  ["A14", 14, "Planner", "CreditBlock", "Medium", true, "O", "op@95 vw:u1@92:10"],
  ["A15", 15, "Planner", "LateGI", "High", false, "O", "op@6 vw:u1@5:09 ac:u1@5:10"],
  ["A16", 16, "Logistics", "Allocation", "Medium", false, "O", "op@13 vw:u2@12:09 rs:u2@11:09"],
  ["A17", 17, "CustomerService", "CreditBlock", "Low", true, "O", "op@28 vw:u3@27:09 dl:u3@27:10"],
  ["A18", 18, "Planner", "LateGI", "Urgent", false, "O", "op@50 vw:u1@48:09 ac:u5@3:09"],
  ["A19", 19, "Logistics", "LateGI", "Unclassified", false, "O", "op@2 vw:u2@1:09 ac:u2@1:10 up@1:11"],
  ["A20", 20, "Planner", "CreditBlock", "High", false, "O", "op@70 vw:u6@65:09 es:u6@65:10"],
  ["A21", 21, "CustomerService", "Allocation", "Medium", false, "O", "op@4 ac:u3@3:09"],
  ["A22", 22, "Planner", "LateGI", "Low", true, "O", "op@16 dl:u4@15:09"],
  ["A23", 23, "Logistics", "CreditBlock", "High", false, "O", "op@35 rs:u5@33:09"],
  ["A24", 24, "Planner", "Allocation", "Urgent", false, "O", "op@5 ag@4:09"],
  ["A25", 25, "Planner", "LateGI", "High", false, "O", "op@5 vw:u1@4:09 ac:u1@4:10 wb:u1@4:11"],
  ["A26", 26, "Logistics", "Allocation", "Medium", true, "O", "op@12 vw:u2@11:09 wt:u2@11:10"],
  ["A27", 9, "CustomerService", "CreditBlock", "Low", false, "O", "op@25 wr:u3@24:09"],
  ["A28", 16, "Planner", "LateGI", "Urgent", false, "O", "op@80 vw:u4@75:09 ac:u4@75:10 wb:u4@10:09"],
  ["A29", 29, "Planner", "LateGI", "High", false, "O", "op@30 cl@20 op@10 vw:u1@9:09"],
  ["A30", 20, "Logistics", "CreditBlock", "Medium", false, "O", "op@60 vw:u2@59:09 cl@40 op@3"],
  ["A31", 1, "CustomerService", "Allocation", "Low", true, "O", "op@8 cl@6 op@2"],
  ["A32", 2, "Planner", "LateGI", "High", false, "O", "vw:u1@120:09 ac:u1@5:09"],
  ["A33", 3, "Logistics", "Allocation", "Medium", false, "O", "vw:u2@200:09"],
  ["A34", 4, "CustomerService", "CreditBlock", "Low", false, "O", "up@50:09"],
  ["A35", 31, "Planner", "LateGI", "High", null, "C", "op@10 cl@2"],
  ["A36", 32, "Logistics", "CreditBlock", "Medium", null, "C", "op@20 cl@5"],
  ["A37", 33, "CustomerService", "Allocation", "Low", null, "C", "op@15 cl@12"],
  ["A38", 34, "Planner", "LateGI", "Urgent", null, "C", "op@40 cl@25"],
  ["A39", 35, "Logistics", "LateGI", "Unclassified", null, "C", "op@100 cl@60"],
  ["A40", 36, "CustomerService", "CreditBlock", "High", null, "C", "cl@6"],
  ["A41", 37, "Planner", "Allocation", "Medium", null, "C", "op@9 cl@9 up@8:09"],
  ["A42", 38, "Planner", "LateGI", "High", null, "C", "op@12 vw:u1@11:09 cl@4"],
  ["A43", 39, "Logistics", "CreditBlock", "Medium", null, "C", "op@30 vw:u2@29:09 cl@20"],
  ["A44", 40, "CustomerService", "Allocation", "Low", null, "C", "op@8 vw:u3@6 cl@6"],
  ["A45", 31, "Planner", "LateGI", "Low", null, "C", "op@70 vw:u4@69:09 cl@50"],
  ["A46", 32, "Logistics", "LateGI", "High", null, "C", "op@6 vw:u2@5:09 ac:u2@5:10 cl@3"],
  ["A47", 33, "Planner", "CreditBlock", "Urgent", null, "C", "op@18 ac:u1@17:09 cl@11"],
  ["A48", 34, "CustomerService", "Allocation", "Medium", null, "C", "op@45 vw:u3@44:09 dl:u3@44:10 cl@32"],
  ["A49", 10, "Logistics", "LateGI", "Low", null, "C", "op@5 vw:u5@4:09 ac:u5@4:10 cl@1"],
  ["A50", 11, "Planner", "LateGI", "High", null, "C", "op@9 vw:u1@8:09 ac:u1@8:10 wb:u1@8:11 cl@2"],
  ["A51", 12, "Logistics", "Allocation", "Medium", null, "C", "op@20 wt:u2@19:09 cl@15"],
  ["A52", 35, "CustomerService", "CreditBlock", "Low", null, "C", "op@60 vw:u6@58:09 wr:u6@58:10 cl@55"],
  ["A53", 36, "Planner", "LateGI", "Medium", null, "C", "op@10 cl@8 vw:u1@5:09"],
  ["A54", 13, "Logistics", "CreditBlock", "High", null, "C", "op@14 cl@13 ac:u2@3:09"],
  ["A55", 14, "Planner", "LateGI", "High", null, "C", "op@9 vw:u3@8:09 cl@4"],
  ["A56", 15, "CustomerService", "LateGI", "Medium", null, "C", "vw:u4@130:09 cl@100"],
  ["A57", 16, "Planner", "LateGI", "High", false, "O", "op@1"],
  ["A58", 17, "Logistics", "CreditBlock", "Medium", false, "O", "op@1 vw:u2@0:09"],
  ["A59", 18, "CustomerService", "Allocation", "Low", true, "O", "op@7:12"],
  ["A60", 19, "Planner", "LateGI", "Urgent", false, "O", "op@20 vw:u1@19:09 ac:u1@19:10"],
  ["A61", 20, "Logistics", "LateGI", "High", false, "O", "op@22"],
  ["A62", 21, "CustomerService", "CreditBlock", "Medium", false, "O", "op@33 vw:u3@1:09"],
  ["A63", 22, "Planner", "Allocation", "Low", false, "O", "op@44 es:u6@43:09"],
  ["A64", 23, "Logistics", "LateGI", "Unclassified", false, "O", "op@55"],
  ["A65", 24, "CustomerService", "LateGI", "High", true, "O", "op@66 vw:u5@2:09"],
  ["A66", 25, "Planner", "CreditBlock", "Medium", false, "O", "op@77"],
  ["A67", 26, "Logistics", "Allocation", "Low", false, "O", "op@88 vw:u2@87:09"],
  ["A68", 5, "Planner", "LateGI", "High", false, "O", "op@1"],
  ["A69", 6, "CustomerService", "CreditBlock", "Medium", false, "O", "op@11 vw:u3@10:09"],
  ["A70", 7, "Logistics", "Allocation", "Urgent", false, "O", "op@2 dl:u4@1:09"],
];

/** Fixture salesOrderId of item number `n` (1..40). */
export const itemId = (n: number): string => `${1000 + n}_10`;

/** ISO timestamp `days` before 2026-09-01 at `hour`:00 UTC (fixture clock; see the legend). */
export const fixtureTime = (days: number, hour = 6): string =>
  new Date(Date.UTC(2026, 8, 1 - days, hour)).toISOString();

/** Queue filter (human-event persona) per fixture user. */
const QUEUE_FILTER: Readonly<Record<string, string | null>> = {
  u1: "Planner",
  u2: "All",
  u3: "CustomerService",
  u4: "All",
  u5: "Logistics",
  u6: null,
};

const [USER_SOURCE, USER_ACTION_SOURCE, ACTION_SOURCE] = ACTION_EVENT_SOURCES;
const [WB_BLOCK, WB_TOLERANCE, WB_ALLOCATION] = EVENT_TYPES.writeback;

/** Token kind → [eventType, eventSource, actor or null for the user]. */
const TOKEN_KINDS: Readonly<Record<string, readonly [string, string, string | null]>> = {
  op: [EVENT_TYPES.opened, PIPELINE_EVENT_SOURCE, PIPELINE_EVENT_SOURCE],
  cl: [EVENT_TYPES.closed, PIPELINE_EVENT_SOURCE, PIPELINE_EVENT_SOURCE],
  vw: [EVENT_TYPES.viewed, VIEW_EVENT_SOURCE, null],
  ac: ["status_changed", USER_ACTION_SOURCE, null],
  rs: ["resolved", USER_SOURCE, null],
  es: ["escalated", ACTION_SOURCE, null],
  dl: [EVENT_TYPES.deeplink, "user deeplink", null],
  wb: [WB_BLOCK, USER_SOURCE, null],
  wt: [WB_TOLERANCE, USER_SOURCE, null],
  wr: [WB_ALLOCATION, USER_SOURCE, null],
  up: [EVENT_TYPES.updated, ACTION_SOURCE, "automation"],
  ag: ["comment", "agent", "agent-7"],
};

/** Parses one token (`kind[:user]@days[:hour]`) of alert `line` into an AlertHistory row. */
function eventOf(line: AlertLine, token: string, index: number): FixtureEvent {
  const [id, item, persona, riskType, priority] = line;
  const [head, when] = token.split("@");
  const [kind, user] = head.split(":");
  const [days, hour] = when.split(":").map(Number);
  const [eventType, eventSource, actor] = TOKEN_KINDS[kind];
  const pipeline = eventSource === PIPELINE_EVENT_SOURCE;
  const changed = kind === "cl" ? CLOSED_ATTRS[id] : undefined;
  const human = actor === null;
  return {
    historyEventId: `${id}-E${String(index + 1).padStart(2, "0")}`,
    riskAlertId: id,
    salesOrderId: itemId(item),
    eventType,
    eventSource,
    eventActor: human ? user : actor,
    eventTimestamp: fixtureTime(days, hour ?? 6),
    persona: pipeline ? (changed?.[0] ?? persona) : human ? QUEUE_FILTER[user] : null,
    riskType,
    priorityAtEvent: pipeline || human ? (changed?.[1] ?? priority) : null,
  };
}

/** Every AlertHistory row of the fixture alerts, in ALERTS order then script order. */
export const FIXTURE_EVENTS: readonly FixtureEvent[] = ALERTS.flatMap((line) =>
  line[7].split(" ").map((token, i) => eventOf(line, token, i)),
);

/** AlertOrderFulfillment rows: the alerts with status O (open now). */
export const FIXTURE_OPEN_ALERTS: readonly FixtureOpenAlert[] = ALERTS.filter((l) => l[6] === "O").map(
  ([riskAlertId, item, persona, riskType, priority, escalated]) => ({
    riskAlertId,
    salesOrderId: itemId(item),
    persona,
    priority,
    riskType,
    escalated,
  }),
);
