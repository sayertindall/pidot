/**
 * pi-herdr extension registry.
 *
 * Pure wiring — imports the herdr extension factory and
 * registers it with the Pi ExtensionAPI.
 */
import herdrExtension from "./herdr/index";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piHerdrExtensions(pi: ExtensionAPI): void {
	herdrExtension(pi);
}
