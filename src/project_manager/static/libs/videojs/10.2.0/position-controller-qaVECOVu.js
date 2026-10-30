import { i as isFunction } from "./predicate-3rF1m2uv.js";
import { r as supportsPopoverAPI, t as supportsAnchorPositioning } from "./supports-DoLag2tA.js";
import { n as kebabCase } from "./casing-4lg59-o1.js";
import { a as restoreInlineStyles, i as resolveCSSLength, n as getAnchorNames, o as snapshotInlineStyles, t as applyStyles } from "./style-CFppx62l.js";
import { r as getElementSize } from "./layout-BqK_K8jO.js";
import { i as observeResize } from "./observe-elements-B5qhV5BC.js";
import { a as resolvePositioningBoundary, i as getPositioningBoundaryRect, n as createDOMRect, o as getPositionedSide, t as PopoverCSSVars } from "./vars-CTJASilF.js";
import { t as clamp } from "./number-D2skb7-A.js";

//#region ../utils/dist/dom/direction.js
/**
* Check whether an element's text direction is right-to-left.
*
* @internal
*/
function isRTL(element) {
	const dir = element.closest("[dir]")?.getAttribute("dir")?.toLowerCase();
	if (dir === "rtl" || dir === "ltr") return dir === "rtl";
	return getComputedStyle(element).direction === "rtl";
}

//#endregion
//#region ../utils/dist/dom/raf-throttle.js
/**
* Throttle a function to fire at most once per animation frame.
*
* @internal
*/
function rafThrottle(fn) {
	let rafId = null;
	let latestArgs;
	const throttled = (...args) => {
		latestArgs = args;
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			fn(...latestArgs);
		});
	};
	throttled.cancel = () => {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	};
	return throttled;
}

//#endregion
//#region ../core/dist/dev/dom/utils/event.js
/** @internal */
function isEventWithinElement(event, element) {
	if (!element) return false;
	if (isFunction(event.composedPath)) return event.composedPath().includes(element);
	const target = event.target;
	return target instanceof Node && element.contains(target);
}

