/** Shared test helper: the one selection builder every test uses (MOD-19). */
import { DEFAULT_SELECTION } from "../../selection";
import type { Selection } from "../../types";

/** `DEFAULT_SELECTION` with overrides (e.g. `sel({ window: 7, filters: AMER, view: "alert" })`). */
export const sel = (overrides: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...overrides });
