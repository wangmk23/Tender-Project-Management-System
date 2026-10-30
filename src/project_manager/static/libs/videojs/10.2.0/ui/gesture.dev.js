/*! Video.js | https://videojs.org/help */
import { i as isFunction } from "../predicate-3rF1m2uv.js";
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { h as getGestureCoordinator, v as getGestureActionValue } from "../volume-aFyxrX8a.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext, t as containerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { n as ignoreRejection, t as MEDIA_INPUT_ACTION_OVERRIDES } from "../media-actions-C6Q2FwKk.js";

//#region ../core/dist/dev/dom/gesture/actions.js
/** Actions that need custom logic beyond `store.state[action]()`. */
const GESTURE_ACTION_OVERRIDES = {
	togglePaused: MEDIA_INPUT_ACTION_OVERRIDES.togglePaused,
	toggleMuted: MEDIA_INPUT_ACTION_OVERRIDES.toggleMuted,
	toggleFullscreen: MEDIA_INPUT_ACTION_OVERRIDES.toggleFullscreen,
	togglePictureInPicture: MEDIA_INPUT_ACTION_OVERRIDES.togglePictureInPicture,
	seekStep: MEDIA_INPUT_ACTION_OVERRIDES.seekStep,
	volumeStep: MEDIA_INPUT_ACTION_OVERRIDES.volumeStep,
	speedUp: MEDIA_INPUT_ACTION_OVERRIDES.speedUp,
	speedDown: MEDIA_INPUT_ACTION_OVERRIDES.speedDown
};
/** @internal */
function resolveGestureAction(name) {
	const override = GESTURE_ACTION_OVERRIDES[name];
	if (override) return override;
	return ({ store }) => {
		const method = store.state[name];
		if (isFunction(method)) ignoreRejection(method());
		else console.warn(`[vjs-gesture] Unknown action: "${name}"`);
	};
}

//#endregion
//#region ../core/dist/dev/dom/gesture/tap.js
const DOUBLETAP_WINDOW = 200;
/**
* Recognizes tap vs doubletap from quick pointer-up events.
*
* Stateful recognizer — tracks tap count and doubletap timing. The coordinator handles pointer-down timing (tap
* threshold) and calls `handleUp()` only for quick taps that passed the threshold check.
*/
var TapRecognizer = class {
	#lastTapTime = 0;
	#tapTimer = null;
	handleUp(matches, event) {
		if (matches.resolve("doubletap").length > 0) {
			const now = Date.now();
			if (now - this.#lastTapTime < DOUBLETAP_WINDOW) {
				this.#clearTimer();
				this.#lastTapTime = 0;
				matches.resolve("doubletap")[0]?.onActivate(event);
				return;
			}
			this.#lastTapTime = now;
			this.#clearTimer();
			this.#tapTimer = setTimeout(() => {
				this.#tapTimer = null;
				this.#lastTapTime = 0;
				matches.resolve("tap")[0]?.onActivate(event);
			}, DOUBLETAP_WINDOW);
			return;
		}
		matches.resolve("tap")[0]?.onActivate(event);
	}
	#clearTimer() {
		if (this.#tapTimer !== null) {
			clearTimeout(this.#tapTimer);
			this.#tapTimer = null;
		}
	}
	reset() {
		this.#clearTimer();
		this.#lastTapTime = 0;
	}
};

//#endregion
//#region ../core/dist/dev/dom/gesture/create-tap-gesture.js
const recognizers = /* @__PURE__ */ new WeakMap();
function getRecognizer(target) {
	let recognizer = recognizers.get(target);
	if (recognizer) return recognizer;
	recognizer = new TapRecognizer();
	recognizers.set(target, recognizer);
	return recognizer;
}
/**
* Register a tap gesture on a target element.
*
* @example
*   ```ts
*   const cleanup = createTapGesture(
*     container,
*     (event) => {
*       store.paused ? store.play() : store.pause();
*     },
*     { pointer: 'mouse' }
*   );
*   ```;
*
* @internal
*/
function createTapGesture(target, onActivate, options) {
	return getGestureCoordinator(target).add({
		type: "tap",
		recognizer: getRecognizer(target),
		onActivate,
		pointer: options?.pointer,
		region: options?.region,
		disabled: options?.disabled,
		action: options?.action,
		value: options?.value
	});
}
/**
* Register a doubletap gesture on a target element.
*
* @example
*   ```ts
*   const cleanup = createDoubleTapGesture(
*     container,
*     (event) => {
*       store.isFullscreen ? store.exitFullscreen() : store.requestFullscreen();
*     },
*     { region: 'center' }
*   );
*   ```;
*
* @internal
*/
function createDoubleTapGesture(target, onActivate, options) {
	return getGestureCoordinator(target).add({
		type: "doubletap",
		recognizer: getRecognizer(target),
		onActivate,
		pointer: options?.pointer,
		region: options?.region,
		disabled: options?.disabled,
		action: options?.action,
		value: options?.value
	});
}

//#endregion
//#region ../html/dist/dev/ui/gesture/element.js
var GestureElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.type = "";
		this.action = "";
		this.value = void 0;
		this.pointer = void 0;
		this.region = void 0;
		this.disabled = false;
		this.#player = new PlayerController(this, playerContext);
		this.#container = new ContextConsumer(this, {
			context: containerContext,
			callback: () => this.requestUpdate(),
			subscribe: true
		});
		this.#cleanup = null;
	}
	static {
		this.tagName = "media-gesture";
	}
	static {
		this.properties = {
			type: { type: String },
			action: { type: String },
			value: { type: Number },
			pointer: { type: String },
			region: { type: String },
			disabled: { type: Boolean }
		};
	}
	#player;
	#container;
	#cleanup;
	connectedCallback() {
		super.connectedCallback();
		this.style.display = "none";
		this.#register();
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#unregister();
	}
	update(changed) {
		super.update(changed);
		if (this.isConnected) {
			this.#unregister();
			this.#register();
		}
	}
	#register() {
		const store = this.#player.value;
		const container = this.#container.value?.container;
		if (!this.type || !this.action || !store || !container) return;
		const resolver = resolveGestureAction(this.action);
		if (!resolver) return;
		const { value, region } = this;
		const actionValue = getGestureActionValue(this.action, region, value);
		const onActivate = (event) => {
			resolver({
				store,
				value: actionValue,
				event
			});
		};
		const options = {
			pointer: this.pointer,
			region,
			disabled: this.disabled,
			action: this.action,
			value: actionValue
		};
		if (this.type === "doubletap") this.#cleanup = createDoubleTapGesture(container, onActivate, options);
		else if (this.type === "tap") this.#cleanup = createTapGesture(container, onActivate, options);
	}
	#unregister() {
		this.#cleanup?.();
		this.#cleanup = null;
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/gesture.js
safeDefine(GestureElement);

//#endregion
//# sourceMappingURL=gesture.dev.js.map