//#endregion
//#region ../core/dist/dev/dom/ui/popover/positioning.js
const ZERO_OFFSETS = {
	sideOffset: 0,
	alignOffset: 0,
	boundaryOffset: 0
};
const OPPOSITE_SIDE = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left"
};
function formatPixels(value) {
	return `${clamp(value, 0, Infinity)}px`;
}
function shiftCrossAxis(value, boundaryStart, boundaryEnd, size) {
	const max = boundaryEnd - size;
	return max < boundaryStart ? boundaryStart : clamp(value, boundaryStart, max);
}
function getHorizontalAlign({ align, direction = "ltr" }) {
	if (direction !== "rtl") return align;
	return align === "start" ? "end" : align === "end" ? "start" : align;
}
function getAnchorCrossAxisShift(start, end, size, boundaryStart, boundaryEnd, align, alignOffset, boundaryOffset, axis, alignOffsetVar) {
	const base = align === "start" ? start + alignOffset : align === "end" ? end + alignOffset : start + size / 2 + alignOffset;
	const startAnchor = axis === "horizontal" ? "left" : "top";
	const endAnchor = OPPOSITE_SIDE[startAnchor];
	const anchor = align === "start" ? startAnchor : align === "end" ? endAnchor : "center";
	const desiredTranslate = align === "start" ? "0px" : align === "end" ? "-100%" : "-50%";
	return {
		base: `calc(anchor(${anchor}) + ${alignOffsetVar})`,
		translate: `clamp(${boundaryStart + boundaryOffset - base}px, ${desiredTranslate}, calc(${boundaryEnd - boundaryOffset - base}px - 100%))`
	};
}
/**
* Get positioning styles for the popup element.
*
* When the browser supports CSS Anchor Positioning, returns native CSS properties that reference the provided CSS var
* names for side/align offsets — no JS offset values needed.
*
* When rects are provided and anchor positioning is unsupported, falls back to manual JS-computed positioning. The
* caller must resolve offset CSS vars via `getComputedStyle` and pass them as `offsets`.
*
* Returns camelCase keys for standard CSS properties and `--*` keys for custom properties — compatible with both
* React's `style` prop and `applyStyles()` from `@videojs/utils/dom`.
*/
function getAnchorPositionStyle(anchorName, opts, triggerRect, popupRect, boundaryRect, offsets, cssVars = PopoverCSSVars) {
	if (supportsAnchorPositioning()) return {
		...getAnchorPositionCSS(anchorName, opts, cssVars, triggerRect, boundaryRect, offsets),
		...triggerRect && boundaryRect ? getPositioningCSSVars(triggerRect, boundaryRect, opts, offsets, cssVars) : {}
	};
	if (triggerRect && popupRect) {
		const resolved = offsets ?? ZERO_OFFSETS;
		return {
			position: "fixed",
			margin: "0",
			...getManualPositionStyle(triggerRect, popupRect, opts, resolved, boundaryRect),
			...boundaryRect ? getPositioningCSSVars(triggerRect, boundaryRect, opts, resolved, cssVars) : {}
		};
	}
	return {};
}
function getAnchorPositionCSS(anchorName, opts, cssVars = PopoverCSSVars, triggerRect, boundaryRect, offsets = ZERO_OFFSETS) {
	const SIDE_OFFSET_VAR = `var(${cssVars.sideOffset}, 0px)`;
	const ALIGN_OFFSET_VAR = `var(${cssVars.alignOffset}, 0px)`;
	const { side, align } = opts;
	const boundaryOffset = offsets.boundaryOffset ?? 0;
	const style = {
		positionAnchor: `--${anchorName}`,
		position: "fixed",
		inset: "auto",
		margin: "0",
		justifySelf: "normal",
		alignSelf: "normal",
		marginInlineStart: "0",
		marginBlockStart: "0",
		translate: "none"
	};
	const insetProp = OPPOSITE_SIDE[side];
	if (side === "top" || side === "bottom") {
		const horizontalAlign = getHorizontalAlign(opts);
		style[insetProp] = `calc(anchor(${side}) + ${SIDE_OFFSET_VAR})`;
		if (triggerRect && boundaryRect) {
			const { base, translate } = getAnchorCrossAxisShift(triggerRect.left, triggerRect.right, triggerRect.width, boundaryRect.left, boundaryRect.right, horizontalAlign, offsets.alignOffset, boundaryOffset, "horizontal", ALIGN_OFFSET_VAR);
			style.left = base;
			style.translate = `${translate} 0`;
			return style;
		}
		if (horizontalAlign === "start") style.left = `calc(anchor(left) + ${ALIGN_OFFSET_VAR})`;
		else if (horizontalAlign === "end") style.right = `calc(anchor(right) + ${ALIGN_OFFSET_VAR})`;
		else {
			style.justifySelf = "anchor-center";
			style.marginInlineStart = ALIGN_OFFSET_VAR;
		}
	} else {
		style[insetProp] = `calc(anchor(${side}) + ${SIDE_OFFSET_VAR})`;
		if (triggerRect && boundaryRect) {
			const { base, translate } = getAnchorCrossAxisShift(triggerRect.top, triggerRect.bottom, triggerRect.height, boundaryRect.top, boundaryRect.bottom, align, offsets.alignOffset, boundaryOffset, "vertical", ALIGN_OFFSET_VAR);
			style.top = base;
			style.translate = `0 ${translate}`;
			return style;
		}
		if (align === "start") style.top = `calc(anchor(top) + ${ALIGN_OFFSET_VAR})`;
		else if (align === "end") style.bottom = `calc(anchor(bottom) + ${ALIGN_OFFSET_VAR})`;
		else {
			style.alignSelf = "anchor-center";
			style.marginBlockStart = ALIGN_OFFSET_VAR;
		}
	}
	return style;
}
/**
* Compute CSS variables for sizing constraints relative to the anchor/boundary.
*
* Accepts a `cssVars` map so the same logic works for both popover (`--media-popover-*`) and tooltip
* (`--media-tooltip-*`) namespaces.
*/
function getPositioningCSSVars(triggerRect, boundaryRect, opts, offsets = ZERO_OFFSETS, cssVars = PopoverCSSVars) {
	const vars = {};
	const { side } = opts;
	const boundaryOffset = offsets.boundaryOffset ?? 0;
	const boundaryStartX = boundaryRect.left + boundaryOffset;
	const boundaryEndX = boundaryRect.right - boundaryOffset;
	const boundaryStartY = boundaryRect.top + boundaryOffset;
	const boundaryEndY = boundaryRect.bottom - boundaryOffset;
	vars[cssVars.anchorWidth] = `${triggerRect.width}px`;
	vars[cssVars.anchorHeight] = `${triggerRect.height}px`;
	if (side === "top" || side === "bottom") {
		const sideSpace = side === "top" ? triggerRect.top - boundaryStartY : boundaryEndY - triggerRect.bottom;
		vars[cssVars.availableHeight] = formatPixels(sideSpace - offsets.sideOffset);
		vars[cssVars.availableWidth] = formatPixels(boundaryEndX - boundaryStartX);
	} else {
		const sideSpace = side === "left" ? triggerRect.left - boundaryStartX : boundaryEndX - triggerRect.right;
		vars[cssVars.availableWidth] = formatPixels(sideSpace - offsets.sideOffset);
		vars[cssVars.availableHeight] = formatPixels(boundaryEndY - boundaryStartY);
	}
	return vars;
}
/**
* Compute manual positioning when CSS Anchor Positioning is not supported.
*
* Returns inline `top`/`left` styles in **viewport coordinates** for use with `position: fixed` (the popup is in the
* top layer). All rects from `getBoundingClientRect()` are already viewport-relative.
*
* Offsets are resolved by the caller from CSS custom properties via `getComputedStyle()` and passed as `offsets`.
*/
function getManualPositionStyle(triggerRect, popupRect, opts, offsets = {
	sideOffset: 0,
	alignOffset: 0
}, boundaryRect) {
	const { side, align } = opts;
	const { sideOffset, alignOffset } = offsets;
	let top = 0;
	let bottom;
	let left = 0;
	let right;
	if (side === "top") bottom = `calc(100% - ${triggerRect.top}px + ${sideOffset}px)`;
	else if (side === "bottom") top = triggerRect.bottom + sideOffset;
	else if (side === "left") right = `calc(100% - ${triggerRect.left}px + ${sideOffset}px)`;
	else left = triggerRect.right + sideOffset;
	if (side === "top" || side === "bottom") {
		const horizontalAlign = getHorizontalAlign(opts);
		if (horizontalAlign === "start") left = triggerRect.left + alignOffset;
		else if (horizontalAlign === "end") left = triggerRect.right - popupRect.width + alignOffset;
		else left = triggerRect.left + (triggerRect.width - popupRect.width) / 2 + alignOffset;
	} else if (align === "start") top = triggerRect.top + alignOffset;
	else if (align === "end") top = triggerRect.bottom - popupRect.height + alignOffset;
	else top = triggerRect.top + (triggerRect.height - popupRect.height) / 2 + alignOffset;
	if (boundaryRect) {
		const boundaryOffset = offsets.boundaryOffset ?? 0;
		if (side === "top" || side === "bottom") left = shiftCrossAxis(left, boundaryRect.left + boundaryOffset, boundaryRect.right - boundaryOffset, popupRect.width);
		else top = shiftCrossAxis(top, boundaryRect.top + boundaryOffset, boundaryRect.bottom - boundaryOffset, popupRect.height);
	}
	return {
		top: side === "top" ? "auto" : `${top}px`,
		bottom: bottom ?? "auto",
		left: side === "left" ? "auto" : `${left}px`,
		right: right ?? "auto"
	};
}
/**
* Read positioning offset CSS custom properties from the popup element's computed style, returning numeric pixel
* values.
*/
function resolveOffsets(el, cssVars = PopoverCSSVars) {
	const computed = getComputedStyle(el);
	return {
		sideOffset: resolveCSSLength(el, computed.getPropertyValue(cssVars.sideOffset)),
		alignOffset: resolveCSSLength(el, computed.getPropertyValue(cssVars.alignOffset)),
		boundaryOffset: resolveCSSLength(el, computed.getPropertyValue(cssVars.boundaryOffset))
	};
}
/**
* Measure the popup's layout box for positioning.
*
* `getBoundingClientRect()` includes active transforms, which causes the fallback position to drift while
* opening/closing animations scale the popup. Using layout dimensions preserves the untransformed size, while the
* side-axis scroll dimension includes content clipped by size constraints.
*/
function getPopupPositionRect(el, side) {
	const rect = el.getBoundingClientRect();
	const size = getElementSize(el, {
		box: "layout",
		overflow: side === "left" || side === "right" ? "width" : "height"
	});
	return createDOMRect(rect.left, rect.top, size.width, size.height);
}
/**
* The viewport origin of the box a `position: fixed` popup is placed against. A `[popover]` popup is placed against the
* viewport wherever the Popover API exists, including while it is still closed: the first position runs before
* `showPopover()` moves it to the top layer. Without the Popover API it stays in the page, where an ancestor with a
* transform, filter, or containment becomes its containing block instead, and engines disagree about which properties
* count. A fixed probe beside the popup lands on that origin whatever the engine decides, and the popup's own
* transitions cannot move it.
*/
function getFixedContainingBlockOrigin(popup) {
	const parent = popup.parentNode;
	if (opensInTopLayer(popup) || !parent) return {
		x: 0,
		y: 0
	};
	const probe = popup.ownerDocument.createElement("div");
	probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;visibility:hidden;pointer-events:none";
	parent.insertBefore(probe, popup);
	const rect = probe.getBoundingClientRect();
	probe.remove();
	return {
		x: rect.left,
		y: rect.top
	};
}
/** Move a rect into a coordinate space whose origin sits at `origin` in the viewport. */
function offsetRect(rect, origin) {
	return createDOMRect(rect.left - origin.x, rect.top - origin.y, rect.width, rect.height);
}
function opensInTopLayer(popup) {
	return popup.hasAttribute("popover") && supportsPopoverAPI();
}

