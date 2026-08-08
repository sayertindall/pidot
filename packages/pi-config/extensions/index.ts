/**
 * pi-config core extension registry.
 *
 * Each extension lives in its own subdirectory with split concern modules
 * (types / schemas / state / runtime / ui) wired together by that extension's
 * own `index.ts`. This file is pure wiring — no logic, no state.
 *
 * Path conventions (from AGENTS.md):
 *   - Configuration: ~/.pi/agent/pi-config/<feature>/*.json
 *   - Session state: ~/.pi/agent/pi-config/<feature>/<base64url(sessionId)>/*
 *   - No `data/` subdirectory; the package dir *is* the data dir.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import context7 from "./context7/index";
import enhance from "./enhance/index";
import minimalFooter from "./minimal-footer/index";
import preset from "./preset/index";
import review from "./review/index";
import safety from "./safety/index";
import status from "./status/index";

export default function piConfigExtensions(pi: ExtensionAPI): void {
  preset(pi);
  safety(pi);
  review(pi);
  status(pi);
  context7(pi);
  enhance(pi);
  minimalFooter(pi);
  see(pi);
}
