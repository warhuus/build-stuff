# Phase 1 review 3: OSDK feasibility

Reviewer 3 (OSDK feasibility). This is a report only; no files under `src/` were edited.
Inputs reviewed: `process/DESIGN.md`, `src/data/metrics/query/specs.ts`, `src/data/metrics/source/MetricsSource.ts`, `src/config/metrics.ts`, `src/data/metrics/{types,rowTypes,rawTypes}.ts`.
Checked against the installed typings in `node_modules/@osdk/api/build/types/**` and `node_modules/@osdk/client/build/types/**` (both 2.7.8), with TypeScript 5.5 from the project.

**Verdict:** every spec kind and every port method compiles to OSDK 2.7 calls that exist. The probes type-check with `npx tsc --noEmit` (strict, same compiler options as the project) and pass the project's ESLint config with `--max-warnings 0`. A runtime probe using `createClient` and a recording `fetch` confirmed the wire JSON for pivot, intersect, `$exactWithLimit`, `$ranges`, `exactDistinct` and `fetchPage`. No interface change is required. There are no high-severity findings. Two medium findings need adapter guards (empty `$in`, empty `$or`), and one needs a guard test (group-by-only properties).

Probe files, kept for Agent C: `/tmp/claude-0/-home-user-build-stuff/6668890e-cf53-523c-8931-07c0cb904c0d/scratchpad/probe/`
- `app-sdk/index.ts`: the full stub (7 object types). Copy it to `stubs/app-sdk/index.ts`.
- `compile.ts`: a spec compiler over the real `specs.ts` types (all 4 set types, set ops, predicates, risk and verdict conditions).
- `probe.ts`: the requested chain, plus `$ranges`, multi-key groupBy, the groupBy switch and the paging helper.
- `negative.ts`, `neg2.ts`: `@ts-expect-error` cases that prove strictness.
- `runtime.ts`, `runtime2.ts`: run with `./node_modules/.bin/vite-node runtime.ts` to print the wire requests.
- `tsconfig.json`: the project options plus `"paths": {"@app/sdk": ["./app-sdk/index.ts"]}`. `node_modules` is a symlink to the project.

## Interface change requests
None.

---

## 1. Verified stub pattern for `stubs/app-sdk/index.ts`

### Rules learned from the typings (each one was hit in the probe)
1. **The shape comes from `@osdk/api/build/types/test/EmployeeApiTest.d.ts`.** That is the generator's own output shape. Each object type is written three times under one name:
   - an `interface X extends ObjectTypeDefinition` with `type: "object"`, `apiName: "X"` and an optional `__DefinitionMetadata`;
   - a `const X: X = { type: "object", apiName: "X" }`. At runtime the client needs only these two fields;
   - the metadata itself.
2. **Four `__DefinitionMetadata` fields do the typing work:**
   - `objectSet` must be set to `ObjectSet<X>`. Otherwise `client(X)` and the parameters of `intersect`/`union`/`subtract` (`CompileTimeMetadata<Q>["objectSet"]`) lose their types.
   - `props` is required. Fetched objects are typed from `CompileTimeMetadata<Q>["props"]`.
   - `links` is `{ linkName: ObjectMetadata.Link<Target, isMany> }`. `pivotTo` takes `keyof links & string`, and `LinkedType` reads `Link.__OsdkLinkTargetType`. This is what makes link names strict literals.
   - `properties` is `{ apiName: PropertyDef<wireType, nullability, "single"> }`. `where`, `aggregate` and `groupBy` are all typed from it.
3. **`properties` must be a `type` alias, not an `interface`.** It is checked against `Record<any, ObjectMetadata.Property>`. An interface has no implicit index signature and fails with TS2430/TS2344 ("Index signature for type 'string' is missing").
4. **Do not use namespaces.** The generator emits `export declare namespace X { … }`, but the project lints `stubs/` with `tseslint.configs.recommended`, and `no-namespace` rejects that. Empty `interface XObjectSet extends ObjectSet<X> {}` declarations are also out: `no-empty-object-type` rejects them. Use `objectSet: $ObjectSet<X>` inline instead.
5. **Object types without links use `links: Record<never, never>`.** With `Record<string, never>`, `pivotTo("anything")` type-checks, which was verified as a false negative.
6. **Wire types:**
   - `"string"`, `"boolean"`, `"double"`, `"integer"`;
   - `"datetime"` for date properties such as `salesOrderItemCreationDate`, `actualGiDate` and the verdict dates;
   - `"timestamp"` for `eventTimestamp`.

   Both date kinds filter as plain strings (`DatetimeFilter`), so the type system does not distinguish `YYYY-MM-DD` from a full ISO string. The adapter must convert the format itself (see F9).

