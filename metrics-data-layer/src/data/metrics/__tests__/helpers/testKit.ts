/** Shared test helper: the one selection builder. */
import { DEFAULT_SELECTION } from "../../selection";
import type { Selection } from "../../types";

/** `DEFAULT_SELECTION` with overrides (e.g. `sel({ window: 7, view: "alert" })`). */
export const sel = (overrides: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...overrides });
