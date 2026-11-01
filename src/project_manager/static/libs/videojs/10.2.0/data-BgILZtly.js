import { o as isNull } from "./predicate-3rF1m2uv.js";
import { t as defaults } from "./defaults-nT7MwJ_t.js";
import { a as isPointInElement } from "./layout-BqK_K8jO.js";
import { i as observeResize } from "./observe-elements-B5qhV5BC.js";
import { t as createState } from "./state-DLDF0q4U.js";
import { n as roundToStep, r as toPercent, t as clamp } from "./number-D2skb7-A.js";
import { t as resolveLabel } from "./resolve-label-DhVHkW_N.js";

//#region ../utils/dist/function/throttle.js
/**
* Throttle: limits `fn` to at most once per `ms` window.
*
* - Default (no options): trailing-edge only — the first call schedules a timer; subsequent calls within the window
*   update the arguments. The function fires once per window with the latest arguments.
* - `{ leading: true }`: leading + trailing — the first call invokes immediately and opens a cooldown window. Subsequent
*   calls within the window are coalesced to a single trailing-edge invocation.
*
* @internal
*/
function throttle(fn, ms, options) {
	const leading = options?.leading ?? false;
	let timerId = null;
	let latestArgs;
	let hasPending = false;
	function startCooldown() {
		timerId = setTimeout(() => {
			timerId = null;
			if (hasPending) {
				hasPending = false;
				fn(...latestArgs);
				startCooldown();
			}
		}, ms);
	}
	const throttled = (...args) => {
		latestArgs = args;
		if (leading) {
			if (timerId === null) {
				fn(...latestArgs);
				startCooldown();
			} else hasPending = true;
		} else {
			if (timerId !== null) return;
			timerId = setTimeout(() => {
				timerId = null;
				fn(...latestArgs);
			}, ms);
		}
	};
	throttled.cancel = () => {
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
		hasPending = false;
	};
	return throttled;
}

//#endregion
//#region ../core/dist/dev/dom/utils/pointer.js
/**
* Convert a pointer event position to a 0–100 percent along an element's rect.
*
* @internal
*/
function getPercentFromPointerEvent(event, rect, orientation) {
	let ratio;
	if (orientation === "vertical") ratio = 1 - (event.clientY - rect.top) / rect.height;
	else ratio = (event.clientX - rect.left) / rect.width;
	if (!Number.isFinite(ratio)) return 0;
	return clamp(ratio * 100, 0, 100);
}

