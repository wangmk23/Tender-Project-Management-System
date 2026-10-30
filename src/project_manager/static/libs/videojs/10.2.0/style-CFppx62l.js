import { n as kebabCase } from "./casing-4lg59-o1.js";

//#region ../utils/dist/dom/style.js
function normalizeStyleProperty(property) {
	return property.startsWith("--") ? property : kebabCase(property);
}
/** @internal */
function getAnchorNames(element) {
	const value = element.style.getPropertyValue("anchor-name").trim();
	if (!value || value === "none") return [];
	return value.split(",").map((name) => name.trim()).filter(Boolean);
}
/** @internal */
function applyStyles(element, styles) {
	for (const [prop, value] of Object.entries(styles)) if (typeof value === "string") element.style.setProperty(normalizeStyleProperty(prop), value);
}
/**
* Capture authored inline values and priorities for the selected properties.
*
* @internal
*/
function snapshotInlineStyles(element, properties) {
	return [...properties].map((property) => {
		const normalizedProperty = normalizeStyleProperty(property);
		return {
			property: normalizedProperty,
			value: element.style.getPropertyValue(normalizedProperty),
			priority: element.style.getPropertyPriority(normalizedProperty)
		};
	});
}
/**
* Restore a snapshot created by `snapshotInlineStyles`.
*
* @internal
*/
function restoreInlineStyles(element, snapshot) {
	for (const { property, value, priority } of snapshot) if (value) element.style.setProperty(property, value, priority);
	else element.style.removeProperty(property);
}
/**
* Apply inline styles for a synchronous callback and restore authored styles afterward.
*
* @internal
*/
function withInlineStyles(element, styles, callback) {
	const snapshot = snapshotInlineStyles(element, Object.keys(styles));
	try {
		applyStyles(element, styles);
		return callback();
	} finally {
		restoreInlineStyles(element, snapshot);
	}
}
/**
* Read and resolve a CSS property as a pixel length.
*
* @internal
*/
function readCSSLength(element, property, { source = "inline-or-computed" } = {}) {
	const normalizedProperty = normalizeStyleProperty(property);
	let value = source !== "computed" && element instanceof HTMLElement ? element.style.getPropertyValue(normalizedProperty) : "";
	if (!value && source !== "inline") value = getComputedStyle(element).getPropertyValue(normalizedProperty);
	return value.trim() ? resolveCSSLength(element, value) : null;
}
/** @internal */
function resolveCSSLength(el, value) {
	const trimmed = value.trim();
	if (!trimmed) return 0;
	const parsed = Number.parseFloat(trimmed);
	if (!Number.isNaN(parsed) && (/^-?\d*\.?\d+$/.test(trimmed) || trimmed.endsWith("px"))) return parsed;
	const doc = el.ownerDocument;
	const root = doc?.documentElement;
	if (!Number.isNaN(parsed) && trimmed.endsWith("rem")) return parsed * (root ? Number.parseFloat(getComputedStyle(root).fontSize) || 16 : 16);
	if (!Number.isNaN(parsed) && trimmed.endsWith("em")) return parsed * (el instanceof HTMLElement ? Number.parseFloat(getComputedStyle(el).fontSize) || 16 : 16);
	if (!doc) return Number.isNaN(parsed) ? 0 : parsed;
	const measurementEl = doc.createElement("div");
	measurementEl.style.position = "absolute";
	measurementEl.style.visibility = "hidden";
	measurementEl.style.pointerEvents = "none";
	measurementEl.style.inlineSize = trimmed;
	if (!measurementEl.style.inlineSize) return 0;
	measurementEl.style.blockSize = "0";
	measurementEl.style.padding = "0";
	measurementEl.style.border = "0";
	measurementEl.style.inset = "0";
	const computed = getComputedStyle(el);
	measurementEl.style.fontSize = computed.fontSize;
	for (let i = 0; i < computed.length; i++) {
		const name = computed.item(i);
		if (name.startsWith("--")) measurementEl.style.setProperty(name, computed.getPropertyValue(name));
	}
	const parent = doc.body ?? doc.documentElement;
	if (!parent) return Number.isNaN(parsed) ? 0 : parsed;
	parent.appendChild(measurementEl);
	if (getComputedStyle(measurementEl).inlineSize === "auto") {
		measurementEl.remove();
		return 0;
	}
	const pixels = measurementEl.getBoundingClientRect().width;
	measurementEl.remove();
	if (Number.isFinite(pixels)) return pixels;
	return Number.isNaN(parsed) ? 0 : parsed;
}

//#endregion
export { restoreInlineStyles as a, resolveCSSLength as i, getAnchorNames as n, snapshotInlineStyles as o, readCSSLength as r, withInlineStyles as s, applyStyles as t };
//# sourceMappingURL=style-CFppx62l.js.map