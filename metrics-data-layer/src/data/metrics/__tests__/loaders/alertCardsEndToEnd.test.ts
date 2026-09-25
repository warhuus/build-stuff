/** End-to-end smoke: section-4 loaders → Agent A2's derives over the fixtures (loader tests assert raw). */
import { beforeEach, describe, expect, it } from "vitest";
import { deriveAgeingBacklog } from "../../compute/deriveAgeingBacklog";
import { deriveClosureComposition } from "../../compute/deriveClosureComposition";
import { deriveFirstViewToClosure, deriveRaisedToClosed, deriveRaisedToFirstView } from "../../compute/deriveDurations";
import { loadAgeingBacklog } from "../../loaders/ageingBacklog";
import { loadClosureComposition } from "../../loaders/closureComposition";
import { loadFirstViewToClosure } from "../../loaders/firstViewToClosure";
import { loadRaisedToClosed } from "../../loaders/raisedToClosed";
import { loadRaisedToFirstView } from "../../loaders/raisedToFirstView";
import { clearMetricsCache } from "../../shared/cache";
import { FIXTURE_CONFIG } from "../../source/fake/fixtures";
import { fakeDeps } from "../helpers/loaderDeps";
import {  } from "../helpers/alertCards";
import { sel } from "../helpers/testKit";

describe("section-4 loaders feed their derives (7 days unless noted)", () => {
  beforeEach(() => clearMetricsCache());

  it("4.2: worked 6 (A42 A44 A46 A49 A50 A55 closed in 7 d), not worked 2 (A35 A36; A40 has no opened event)", async () => {
    const out = await loadRaisedToClosed(sel({ window: 7 }), null, fakeDeps());
    const d = deriveRaisedToClosed(out.raw, sel({ window: 7 }), FIXTURE_CONFIG);
    expect(d.data.total.series.map((s) => s.n)).toEqual([6, 2]);
  });

  it("4.3: 12 alerts first viewed in 7 d (A09 A13 A15 A19 A25 A44 A46 A49 A53 A58 A62 A65)", async () => {
    const out = await loadRaisedToFirstView(sel({ window: 7 }), null, fakeDeps());
    expect(deriveRaisedToFirstView(out.raw, sel({ window: 7 }), FIXTURE_CONFIG).data.total.series[0].n).toBe(12);
  });

  it("4.4: 6 viewed alerts closed in 7 d (A44 view = close stamp counts as before)", async () => {
    const out = await loadFirstViewToClosure(sel({ window: 7 }), null, fakeDeps());
    expect(deriveFirstViewToClosure(out.raw, sel({ window: 7 }), FIXTURE_CONFIG).data.total.series[0].n).toBe(6);
  });

  it("4.5 (30): 48 open alerts, 3 of unknown age (A32–A34 raised before the pipeline start)", async () => {
    const out = await loadAgeingBacklog(sel({ window: 30 }), null, fakeDeps());
    const d = deriveAgeingBacklog(out.raw, sel({ window: 30 }), FIXTURE_CONFIG);
    expect(d.data.total).toMatchObject({ openAlerts: 48, unknownAge: 3 });
  });

  it("4.6: closedTotal 9 = writeBack A50 + action A46 A49 + viewOnly A42 A44 A55 + noHuman 3", async () => {
    const out = await loadClosureComposition(sel({ window: 7 }), null, fakeDeps());
    const d = deriveClosureComposition(out.raw, sel({ window: 7 }), FIXTURE_CONFIG);
    const byGroup = Object.fromEntries(d.data.total.rows.map((r) => [r.group, r.count]));
    expect(byGroup).toEqual({ writeBack: 1, action: 2, viewOnly: 3, noHuman: 3 });
    expect(d.data.total.closedTotal).toBe(9);
  });
});
