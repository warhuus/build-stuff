/**
 * Test harness: a real OSDK `Client` (createClient) whose `fetch` records every request and answers from
 * handlers (instructions §12 "recording stub"; process/phase1-review-osdk.md §1). No casts, no `any`.
 * The wire JSON of a request IS the compiled chain: base / filter(where) / searchAround(link) / set ops.
 */
import { createClient, type Client } from "@osdk/client";

/** One recorded server request (metadata GETs excluded). */
export interface Recorded {
  readonly kind: "aggregate" | "loadObjects";
  readonly body: WireBody;
}
/** The request body as JSON (objectSet tree + aggregation / paging fields). */
export interface WireBody {
  readonly objectSet: WireSet;
  readonly [key: string]: unknown;
}
/** A wire object set node. */
export interface WireSet {
  readonly type: string;
  readonly objectType?: string;
  readonly objectSet?: WireSet;
  readonly objectSets?: readonly WireSet[];
  readonly where?: unknown;
  readonly link?: string;
}
/** Answer to an aggregate: `data` groups with metrics. */
export interface AggregateReply {
  readonly data: readonly { readonly group: Record<string, unknown>; readonly metrics: readonly { name: string; value: number }[] }[];
}
/** Answer to a loadObjects page: raw property values per object (the harness adds `__apiName` etc.). */
export interface LoadReply {
  readonly data: readonly Record<string, unknown>[];
  readonly nextPageToken?: string;
}

/** Handlers the test sets; default: empty results. */
export interface Handlers {
  aggregate: (body: WireBody) => AggregateReply | Promise<AggregateReply>;
  load: (body: WireBody) => LoadReply | Promise<LoadReply>;
}

const PROPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  SalesOrders: {
    salesOrderId: "string", isOpen: "boolean", salesOrderItemCreationDate: "date", actualGiDate: "date",
    valueUsd: "double", businessLineName: "string", productLineName: "string", iscRegionName: "string", plantCode: "string",
  },
  AlertHistory: {
    historyEventId: "string", riskAlertId: "string", salesOrderId: "string", eventType: "string", eventSource: "string",
    eventActor: "string", eventTimestamp: "timestamp", persona: "string", riskType: "string", priorityAtEvent: "string",
  },
  AlertOrderFulfillment: {
    riskAlertId: "string", salesOrderId: "string", persona: "string", priority: "string", riskType: "string", escalated: "boolean",
  },
  SalesOrderOtifEvaluation: { salesOrderId: "string", otifStatus: "string", otifScore: "integer" },
  OtifOrderVerdict: {
    otifOrderId: "string", initOtifClassification: "string", critClassification: "string", officialExclusionOtif: "string",
    officialExclusionCrit: "string", otifOtShipmentEndDate: "date", otifFirstInitialDeliveryDateTarget: "date",
  },
  AppUsageEvent: { eventId: "string", userId: "string", appId: "string", eventType: "string", eventTimestamp: "timestamp", persona: "string", region: "string" },
  AlertType: { primaryKey_: "string", alertTypeId: "string", title: "string", alertType: "string" },
};
const PK: Readonly<Record<string, string>> = {
  SalesOrders: "salesOrderId", AlertHistory: "historyEventId", AlertOrderFulfillment: "riskAlertId",
  SalesOrderOtifEvaluation: "salesOrderId", OtifOrderVerdict: "otifOrderId", AppUsageEvent: "eventId", AlertType: "primaryKey_",
};

/** Links per source object type: [link name, one-to-many]. Spec §3. */
const LINKS: Readonly<Record<string, readonly (readonly [string, boolean])[]>> = {
  SalesOrders: [["alertHistory", true], ["orderFulfillmentAlerts", true], ["otifEvaluation", false]],
  AlertHistory: [["salesOrder_1", false], ["alert", false]],
  AlertOrderFulfillment: [["sourceSalesOrder", false], ["historyEvents", true], ["alertType", false]],
  SalesOrderOtifEvaluation: [["salesOrder", false]],
};

function fullMetadata(apiName: string): unknown {
  const props = PROPS[apiName] ?? {};
  const properties = Object.fromEntries(
    Object.entries(props).map(([p, t]) => [p, { dataType: { type: t }, rid: `ri.prop.${p}` }]),
  );
  return {
    objectType: {
      apiName, primaryKey: PK[apiName], titleProperty: PK[apiName], rid: `ri.stub.${apiName}`, status: "ACTIVE",
      visibility: "NORMAL", displayName: apiName, pluralDisplayName: apiName,
      icon: { type: "blueprint", color: "blue", name: "x" }, properties,
    },
    linkTypes: (LINKS[apiName] ?? []).map(([link, many]) => ({
      apiName: link, objectTypeApiName: LINK_TARGET[link], cardinality: many ? "MANY" : "ONE", status: "ACTIVE",
      displayName: link, linkTypeRid: `ri.link.${link}`,
    })),
    implementsInterfaces: [], implementsInterfaces2: {}, sharedPropertyTypeMapping: {},
  };
}

const json = (b: unknown): Response =>
  new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

function isWireBody(v: unknown): v is WireBody {
  return typeof v === "object" && v !== null && "objectSet" in v;
}

/** True when the aggregate request has a group-by (grouped results are arrays). */
export function isGrouped(body: WireBody): boolean {
  return Array.isArray(body.groupBy) && body.groupBy.length > 0;
}

