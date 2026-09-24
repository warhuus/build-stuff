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