### The file (verified: `tsc --noEmit` clean, ESLint clean). Copy it verbatim.
```ts
/**
 * Stub of the generated OSDK package `@app/sdk` (NOT DELIVERED). Mirrors the shape @osdk/generator 2.x emits
 * (see node_modules/@osdk/api/build/types/test/EmployeeApiTest.d.ts), without namespaces (lint: no-namespace).
 */
import type {
  ObjectMetadata as $ObjectMetadata,
  ObjectSet as $ObjectSet,
  ObjectTypeDefinition as $ObjectTypeDefinition,
  PropertyDef as $PropertyDef,
  PropertyValueWireToClient as $PropType,
  SingleLinkAccessor as $SingleLinkAccessor,
} from "@osdk/api";

// ---------- SalesOrders ----------
/** Property metadata of SalesOrders (apiName → wire type). */
export type SalesOrdersProperties = {
  salesOrderId: $PropertyDef<"string", "non-nullable", "single">;
  isOpen: $PropertyDef<"boolean", "nullable", "single">;
  salesOrderItemCreationDate: $PropertyDef<"datetime", "nullable", "single">;
  actualGiDate: $PropertyDef<"datetime", "nullable", "single">;
  valueUsd: $PropertyDef<"double", "nullable", "single">;
  businessLineName: $PropertyDef<"string", "nullable", "single">;
  productLineName: $PropertyDef<"string", "nullable", "single">;
  iscRegionName: $PropertyDef<"string", "nullable", "single">;
  plantCode: $PropertyDef<"string", "nullable", "single">;
};
/** Client-side property values of a SalesOrders object. */
export interface SalesOrdersProps {
  readonly salesOrderId: $PropType["string"];
  readonly isOpen: $PropType["boolean"] | undefined;
  readonly salesOrderItemCreationDate: $PropType["datetime"] | undefined;
  readonly actualGiDate: $PropType["datetime"] | undefined;
  readonly valueUsd: $PropType["double"] | undefined;
  readonly businessLineName: $PropType["string"] | undefined;
  readonly productLineName: $PropType["string"] | undefined;
  readonly iscRegionName: $PropType["string"] | undefined;
  readonly plantCode: $PropType["string"] | undefined;
}
/** Link accessors on a loaded SalesOrders object. */
export interface SalesOrdersLinks {
  readonly alertHistory: $ObjectSet<AlertHistory>;
  readonly otifEvaluation: $SingleLinkAccessor<SalesOrderOtifEvaluation>;
  readonly orderFulfillmentAlerts: $ObjectSet<AlertOrderFulfillment>;
}
/** SalesOrders object type definition. */
export interface SalesOrders extends $ObjectTypeDefinition {
  type: "object";
  apiName: "SalesOrders";
  __DefinitionMetadata?: {
    objectSet: $ObjectSet<SalesOrders>;
    props: SalesOrdersProps;
    linksType: SalesOrdersLinks;
    strictProps: SalesOrdersProps;
    apiName: "SalesOrders";
    description: undefined;
    displayName: "Sales Orders";
    icon: undefined;
    implements: [];
    interfaceMap: Record<string, never>;
    inverseInterfaceMap: Record<string, never>;
    links: {
      alertHistory: $ObjectMetadata.Link<AlertHistory, true>;
      otifEvaluation: $ObjectMetadata.Link<SalesOrderOtifEvaluation, false>;
      orderFulfillmentAlerts: $ObjectMetadata.Link<AlertOrderFulfillment, true>;
    };
    pluralDisplayName: "Sales Orders";
    primaryKeyApiName: "salesOrderId";
    primaryKeyType: "string";
    properties: SalesOrdersProperties;
    rid: "ri.stub.object-type.SalesOrders";
    status: "ACTIVE";
    titleProperty: "salesOrderId";
    type: "object";
    visibility: "NORMAL";
  };
}
/** Runtime value passed to `client(SalesOrders)`. */
export const SalesOrders: SalesOrders = { type: "object", apiName: "SalesOrders" };

// ---------- AlertHistory ----------
/** Property metadata of AlertHistory. */
export type AlertHistoryProperties = {
  historyEventId: $PropertyDef<"string", "non-nullable", "single">;
  riskAlertId: $PropertyDef<"string", "nullable", "single">;
  salesOrderId: $PropertyDef<"string", "nullable", "single">;
  eventType: $PropertyDef<"string", "nullable", "single">;
  eventSource: $PropertyDef<"string", "nullable", "single">;
  eventActor: $PropertyDef<"string", "nullable", "single">;
  eventTimestamp: $PropertyDef<"timestamp", "nullable", "single">;
  persona: $PropertyDef<"string", "nullable", "single">;
  riskType: $PropertyDef<"string", "nullable", "single">;
  priorityAtEvent: $PropertyDef<"string", "nullable", "single">;
};
/** Client-side property values of an AlertHistory object. */
export interface AlertHistoryProps {
  readonly historyEventId: $PropType["string"];
  readonly riskAlertId: $PropType["string"] | undefined;
  readonly salesOrderId: $PropType["string"] | undefined;
  readonly eventType: $PropType["string"] | undefined;
  readonly eventSource: $PropType["string"] | undefined;
  readonly eventActor: $PropType["string"] | undefined;
  readonly eventTimestamp: $PropType["timestamp"] | undefined;
  readonly persona: $PropType["string"] | undefined;
  readonly riskType: $PropType["string"] | undefined;
  readonly priorityAtEvent: $PropType["string"] | undefined;
}
/** Link accessors on a loaded AlertHistory object. */
export interface AlertHistoryLinks {
  readonly salesOrder_1: $SingleLinkAccessor<SalesOrders>;
  readonly alert: $SingleLinkAccessor<AlertOrderFulfillment>;
}
/** AlertHistory object type definition. */
export interface AlertHistory extends $ObjectTypeDefinition {
  type: "object";
  apiName: "AlertHistory";
  __DefinitionMetadata?: {
    objectSet: $ObjectSet<AlertHistory>;
    props: AlertHistoryProps;
    linksType: AlertHistoryLinks;
    strictProps: AlertHistoryProps;
    apiName: "AlertHistory";
    description: undefined;
    displayName: "Alert History";
    icon: undefined;
    implements: [];
    interfaceMap: Record<string, never>;
    inverseInterfaceMap: Record<string, never>;
    links: {
      salesOrder_1: $ObjectMetadata.Link<SalesOrders, false>;
      alert: $ObjectMetadata.Link<AlertOrderFulfillment, false>;
    };
    pluralDisplayName: "Alert History";
    primaryKeyApiName: "historyEventId";
    primaryKeyType: "string";
    properties: AlertHistoryProperties;
    rid: "ri.stub.object-type.AlertHistory";
    status: "ACTIVE";
    titleProperty: "historyEventId";
    type: "object";
    visibility: "NORMAL";
  };
}
/** Runtime value passed to `client(AlertHistory)`. */
export const AlertHistory: AlertHistory = { type: "object", apiName: "AlertHistory" };

// ---------- SalesOrderOtifEvaluation ----------
/** Property metadata of SalesOrderOtifEvaluation. */
export type SalesOrderOtifEvaluationProperties = {
  salesOrderId: $PropertyDef<"string", "non-nullable", "single">;
  otifStatus: $PropertyDef<"string", "nullable", "single">;
  otifScore: $PropertyDef<"integer", "nullable", "single">;
};
/** Client-side property values. */
export interface SalesOrderOtifEvaluationProps {
  readonly salesOrderId: $PropType["string"];
  readonly otifStatus: $PropType["string"] | undefined;
  readonly otifScore: $PropType["integer"] | undefined;
}
/** SalesOrderOtifEvaluation object type definition. */
export interface SalesOrderOtifEvaluation extends $ObjectTypeDefinition {
  type: "object";
  apiName: "SalesOrderOtifEvaluation";
  __DefinitionMetadata?: {
    objectSet: $ObjectSet<SalesOrderOtifEvaluation>;
    props: SalesOrderOtifEvaluationProps;
    linksType: { readonly salesOrder: $SingleLinkAccessor<SalesOrders> };
    strictProps: SalesOrderOtifEvaluationProps;
    apiName: "SalesOrderOtifEvaluation";
    description: undefined;
    displayName: "Sales Order OTIF Evaluation";
    icon: undefined;
    implements: [];
    interfaceMap: Record<string, never>;
    inverseInterfaceMap: Record<string, never>;
    links: { salesOrder: $ObjectMetadata.Link<SalesOrders, false> };
    pluralDisplayName: "Sales Order OTIF Evaluations";
    primaryKeyApiName: "salesOrderId";
    primaryKeyType: "string";
    properties: SalesOrderOtifEvaluationProperties;
    rid: "ri.stub.object-type.SalesOrderOtifEvaluation";
    status: "ACTIVE";
    titleProperty: "salesOrderId";
    type: "object";
    visibility: "NORMAL";
  };
}
/** Runtime value passed to `client(SalesOrderOtifEvaluation)`. */
export const SalesOrderOtifEvaluation: SalesOrderOtifEvaluation = {
  type: "object",
  apiName: "SalesOrderOtifEvaluation",
};

// ---------- AlertOrderFulfillment ----------
/** Property metadata of AlertOrderFulfillment. */
export type AlertOrderFulfillmentProperties = {
  riskAlertId: $PropertyDef<"string", "non-nullable", "single">;
  salesOrderId: $PropertyDef<"string", "nullable", "single">;
  persona: $PropertyDef<"string", "nullable", "single">;
  priority: $PropertyDef<"string", "nullable", "single">;
  riskType: $PropertyDef<"string", "nullable", "single">;
  escalated: $PropertyDef<"boolean", "nullable", "single">;
};
/** Client-side property values. */
export interface AlertOrderFulfillmentProps {
  readonly riskAlertId: $PropType["string"];
  readonly salesOrderId: $PropType["string"] | undefined;
  readonly persona: $PropType["string"] | undefined;
  readonly priority: $PropType["string"] | undefined;
  readonly riskType: $PropType["string"] | undefined;
  readonly escalated: $PropType["boolean"] | undefined;
}
/** AlertOrderFulfillment object type definition. */
export interface AlertOrderFulfillment extends $ObjectTypeDefinition {
  type: "object";
  apiName: "AlertOrderFulfillment";
  __DefinitionMetadata?: {
    objectSet: $ObjectSet<AlertOrderFulfillment>;
    props: AlertOrderFulfillmentProps;
    linksType: {
      readonly sourceSalesOrder: $SingleLinkAccessor<SalesOrders>;
      readonly historyEvents: $ObjectSet<AlertHistory>;
      readonly alertType: $SingleLinkAccessor<AlertType>;
    };
    strictProps: AlertOrderFulfillmentProps;
    apiName: "AlertOrderFulfillment";
    description: undefined;
    displayName: "Alert Order Fulfillment";
    icon: undefined;
    implements: [];
    interfaceMap: Record<string, never>;
    inverseInterfaceMap: Record<string, never>;
    links: {
      sourceSalesOrder: $ObjectMetadata.Link<SalesOrders, false>;
      historyEvents: $ObjectMetadata.Link<AlertHistory, true>;
      alertType: $ObjectMetadata.Link<AlertType, false>;
    };
    pluralDisplayName: "Alert Order Fulfillments";
    primaryKeyApiName: "riskAlertId";
    primaryKeyType: "string";
    properties: AlertOrderFulfillmentProperties;
    rid: "ri.stub.object-type.AlertOrderFulfillment";
    status: "ACTIVE";
    titleProperty: "riskAlertId";
    type: "object";
    visibility: "NORMAL";
  };
}
/** Runtime value passed to `client(AlertOrderFulfillment)`. */
export const AlertOrderFulfillment: AlertOrderFulfillment = { type: "object", apiName: "AlertOrderFulfillment" };

// ---------- OtifOrderVerdict (no links) ----------
/** Property metadata of OtifOrderVerdict. */
export type OtifOrderVerdictProperties = {
  otifOrderId: $PropertyDef<"string", "non-nullable", "single">;
  initOtifClassification: $PropertyDef<"string", "nullable", "single">;
  critClassification: $PropertyDef<"string", "nullable", "single">;
  officialExclusionOtif: $PropertyDef<"string", "nullable", "single">;
  officialExclusionCrit: $PropertyDef<"string", "nullable", "single">;
  otifOtShipmentEndDate: $PropertyDef<"datetime", "nullable", "single">;
  otifFirstInitialDeliveryDateTarget: $PropertyDef<"datetime", "nullable", "single">;
};
/** Client-side property values. */
export interface OtifOrderVerdictProps {
  readonly otifOrderId: $PropType["string"];
  readonly initOtifClassification: $PropType["string"] | undefined;
  readonly critClassification: $PropType["string"] | undefined;
  readonly officialExclusionOtif: $PropType["string"] | undefined;
  readonly officialExclusionCrit: $PropType["string"] | undefined;
  readonly otifOtShipmentEndDate: $PropType["datetime"] | undefined;
  readonly otifFirstInitialDeliveryDateTarget: $PropType["datetime"] | undefined;
}
/** OtifOrderVerdict object type definition. */
export interface OtifOrderVerdict extends $ObjectTypeDefinition {
  type: "object";
  apiName: "OtifOrderVerdict";
  __DefinitionMetadata?: {
    objectSet: $ObjectSet<OtifOrderVerdict>;
    props: OtifOrderVerdictProps;
    linksType: Record<never, never>;
    strictProps: OtifOrderVerdictProps;
    apiName: "OtifOrderVerdict";
    description: undefined;
    displayName: "OTIF Order Verdict";
    icon: undefined;
    implements: [];
    interfaceMap: Record<string, never>;
    inverseInterfaceMap: Record<string, never>;
    links: Record<never, never>;
    pluralDisplayName: "OTIF Order Verdicts";
    primaryKeyApiName: "otifOrderId";
    primaryKeyType: "string";
    properties: OtifOrderVerdictProperties;
    rid: "ri.stub.object-type.OtifOrderVerdict";
    status: "ACTIVE";
    titleProperty: "otifOrderId";
    type: "object";
    visibility: "NORMAL";
  };
}
/** Runtime value passed to `client(OtifOrderVerdict)`. */
export const OtifOrderVerdict: OtifOrderVerdict = { type: "object", apiName: "OtifOrderVerdict" };

// ---------- AppUsageEvent (no links) ----------
/** Property metadata of AppUsageEvent. */
export type AppUsageEventProperties = {
  eventId: $PropertyDef<"string", "non-nullable", "single">;
  userId: $PropertyDef<"string", "nullable", "single">;
  appId: $PropertyDef<"string", "nullable", "single">;
  eventType: $PropertyDef<"string", "nullable", "single">;
  eventTimestamp: $PropertyDef<"timestamp", "nullable", "single">;
  persona: $PropertyDef<"string", "nullable", "single">;
  region: $PropertyDef<"string", "nullable", "single">;
};
/** Client-side property values. */
export interface AppUsageEventProps {
  readonly eventId: $PropType["string"];
  readonly userId: $PropType["string"] | undefined;
  readonly appId: $PropType["string"] | undefined;
  readonly eventType: $PropType["string"] | undefined;
  readonly eventTimestamp: $PropType["timestamp"] | undefined;
  readonly persona: $PropType["string"] | undefined;
  readonly region: $PropType["string"] | undefined;
}
/** AppUsageEvent object type definition. */
export interface AppUsageEvent extends $ObjectTypeDefinition {
  type: "object";
  apiName: "AppUsageEvent";
  __DefinitionMetadata?: {
    objectSet: $ObjectSet<AppUsageEvent>;
    props: AppUsageEventProps;
    linksType: Record<never, never>;
    strictProps: AppUsageEventProps;
    apiName: "AppUsageEvent";
    description: undefined;
    displayName: "App Usage Event";
    icon: undefined;
    implements: [];
    interfaceMap: Record<string, never>;
    inverseInterfaceMap: Record<string, never>;
    links: Record<never, never>;
    pluralDisplayName: "App Usage Events";
    primaryKeyApiName: "eventId";
    primaryKeyType: "string";
    properties: AppUsageEventProperties;
    rid: "ri.stub.object-type.AppUsageEvent";
    status: "ACTIVE";
    titleProperty: "eventId";
    type: "object";
    visibility: "NORMAL";
  };
}
/** Runtime value passed to `client(AppUsageEvent)`. */
export const AppUsageEvent: AppUsageEvent = { type: "object", apiName: "AppUsageEvent" };

// ---------- AlertType (labels only; no links) ----------
/** Property metadata of AlertType. */
export type AlertTypeProperties = {
  primaryKey_: $PropertyDef<"string", "non-nullable", "single">;
  alertTypeId: $PropertyDef<"string", "nullable", "single">;
  title: $PropertyDef<"string", "nullable", "single">;
  alertType: $PropertyDef<"string", "nullable", "single">;
};
/** Client-side property values. */
export interface AlertTypeProps {
  readonly primaryKey_: $PropType["string"];
  readonly alertTypeId: $PropType["string"] | undefined;
  readonly title: $PropType["string"] | undefined;
  readonly alertType: $PropType["string"] | undefined;
}
/** AlertType object type definition. */
export interface AlertType extends $ObjectTypeDefinition {
  type: "object";
  apiName: "AlertType";
  __DefinitionMetadata?: {
    objectSet: $ObjectSet<AlertType>;
    props: AlertTypeProps;
    linksType: Record<never, never>;
    strictProps: AlertTypeProps;
    apiName: "AlertType";
    description: undefined;
    displayName: "Alert Type";
    icon: undefined;
    implements: [];
    interfaceMap: Record<string, never>;
    inverseInterfaceMap: Record<string, never>;
    links: Record<never, never>;
    pluralDisplayName: "Alert Types";
    primaryKeyApiName: "primaryKey_";
    primaryKeyType: "string";
    properties: AlertTypeProperties;
    rid: "ri.stub.object-type.AlertType";
    status: "ACTIVE";
    titleProperty: "title";
    type: "object";
    visibility: "NORMAL";
  };
}
/** Runtime value passed to `client(AlertType)`. */
export const AlertType: AlertType = { type: "object", apiName: "AlertType" };
```
The file is 399 lines. The 250-line rule applies to `src/` only (structure test and instructions §10), and `stubs/` is not delivered. If you prefer smaller files, split it into one file per object type under `stubs/app-sdk/` and re-export them from `index.ts`. The `paths` entry and the vitest alias both point at `index.ts`.