/** A recording client plus its request log. `inFlight`/`maxInFlight` count loadObjects requests. */
export interface RecordingClient {
  readonly client: Client;
  readonly requests: Recorded[];
  readonly handlers: Handlers;
  readonly stats: { inFlight: number; maxInFlight: number };
}

/** Creates the recording client. Every response is delayed by one macrotask so concurrency is observable. */
export function createRecordingClient(): RecordingClient {
  const requests: Recorded[] = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const handlers: Handlers = {
    aggregate: (body) => ({ data: isGrouped(body) ? [] : [{ group: {}, metrics: [] }] }),
    load: () => ({ data: [] }),
  };
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const meta = /objectTypes\/([^/]+)\/fullMetadata/.exec(url);
    if (meta) return json(fullMetadata(meta[1]));
    const text = input instanceof Request ? await input.clone().text() : String(init?.body ?? "");
    const body: unknown = JSON.parse(text);
    if (!isWireBody(body)) throw new Error(`unexpected request ${url}`);
    if (url.includes("/objectSets/aggregate")) {
      requests.push({ kind: "aggregate", body });
      return json({ accuracy: "ACCURATE", ...(await handlers.aggregate(body)) });
    }
    requests.push({ kind: "loadObjects", body });
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, 1));
    stats.inFlight -= 1;
    const reply = await handlers.load(body);
    const apiName = typeOfSet(body.objectSet);
    const data = reply.data.map((o) => ({ __apiName: apiName, __primaryKey: o[PK[apiName] ?? ""] ?? "pk", ...o }));
    return json({ data, nextPageToken: reply.nextPageToken, totalCount: String(data.length) });
  };
  const client = createClient("https://stub.invalid", "ri.stub.ontology", () => Promise.resolve("token"), undefined, fetchFn);
  return { client, requests, handlers, stats };
}

/** Link name → target object type (spec §3). */
export const LINK_TARGET: Readonly<Record<string, string>> = {
  alertHistory: "AlertHistory",
  orderFulfillmentAlerts: "AlertOrderFulfillment",
  otifEvaluation: "SalesOrderOtifEvaluation",
  salesOrder_1: "SalesOrders",
  alert: "AlertOrderFulfillment",
  sourceSalesOrder: "SalesOrders",
  historyEvents: "AlertHistory",
  salesOrder: "SalesOrders",
  alertType: "AlertType",
};

/** Object type of a wire set: base type, the link target of a searchAround, or the first operand's type. */
export function typeOfSet(s: WireSet): string {
  if (s.type === "base") return s.objectType ?? "?";
  if (s.type === "searchAround") return LINK_TARGET[s.link ?? ""] ?? "?";
  const inner = s.objectSet ?? s.objectSets?.[0];
  return inner === undefined ? "?" : typeOfSet(inner);
}

/** One step of a compiled chain, in OSDK call terms. */
export type Step =
  | { readonly base: string }
  | { readonly where: unknown }
  | { readonly pivotTo: string }
  | { readonly intersect: Step[][] }
  | { readonly union: Step[][] }
  | { readonly subtract: Step[][] };

/** The OSDK call chain a wire object set encodes: client(X) → where → pivotTo → set ops. */
export function chainOf(s: WireSet): Step[] {
  const inner = (): Step[] => (s.objectSet === undefined ? [] : chainOf(s.objectSet));
  switch (s.type) {
    case "base":
      return [{ base: s.objectType ?? "?" }];
    case "filter":
      return [...inner(), { where: toOsdkWhere(s.where) }];
    case "searchAround":
      return [...inner(), { pivotTo: s.link ?? "?" }];
    case "intersect":
      return [{ intersect: (s.objectSets ?? []).map(chainOf) }];
    case "union":
      return [{ union: (s.objectSets ?? []).map(chainOf) }];
    case "subtract":
      return [{ subtract: (s.objectSets ?? []).map(chainOf) }];
    default:
      throw new Error(`unknown wire set ${s.type}`);
  }
}

interface WireWhere {
  readonly type: string;
  readonly field?: string;
  readonly value?: unknown;
}
function isWireWhere(v: unknown): v is WireWhere {
  return typeof v === "object" && v !== null && "type" in v;
}

/** Wire where → the OSDK where object that produced it (`{ p: { $op: v } }`, `$and`, `$or`, `$not`). */
export function toOsdkWhere(w: unknown): unknown {
  if (!isWireWhere(w)) throw new Error("not a wire where");
  if (w.type === "and" || w.type === "or") {
    return { [`$${w.type}`]: Array.isArray(w.value) ? w.value.map(toOsdkWhere) : [] };
  }
  if (w.type === "not") return { $not: toOsdkWhere(w.value) };
  return { [w.field ?? "?"]: { [`$${w.type}`]: w.value } };
}

/** Every property named in a where clause of a set on `objectType` (following pivots and set ops). */
export function whereFieldsOn(s: WireSet, objectType: string): string[] {
  const nested = [s.objectSet, ...(s.objectSets ?? [])].flatMap((x) => (x === undefined ? [] : whereFieldsOn(x, objectType)));
  return s.type === "filter" && typeOfSet(s) === objectType ? [...nested, ...fieldsOf(s.where)] : nested;
}

function fieldsOf(w: unknown): string[] {
  if (!isWireWhere(w)) return [];
  if (w.field !== undefined) return [w.field];
  return Array.isArray(w.value) ? w.value.flatMap(fieldsOf) : fieldsOf(w.value);
}
