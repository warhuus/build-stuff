// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { EventGroupField, EventPredicate, EventSet, OpenAlertCondition, RiskCondition } from "../../../query/specs";
import { whereFieldsOn } from "./recordingClient";
import { SOME_FILTERS, W7, WNOW, makeCtx, setup } from "./osdkTestUtils";

// Decision D16 (osdk F3): group-by-only properties must never appear in a where clause sent for
// AlertHistory (persona, riskType, priorityAtEvent) or OtifOrderVerdict (critClassification). Spec §3, §5 B9.
const AH_FORBIDDEN = ["persona", "riskType", "priorityAtEvent"];
const OOV_FORBIDDEN = ["critClassification"];

const PREDICATES: EventPredicate[] = ["viewed", "action", "writeback", "human", "opened", "closed", "lifecycle"];
const GROUPS: EventGroupField[] = ["queueFilter", "routingPersona", "alertType", "priority", "actionType", "writebackType"];
const CONDITIONS: OpenAlertCondition[] = [
  { field: "routingPersona", value: "P" },
  { field: "priority", value: "High" },
  { field: "escalated", value: true },
];
const RISK: RiskCondition[] = [
  { kind: "notDelayed" },
  { kind: "bucket", bucket: "unscored" },
  { kind: "bucket", bucket: "delayed" },
  { kind: "bucket", bucket: "b51_70" },
];

function eventSets(): EventSet[] {
  const byItems: EventSet = { kind: "ofItems", items: { kind: "filtered", base: { kind: "all" }, filters: SOME_FILTERS } };
  const sets: EventSet[] = PREDICATES.flatMap((p) =>
    [W7, WNOW, null].map((window): EventSet => ({ kind: "where", base: byItems, filter: { predicates: [p], window } })),
  );
  const escalated: EventSet[] = CONDITIONS.map((condition) => ({
    kind: "where",
    base: { kind: "ofOpenAlerts", alerts: { kind: "where", base: { kind: "all" }, condition } },
    filter: { predicates: ["viewed", "action", "writeback"], window: W7 },
  }));
  return [...sets, ...escalated, { kind: "subtract", a: sets[0], b: { kind: "ofOpenAlerts", alerts: { kind: "ofEvents", events: sets[1] } } }];
}

async function runEverything() {
  const t = setup();
  const ctx = makeCtx();
  for (const s of eventSets()) {
    await t.source.countEvents(s, "actor", ctx);
    for (const g of GROUPS) await t.source.countEventsBy(s, "alert", g, ctx);
    await t.source.fetchEvents(s, ctx);
    await t.source.countItems({ kind: "ofEvents", events: s }, ctx);
    await t.source.countOpenAlerts({ kind: "ofEvents", events: s }, ctx);
  }
  for (const condition of RISK) {
    await t.source.countRisk({ kind: "where", base: { kind: "ofItems", items: { kind: "ofEvents", events: eventSets()[0] } }, condition }, ctx);
  }
  for (const mode of ["otif", "crit"] as const) {
    for (const window of [W7, WNOW]) await t.source.countVerdictsBy({ mode, window }, ctx);
  }
  await t.source.fetchVerdictsByIds(["o1", "o2"], ctx);
  await t.source.fetchVerdictsByIds(["o1"], makeCtx({ VERDICT_ID_LOOKUP: "eq" }));
  return t.requests;
}

describe("group-by-only properties are never filtered (D16)", () => {
  it("no AlertHistory or OtifOrderVerdict where clause names them", async () => {
    const requests = await runEverything();
    expect(requests.length).toBeGreaterThan(250);
    const ahFields = new Set(requests.flatMap((r) => whereFieldsOn(r.body.objectSet, "AlertHistory")));
    const oovFields = new Set(requests.flatMap((r) => whereFieldsOn(r.body.objectSet, "OtifOrderVerdict")));
    expect(AH_FORBIDDEN.filter((f) => ahFields.has(f))).toEqual([]);
    expect(OOV_FORBIDDEN.filter((f) => oovFields.has(f))).toEqual([]);
    // The walker sees the fields that are filtered (guards against a vacuous pass).
    expect([...ahFields].sort()).toEqual(["eventSource", "eventTimestamp", "eventType"]);
    expect(oovFields.has("officialExclusionCrit") && oovFields.has("otifOrderId")).toBe(true);
    const aofFields = new Set(requests.flatMap((r) => whereFieldsOn(r.body.objectSet, "AlertOrderFulfillment")));
    expect(aofFields.has("persona")).toBe(true);
  });

  it("they appear only in $groupBy", async () => {
    const requests = await runEverything();
    const grouped = requests.flatMap((r) => (Array.isArray(r.body.groupBy) ? r.body.groupBy : []));
    const fields = new Set(grouped.map((g: unknown) => (typeof g === "object" && g !== null && "field" in g ? g.field : null)));
    for (const f of [...AH_FORBIDDEN, ...OOV_FORBIDDEN]) expect(fields.has(f)).toBe(true);
  });
});
