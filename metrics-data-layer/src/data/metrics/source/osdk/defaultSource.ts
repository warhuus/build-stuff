/**
 * The default OSDK-backed source for the app (instructions §4 `MetricsSourceContext.ts`: "default:
 * osdkSource"). Lives in `source/osdk` because only this folder may import `src/client.ts` and `@app/sdk`
 * (instructions §5 rule 2). Created lazily, once.
 */
import * as sdk from "@app/sdk";
import { client } from "../../../../client";
import type { MetricsSource } from "../MetricsSource";
import { createOsdkSource } from "./osdkSource";

let memo: MetricsSource | null = null;

/**
 * The app's default `MetricsSource`: `createOsdkSource({ client, sdk })` over the host's OSDK client and
 * generated SDK, created on first call and reused afterwards.
 * @returns the memoised OSDK source (never null).
 */
export function getDefaultOsdkSource(): MetricsSource {
  memo ??= createOsdkSource({ client, sdk });
  return memo;
}
