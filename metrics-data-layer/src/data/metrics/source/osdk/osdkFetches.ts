/**
 * The five row-fetch port methods on OSDK (spec §9.0.1 L1–L3, §9.0 `itemsById`, §9 4.1 verdicts). Every fetch
 * pages through `paging.ts` (PAGE_SIZE, ROW_CAP, abort, progress). Id lookups: empty list → no request
 * (OSDK `$in: []` matches all objects; decision D14); duplicates removed; chunks of `ID_BATCH` with at most
 * `INNER_CONCURRENCY` in flight (own limiter; Appendix A X3). Missing ids are simply absent.
 */
import type { AlertEventRow, ItemRow, OpenAlertRow, Paged, VerdictRow } from "../../types";
import type { EventSet, ItemSet, OpenAlertSet } from "../../query/specs";
import type { SourceCtx } from "../MetricsSource";
import { compilerFor, type OsdkDeps } from "./osdkAggregates";
import { chunkIds, createProgress, fetchMapped, mergePaged, runLimited, throwIfAborted } from "./paging";
import {
  EVENT_SELECT,
  ITEM_SELECT,
  OPEN_ALERT_SELECT,
  VERDICT_SELECT,
  toAlertEventRow,
  toItemRow,
  toOpenAlertRow,
  toVerdictRow,
  verdictDateReader,
  type OsdkVerdictRow,
} from "./rowMapping";

const EMPTY: Paged<never> = { rows: [], capped: false };

/** AlertHistory rows of an event set (L1, L2 chain, L3 opened, 4.2 not-worked). Spec §9.0.1. */
export async function fetchEvents(deps: OsdkDeps, set: EventSet, ctx: SourceCtx): Promise<Paged<AlertEventRow>> {
  const s = compilerFor(deps, ctx).events(set);
  const size = ctx.config.PAGE_SIZE;
  return fetchMapped(
    (token) => s.fetchPage({ $select: EVENT_SELECT, $pageSize: size, $nextPageToken: token }),
    toAlertEventRow,
    ctx,
    createProgress(ctx),
  );
}

/** Open alerts of an open-alert set (L3; L2 touched-and-open ids). Spec §9.0.1 L3. */
export async function fetchOpenAlerts(deps: OsdkDeps, set: OpenAlertSet, ctx: SourceCtx): Promise<Paged<OpenAlertRow>> {
  const s = compilerFor(deps, ctx).openAlerts(set);
  const size = ctx.config.PAGE_SIZE;
  return fetchMapped(
    (token) => s.fetchPage({ $select: OPEN_ALERT_SELECT, $pageSize: size, $nextPageToken: token }),
    toOpenAlertRow,
    ctx,
    createProgress(ctx),
  );
}

/** Items of an item set (L3 items; 4.1 worked ids). Spec §9.0.1 L3, §9 4.1 step 2. */
export async function fetchItems(deps: OsdkDeps, set: ItemSet, ctx: SourceCtx): Promise<Paged<ItemRow>> {
  const s = compilerFor(deps, ctx).items(set);
  const size = ctx.config.PAGE_SIZE;
  return fetchMapped(
    (token) => s.fetchPage({ $select: ITEM_SELECT, $pageSize: size, $nextPageToken: token }),
    toItemRow,
    ctx,
    createProgress(ctx),
  );
}

/** Items by `salesOrderId` `$in` chunks of `ID_BATCH` (spec §9.0 `itemsById`). */
export async function fetchItemsByIds(deps: OsdkDeps, ids: readonly string[], ctx: SourceCtx): Promise<Paged<ItemRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return EMPTY;
  throwIfAborted(ctx.signal);
  const { ID_BATCH, INNER_CONCURRENCY, PAGE_SIZE, ROW_CAP } = ctx.config;
  const progress = createProgress(ctx);
  const parts = await runLimited(chunkIds(unique, ID_BATCH), INNER_CONCURRENCY, ctx.signal, (chunk) => {
    const s = deps.client(deps.sdk.SalesOrders).where({ salesOrderId: { $in: chunk } });
    return fetchMapped(
      (token) => s.fetchPage({ $select: ITEM_SELECT, $pageSize: PAGE_SIZE, $nextPageToken: token }),
      toItemRow,
      ctx,
      progress,
    );
  });
  return mergePaged(parts, ROW_CAP);
}

type VerdictMap = (r: OsdkVerdictRow) => VerdictRow | null;

/** `"eq"` lookup: one `$eq` fetch per id with `$pageSize: 1`, INNER_CONCURRENCY in flight. */
async function verdictsByEq(deps: OsdkDeps, ids: string[], ctx: SourceCtx, map: VerdictMap): Promise<Paged<VerdictRow>> {
  const progress = createProgress(ctx);
  const oov = deps.client(deps.sdk.OtifOrderVerdict);
  const parts = await runLimited(ids, ctx.config.INNER_CONCURRENCY, ctx.signal, async (id) => {
    const page = await oov.where({ otifOrderId: { $eq: id } }).fetchPage({ $select: VERDICT_SELECT, $pageSize: 1 });
    const rows = (Array.isArray(page.data) ? page.data : []).slice(0, 1).flatMap((r) => map(r) ?? []);
    progress(rows.length);
    return { rows, capped: false };
  });
  return mergePaged(parts, ctx.config.ROW_CAP);
}

/** `"in"` lookup: `$in` chunks of ID_BATCH, each paged, INNER_CONCURRENCY in flight. */
async function verdictsByIn(deps: OsdkDeps, ids: string[], ctx: SourceCtx, map: VerdictMap): Promise<Paged<VerdictRow>> {
  const { ID_BATCH, INNER_CONCURRENCY, PAGE_SIZE, ROW_CAP } = ctx.config;
  const progress = createProgress(ctx);
  const parts = await runLimited(chunkIds(ids, ID_BATCH), INNER_CONCURRENCY, ctx.signal, (chunk) => {
    const s = deps.client(deps.sdk.OtifOrderVerdict).where({ otifOrderId: { $in: chunk } });
    return fetchMapped(
      (token) => s.fetchPage({ $select: VERDICT_SELECT, $pageSize: PAGE_SIZE, $nextPageToken: token }),
      map,
      ctx,
      progress,
    );
  });
  return mergePaged(parts, ROW_CAP);
}

/**
 * Verdicts by `otifOrderId` per `config.VERDICT_ID_LOOKUP`: `"in"` = `$in` chunks of `ID_BATCH`, paged;
 * `"eq"` = one `$eq` fetch per id with `$pageSize: 1`. `verdictDate` from `VERDICT_DATE_PROPERTY` (throws before
 * any request while it is the placeholder). Empty ids → no request. Spec §9 4.1 step 3.
 */
export async function fetchVerdictsByIds(deps: OsdkDeps, ids: readonly string[], ctx: SourceCtx): Promise<Paged<VerdictRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return EMPTY;
  const dateOf = verdictDateReader(ctx.config);
  throwIfAborted(ctx.signal);
  const map: VerdictMap = (r) => toVerdictRow(r, dateOf);
  return ctx.config.VERDICT_ID_LOOKUP === "eq" ? verdictsByEq(deps, unique, ctx, map) : verdictsByIn(deps, unique, ctx, map);
}
