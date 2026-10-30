import { d as isString } from "./predicate-3rF1m2uv.js";

//#region ../utils/dist/dom/popover.js
const ZERO_OFFSETS = {
	sideOffset: 0,
	boundaryOffset: 0
};
const OPPOSITE_SIDE = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left"
};
function getSideAvailable(triggerRect, boundaryRect, side, offsets) {
	const boundaryOffset = offsets.boundaryOffset ?? 0;
	switch (side) {
		case "top": return triggerRect.top - boundaryRect.top - boundaryOffset - offsets.sideOffset;
		case "bottom": return boundaryRect.bottom - triggerRect.bottom - boundaryOffset - offsets.sideOffset;
		case "left": return triggerRect.left - boundaryRect.left - boundaryOffset - offsets.sideOffset;
		case "right": return boundaryRect.right - triggerRect.right - boundaryOffset - offsets.sideOffset;
	}
}
/**
* Resolve the preferred side against a positioning boundary.
*
* @internal
*/
function getPositionedSide(triggerRect, positionedRect, boundaryRect, opts, offsets = ZERO_OFFSETS) {
	const preferred = opts.side;
	const opposite = OPPOSITE_SIDE[preferred];
	const size = preferred === "top" || preferred === "bottom" ? positionedRect.height : positionedRect.width;
	const preferredSpace = getSideAvailable(triggerRect, boundaryRect, preferred, offsets);
	if (preferredSpace >= size) return preferred;
	return getSideAvailable(triggerRect, boundaryRect, opposite, offsets) > preferredSpace ? opposite : preferred;
}
/** @internal */
function tryShowPopover(el) {
	try {
		el?.showPopover?.();
	} catch {}
}
/** @internal */
function tryHidePopover(el) {
	try {
		el?.hidePopover?.();
	} catch {}
}

//#endregion
//#region ../core/dist/dev/dom/utils/layout.js
/** @internal */
function forceLayout(element) {
	element?.getBoundingClientRect();
}
/** @internal */
function createDOMRect(left, top, width, height) {
	const right = left + width;
	const bottom = top + height;
	return {
		x: left,
		y: top,
		width,
		height,
		top,
		right,
		bottom,
		left,
		toJSON() {
			return {
				x: left,
				y: top,
				width,
				height,
				top,
				right,
				bottom,
				left
			};
		}
	};
}
/** @internal */
function intersectDOMRects(firstRect, secondRect) {
	const left = Math.max(firstRect.left, secondRect.left);
	const top = Math.max(firstRect.top, secondRect.top);
	const right = Math.min(firstRect.right, secondRect.right);
	const bottom = Math.min(firstRect.bottom, secondRect.bottom);
	return createDOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}
/** @internal */
function getPositioningBoundaryRect(boundaryElement) {
	const viewportRect = document.documentElement.getBoundingClientRect();
	return boundaryElement ? intersectDOMRects(viewportRect, boundaryElement.getBoundingClientRect()) : viewportRect;
}
/** @internal */
function resolvePositioningBoundary(boundary, options = {}) {
	if (!boundary) return null;
	if (!isString(boundary)) return boundary;
	if (boundary === "viewport") return null;
	if (boundary === "container") return options.container ?? null;
	try {
		return (options.root ?? document).querySelector(boundary);
	} catch {
		return null;
	}
}

//#endregion
//#region ../core/dist/dev/core/ui/popover/vars.js
/** @internal */
const PopoverCSSVars = {
	/** Distance between the popup and the trigger along the side axis. */
	sideOffset: "--media-popover-side-offset",
	/** Distance between the popup and the trigger along the alignment axis. */
	alignOffset: "--media-popover-align-offset",
	/** Minimum distance between the popup and the positioning boundary. */
	boundaryOffset: "--media-popover-boundary-offset",
	/** The anchor element's width. */
	anchorWidth: "--media-popover-anchor-width",
	/** The anchor element's height. */
	anchorHeight: "--media-popover-anchor-height",
	/** Available width between the trigger and the boundary edge. */
	availableWidth: "--media-popover-available-width",
	/** Available height between the trigger and the boundary edge. */
	availableHeight: "--media-popover-available-height"
};

//#endregion
export { resolvePositioningBoundary as a, tryShowPopover as c, getPositioningBoundaryRect as i, createDOMRect as n, getPositionedSide as o, forceLayout as r, tryHidePopover as s, PopoverCSSVars as t };
//# sourceMappingURL=vars-CTJASilF.js.map