//#endregion
//#region ../core/dist/dev/dom/ui/slider/slider.js
const DRAG_THRESHOLD = 3;
/** @internal */
function createSlider(options) {
	const input = createState({
		pointerPercent: 0,
		dragPercent: 0,
		dragging: false,
		pointing: false,
		focused: false
	});
	const abort = new AbortController();
	const changeThrottleMs = options.changeThrottle ?? 0;
	let isPointerDown = false, cachedRect = null, capturedPointerId = null, pointerDownX = 0, pointerDownY = 0, lastDragPercent = 0, lastKeyPercent = null, committedOnRelease = false, pointingOnRelease = false;
	const throttledChange = changeThrottleMs > 0 ? throttle((percent) => options.onValueChange?.(percent), changeThrottleMs, { leading: true }) : null;
	/** Fire `onValueChange` — throttled during drag when `changeThrottle > 0`. */
	function fireChange(percent, duringDrag) {
		if (duringDrag && throttledChange) throttledChange(percent);
		else options.onValueChange?.(percent);
	}
	function releaseCapture() {
		if (isNull(capturedPointerId)) return;
		const id = capturedPointerId;
		capturedPointerId = null;
		try {
			options.getElement().releasePointerCapture(id);
		} catch {}
	}
	function endDrag() {
		if (!isPointerDown) return;
		const pointing = committedOnRelease && pointingOnRelease;
		const wasDragging = input.current.dragging;
		if (!committedOnRelease) options.onValueCommit?.(lastDragPercent);
		isPointerDown = false;
		input.patch({
			dragging: false,
			pointing
		});
		if (wasDragging) options.onDragEnd?.();
		options.onPressEnd?.();
		committedOnRelease = false;
		pointingOnRelease = false;
		cleanup();
	}
	function cleanup() {
		throttledChange?.cancel();
		capturedPointerId = null;
		cachedRect = null;
	}
	const rootProps = {
		onPointerDown(event) {
			if (options.isDisabled()) return;
			event.stopPropagation();
			event.preventDefault();
			const el = options.getElement();
			cachedRect = el.getBoundingClientRect();
			committedOnRelease = false;
			pointingOnRelease = false;
			releaseCapture();
			capturedPointerId = event.pointerId;
			el.setPointerCapture(event.pointerId);
			const percent = getPercentFromPointerEvent(event, cachedRect, options.getOrientation());
			isPointerDown = true;
			pointerDownX = event.clientX;
			pointerDownY = event.clientY;
			lastDragPercent = percent;
			lastKeyPercent = percent;
			input.patch({
				pointing: true,
				pointerPercent: percent,
				dragPercent: percent
			});
			options.onPressStart?.();
			options.onValueChange?.(percent);
			options.getThumbElement?.()?.focus({
				preventScroll: true,
				focusVisible: false
			});
		},
		onPointerMove(event) {
			if (options.isDisabled()) return;
			if (!isNull(capturedPointerId)) {
				if (event.pointerType !== "touch" && event.buttons === 0) {
					endDrag();
					return;
				}
				const percent = getPercentFromPointerEvent(event, cachedRect, options.getOrientation());
				const startingDrag = !input.current.dragging;
				if (startingDrag) {
					if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) < DRAG_THRESHOLD) return;
				}
				lastDragPercent = percent;
				lastKeyPercent = percent;
				input.patch({
					dragging: true,
					dragPercent: percent,
					pointerPercent: percent
				});
				if (startingDrag) options.onDragStart?.();
				fireChange(percent, true);
				return;
			}
			const rect = options.getElement().getBoundingClientRect();
			const percent = getPercentFromPointerEvent(event, rect, options.getOrientation());
			input.patch({
				pointing: true,
				pointerPercent: percent
			});
		},
		onPointerUp(event) {
			if (options.isDisabled()) return;
			event.stopPropagation();
			if (isNull(capturedPointerId)) return;
			const percent = getPercentFromPointerEvent(event, cachedRect, options.getOrientation());
			pointingOnRelease = event.pointerType !== "touch" && isPointInElement(options.getElement(), event);
			throttledChange?.cancel();
			options.onValueChange?.(percent);
			options.onValueCommit?.(percent);
			committedOnRelease = true;
		},
		onPointerLeave() {
			if (!isNull(capturedPointerId)) return;
			input.patch({ pointing: false });
		},
		onLostPointerCapture() {
			endDrag();
		}
	};
	const thumbProps = {
		onKeyDownCapture(event) {
			if (options.isDisabled()) {
				if (event.key !== "Tab") event.preventDefault();
				return;
			}
			const stepPercent = options.getStepPercent();
			const largeStepPercent = options.getLargeStepPercent();
			const currentPercent = event.repeat && !isNull(lastKeyPercent) ? lastKeyPercent : options.getPercent();
			const rounded = roundToStep(currentPercent, stepPercent, 0);
			const step = event.shiftKey ? largeStepPercent : stepPercent;
			let newPercent = null;
			switch (event.key) {
				case "ArrowRight":
					newPercent = rounded + step;
					break;
				case "ArrowLeft":
					newPercent = rounded - step;
					break;
				case "ArrowUp":
					newPercent = rounded + step;
					break;
				case "ArrowDown":
					newPercent = rounded - step;
					break;
				case "PageUp":
					newPercent = rounded + largeStepPercent;
					break;
				case "PageDown":
					newPercent = rounded - largeStepPercent;
					break;
				case "Home":
					newPercent = 0;
					break;
				case "End": newPercent = 100;
			}
			if (newPercent !== null) {
				event.preventDefault();
				newPercent = clamp(newPercent, 0, 100);
				lastKeyPercent = newPercent;
				input.patch({
					pointerPercent: newPercent,
					dragPercent: newPercent,
					pointing: false
				});
				options.onValueChange?.(newPercent);
				options.onValueCommit?.(newPercent);
			}
		},
		onFocus() {
			input.patch({ focused: true });
		},
		onBlur() {
			input.patch({ focused: false });
		}
	};
	function adjustForAlignment(state) {
		if (!options.adjustPercent || state.thumbAlignment !== "edge") return state;
		const rootEl = options.getElement();
		const thumbEl = options.getThumbElement?.();
		if (!thumbEl) return state;
		const isHorizontal = state.orientation === "horizontal";
		const thumbSize = isHorizontal ? thumbEl.offsetWidth : thumbEl.offsetHeight;
		const trackSize = isHorizontal ? rootEl.offsetWidth : rootEl.offsetHeight;
		return {
			...state,
			fillPercent: options.adjustPercent(state.fillPercent, thumbSize, trackSize),
			pointerPercent: options.adjustPercent(state.pointerPercent, thumbSize, trackSize)
		};
	}
	let stopObservingResize = null;
	if (options.onResize) stopObservingResize = observeResize(options.getElement(), () => options.onResize());
	return {
		input,
		rootProps,
		rootStyle: {
			touchAction: "none",
			userSelect: "none"
		},
		thumbProps,
		adjustForAlignment,
		destroy() {
			if (abort.signal.aborted) return;
			abort.abort();
			stopObservingResize?.();
			releaseCapture();
			cleanup();
		}
	};
}