### Requested chain (verified in `probe.ts`)
```ts
import type { ObjectSet, PageResult, WhereClause } from "@osdk/api";   // all also re-exported by @osdk/client
import { AlertHistory, SalesOrders } from "@app/sdk";

const events: ObjectSet<AlertHistory> = withItemFilters(client(SalesOrders), f)
  .pivotTo("alertHistory")                                   // literal; "nope" or a string variable → compile error
  .where({ $and: [HUMAN, tsIn(w)] });
const items: ObjectSet<SalesOrders> = events.pivotTo("salesOrder_1");
const grouped = await items.aggregate({
  $select: { $count: "unordered", "valueUsd:sum": "unordered" },
  $groupBy: { businessLineName: { $exactWithLimit: MAX_GROUPS } },
});
grouped.map((r) => ({ group: r.$group.businessLineName, count: r.$count ?? 0, valueUsd: r.valueUsd?.sum ?? 0 }));
const page = await items.fetchPage({
  $select: ["salesOrderId", "businessLineName", "valueUsd", "isOpen"] as const,
  $pageSize: PAGE_SIZE, $nextPageToken: token,
});   // page.data[i].businessLineName: string | undefined; page.nextPageToken: string | undefined
```
Wire output (runtime probe): `searchAround(filter(searchAround(filter(base SalesOrders, in businessLineName), "alertHistory"), and[eq eventType, gte eventTimestamp]), "salesOrder_1")`, `groupBy:[{type:"exact",field:"businessLineName",maxGroupCount:10000}]`, `aggregation:[count, sum valueUsd]`.

