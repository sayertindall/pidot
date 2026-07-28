/**
 * `ctx.ui.setWidget` helpers.
 *
 * Each extension in pi-config claims a single widget key and never
 * touches another extension's key. The key is namespaced under
 * `pi-config/` so we don't collide with host Pi widgets or other
 * packages. The renderer wrapper centralizes the "show one line
 * or hide" decision.
 */

import type { ExtensionContext, ExtensionWidgetOptions, Theme } from "@earendil-works/pi-coding-agent";

/** Make a widget key scoped to pi-config so we don't clash with host Pi or other packages. */
export function widgetKey(feature: string): string {
	return `pi-config/${feature}`;
}

/**
 * Render a single line if `text` is provided; clear the widget otherwise.
 * The `text` argument is already themed (colored) by the caller.
 */
export function setWidgetLine(
	ctx: ExtensionContext,
	key: string,
	text: string | undefined,
	options?: ExtensionWidgetOptions,
): void {
	if (!ctx.hasUI) return;
	if (text === undefined) {
		ctx.ui.setWidget(key, undefined, options);
		return;
	}
	ctx.ui.setWidget(key, [text], options);
}

/** Theme shorthand — same shape as `theme.fg` in the host. */
export type Fg = (color: keyof Theme, text: string) => string;