//#endregion
//#region ../core/dist/dev/dom/ui/popover/positioner.js
const POPUP_STYLE_PROPS = [
	"position",
	"inset",
	"margin",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"justify-self",
	"align-self",
	"margin-inline-start",
	"margin-block-start",
	"translate",
	"top",
	"right",
	"bottom",
	"left"
];
/**
* Positions a popup and tracks layout changes while it is active.
*
* @internal
*/
var PopupPositioner = class {
	#options = null;
	#boundaryElement = null;
	#abort = null;
	#stopObservingResize = null;
	#triggerAnchorName = null;
	#triggerAnchorAdded = false;
	#popupAnchor = null;
	#popupStyles = null;
	#reposition = rafThrottle(() => this.#position());
	sync(options) {
		const { anchorName, position, trigger, popup, boundary, container, cssVars = PopoverCSSVars } = options;
		if (!position || !trigger || !popup) {
			this.cleanup();
			return;
		}
		const boundaryElement = resolvePositioningBoundary(boundary, {
			container: container ?? null,
			root: popup.getRootNode()
		});
		const previous = this.#options;
		if (!previous || previous.anchorName !== anchorName || previous.trigger !== trigger || previous.popup !== popup || (previous.cssVars ?? PopoverCSSVars) !== cssVars || previous.trackResize !== options.trackResize || this.#boundaryElement !== boundaryElement) {
			if (previous?.popup) this.#restorePopupStyles(previous.popup);
			this.#stopTracking();
			this.#options = {
				...options,
				cssVars
			};
			this.#boundaryElement = boundaryElement;
			this.#startTracking();
		} else this.#options = {
			...options,
			cssVars
		};
		this.#position();
	}
	cleanup() {
		if (!this.#options) return;
		if (this.#options.popup) this.#restorePopupStyles(this.#options.popup);
		this.#stopTracking();
		this.#options = null;
		this.#boundaryElement = null;
	}
	#startTracking() {
		const options = this.#options;
		if (!options?.trigger || !options.popup) return;
		this.#applyAnchorStyles(options.trigger, options.popup, options.anchorName);
		this.#abort = new AbortController();
		const { signal } = this.#abort;
		window.addEventListener("scroll", this.#schedule, {
			capture: true,
			passive: true,
			signal
		});
		window.addEventListener("resize", this.#schedule, { signal });
		const resizeTargets = [options.trigger];
		if (options.trackResize !== false) resizeTargets.push(options.popup);
		if (this.#boundaryElement) resizeTargets.push(this.#boundaryElement);
		this.#stopObservingResize = observeResize(resizeTargets, () => this.#schedule());
	}
	#stopTracking() {
		this.#abort?.abort();
		this.#abort = null;
		this.#stopObservingResize?.();
		this.#stopObservingResize = null;
		this.#reposition.cancel();
		this.#restoreAnchorStyles();
	}
	#schedule = (event) => {
		const popup = this.#options?.popup;
		if (!popup || event && isEventWithinElement(event, popup)) return;
		this.#reposition();
	};
	#position() {
		const options = this.#options;
		if (!options?.position || !options.trigger || !options.popup) return;
		const trigger = options.trigger;
		const anchorSupported = supportsAnchorPositioning();
		const origin = anchorSupported ? {
			x: 0,
			y: 0
		} : getFixedContainingBlockOrigin(options.popup);
		const triggerRect = offsetRect(trigger.getBoundingClientRect(), origin);
		const boundaryRect = offsetRect(getPositioningBoundaryRect(this.#boundaryElement), origin);
		const offsets = resolveOffsets(options.popup, options.cssVars);
		const preferredPosition = options.position;
		const measure = () => offsetRect(getPopupPositionRect(options.popup, preferredPosition.side), origin);
		const getPosition = (popupRect) => {
			const side = getPositionedSide(triggerRect, popupRect, boundaryRect, preferredPosition, offsets);
			const { positionAnchor: _, ...style } = getAnchorPositionStyle(options.anchorName, {
				...preferredPosition,
				side,
				direction: isRTL(trigger) ? "rtl" : "ltr"
			}, triggerRect, anchorSupported ? void 0 : popupRect, boundaryRect, offsets, options.cssVars);
			return {
				popupRect,
				side,
				style
			};
		};
		const position = getPosition(measure());
		this.#capturePopupStyles(options.popup, options.cssVars ?? PopoverCSSVars);
		applyStyles(options.popup, position.style);
		options.onSideChange?.(position.side);
		if (anchorSupported || !options.onSideChange) return;
		const popupRect = measure();
		if (popupRect.width === position.popupRect.width && popupRect.height === position.popupRect.height) return;
		const nextPosition = getPosition(popupRect);
		applyStyles(options.popup, nextPosition.style);
		if (nextPosition.side !== position.side) options.onSideChange(nextPosition.side);
	}
	#capturePopupStyles(popup, cssVars) {
		if (this.#popupStyles) return;
		const props = [
			...POPUP_STYLE_PROPS,
			cssVars.anchorWidth,
			cssVars.anchorHeight,
			cssVars.availableWidth,
			cssVars.availableHeight
		];
		this.#popupStyles = snapshotInlineStyles(popup, props);
	}
	#restorePopupStyles(popup) {
		if (!this.#popupStyles) return;
		restoreInlineStyles(popup, this.#popupStyles);
		this.#popupStyles = null;
	}
	#applyAnchorStyles(trigger, popup, anchorName) {
		if (!supportsAnchorPositioning()) return;
		const generatedName = `--${anchorName}`;
		const triggerAnchor = this.#readStyle(trigger, "anchor-name");
		this.#popupAnchor = this.#readStyle(popup, "position-anchor");
		const names = getAnchorNames(trigger);
		this.#triggerAnchorName = generatedName;
		this.#triggerAnchorAdded = !names.includes(generatedName);
		if (this.#triggerAnchorAdded) names.push(generatedName);
		trigger.style.setProperty("anchor-name", names.join(", "), triggerAnchor.priority);
		popup.style.setProperty("position-anchor", generatedName);
	}
	#restoreAnchorStyles() {
		const options = this.#options;
		if (!options?.trigger || !options.popup) return;
		if (this.#triggerAnchorName && this.#triggerAnchorAdded) {
			const current = this.#readStyle(options.trigger, "anchor-name");
			const names = getAnchorNames(options.trigger).filter((name) => name !== this.#triggerAnchorName);
			this.#writeStyle(options.trigger, "anchor-name", {
				value: names.join(", "),
				priority: current.priority
			});
		}
		if (this.#popupAnchor) this.#writeStyle(options.popup, "position-anchor", this.#popupAnchor);
		this.#triggerAnchorName = null;
		this.#triggerAnchorAdded = false;
		this.#popupAnchor = null;
	}
	#readStyle(element, prop) {
		const name = prop.startsWith("--") ? prop : kebabCase(prop);
		return {
			value: element.style.getPropertyValue(name),
			priority: element.style.getPropertyPriority(name)
		};
	}
	#writeStyle(element, prop, style) {
		const name = prop.startsWith("--") ? prop : kebabCase(prop);
		if (style.value) element.style.setProperty(name, style.value, style.priority);
		else element.style.removeProperty(name);
	}
};

