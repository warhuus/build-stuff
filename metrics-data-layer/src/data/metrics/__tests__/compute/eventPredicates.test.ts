import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import {
  compareEvents,
  compareTimestamps,
  isActionEvent,
  isClosedEvent,
  isHumanEvent,
  isLifecycleEvent,
  isOpenedEvent,
  isViewedEvent,
  isWritebackEvent,
  matchesAnyPredicate,
  matchesPredicate,
  sortEvents,
  tieRankOf,
  timestampMs,
} from "../../compute/eventPredicates";
import type { EventPredicate } from "../../query/specs";

const C = METRICS_CONFIG;
const ev = (eventType: string, eventSource: string | null, eventTimestamp = "2026-06-01T00:00:00Z") => ({
  eventType,
  eventSource,
  eventTimestamp,
});

const view = ev("opened_by_user", "user view");
const resolved = ev("resolved", "user");
const userAction = ev("snoozed", "user action");
const plainAction = ev("escalated", "action");
const deeplink = ev("deeplink_clicked", "user deeplink");
const deeplinkNoSource = ev("deeplink_clicked", null);
const updatedByUser = ev("updated", "user");
const writeback = ev("delivery_block_removed", "user");
const writebackPipeline = ev("allocation_rejection_lifted", "pipeline");
const opened = ev("opened", "pipeline");
const closed = ev("closed", "pipeline");
const agent = ev("transitioned", "agent");
const nullSource = ev("resolved", null);

describe("spec §4 named predicates", () => {
  it("viewed_event is eventType opened_by_user only", () => {
    expect(isViewedEvent(view, C)).toBe(true);
    expect(isViewedEvent(resolved, C)).toBe(false);
  });

  it("a view is not an action (eventSource user view)", () => {
    expect(isActionEvent(view, C)).toBe(false);
  });

  it("action_event: user / user action / action sources, or deeplink_clicked", () => {
    for (const e of [resolved, userAction, plainAction, deeplink, deeplinkNoSource]) {
      expect(isActionEvent(e, C)).toBe(true);
    }
    expect(isActionEvent(agent, C)).toBe(false);
    expect(isActionEvent(nullSource, C)).toBe(false);
    expect(isActionEvent(opened, C)).toBe(false);
  });

  it("action_event excludes eventType updated even from a user source (W1)", () => {
    expect(isActionEvent(updatedByUser, C)).toBe(false);
    expect(isHumanEvent(updatedByUser, C)).toBe(false);
  });

  it("writeback_event is one of the three ERP types whatever the source", () => {
    expect(isWritebackEvent(writeback, C)).toBe(true);
    expect(isWritebackEvent(writebackPipeline, C)).toBe(true);
    expect(isWritebackEvent(ev("delivery_tolerance_corrected", "user"), C)).toBe(true);
    expect(isWritebackEvent(resolved, C)).toBe(false);
  });

  it("human = viewed OR action OR writeback", () => {
    expect(isHumanEvent(view, C)).toBe(true);
    expect(isHumanEvent(resolved, C)).toBe(true);
    expect(isHumanEvent(writebackPipeline, C)).toBe(true);
    expect(isHumanEvent(opened, C)).toBe(false);
    expect(isHumanEvent(agent, C)).toBe(false);
  });

  it("opened / closed / lifecycle", () => {
    expect(isOpenedEvent(opened, C)).toBe(true);
    expect(isOpenedEvent(closed, C)).toBe(false);
    expect(isClosedEvent(closed, C)).toBe(true);
    expect(isLifecycleEvent(opened, C)).toBe(true);
    expect(isLifecycleEvent(closed, C)).toBe(true);
    expect(isLifecycleEvent(view, C)).toBe(false);
  });
});

describe("matchesPredicate / matchesAnyPredicate", () => {
  const cases: [EventPredicate, typeof view, boolean][] = [
    ["viewed", view, true],
    ["action", resolved, true],
    ["action", view, false],
    ["writeback", writeback, true],
    ["human", view, true],
    ["human", opened, false],
    ["opened", opened, true],
    ["closed", closed, true],
    ["lifecycle", closed, true],
    ["lifecycle", view, false],
  ];
  it.each(cases)("%s on %o → %s", (predicate, event, expected) => {
    expect(matchesPredicate(predicate, event, C)).toBe(expected);
  });
  it("ORs a list of predicates; empty matches nothing", () => {
    expect(matchesAnyPredicate(["opened", "human"], view, C)).toBe(true);
    expect(matchesAnyPredicate(["opened", "closed"], view, C)).toBe(false);
    expect(matchesAnyPredicate([], view, C)).toBe(false);
  });
});

describe("tie order and comparators (spec §4)", () => {
  it("ranks opened < human < closed; other events rank with human", () => {
    expect(tieRankOf(opened, C)).toBeLessThan(tieRankOf(view, C));
    expect(tieRankOf(view, C)).toBeLessThan(tieRankOf(closed, C));
    expect(tieRankOf(agent, C)).toBe(tieRankOf(view, C));
  });

  it("compares timestamps by instant, not string", () => {
    expect(compareTimestamps("2026-06-01T01:00:00Z", "2026-06-01T01:00:00.000+00:00")).toBe(0);
    expect(compareTimestamps("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z")).toBeLessThan(0);
    expect(timestampMs("1970-01-01T00:00:01Z")).toBe(1000);
  });

  it("orders by time first, then opened, human, closed at an equal timestamp", () => {
    const t = "2026-06-01T10:00:00Z";
    const earlierClosed = ev("closed", "pipeline", "2026-06-01T09:00:00Z");
    const sorted = sortEvents([ev("closed", "pipeline", t), ev("opened_by_user", "user view", t), ev("opened", "pipeline", t), earlierClosed], C);
    expect(sorted.map((e) => e.eventType)).toEqual(["closed", "opened", "opened_by_user", "closed"]);
    expect(sorted[0]).toBe(earlierClosed);
    expect(compareEvents(view, view, C)).toBe(0);
  });

  it("sortEvents does not mutate its input", () => {
    const input = [closed, opened];
    sortEvents(input, C);
    expect(input).toEqual([closed, opened]);
  });
});