//#endregion
//#region ../core/dist/dev/core/ui/slider/core.js
/**
* Base slider logic: value mapping, ARIA attrs, and step calculations.
*
* @internal
*/
var SliderCore = class SliderCore {
	static defaultProps = {
		label: "",
		step: 1,
		largeStep: 10,
		orientation: "horizontal",
		disabled: false,
		thumbAlignment: "center",
		value: 0,
		min: 0,
		max: 100
	};
	static defaultInput = {
		pointerPercent: 0,
		dragPercent: 0,
		dragging: false,
		pointing: false,
		focused: false
	};
	#props = { ...SliderCore.defaultProps };
	#input = { ...SliderCore.defaultInput };
	get props() {
		return this.#props;
	}
	get input() {
		return this.#input;
	}
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, SliderCore.defaultProps);
	}
	setInput(input) {
		this.#input = input;
	}
	getSliderState(value) {
		const { orientation, disabled, thumbAlignment } = this.#props;
		const { pointerPercent, dragging, pointing, focused } = this.#input;
		return {
			value,
			fillPercent: this.percentFromValue(value),
			pointerPercent,
			dragging,
			pointing,
			interactive: dragging || pointing || focused,
			orientation,
			disabled,
			thumbAlignment
		};
	}
	getLabel(state) {
		return resolveLabel(this.#props.label, state) || "";
	}
	getAttrs(state) {
		return {
			role: "slider",
			tabIndex: state.disabled ? -1 : 0,
			autoComplete: "off",
			"aria-label": this.getLabel(state),
			"aria-valuemin": this.#props.min,
			"aria-valuemax": this.#props.max,
			"aria-valuenow": state.value,
			"aria-orientation": state.orientation,
			"aria-disabled": state.disabled ? "true" : void 0
		};
	}
	valueFromPercent(percent) {
		const { min, max, step } = this.#props;
		const raw = min + percent / 100 * (max - min);
		return roundToStep(clamp(raw, min, max), step, min);
	}
	/** Convert percent to a clamped value without applying step rounding. */
	rawValueFromPercent(percent) {
		const { min, max } = this.#props;
		return clamp(min + percent / 100 * (max - min), min, max);
	}
	percentFromValue(value) {
		const { min, max } = this.#props;
		return toPercent(value, min, max);
	}
	/** Step as a percentage of the slider range. */
	getStepPercent() {
		const { step, min, max } = this.#props;
		const range = max - min;
		return range > 0 ? step / range * 100 : 0;
	}
	/** Large step as a percentage of the slider range. */
	getLargeStepPercent() {
		const { largeStep, min, max } = this.#props;
		const range = max - min;
		return range > 0 ? largeStep / range * 100 : 0;
	}
	adjustPercentForAlignment(rawPercent, thumbSize, trackSize) {
		if (this.#props.thumbAlignment === "center" || trackSize === 0) return rawPercent;
		const thumbHalf = thumbSize / trackSize * 100 / 2;
		const minPercent = thumbHalf;
		const maxPercent = 100 - thumbHalf;
		return minPercent + rawPercent / 100 * (maxPercent - minPercent);
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/slider/data.js
/** @internal */
const SliderDataAttrs = {
	/** Present when the user is actively dragging. */
	dragging: "data-dragging",
	/** Present when the pointer is over the slider. */
	pointing: "data-pointing",
	/** Present when dragging, pointing, or focus is active. */
	interactive: "data-interactive",
	/** Current axis of slider movement (`horizontal` or `vertical`). */
	orientation: "data-orientation",
	/** Present when the slider is non-interactive. */
	disabled: "data-disabled"
};

//#endregion
export { SliderCore as n, createSlider as r, SliderDataAttrs as t };
//# sourceMappingURL=data-BgILZtly.js.map