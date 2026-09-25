/**
 * Compiles the plain-data specs (`query/specs.ts`) to OSDK object sets (spec §9.0 shared code). Each set type
 * has one exhaustive switch; pivots use literal link names only (S8); set operations use the same object type.
 * Nothing here talks to the server: the returned sets are lazy until `aggregate`/`fetchPage`.
 */
import type { Client, ObjectSet } from "@osdk/client";
import type {
  AlertHistory,
  AlertOrderFulfillment,
  AlertType,
  AppUsageEvent,
  OtifOrderVerdict,
  SalesOrderOtifEvaluation,
  SalesOrders,
} from "@app/sdk";
import type { MetricsConfig } from "../../types";
import type { EventSet, ItemSet, OpenAlertSet, RiskSet, SetOp } from "../../query/specs";
import {
  buildPredicates,
  eventFilterWhere,
  itemFiltersWhere,
  openAlertWhere,
  openInWindowWhere,
  compileRiskCondition,
  type PredicateClauses,
} from "./compileWhere";

/** The object-type definitions of the generated SDK the adapter uses (`@app/sdk`, spec §3). */
export interface OsdkObjectTypes {
  readonly SalesOrders: SalesOrders;
  readonly AlertHistory: AlertHistory;
  readonly AlertOrderFulfillment: AlertOrderFulfillment;
  readonly SalesOrderOtifEvaluation: SalesOrderOtifEvaluation;
  readonly OtifOrderVerdict: OtifOrderVerdict;
  readonly AppUsageEvent: AppUsageEvent;
  readonly AlertType: AlertType;
}

/** What the compiler needs: the injected client, the SDK definitions and the config (predicate values). */
export interface CompileDeps {
  readonly client: Client;
  readonly sdk: OsdkObjectTypes;
  readonly config: MetricsConfig;
}

/** Spec → object set, one function per set type (mutually recursive through the pivots). */
export interface SpecCompiler {
  readonly items: (s: ItemSet) => ObjectSet<SalesOrders>;
  readonly events: (s: EventSet) => ObjectSet<AlertHistory>;
  readonly openAlerts: (s: OpenAlertSet) => ObjectSet<AlertOrderFulfillment>;
  readonly risk: (s: RiskSet) => ObjectSet<SalesOrderOtifEvaluation>;
}

/** Structural view of OSDK set arithmetic, so one helper serves every object type (F12). */
interface SetArithmetic<S> {
  intersect(...sets: S[]): S;
  union(...sets: S[]): S;
  subtract(...sets: S[]): S;
}

function setOp<S extends SetArithmetic<S>>(kind: SetOp<unknown>["kind"], a: S, b: S): S {
  switch (kind) {
    case "intersect":
      return a.intersect(b);
    case "union":
      return a.union(b);
    case "subtract":
      return a.subtract(b);
  }
}

/**
 * True when an item set is every item: `all`, or `filtered` with every dimension empty over such a set.
 * Pivots from it are replaced by the target object type's base set (spec §9.0 `events`, `aofSet`, `soeAll`:
 * "without filters, filter the target directly").
 */
export function isAllItems(s: ItemSet): boolean {
  if (s.kind === "all") return true;
  return s.kind === "filtered" && itemFiltersWhere(s.filters) === null && isAllItems(s.base);
}

/** Compile context: deps plus the predicate clauses built once from config. */
interface Ctx extends CompileDeps {
  readonly pred: PredicateClauses;
}

function compileItems(c: Ctx, s: ItemSet): ObjectSet<SalesOrders> {
  switch (s.kind) {
    case "all":
      return c.client(c.sdk.SalesOrders);
    case "openInWindow":
      return c.client(c.sdk.SalesOrders).where(openInWindowWhere(s.window));
    case "filtered": {
      const clause = itemFiltersWhere(s.filters);
      return clause === null ? compileItems(c, s.base) : compileItems(c, s.base).where(clause);
    }
    case "ofEvents":
      return compileEvents(c, s.events).pivotTo("salesOrder_1");
    case "ofOpenAlerts":
      return compileOpenAlerts(c, s.alerts).pivotTo("sourceSalesOrder");
    case "ofRisk":
      return compileRisk(c, s.risk).pivotTo("salesOrder");
    case "intersect":
    case "union":
    case "subtract":
      return setOp(s.kind, compileItems(c, s.a), compileItems(c, s.b));
  }
}

function compileEvents(c: Ctx, s: EventSet): ObjectSet<AlertHistory> {
  switch (s.kind) {
    case "all":
      return c.client(c.sdk.AlertHistory);
    case "ofItems":
      return isAllItems(s.items) ? c.client(c.sdk.AlertHistory) : compileItems(c, s.items).pivotTo("alertHistory");
    case "ofOpenAlerts":
      return compileOpenAlerts(c, s.alerts).pivotTo("historyEvents");
    case "where":
      return compileEvents(c, s.base).where(eventFilterWhere(s.filter, c.pred));
    case "intersect":
    case "union":
    case "subtract":
      return setOp(s.kind, compileEvents(c, s.a), compileEvents(c, s.b));
  }
}

function compileOpenAlerts(c: Ctx, s: OpenAlertSet): ObjectSet<AlertOrderFulfillment> {
  switch (s.kind) {
    case "all":
      return c.client(c.sdk.AlertOrderFulfillment);
    case "ofItems":
      return isAllItems(s.items)
        ? c.client(c.sdk.AlertOrderFulfillment)
        : compileItems(c, s.items).pivotTo("orderFulfillmentAlerts");
    case "ofEvents":
      return compileEvents(c, s.events).pivotTo("alert");
    case "where":
      return compileOpenAlerts(c, s.base).where(openAlertWhere(s.condition));
    case "intersect":
    case "union":
    case "subtract":
      return setOp(s.kind, compileOpenAlerts(c, s.a), compileOpenAlerts(c, s.b));
  }
}

function compileRisk(c: Ctx, s: RiskSet): ObjectSet<SalesOrderOtifEvaluation> {
  switch (s.kind) {
    case "all":
      return c.client(c.sdk.SalesOrderOtifEvaluation);
    case "ofItems":
      return isAllItems(s.items)
        ? c.client(c.sdk.SalesOrderOtifEvaluation)
        : compileItems(c, s.items).pivotTo("otifEvaluation");
    case "where":
      return compileRisk(c, s.base).where(compileRiskCondition(s.condition, c.config));
    case "intersect":
    case "union":
    case "subtract":
      return setOp(s.kind, compileRisk(c, s.a), compileRisk(c, s.b));
  }
}

/** Builds the compiler for one call context. Spec §9.0; mapping table in process/phase1-review-osdk.md §2. */
export function createSpecCompiler(deps: CompileDeps): SpecCompiler {
  const c: Ctx = { ...deps, pred: buildPredicates(deps.config) };
  return {
    items: (s) => compileItems(c, s),
    events: (s) => compileEvents(c, s),
    openAlerts: (s) => compileOpenAlerts(c, s),
    risk: (s) => compileRisk(c, s),
  };
}