//#endregion
//#region ../html/dist/dev/ui/position-controller.js
let popupId = 0;
/** Connects a popup element to the shared positioning lifecycle. */
var PositionController = class {
	#host;
	#positioner = new PopupPositioner();
	#implicitBinding = null;
	constructor(host) {
		this.#host = host;
		host.addController(this);
	}
	/** Discover an explicit trigger by ID or one linked via `commandfor`. */
	findTrigger(trigger) {
		const root = this.#host.getRootNode();
		if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
			this.#releaseImplicitBinding();
			return null;
		}
		const scopedRoot = root;
		if (trigger) {
			this.#releaseImplicitBinding();
			return scopedRoot.getElementById(trigger);
		}
		if (this.#implicitBinding) {
			const { id, trigger: boundTrigger } = this.#implicitBinding;
			if (this.#host.id === id && boundTrigger.getAttribute("commandfor") === id && this.#host.previousElementSibling === boundTrigger) return boundTrigger;
			this.#releaseImplicitBinding();
		}
		if (this.#host.id) return scopedRoot.querySelector(`[commandfor="${this.#host.id}"]`);
		const adjacent = this.#host.previousElementSibling;
		if (!(adjacent instanceof HTMLElement)) {
			console.warn(`[${this.#host.localName}] No trigger was found. Place the popup immediately after its trigger or link them explicitly.`);
			return null;
		}
		const claimedTarget = adjacent.getAttribute("commandfor");
		if (claimedTarget) {
			console.warn(`[${this.#host.localName}] The adjacent trigger already targets \`${claimedTarget}\`; link this popup explicitly.`);
			return null;
		}
		const id = nextPopupId(scopedRoot);
		this.#host.id = id;
		adjacent.setAttribute("commandfor", id);
		this.#implicitBinding = {
			id,
			trigger: adjacent
		};
		return adjacent;
	}
	sync(options) {
		this.#positioner.sync({
			...options,
			popup: this.#host
		});
	}
	cleanup() {
		this.#positioner.cleanup();
	}
	hostDisconnected() {
		this.cleanup();
		this.#releaseImplicitBinding();
	}
	hostDestroyed() {
		this.cleanup();
		this.#releaseImplicitBinding();
	}
	#releaseImplicitBinding() {
		const binding = this.#implicitBinding;
		if (!binding) return;
		if (binding.trigger.getAttribute("commandfor") === binding.id) binding.trigger.removeAttribute("commandfor");
		if (this.#host.id === binding.id) this.#host.removeAttribute("id");
		this.#implicitBinding = null;
	}
};
function nextPopupId(root) {
	let id;
	do
		id = `vjs-popup-${++popupId}`;
	while (root.getElementById(id));
	return id;
}

//#endregion
export { PositionController as t };
//# sourceMappingURL=position-controller-qaVECOVu.js.map