### Helpers Agent C can copy (verified)
```ts
/** Structural view of OSDK set arithmetic: one helper serves all four object types.
 *  (A generic `<Q>(a: ObjectSet<Q>, b: ObjectSet<Q>)` does NOT compile: TS2345 on CompileTimeMetadata<Q>["objectSet"].) */
interface SetArithmetic<S> { intersect(...sets: S[]): S; union(...sets: S[]): S; subtract(...sets: S[]): S }
function setOp<S extends SetArithmetic<S>>(op: SetOp<unknown>["kind"], a: S, b: S): S {
  switch (op) {
    case "intersect": return a.intersect(b);
    case "union": return a.union(b);
    case "subtract": return a.subtract(b);
  }
}
// usage inside the per-type compiler:  case "intersect": case "union": case "subtract": return setOp(s.kind, items(s.a), items(s.b));

/** Paging without generics over the object type: the caller closes over a literal $select. */
async function fetchAllPages<T>(page: (token: string | undefined) => Promise<PageResult<T>>,
                                signal: AbortSignal, rowCap: number): Promise<{ rows: T[]; capped: boolean }> { /* loop */ }
fetchAllPages((token) => set.fetchPage({ $select: SELECT, $pageSize: PAGE_SIZE, $nextPageToken: token }), signal, cap);

/** Readonly config ranges → the mutable tuples $ranges requires (passing the readonly value is a type error). */
const ranges = config.RISK_RANGES.map(([lo, hi]): [number, number] => [lo, hi]);
set.aggregate({ $select: { $count: "unordered" }, $groupBy: { otifScore: { $ranges: ranges } } });   // r.$group.otifScore.startValue: number
```
The spec compiler over the real spec types is in the probe's `compile.ts`. Its shape: `items(s): ObjectSet<SalesOrders>`, `events(s): ObjectSet<AlertHistory>`, `openAlerts(s): ObjectSet<AlertOrderFulfillment>` and `risk(s): ObjectSet<SalesOrderOtifEvaluation>` are mutually recursive, each with an exhaustive `switch (s.kind)`. `PRED: Readonly<Record<EventPredicate, WhereClause<AlertHistory>>>` is one complete literal. `aofWhere` and `riskWhere` are switches that return literal clauses.

