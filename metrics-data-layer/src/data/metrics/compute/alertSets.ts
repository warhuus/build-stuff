/**
 * Alert-id sets of the itemFunnel alert view, from L1 human event rows (spec §9 2.2–2.4 alert view,
 * §5 B10). Pure; event classification from `eventPredicates.ts` (decision D8).
 */
import type { MetricsConfig } from "../../../config/metrics";
import type { AlertEventRow, GroupCount } from "../types";
import { sortGroupCounts } from "./breakdown";
import { isActionEvent, isViewedEvent, isWritebackEvent } from "./eventPredicates";
import type { EventTest } from "./eventPredicates";

/**
 * The alert-view stage sets (distinct `riskAlertId`), spec §9 2.2–2.4:
 * 2.2 = viewed; 2.3 = acted ∩ viewed, outside path acted ∖ viewed; 2.4 = writtenBack ∩ stage23,
 * outside path writtenBack ∖ stage23 (always computed, Appendix A F4).
 */
export interface AlertFunnelSets {
  readonly viewed: ReadonlySet<string>;
  readonly acted: ReadonlySet<string>;
  readonly writtenBack: ReadonlySet<string>;
  readonly stage22: ReadonlySet<string>;
  readonly stage23: ReadonlySet<string>;
  readonly outside23: ReadonlySet<string>;
  readonly stage24: ReadonlySet<string>;
  readonly outside24: ReadonlySet<string>;
}

/** Distinct `riskAlertId` of the rows matching `test`. */
export function alertIdsWhere(rows: readonly AlertEventRow[], test: EventTest, config: MetricsConfig): Set<string> {
  return new Set(rows.filter((row) => test(row, config)).map((row) => row.riskAlertId));
}

/** Elements of `a` that are also in `b` (order of `a`). */
export function intersectIds(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a].filter((id) => b.has(id)));
}

/** Elements of `a` that are not in `b` (order of `a`). */
export function subtractIds(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a].filter((id) => !b.has(id)));
}

/** Rows whose alert is in `keep`; `keep` null → all rows. */
export function rowsOfAlerts(rows: readonly AlertEventRow[], keep: ReadonlySet<string> | null): readonly AlertEventRow[] {
  return keep === null ? rows : rows.filter((row) => keep.has(row.riskAlertId));
}

/**
 * Stage sets of the alert view from human event rows (L1, spec §9 2.2–2.4). `keep` restricts every set
 * to those alert ids first: the open-now alerts under `"now"`, or one breakdown group's alerts; null = no
 * restriction. A view is not an action (spec §4); a write-back row counts as written back whatever its source.
 */
export function alertFunnelSets(
  rows: readonly AlertEventRow[],
  config: MetricsConfig,
  keep: ReadonlySet<string> | null = null,
): AlertFunnelSets {
  const kept = rowsOfAlerts(rows, keep);
  const viewed = alertIdsWhere(kept, isViewedEvent, config);
  const acted = alertIdsWhere(kept, isActionEvent, config);
  const writtenBack = alertIdsWhere(kept, isWritebackEvent, config);
  const stage23 = intersectIds(acted, viewed);
  return {
    viewed,
    acted,
    writtenBack,
    stage22: viewed,
    stage23,
    outside23: subtractIds(acted, viewed),
    stage24: intersectIds(writtenBack, stage23),
    outside24: subtractIds(writtenBack, stage23),
  };
}

/**
 * Distinct alerts per `eventType` over the rows matching `test` whose alert is in `alertIds`. One alert
 * with two types is in both groups; repeated rows of one type count the alert once (spec §5 B10).
 */
export function alertIdsByEventType(
  rows: readonly AlertEventRow[],
  test: EventTest,
  alertIds: ReadonlySet<string>,
  config: MetricsConfig,
): Map<string, Set<string>> {
  const byType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!alertIds.has(row.riskAlertId) || !test(row, config)) continue;
    const ids = byType.get(row.eventType) ?? new Set<string>();
    ids.add(row.riskAlertId);
    byType.set(row.eventType, ids);
  }
  return byType;
}

/** `alertIdsByEventType` as `GroupCount[]` (alerts per type), count descending then name ascending. */
export function eventTypeGroups(
  rows: readonly AlertEventRow[],
  test: EventTest,
  alertIds: ReadonlySet<string>,
  config: MetricsConfig,
): GroupCount[] {
  const byType = alertIdsByEventType(rows, test, alertIds, config);
  return sortGroupCounts([...byType].map(([group, ids]) => ({ group, count: ids.size })));
}

/**
 * `actionType` groups on 2.3 (alert view): the action rows of the stage-2.3 alerts by `eventType`,
 * each alert once per type; non-additive with `overlap` (spec §9 2.3, §5 B10).
 */
export function actionTypeGroups(rows: readonly AlertEventRow[], sets: AlertFunnelSets, config: MetricsConfig): GroupCount[] {
  return eventTypeGroups(rows, isActionEvent, sets.stage23, config);
}

/**
 * `writebackType` groups on 2.4 (alert view): the write-back rows of the stage-2.4 alerts by `eventType`,
 * each alert once per type; non-additive with `overlap` (spec §9 2.4, §5 B10).
 */
export function writebackTypeGroups(
  rows: readonly AlertEventRow[],
  sets: AlertFunnelSets,
  config: MetricsConfig,
): GroupCount[] {
  return eventTypeGroups(rows, isWritebackEvent, sets.stage24, config);
}
