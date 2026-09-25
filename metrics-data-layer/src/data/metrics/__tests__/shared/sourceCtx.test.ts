import { describe, expect, it } from "vitest";
import { callCtx, sourceCtxOf, withCallProgress } from "../../shared/sourceCtx";
import { createFakeSource } from "../../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../../source/fake/fixtures";
import type { SourceCtx } from "../../source/MetricsSource";
import { wrapSource } from "../helpers/wrapSource";

const baseCtx = (): SourceCtx => ({ signal: new AbortController().signal, config: FIXTURE_CONFIG });

describe("callCtx (MOD-01)", () => {
  it("forwards the increase of one call's cumulative count as deltas", () => {
    const deltas: number[] = [];
    const ctx = callCtx(baseCtx(), (d) => deltas.push(d));
    for (const loaded of [1000, 2000, 2000, 2500]) ctx.onProgress?.({ loaded });
    expect(deltas).toEqual([1000, 1000, 500]);
  });

  it("never forwards a negative delta and keeps signal and config", () => {
    const deltas: number[] = [];
    const base = baseCtx();
    const ctx = callCtx({ ...base, onProgress: () => deltas.push(-1) }, (d) => deltas.push(d));
    ctx.onProgress?.({ loaded: 300 });
    ctx.onProgress?.({ loaded: 100 });
    expect(deltas).toEqual([300]);
    expect(ctx.signal).toBe(base.signal);
    expect(ctx.config).toBe(base.config);
  });
});

describe("withCallProgress (MOD-01)", () => {
  it("gives every port call its own ctx, even when the loader reuses one ctx", async () => {
    const script = [[500], [1000, 2000]];
    let n = 0;
    const scripted = wrapSource(withCallProgress(createFakeSource(), () => undefined), (method, _a, ctx) => {
      if (method.startsWith("fetch")) for (const loaded of script[n++] ?? []) ctx.onProgress?.({ loaded });
    });
    let total = 0;
    const source = withCallProgress(scripted, (d) => {
      total += d;
    });
    const shared = sourceCtxOf(
      { source, now: FIXTURE_NOW, signal: new AbortController().signal, config: FIXTURE_CONFIG },
      new AbortController().signal,
    );
    await source.fetchItemsByIds(["x"], shared);
    await source.fetchItemsByIds(["y"], shared);
    expect(total).toBe(2500);
  });

  it("passes results through unchanged", async () => {
    const fake = createFakeSource();
    const ctx = baseCtx();
    expect(await withCallProgress(fake, () => undefined).countAppUsers({ key: 7, start: null, end: FIXTURE_NOW.toISOString() }, ctx)).toBe(
      await fake.countAppUsers({ key: 7, start: null, end: FIXTURE_NOW.toISOString() }, ctx),
    );
  });
});

describe("sourceCtxOf", () => {
  it("passes the caller's onProgress and config through with the given signal", () => {
    const onProgress = (): void => undefined;
    const signal = new AbortController().signal;
    const deps = { source: createFakeSource(), now: FIXTURE_NOW, signal: new AbortController().signal, config: FIXTURE_CONFIG };
    expect(sourceCtxOf({ ...deps, onProgress }, signal)).toEqual({ signal, onProgress, config: FIXTURE_CONFIG });
    expect(sourceCtxOf(deps, signal)).toEqual({ signal, config: FIXTURE_CONFIG });
  });
});