### Recording test client (instructions X5), verified without `any` or casts
Use the real `createClient(baseUrl, ontologyRid, tokenProvider, undefined, recordingFetch)`. Record `url` plus `JSON.parse(init.body)`, and assert on the wire JSON. That JSON is the exact where, pivot and groupBy output. Two notes:
- `aggregate` POSTs to `/objectSets/aggregate`. Answer with `{ data: [{ group: { businessLineName: "BL1" }, metrics: [{ name: "count", value: 3 }, { name: "valueUsd.sum", value: 12.5 }] }] }`. The client maps this to `[{ $group: { businessLineName: "BL1" }, $count: 3, valueUsd: { sum: 12.5 } }]`.
- `fetchPage` first GETs `/objectTypes/<X>/fullMetadata?preview=true`, then POSTs `/objectSets/loadObjects`. The fake must answer the metadata GET. A minimal `{ objectType: { apiName, primaryKey, titleProperty, rid, status, visibility, displayName, pluralDisplayName, icon, properties: { p: { dataType: { type: "string" }, rid } } }, linkTypes: [], implementsInterfaces: [], implementsInterfaces2: {}, sharedPropertyTypeMapping: {} }` works (see `runtime2.ts`).

A hand-written "recording stub" that implements `Client`/`ObjectSet` directly cannot be typed without casts, because `ObjectSet` has about 20 members with deep generics.

