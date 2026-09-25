import { describe, expect, it } from "vitest";
import { CARD_IDS } from "../../../config/metrics";
import { CARD_IMPL, CARDS, funnelStageCaveats, noStageCaveats } from "../catalogue";
import { deriveStubRows } from "../compute/deriveStub";
import { loadStub } from "../loaders/blocked";
import { deriveAgeingBacklog } from "../compute/deriveAgeingBacklog";
import { deriveItemFunnel } from "../compute/deriveItemFunnel";
import { deriveUserFunnel } from "../compute/deriveUserFunnel";
import { loadAgeingBacklog } from "../loaders/ageingBacklog";
import { loadItemFunnel } from "../loaders/itemFunnel";
import { loadUserFunnel } from "../loaders/userFunnel";
import { DEFAULT_SELECTION } from "../selection";
import type { CardData, FunnelSeries, FunnelStage } from "../types";
import { fakeDeps } from "./helpers/loaderDeps";

const stage = (id: FunnelStage["id"], caveats: FunnelStage["caveats"]): FunnelStage => ({
  id,
  label: id,
  count: 1,
  valueUsd: null,
  availability: "ok",
  caveats,
  outsidePath: null,
  pctPrev: null,
  pctFirst: null,
  trackValue: null,
});
const series = (stages: readonly FunnelStage[]): FunnelSeries => ({
  section: 2,
  view: "item",
  window: 30,
  unit: "count",
  firstStageId: "2.0",
  stages,
  generatedAt: "2026-09-01T12:00:00.000Z",
});

describe("CARDS (instructions §7)", () => {
  it("lists every card id with its metadata", () => {
    expect(Object.keys(CARDS).sort()).toEqual([...CARD_IDS].sort());
    for (const id of CARD_IDS) expect(CARDS[id].id).toBe(id);
    expect(CARDS.itemFunnel).toMatchObject({ rows: ["2.0", "2.1", "2.2", "2.3", "2.4"], draft: 1, stub: null });
    expect(CARDS.riskMovement.stub?.reason).toBe("not-captured");
    expect(CARDS.otifOutcome.requires).toEqual(["VERDICT_DATE_PROPERTY"]);
  });
});

describe("CARD_IMPL", () => {
  it("pairs each first-draft card with its loader and derive", () => {
    expect(Object.keys(CARD_IMPL).sort()).toEqual([...CARD_IDS].sort());
    expect(CARD_IMPL.userFunnel).toMatchObject({ load: loadUserFunnel, derive: deriveUserFunnel });
    expect(CARD_IMPL.itemFunnel).toMatchObject({ load: loadItemFunnel, derive: deriveItemFunnel });
    expect(CARD_IMPL.ageingBacklog).toMatchObject({ load: loadAgeingBacklog, derive: deriveAgeingBacklog });
    expect(CARD_IMPL.itemFunnel.stageCaveats).toBe(funnelStageCaveats);
    expect(CARD_IMPL.riskDistribution.stageCaveats).toBe(noStageCaveats);
  });

  it("gives the stubs an inert loader and an empty derive (never reached: loadCard blocks them first)", async () => {
    const deps = fakeDeps();
    expect(await loadStub(DEFAULT_SELECTION, null, deps)).toEqual({ raw: null, status: "ok", caveats: [] });
    expect(deps.source.calls).toEqual([]);
    expect(deriveStubRows()(null, DEFAULT_SELECTION)).toEqual({ data: { total: [], breakdown: null }, caveats: [] });
    expect(CARD_IMPL.rolledValue.load).toBe(loadStub);
  });
});

describe("stage caveats", () => {
  it("funnelStageCaveats unions total, group and other stages in config order", () => {
    const data: CardData<FunnelSeries> = {
      total: series([stage("2.0", ["proxy"]), stage("2.3", ["not-a-conversion"])]),
      breakdown: {
        dimension: "region",
        additive: true,
        groups: [{ group: "AMER", data: series([stage("2.4", ["low-volume"])]) }],
        other: series([stage("2.1", ["build-stamp"]), stage("2.0", ["proxy"])]),
        truncated: null,
        overlapRatio: null,
      },
    };
    const got = funnelStageCaveats(data);
    expect([...got].sort()).toEqual(["build-stamp", "low-volume", "not-a-conversion", "proxy"]);
  });

  it("funnelStageCaveats without a breakdown reads the total only; noStageCaveats is empty", () => {
    expect(funnelStageCaveats({ total: series([stage("2.0", ["proxy"])]), breakdown: null })).toEqual(["proxy"]);
    expect(noStageCaveats()).toEqual([]);
  });
});
