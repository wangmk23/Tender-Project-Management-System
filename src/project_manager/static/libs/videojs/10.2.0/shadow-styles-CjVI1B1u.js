import { n as supportsConstructableStyleSheets } from "./supports-DoLag2tA.js";

//#region ../utils/dist/dom/shadow-styles.js
/**
* Inject a `<style>` tag into `document.head` once (idempotent by `id`).
*
* @internal
*/
function ensureGlobalStyle(id, css) {
	const doc = globalThis.document;
	if (!doc || doc.getElementById(id)) return;
	const style = doc.createElement("style");
	style.id = id;
	style.textContent = css;
	doc.head.appendChild(style);
}
function isConstructableStyleSheet(value) {
	return typeof globalThis.CSSStyleSheet !== "undefined" && value instanceof globalThis.CSSStyleSheet;
}
function getStyleText(style) {
	if (typeof style === "string") return style;
	return Array.from(style.cssRules).map((rule) => rule.cssText).join("\n");
}
/**
* Create a constructable stylesheet when available, otherwise return raw CSS.
*
* @internal
*/
function createShadowStyle(css) {
	if (!supportsConstructableStyleSheets()) return css;
	const sheet = new globalThis.CSSStyleSheet();
	sheet.replaceSync(css);
	return sheet;
}
/**
* Apply styles to a shadow root using `adoptedStyleSheets` when available, falling back to `<style>` injection.
*
* @internal
*/
function applyShadowStyles(shadowRoot, styles) {
	if (styles.every(isConstructableStyleSheet) && "adoptedStyleSheets" in shadowRoot) {
		shadowRoot.adoptedStyleSheets = styles;
		return;
	}
	const doc = shadowRoot.ownerDocument;
	for (const styleText of styles.map(getStyleText)) {
		const style = doc.createElement("style");
		style.textContent = styleText;
		shadowRoot.appendChild(style);
	}
}

//#endregion
export { createShadowStyle as n, ensureGlobalStyle as r, applyShadowStyles as t };
//# sourceMappingURL=shadow-styles-CjVI1B1u.js.map