---

## 2. Mapping: spec kind / port method → OSDK 2.7 call chain

Notation: `C(X)` = `client(X)`. SO = SalesOrders, AH = AlertHistory, AOF = AlertOrderFulfillment, SOE = SalesOrderOtifEvaluation, OOV = OtifOrderVerdict, AUE = AppUsageEvent. "Verified" means it compiles in the probe; "wire" means the runtime probe also produced the request.

### Spec kinds
| Spec kind | OSDK chain | Verdict |
|---|---|---|
| `ItemSet.all` | `C(SO)` | OK, verified |
| `ItemSet.openInWindow(w)` | start≠null: `C(SO).where({$and:[{salesOrderItemCreationDate:{$lte:d(end)}},{$or:[{isOpen:{$eq:true}},{actualGiDate:{$gte:d(start)}}]}]})`; "now": `C(SO).where({isOpen:{$eq:true}})` | OK, verified. `d()` = `iso.slice(0,10)` (UTC, because the Window holds `toISOString` output) |
| `ItemSet.filtered(base,f)` | `items(base).where({$and:[…one $in per non-empty dim…]})`, or `items(base)` when every dim is empty | OK, verified. `$in` accepts `ReadonlyArray<string>`; chained `where` is AND on the wire |
| `ItemSet.ofEvents(e)` | `events(e).pivotTo("salesOrder_1")` | OK, verified, wire |
| `ItemSet.ofOpenAlerts(a)` | `openAlerts(a).pivotTo("sourceSalesOrder")` | OK, verified |
| `ItemSet.ofRisk(r)` | `risk(r).pivotTo("salesOrder")` | OK, verified |
| `EventSet.all` | `C(AH)` | OK |
| `EventSet.ofItems(i)` | `items(i).pivotTo("alertHistory")` | OK, verified, wire |
| `EventSet.ofOpenAlerts(a)` | `openAlerts(a).pivotTo("historyEvents")` | OK, verified |
| `EventSet.where(base,{predicates,window})` | `events(base).where({$and:[{$or: predicates.map(k=>PRED[k])}, tsIn(window)]})`; `window:null` → predicates only; `start:null` → `{eventTimestamp:{$lte:end}}` | OK, verified. One operator per property object (two operators is a verified type error). See F2 for empty `predicates` |
| `OpenAlertSet.all` | `C(AOF)` | OK |
| `OpenAlertSet.ofItems(i)` | `items(i).pivotTo("orderFulfillmentAlerts")` | OK, verified |
| `OpenAlertSet.ofEvents(e)` | `events(e).pivotTo("alert")` | OK, verified |
| `OpenAlertSet.where(base,cond)` | `switch(cond.field)`: `{persona:{$eq}}` / `{priority:{$eq}}` / `{escalated:{$eq:boolean}}` | OK, verified (the `boolean` narrows through the discriminated union) |
| `RiskSet.all` | `C(SOE)` | OK |
| `RiskSet.ofItems(i)` | `items(i).pivotTo("otifEvaluation")` | OK, verified |
| `RiskSet.where(base, notDelayed)` | `.where({$not:{otifStatus:{$eq:"Delayed"}}})` | OK, verified, wire |
| `RiskSet.where(base, bucket)` | delayed `{otifStatus:{$eq}}`; unscored `{$and:[NOT_DELAYED,{otifScore:{$isNull:true}}]}`; scored `{$and:[NOT_DELAYED,{otifScore:{$gte:lo}},{otifScore:{$lt:hi}}]}` | OK, verified |
| `SetOp<S>` (all 4 types) | `setOp(kind, compile(a), compile(b))` → `.intersect/.union/.subtract` | OK, verified, wire (intersect). `SetOp<S>` has `a: S, b: S`, so ops are only ever between sets of the same type. OSDK rejects cross-type ops at compile time too (verified) |
| `VerdictFilter{mode,window}` | `C(OOV).where({$and:[gate(mode), dateIn(VERDICT_DATE_PROPERTY,w)]})`. Gate: `officialExclusionOtif` or `officialExclusionCrit` `{$eq:"No"}`. Date: a switch over the two literal properties, `$gte`/`$lte` on `YYYY-MM-DD` | OK, verified. The switch needs a `default`/placeholder arm that throws (loadCard blocks first) |

