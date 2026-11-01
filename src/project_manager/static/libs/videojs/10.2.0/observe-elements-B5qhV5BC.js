import { t as noop } from "./noop-DBLxABor.js";
import { n as watchDevicePixelRatio, t as getDevicePixelRatio } from "./device-pixel-ratio-BSKOBkaO.js";

//#region ../utils/dist/dom/observe-elements.js
/**
* Observe one or more elements for size changes and return a cleanup function.
*
* @internal
*/
function observeResize(elements, callback) {
	if (typeof ResizeObserver === "undefined") return noop;
	const observer = new ResizeObserver(callback);
	const targets = Symbol.iterator in Object(elements) ? elements : [elements];
	for (const element of targets) observer.observe(element);
	return () => observer.disconnect();
}
/**
* Observe a dynamically resolved element set. When the optional root mutates, the set is resolved again before
* `onChange` is called.
*
* @internal
*/
function observeElements({ getElements, onChange, root, mutations }) {
	let stopObservingResize = noop;
	const observeCurrentElements = () => {
		stopObservingResize();
		stopObservingResize = observeResize(getElements(), onChange);
	};
	observeCurrentElements();
	let mutationObserver = null;
	if (root && mutations !== false && typeof MutationObserver !== "undefined") {
		mutationObserver = new MutationObserver(() => {
			observeCurrentElements();
			onChange();
		});
		mutationObserver.observe(root, mutations ?? { childList: true });
	}
	return () => {
		mutationObserver?.disconnect();
		stopObservingResize();
	};
}
function toElementSize(entry) {
	const box = entry.contentBoxSize[0];
	return {
		width: box?.inlineSize ?? 0,
		height: box?.blockSize ?? 0
	};
}
/**
* Call `onResize` with `element`'s content box whenever it changes, starting with the observer's initial delivery.
* Returns a cleanup function.
*
* @internal
*/
function observeElementSize(element, onResize) {
	return observeResize(element, (entries) => {
		const entry = entries[entries.length - 1];
		if (entry) onResize(toElementSize(entry));
	});
}
/**
* Call `onResize` with `element`'s content box and the current `devicePixelRatio` whenever either changes. Returns a
* cleanup function to stop both watchers.
*
* @internal
*/
function observeRenderedSize(element, onResize) {
	let size;
	const emit = () => {
		if (size) onResize({
			...size,
			scale: getDevicePixelRatio()
		});
	};
	const stopObservingSize = observeElementSize(element, (next) => {
		size = next;
		emit();
	});
	const stopWatchingDevicePixelRatio = watchDevicePixelRatio(emit);
	return () => {
		stopObservingSize();
		stopWatchingDevicePixelRatio();
	};
}

//#endregion
export { observeResize as i, observeElements as n, observeRenderedSize as r, observeElementSize as t };
//# sourceMappingURL=observe-elements-B5qhV5BC.js.map