import { s as withInlineStyles } from "./style-CFppx62l.js";

//#region ../utils/dist/dom/layout.js
/**
* Read an element's current rendered size.
*
* @internal
*/
function getElementSize(element, { box = "bounding", overflow = "none" } = {}) {
	const rect = element.getBoundingClientRect();
	let width = box === "layout" ? element.offsetWidth || rect.width : rect.width;
	let height = box === "layout" ? element.offsetHeight || rect.height : rect.height;
	if (overflow === "width" || overflow === "both") width = Math.max(width, element.scrollWidth);
	if (overflow === "height" || overflow === "both") height = Math.max(height, element.scrollHeight);
	return {
		width,
		height
	};
}
/**
* Whether a viewport point, such as a mouse event's `clientX` and `clientY`, falls inside an element's border box. The
* right and bottom edges are outside, matching how the browser hit-tests. An element with no size contains nothing.
*
* @internal
*/
function isPointInElement(element, point) {
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0 && point.clientX >= rect.left && point.clientX < rect.right && point.clientY >= rect.top && point.clientY < rect.bottom;
}
/**
* Measure an element with optional temporary inline style overrides.
*
* @internal
*/
function measureElement(element, options = {}) {
	const { styles, ...sizeOptions } = options;
	const measure = () => getElementSize(element, sizeOptions);
	return styles ? withInlineStyles(element, styles, measure) : measure();
}
/**
* Read logical padding edges in pixels.
*
* @internal
*/
function getElementPadding(element) {
	const style = getComputedStyle(element);
	return {
		inlineStart: Number.parseFloat(style.paddingInlineStart) || 0,
		inlineEnd: Number.parseFloat(style.paddingInlineEnd) || 0,
		blockStart: Number.parseFloat(style.paddingBlockStart) || 0,
		blockEnd: Number.parseFloat(style.paddingBlockEnd) || 0
	};
}
/** @internal */
function getInlineExtent(edges) {
	return edges.inlineStart + edges.inlineEnd;
}
/** @internal */
function getBlockExtent(edges) {
	return edges.blockStart + edges.blockEnd;
}
function getPaddingOrigin(element) {
	const style = getComputedStyle(element);
	return {
		x: Number.parseFloat(style.paddingLeft) || 0,
		y: Number.parseFloat(style.paddingTop) || 0
	};
}
function defaultResolveChildrenSize(measurements) {
	if (measurements.length === 0) return {
		width: 0,
		height: 0
	};
	const width = Math.max(...measurements.map(({ offsetLeft, size }) => offsetLeft + size.width));
	const firstTop = measurements[0].offsetTop;
	return {
		width,
		height: measurements.some(({ offsetTop }) => offsetTop !== firstTop) ? Math.max(...measurements.map(({ offsetTop, size }) => offsetTop + size.height)) : measurements.reduce((total, { size }) => total + size.height, 0)
	};
}
/**
* Measure the layout occupied by a collection of child elements.
*
* @internal
*/
function measureElementChildren(container, { children, includePadding = false, maxWidth = null, measure = (element, width) => measureElement(element, width === void 0 ? void 0 : { styles: { width: `${width}px` } }), resolveSize = defaultResolveChildrenSize } = {}) {
	const elements = [...children ?? Array.from(container.children).filter((child) => child instanceof HTMLElement)].filter((element) => !element.hidden);
	const padding = includePadding ? getElementPadding(container) : {
		inlineStart: 0,
		inlineEnd: 0,
		blockStart: 0,
		blockEnd: 0
	};
	const inlinePadding = getInlineExtent(padding);
	const blockPadding = getBlockExtent(padding);
	const paddingOrigin = includePadding ? getPaddingOrigin(container) : {
		x: 0,
		y: 0
	};
	if (elements.length === 0) return {
		width: inlinePadding,
		height: blockPadding
	};
	const collect = (width) => elements.map((element) => ({
		element,
		size: measure(element, width),
		offsetLeft: element.offsetLeft - paddingOrigin.x,
		offsetTop: element.offsetTop - paddingOrigin.y
	}));
	let measurements = collect();
	const naturalWidth = resolveSize(measurements).width + inlinePadding;
	const width = maxWidth === null ? naturalWidth : Math.min(naturalWidth, Math.max(0, maxWidth));
	if (width < naturalWidth) measurements = collect(Math.max(0, width - inlinePadding));
	return {
		width,
		height: resolveSize(measurements).height + blockPadding
	};
}

//#endregion
export { isPointInElement as a, getInlineExtent as i, getElementPadding as n, measureElement as o, getElementSize as r, measureElementChildren as s, getBlockExtent as t };
//# sourceMappingURL=layout-BqK_K8jO.js.map