### Port methods
| Method | OSDK call | Verdict |
|---|---|---|
| `countItems(set)` | `items(set).aggregate({$select:{$count:"unordered","valueUsd:sum":"unordered"}})` → `{count:r.$count ?? 0, valueUsd:r.valueUsd?.sum ?? 0}` | OK, verified |
| `countItemsBy(set, dim)` | `switch(dim)`, one literal call per case: `$groupBy:{businessLineName\|productLineName\|iscRegionName\|plantCode:{$exactWithLimit:config.MAX_GROUPS}}`. Read `r.$group.<same literal>` inside the same case | OK, verified. `$exactWithLimit` takes a `number` variable. See F7 on union helpers |
| `countEvents(set, actor\|alert)` | `.aggregate({$select:{"eventActor:exactDistinct":"unordered"}})` or `riskAlertId:exactDistinct`; read `r.eventActor?.exactDistinct ?? 0` | OK, verified, wire |
| `countEventsBy(set, d, g)` | 2 selects × 4 groupBy literals (`persona` for queueFilter and routingPersona, `riskType`, `priorityAtEvent`, `eventType` for actionType and writebackType): nested switch, 8 literal calls | OK, verified (persona case). Group-by-only properties appear only in `$groupBy` |
| `countOpenAlerts(set)` | `.aggregate({$select:{$count:"unordered"}})` | OK |
| `countOpenAlertsBy(set, g)` | `$groupBy:{persona\|priority\|riskType\|escalated:{$exactWithLimit}}`; `escalated` groups are typed `boolean` → label with `String(v) === "true"` (F6) | OK, verified |
| `countRisk(set)` | `$count` | OK |
| `countRiskByScoreRange(set, ranges)` | `.aggregate({$select:{$count:"unordered"},$groupBy:{otifScore:{$ranges: mutableCopy(ranges)}}})` → `r.$group.otifScore.startValue` | OK, verified, wire (`{type:"ranges",ranges:[{startValue,endValue}]}`). Readonly ranges must be copied (F5). No `$exactWithLimit` is possible with `$ranges` |
| `countAppUsers(w)` | `C(AUE).where({$and:[{appId:{$eq:config.ALERT_APP_ID}}, inWin]}).aggregate({$select:{"userId:exactDistinct":"unordered"}})` | OK, verified |
| `countAppUsersBy(w,"queueFilter")` | same + `$groupBy:{persona:{$exactWithLimit}}` (AUE.persona is exact) | OK, verified |
| `countVerdictsBy(filter)` | VerdictFilter set `.aggregate({$select:{$count:"unordered"},$groupBy:{initOtifClassification\|critClassification:{$exactWithLimit}}})`, a switch on mode | OK, verified (crit). `critClassification` appears only in `$groupBy` |
| `fetchEvents(set)` | `fetchAllPages(t => events(set).fetchPage({$select:[riskAlertId,salesOrderId,eventType,eventSource,eventTimestamp,persona,riskType,priorityAtEvent] as const,$pageSize,$nextPageToken:t}))` | OK, verified, wire (`loadObjects`, `select`, `pageSize`, `pageToken`) |
| `fetchOpenAlerts(set)` | same over AOF `[riskAlertId,salesOrderId,persona,priority,riskType,escalated]` | OK |
| `fetchItems(set)` | same over SO `[salesOrderId,businessLineName,productLineName,iscRegionName,plantCode,valueUsd,isOpen]` | OK, verified |
| `fetchItemsByIds(ids)` | chunk(ids, ID_BATCH) → `C(SO).where({salesOrderId:{$in:chunk}})` + fetchAllPages, INNER_CONCURRENCY limiter | OK. **Short-circuit empty `ids`** (F1) |
| `fetchVerdictsByIds(ids)` | `"in"`: `C(OOV).where({otifOrderId:{$in:chunk}})`; `"eq"`: `C(OOV).where({otifOrderId:{$eq:id}}).fetchPage({$pageSize:1,$select})`. `$select` includes both date properties, and `verdictDate` is chosen by `VERDICT_DATE_PROPERTY` | OK, verified (`$in` + `$select` of date property). Short-circuit empty `ids` (F1) |
| Several groupBy keys | Not used by the design. If needed, every `$select` entry must be `"unordered"`, and `"asc"` with two keys is a verified type error | OK |

### Design builders (DESIGN.md) → chains, spot-checked
- `events(preds,w,f)` = `where(ofItems(filtered(all,f)), preds, w)` when filters are set, else `where(all, …)`. Compiles to `C(SO).where(f).pivotTo("alertHistory").where(…)`, as in spec §9.0.
- `closedNotOpenNow` = `subtract(E, ofOpenAlerts(ofEvents(E)))`. The EventSet subtract compiles (`AH.subtract(AOF.pivotTo("historyEvents"))`).
- `touchedEventsChain` = `where(ofItems(ofEvents(events(human))), [lifecycle,human], null)`. Compiles to the L2 chain `….pivotTo("salesOrder_1").pivotTo("alertHistory").where(…)`.
- 3.1 value: `countItems(itemsOfRisk(riskWhere(set,b)))` compiles to `SOE.where(b).pivotTo("salesOrder").aggregate(SEL)`. Worked: `risk ∩ ofItems(ofEvents(human,w))`.
- 2.3/2.4 outside path: `subtract(intersect(so21, acted), so22)`. ItemSet ops compile.
- 1.2 escalated: `where(ofOpenAlerts(where(all,{escalated:v})), preds, w)` compiles to `C(AOF).where({escalated:{$eq:v}}).pivotTo("historyEvents").where(…)`.

### Group-by-only properties cannot be filtered through any spec (checked)
- `EventFilter` names only `EventPredicate`s and a window. `PRED` is built from `eventType`, `eventSource` and `eventTimestamp` only.
- `OpenAlertCondition` names AOF `persona`, `priority` and `escalated`. These are exact on AOF; the AH properties with the same names are the group-by-only ones.
- `RiskCondition` names only `otifStatus` and `otifScore`.
- `VerdictFilter` has only a mode and a window, so the gate is exact and `critClassification` is only ever grouped.
- `ItemFilters` maps only to exact SO properties.
- `EventGroupField`, `OpenAlertGroupField` and `AppUsageGroupField` reach properties only through `$groupBy`.

So AH `persona`/`riskType`/`priorityAtEvent` and OOV `critClassification` are unreachable by any where clause through the specs. **But the OSDK types do not help:** `C(AH).where({ persona: { $eq: "x" } })` type-checks (verified in `neg2.ts`). The only guard left is the adapter code. See F3.

---

## 3. Findings

| id | severity | file:line | finding | suggested fix |
|---|---|---|---|---|
| F1 | Medium | `src/data/metrics/source/MetricsSource.ts:243-246` | `$in: []` **matches all objects**, as documented in `@osdk/api` `BaseFilterOptions.$in`: "If an empty array is provided, the filter will match all objects". If `fetchItemsByIds([])` or `fetchVerdictsByIds([])` ever sends a request, it pages through SalesOrders (4.5M rows) or OtifOrderVerdict (930k rows) up to ROW_CAP and returns wrong rows. The same applies to any adapter code that builds `$in` from a list that could be empty. | Port doc: "empty `ids` → `{rows: [], capped: false}` with no server call". Agent C: guard in both methods, and never emit `$in` from a possibly empty list (`withItemFilters` already skips empty dims). Fake: same semantics. Add tests for both. |
| F2 | Medium | `src/data/metrics/query/specs.ts:28-31` | `EventFilter.predicates` is `readonly EventPredicate[]`, so it can be empty. That compiles to `{ $or: [] }` (wire `{type:"or",value:[]}`), whose server semantics are unverified: it could match nothing, match everything, or return a 400. The fake would have to guess. | Make it non-empty: `readonly [EventPredicate, ...EventPredicate[]]`. Alternatively document "at least one" and have compileSpec throw on empty. When there is only one predicate, compile it without the `$or` wrapper. |
| F3 | Medium | `specs.ts:10-15` (rule), future `source/osdk/compileSpec.ts` | The group-by-only rule is enforced only by the shape of the specs. The OSDK typings accept `$eq`/`$in` on AH `persona`/`riskType`/`priorityAtEvent` and OOV `critClassification` (verified). Any hand-written where clause in `source/osdk` would return zero rows silently. A plain grep is not enough, because AOF has exact properties with the same names (`persona`, `riskType`). | Agent C adds a recording-client test. It compiles every spec kind and every EventFilter predicate, walks the recorded wire `where` trees of requests on AH and OOV, and asserts that `persona`, `riskType`, `priorityAtEvent` and `critClassification` never appear as a `field` in them. They may appear only in `groupBy`. |
| F4 | Low | `src/data/metrics/rowTypes.ts:20-38` | The generated SDK types non-PK properties as `T \| undefined` (the stub does too). `AlertEventRow.riskAlertId`, `eventType` and `eventTimestamp`, and `OpenAlertRow.salesOrderId`, are non-null in the row types. The design does not say what the adapter does with a missing value. | DESIGN or the port doc should state a policy, for example: rows missing `riskAlertId`/`eventTimestamp` are dropped by the adapter and by the fake; other missing strings map to `null` where the row type allows it. Test the policy on both sides. |
| F5 | Low | `MetricsSource.ts:223-227`, `config/metrics.ts:98` | The `$ranges` type is `GroupByRange<number>[]` = mutable `[number, number][]`. Passing `readonly (readonly [number, number])[]` is a verified type error. | Adapter copies: `ranges.map(([lo, hi]): [number, number] => [lo, hi])`. The port stays readonly. |
| F6 | Low | `MetricsSource.ts:214`, `config/metrics.ts:141` | AOF `escalated` groups are typed `boolean`. If the server returns `"false"` as a string, a truthiness test would label it "true". | Label with `String(r.$group.escalated) === "true" ? labels.true : labels.false`, which is safe for both representations. |
| F7 | Low | DESIGN "Spec" / spec §9.0 `itemGroupBy` | A helper that returns a *union* of literal `$groupBy` objects compiles, but the result's `$group` is typed with **all** keys present (`{businessLineName: string; plantCode: string}`). That is unsound: reading the wrong key gives `undefined` typed as `string`. | Put the `switch` at the aggregate call site and read `$group.<literal>` in the same case, as in the probe's `groupedByDim`. Alternatively return `{groupBy, read}` pairs from the switch. |
| F8 | Low | DESIGN "Port", spec §9.0.1 L2 fallback | The spec's L2 fallback, a per-alert `C(AH).where({riskAlertId:{$eq:id}})`, cannot be expressed in the port (no `fetchEventsByAlertIds`). That is acceptable, because the chained pivot is the primary plan. | No change now. Note it in INTEGRATION.md as a possible later port method if the chained pivot is slow at integration. |
| F9 | Low | `specs.ts:44`, `specs.ts:129-136` | Date bounds (`salesOrderItemCreationDate`, `actualGiDate`, verdict dates) and timestamp bounds are both typed `string` (`DatetimeFilter`), so tsc cannot catch a full ISO string sent to a date property. | compileSpec converts with a single `toDateOnly(iso) = iso.slice(0, 10)` helper, used only for `datetime` properties. Assert the exact `YYYY-MM-DD` values in recording tests (2.0 and 4.1). |
| F10 | Info | `stubs/app-sdk/index.ts` (missing) | tsconfig `paths` and the vitest alias point at a file that does not exist yet. The build passes today only because nothing imports `@app/sdk`. | Agent C creates it from §1 (copy the verified file). |
| F11 | Info | instructions X5 / `createOsdkSource({ client, sdk })` | A hand-rolled recording stub implementing `Client` needs casts. `createClient` with a recording `fetch` works with no casts and records the exact wire where/pivot/groupBy JSON. `fetchPage` first GETs `…/fullMetadata`, so the fake fetch must answer it. | Type `sdk` as `{ SalesOrders: SalesOrders; AlertHistory: AlertHistory; … }` (types from `@app/sdk`) and `client` as `Client`. Tests use `createClient(url, rid, tokenFn, undefined, recordingFetch)`; see §1. |
| F12 | Info | `specs.ts:33-38` | `SetOp<S>` keeps `a`/`b` of the same set type, so no spec can express a cross-type op. OSDK also rejects cross-type `intersect`/`union`/`subtract` at compile time (verified). A generic `setOp<Q>(ObjectSet<Q>, ObjectSet<Q>)` does not compile (TS2345); the structural `SetArithmetic<S>` helper in §1 does. | Use the §1 helper. |
