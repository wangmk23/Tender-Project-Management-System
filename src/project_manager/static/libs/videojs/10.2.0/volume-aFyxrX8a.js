import { c as isObject, f as isUndefined, i as isFunction, o as isNull } from "./predicate-3rF1m2uv.js";
import { r as getLocaleKey, s as DEFAULT_LOCALE, t as findLocaleKeys } from "./i18n-ByQGZLGb.js";
import { t as listen } from "./listen-CO63BggB.js";
import { t as noop } from "./noop-DBLxABor.js";
import { n as onEvent, r as resolveEventTarget, t as anyAbortSignal } from "./abort-DsWgOZ8b.js";
import { a as isPointInElement } from "./layout-BqK_K8jO.js";
import { n as getCaptionOrSubtitleTracks, r as isCaptionOrSubtitleTrack, t as findTrackElement } from "./text-track-CnWDzah_.js";
import { t as isWebKitAirPlayCapable } from "./webkit-DXmoZ2Wz.js";
import { n as getRegisteredMedia } from "./registered-media-Xx5cjTln.js";
import { r as toMediaCrossOrigin, t as MediaReadyState } from "./types-D8a85nGw.js";
import { C as isQuerySelectorAllCapable, S as isMediaVolumeCapable, _ as isMediaSourceCapable, a as isMediaAudioTrackCapable, b as isMediaVideoDimensionsCapable, c as isMediaErrorCapable, d as isMediaPauseCapable, f as isMediaPictureInPictureCapable, g as isMediaSeekCapable, h as isMediaRemotePlaybackCapable, l as isMediaLiveCapable, n as hasMetadata, o as isMediaBufferCapable, p as isMediaPlaybackRateCapable, s as isMediaContentDataCapable, u as isMediaMutedCapable, x as isMediaVideoRenditionCapable, y as isMediaTextTrackCapable } from "./predicate-VHPnHoui.js";
import { t as isInteractionLocked } from "./interaction-lock-1oRjjx9B.js";

//#region ../utils/dist/dom/animation-frame.js
/**
* Request an animation frame with cleanup.
*
* @example
*   ```ts
*   const cancel = animationFrame((time) => console.log('Frame at', time));
*   cancel(); // Cancel if needed
*   ```;
*
* @internal
*/
function animationFrame(callback) {
	const id = requestAnimationFrame(callback);
	return () => cancelAnimationFrame(id);
}

//#endregion
//#region ../utils/dist/dom/interactive.js
/** @internal */
const INTERACTIVE_SELECTOR = [
	"button",
	"input",
	"select",
	"textarea",
	"a[href]",
	"[role=\"button\"]",
	"[role=\"menu\"]",
	"[role=\"menuitem\"]",
	"[role=\"menuitemcheckbox\"]",
	"[role=\"menuitemradio\"]",
	"[role=\"slider\"]",
	"[data-interactive]"
].join(",");
/** @internal */
const EDITABLE_SELECTOR = [
	"textarea",
	"select",
	"input:not([type])",
	...[
		"text",
		"search",
		"url",
		"tel",
		"email",
		"password",
		"number"
	].map((type) => `input[type="${type}"]`),
	"[contenteditable]:not([contenteditable=\"false\"])"
].join(",");
/** @internal */
function isEditableElement(el) {
	return el.matches(EDITABLE_SELECTOR);
}
/**
* Whether the keyboard event target is an editable element (input, textarea, etc).
*
* @internal
*/
function isEditableTarget(event) {
	const target = resolveEventTarget(event);
	return target instanceof Element && isEditableElement(target);
}
/**
* Whether the event originated from an interactive control (button, slider, etc).
*
* @internal
*/
function isInteractiveTarget(event) {
	const target = resolveEventTarget(event);
	if (!(target instanceof Element)) return false;
	return target.closest(INTERACTIVE_SELECTOR) !== null;
}
const ACTIVATION_KEYS = /* @__PURE__ */ new Set([" ", "Enter"]);
/**
* Selector for elements that use Space/Enter as a native activation key. Narrower than `INTERACTIVE_SELECTOR` —
* excludes editable elements like `input`, `textarea`, `select` where Space/Enter is text input, not activation.
*/
const ACTIVATABLE_SELECTOR = "button,a[href],[role=\"slider\"],[role=\"button\"]";
/**
* Whether the event is an activation key on an activatable element (button, link, slider).
*
* @internal
*/
function isInteractiveActivation(event) {
	if (!ACTIVATION_KEYS.has(event.key)) return false;
	const target = resolveEventTarget(event);
	return target instanceof Element && target.matches(ACTIVATABLE_SELECTOR);
}

//#endregion
//#region ../utils/dist/dom/time-ranges.js
/**
* Converts a TimeRanges object to an array of [start, end] tuples.
*
* @internal
*/
function serializeTimeRanges(ranges) {
	const result = [];
	for (let i = 0; i < ranges.length; i++) result.push([ranges.start(i), ranges.end(i)]);
	return result;
}

//#endregion
//#region ../store/dist/dev/core/abort-controller-registry.js
/** @internal */
var AbortControllerRegistry = class {
	#base;
	#keys = /* @__PURE__ */ new Map();
	/** The attach-scoped signal. Aborts on detach or reattach. */
	get base() {
		return (this.#base ??= new AbortController()).signal;
	}
	/** Clears all keyed signals, leaving base intact. */
	clear() {
		for (const controller of this.#keys.values()) controller.abort();
		this.#keys.clear();
	}
	/** Resets base and clears all keyed signals. */
	reset() {
		this.clear();
		this.#base?.abort();
		this.#base = void 0;
	}
	/** Creates a new signal for the key, superseding any previous signal. */
	supersede(key) {
		this.#keys.get(key)?.abort();
		const controller = new AbortController();
		this.#keys.set(key, controller);
		return anyAbortSignal([this.base, controller.signal]);
	}
};

//#endregion
//#region ../store/dist/dev/core/errors.js
/** @internal */
var StoreError = class extends Error {
	code;
	cause;
	constructor(code, options) {
		super(options?.message ?? code);
		this.name = "StoreError";
		this.code = code;
		this.cause = options?.cause;
	}
};
/** @internal */
function throwNoTargetError() {
	throw new StoreError("NO_TARGET");
}
/** @internal */
function throwDestroyedError() {
	throw new StoreError("DESTROYED");
}

//#endregion
//#region ../core/dist/dev/dom/feature.js
/** @internal */
function definePlayerFeature(definition) {
	const preserved = Object.values(definition.config ?? {}).map((entry) => entry.state);
	return {
		...definition,
		...preserved.length > 0 ? { preserve: preserved } : {}
	};
}
/**
* Merge the configuration declarations from the selected player features.
*
* @internal
*/
function combinePlayerFeatureConfigs(features) {
	const definitions = features.map((feature) => feature.config ?? {});
	{
		const seen = /* @__PURE__ */ new Set();
		for (const definition of definitions) for (const key of Object.keys(definition)) {
			if (seen.has(key)) console.warn(`[vjs-core] duplicate config key "${key}" — later feature overwrites earlier one`);
			seen.add(key);
		}
	}
	return Object.assign({}, ...definitions);
}
/**
* Forward one configuration input through its feature-owned private action.
*
* @internal
*/
function setPlayerConfigValue(store, entry, value) {
	const action = store[entry.action];
	if (typeof action !== "function") throw new TypeError(`Missing config action "${String(entry.action)}"`);
	action(value);
}

//#endregion
//#region ../core/dist/dev/dom/media-action-value.js
function getMediaInputActionValue(action, key, value) {
	if (!isUndefined(value)) return value;
	const normalizedKey = key?.toLowerCase();
	if (action === "seekStep") return normalizedKey === "arrowleft" || normalizedKey === "j" ? -10 : 10;
	if (action === "volumeStep") return normalizedKey === "arrowdown" ? -.05 : 5 / 100;
}

//#endregion
//#region ../core/dist/dev/dom/gesture/action-value.js
/**
* Resolves the effective value for a gesture action from its explicit value and region.
*
* @internal
*/
function getGestureActionValue(action, region, value) {
	if (action === "seekStep" && isUndefined(value) && region === "left") return -10;
	return getMediaInputActionValue(action, void 0, value);
}

//#endregion
//#region ../core/dist/dev/dom/store/features/audio-track.js
function getTrackValue(track, index) {
	return track.id || String(index);
}
function toMediaTrack(track, index) {
	return {
		id: getTrackValue(track, index),
		...track.kind !== void 0 && { kind: track.kind },
		label: track.label,
		language: track.language,
		enabled: track.enabled
	};
}
const audioTrackFeature = definePlayerFeature({
	name: "audioTrack",
	state: ({ target }) => ({
		audioTrackList: [],
		selectAudioTrack(value) {
			const { media } = target();
			if (!isMediaAudioTrackCapable(media)) return;
			const tracks = [...media.audioTracks];
			const track = tracks.find((candidate, index) => getTrackValue(candidate, index) === value);
			if (!track) return;
			for (const candidate of tracks) candidate.enabled = candidate === track;
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		let audioTracks = null;
		let cleanup = null;
		const getAudioTracks = () => isMediaAudioTrackCapable(media) ? media.audioTracks : null;
		const sync = (list = getAudioTracks()) => {
			set({ audioTrackList: list ? [...list].map(toMediaTrack) : [] });
		};
		const bind = () => {
			const nextAudioTracks = getAudioTracks();
			if (nextAudioTracks === audioTracks) {
				sync(nextAudioTracks);
				return;
			}
			cleanup?.abort();
			cleanup = new AbortController();
			audioTracks = nextAudioTracks;
			if (audioTracks) {
				listen(audioTracks, "addtrack", () => sync(audioTracks), { signal: cleanup.signal });
				listen(audioTracks, "removetrack", () => sync(audioTracks), { signal: cleanup.signal });
				listen(audioTracks, "change", () => sync(audioTracks), { signal: cleanup.signal });
			}
			sync(audioTracks);
		};
		bind();
		listen(media, "loadstart", bind, { signal });
		signal.addEventListener("abort", () => cleanup?.abort(), { once: true });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/buffer.js
const bufferFeature = definePlayerFeature({
	name: "buffer",
	state: () => ({
		buffered: [],
		seekable: []
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaBufferCapable(media)) return;
		const sync = () => set({
			buffered: serializeTimeRanges(media.buffered),
			seekable: serializeTimeRanges(media.seekable)
		});
		sync();
		listen(media, "loadedmetadata", sync, { signal });
		listen(media, "durationchange", sync, { signal });
		listen(media, "progress", sync, { signal });
		listen(media, "emptied", sync, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/gesture/region.js
/**
* Determine which named region a pointer position falls into.
*
* Regions divide the container width equally based on how many are active: - `left` + `right` → halves (50% / 50%) -
* `left` + `center` + `right` → thirds (33% / 34% / 33%)
*
* Single region: `left` covers the left half, `right` the right half, and `center` covers the full surface. Partial
* two-region combos (e.g. `left` + `center`) use the same natural zones — positions outside all active zones return
* `null` so full-surface gestures can handle them.
*/
function resolveRegion(clientX, containerRect, activeRegions) {
	const relativeX = clientX - containerRect.left;
	const width = containerRect.width;
	if (width === 0) return null;
	const ratio = relativeX / width;
	if (activeRegions.size === 2 && activeRegions.has("left") && activeRegions.has("right")) return ratio < .5 ? "left" : "right";
	if (activeRegions.size === 3) {
		if (ratio < 1 / 3) return "left";
		if (ratio < 2 / 3) return "center";
		return "right";
	}
	if (activeRegions.has("left") && ratio < .5) return "left";
	if (activeRegions.has("right") && ratio >= .5) return "right";
	if (activeRegions.has("center")) {
		if (activeRegions.size === 1) return "center";
		if (ratio >= 1 / 3 && ratio < 2 / 3) return "center";
	}
	return null;
}

//#endregion
//#region ../core/dist/dev/dom/gesture/coordinator.js
const TAP_THRESHOLD$1 = 250;
/** @internal */
var GestureCoordinator = class {
	#target;
	#bindings = [];
	#recognizers = /* @__PURE__ */ new Set();
	#disconnect = null;
	#subscribers = /* @__PURE__ */ new Set();
	constructor(target) {
		this.#target = target;
	}
	get bindings() {
		return this.#bindings;
	}
	subscribe(callback) {
		this.#subscribers.add(callback);
		return () => this.#subscribers.delete(callback);
	}
	/**
	* Whether a registered binding claims this tap for the given action. A claimed tap belongs to the gesture layer, so
	* callers should leave it alone. Taps on interactive targets (buttons, sliders) are never claimed — the same
	* filtering the pointerup listener applies. A disabled binding still claims: disabling a gesture opts out of the
	* action, it doesn't hand the tap back to a fallback handler.
	*/
	claimsTap(event, action) {
		if (isInteractionLocked(this.#target)) return true;
		if (isInteractiveTarget(event)) return false;
		return this.#bindings.some((b) => b.type === "tap" && b.action === action && (!b.pointer || b.pointer === event.pointerType));
	}
	add(binding) {
		const value = getGestureActionValue(binding.action ?? "", binding.region, binding.value);
		const wrapped = {
			...binding,
			value,
			onActivate: (event) => {
				if (this.#subscribers.size > 0) {
					const activateEvent = {
						type: binding.type,
						source: "gesture",
						action: binding.action,
						value,
						region: binding.region,
						pointer: binding.pointer,
						event
					};
					for (const cb of this.#subscribers) try {
						cb(activateEvent);
					} catch (error) {
						console.warn("[vjs-gesture] subscribe callback threw:", error);
					}
				}
				binding.onActivate(event);
			}
		};
		this.#bindings.push(wrapped);
		this.#recognizers.add(wrapped.recognizer);
		this.#connect();
		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			const idx = this.#bindings.indexOf(wrapped);
			if (idx !== -1) this.#bindings.splice(idx, 1);
			this.#maybeDisconnect();
		};
	}
	#connect() {
		if (this.#disconnect) return;
		this.#disconnect = new AbortController();
		const { signal } = this.#disconnect;
		let pointerDownTime = 0;
		listen(this.#target, "pointerdown", (event) => {
			if (isInteractionLocked(this.#target)) {
				pointerDownTime = 0;
				return;
			}
			if (event.button !== 0) return;
			pointerDownTime = Date.now();
		}, { signal });
		listen(this.#target, "pointerup", (event) => {
			if (isInteractionLocked(this.#target)) {
				pointerDownTime = 0;
				return;
			}
			if (event.button !== 0) return;
			if (Date.now() - pointerDownTime > TAP_THRESHOLD$1) return;
			if (isInteractiveTarget(event)) return;
			const pointerType = event.pointerType;
			const clientX = event.clientX;
			const target = this.#target;
			const bindings = this.#bindings;
			const matches = { resolve: (type) => matchBindings(bindings, type, pointerType, clientX, target) };
			for (const recognizer of this.#recognizers) recognizer.handleUp(matches, event);
		}, { signal });
	}
	#maybeDisconnect() {
		if (this.#bindings.length > 0) return;
		for (const recognizer of this.#recognizers) recognizer.reset();
		this.#recognizers.clear();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
};
const coordinators = /* @__PURE__ */ new WeakMap();
/**
* Look up the gesture coordinator for a target element, if one exists.
*
* @internal
*/
function findGestureCoordinator(target) {
	return coordinators.get(target);
}
/** @internal */
function getGestureCoordinator(target) {
	let coordinator = coordinators.get(target);
	if (!coordinator) {
		coordinator = new GestureCoordinator(target);
		coordinators.set(target, coordinator);
	}
	return coordinator;
}
function matchBindings(bindings, type, pointerType, clientX, target) {
	const rect = target.getBoundingClientRect();
	const activeRegions = getActiveRegions(bindings, type, pointerType);
	const region = activeRegions.size > 0 ? resolveRegion(clientX, rect, activeRegions) : null;
	const matches = [];
	for (const binding of bindings) {
		if (binding.disabled) continue;
		if (binding.type !== type) continue;
		if (binding.pointer && binding.pointer !== pointerType) continue;
		if (binding.region) {
			if (binding.region !== region) continue;
		} else if (region !== null) continue;
		matches.push(binding);
	}
	return matches;
}
function getActiveRegions(bindings, type, pointerType) {
	const regions = /* @__PURE__ */ new Set();
	for (const binding of bindings) {
		if (binding.disabled) continue;
		if (binding.type !== type) continue;
		if (binding.pointer && binding.pointer !== pointerType) continue;
		if (binding.region) regions.add(binding.region);
	}
	return regions;
}

//#endregion
//#region ../core/dist/dev/dom/presentation/remote-playback.js
function resolveRemote(media) {
	const target = media;
	if (isObject(target.remote) && "state" in target.remote && "prompt" in target.remote) return target.remote;
}
function isRemotePlaybackConnected(media) {
	return resolveRemote(media)?.state === "connected";
}
function isRemotePlaybackConnecting(media) {
	return resolveRemote(media)?.state === "connecting";
}
async function requestRemotePlayback(media) {
	const remote = resolveRemote(media);
	if (!remote) throw new DOMException("Remote playback not supported", "NotSupportedError");
	return remote.prompt();
}

//#endregion
//#region ../core/dist/dev/dom/store/features/controls.js
const IDLE_DELAY = 2e3;
const TAP_THRESHOLD = 250;
const TOUCH_SETTLE_DELAY = 500;
/** How long after a control releases pointer capture a `mouseleave` inside the container is treated as spurious. */
const CAPTURE_RELEASE_DELAY = 100;
const controlsActionsByRequest = /* @__PURE__ */ new WeakMap();
const controlsFeature = definePlayerFeature({
	name: "controls",
	state: ({ get, set }) => {
		const fallbackRequestControlsLock = () => {
			set({ controlsVisible: true });
			return () => {};
		};
		const fallbackToggleControls = (forceShow) => {
			const next = forceShow ?? !get().userActive;
			set({
				userActive: next,
				controlsVisible: next
			});
			return next;
		};
		const actions = createControlsActions(fallbackRequestControlsLock, fallbackToggleControls);
		controlsActionsByRequest.set(actions.requestControlsLock, actions);
		return {
			userActive: true,
			controlsVisible: true,
			requestControlsLock: actions.requestControlsLock,
			toggleControls: actions.toggleControls
		};
	},
	attach({ target, signal, get, set }) {
		const { media, container } = target;
		if (!isMediaPauseCapable(media) || isNull(container)) {
			if (isNull(container)) console.warn("[vjs] controlsFeature requires a container element for activity tracking.");
			return;
		}
		let idleTimer;
		let controlsLockCount = 0;
		const computeVisible = (userActive) => {
			return controlsLockCount > 0 || userActive || media.paused || isRemotePlaybackConnected(media) || isRemotePlaybackConnecting(media);
		};
		function clearIdle() {
			clearTimeout(idleTimer);
			idleTimer = void 0;
		}
		function scheduleIdle() {
			clearIdle();
			if (controlsLockCount > 0) return;
			idleTimer = setTimeout(setInactive, IDLE_DELAY);
		}
		function setActive() {
			if (!get().userActive) set({
				userActive: true,
				controlsVisible: true
			});
			scheduleIdle();
		}
		function setInactive() {
			clearIdle();
			set({
				userActive: false,
				controlsVisible: computeVisible(false)
			});
		}
		function requestControlsLock() {
			controlsLockCount++;
			clearIdle();
			if (!get().controlsVisible) set({ controlsVisible: true });
			let released = false;
			return () => {
				if (released || signal.aborted) return;
				released = true;
				controlsLockCount--;
				if (controlsLockCount === 0) setActive();
			};
		}
		function toggleControls(forceShow) {
			if (forceShow ?? !get().controlsVisible) setActive();
			else setInactive();
			return get().controlsVisible;
		}
		const actions = controlsActionsByRequest.get(get().requestControlsLock);
		actions.setDelegates(requestControlsLock, toggleControls);
		let pointerDownTime = 0;
		let lastTouchAt = 0;
		const isRecentTouch = () => lastTouchAt > 0 && Date.now() - lastTouchAt < TOUCH_SETTLE_DELAY;
		let lastCaptureReleaseAt = 0;
		const isRecentCaptureRelease = () => lastCaptureReleaseAt > 0 && Date.now() - lastCaptureReleaseAt < CAPTURE_RELEASE_DELAY;
		function onPointerDown(event) {
			pointerDownTime = Date.now();
			if (event.pointerType === "touch") lastTouchAt = pointerDownTime;
		}
		function onPointerUp(event) {
			if (event.pointerType === "touch") lastTouchAt = Date.now();
			if (event.pointerType === "touch" && Date.now() - pointerDownTime < TAP_THRESHOLD) {
				if (findGestureCoordinator(container)?.claimsTap(event, "toggleControls")) return;
				const isMediaOrContainer = [getRegisteredMedia(media), container].includes(event.target);
				if (get().controlsVisible && isMediaOrContainer) setInactive();
				else setActive();
			} else setActive();
		}
		const onPlaybackChange = () => {
			const { userActive } = get();
			set({ controlsVisible: computeVisible(userActive) });
			if (!media.paused && userActive) scheduleIdle();
		};
		function onPointerMove(event) {
			if (event.pointerType === "touch") {
				if (get().userActive) scheduleIdle();
				return;
			}
			setActive();
		}
		listen(container, "pointermove", onPointerMove, { signal });
		listen(container, "pointerdown", onPointerDown, { signal });
		listen(container, "pointerup", onPointerUp, { signal });
		listen(container, "lostpointercapture", () => {
			lastCaptureReleaseAt = Date.now();
		}, { signal });
		listen(container, "keydown", setActive, { signal });
		listen(container, "keyup", setActive, { signal });
		listen(container, "focusin", () => {
			if (isRecentTouch()) return;
			setActive();
		}, { signal });
		listen(container, "mouseleave", (event) => {
			if (isRecentTouch()) return;
			if (isRecentCaptureRelease() && event instanceof MouseEvent && isPointInElement(container, event)) return;
			setInactive();
		}, { signal });
		listen(media, "play", onPlaybackChange, { signal });
		listen(media, "pause", onPlaybackChange, { signal });
		listen(media, "ended", onPlaybackChange, { signal });
		if (isMediaRemotePlaybackCapable(media)) {
			const onCastChange = () => {
				const { userActive } = get();
				set({ controlsVisible: computeVisible(userActive) });
			};
			listen(media.remote, "connect", onCastChange, { signal });
			listen(media.remote, "connecting", onCastChange, { signal });
			listen(media.remote, "disconnect", onCastChange, { signal });
		}
		signal.addEventListener("abort", () => {
			actions.reset();
			controlsLockCount = 0;
			clearIdle();
		}, { once: true });
		scheduleIdle();
	}
});
function createControlsActions(fallbackRequestControlsLock, fallbackToggleControls) {
	let requestControlsLockDelegate = fallbackRequestControlsLock;
	let toggleControlsDelegate = fallbackToggleControls;
	const locks = /* @__PURE__ */ new Set();
	const requestControlsLock = () => {
		const lock = { release: requestControlsLockDelegate() };
		let released = false;
		locks.add(lock);
		return () => {
			if (released) return;
			released = true;
			locks.delete(lock);
			lock.release();
		};
	};
	const toggleControls = (forceShow) => toggleControlsDelegate(forceShow);
	const actions = {
		requestControlsLock,
		toggleControls,
		setDelegates(nextRequestControlsLock, nextToggleControls) {
			if (nextRequestControlsLock !== requestControlsLockDelegate) {
				requestControlsLockDelegate = nextRequestControlsLock;
				for (const lock of locks) {
					lock.release();
					lock.release = nextRequestControlsLock();
				}
			}
			toggleControlsDelegate = nextToggleControls;
		},
		reset() {
			actions.setDelegates(fallbackRequestControlsLock, fallbackToggleControls);
		}
	};
	return actions;
}

//#endregion
//#region ../core/dist/dev/dom/store/features/error.js
const errorFeature = definePlayerFeature({
	name: "error",
	state: ({ set }) => ({
		error: null,
		dismissError() {
			set({ error: null });
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaErrorCapable(media)) return;
		const syncError = () => set({ error: media.error });
		listen(media, "error", syncError, { signal });
		listen(media, "emptied", () => set({ error: null }), { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/presentation/fullscreen.js
function isFullscreenEnabled() {
	const doc = document;
	if (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) return true;
	const video = document.createElement("video");
	return isFunction(video.webkitSetPresentationMode);
}
function getFullscreenElement() {
	const doc = document;
	return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}
function matchesFullscreen(element) {
	if (!(element instanceof Element)) return false;
	try {
		return element.matches(":fullscreen");
	} catch {
		return false;
	}
}
function isFullscreen(container, media) {
	if (media.webkitPresentationMode === "fullscreen") return true;
	const fullscreenElement = getFullscreenElement();
	if (fullscreenElement && (fullscreenElement === container || fullscreenElement === getRegisteredMedia(media))) return true;
	if (matchesFullscreen(container) || matchesFullscreen(media)) return true;
	return media.isFullscreen ?? false;
}
async function requestFullscreen(container, media) {
	const doc = document;
	if (container && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) {
		const el = container;
		if (isFunction(el.requestFullscreen)) return el.requestFullscreen();
		if (isFunction(el.webkitRequestFullscreen)) return el.webkitRequestFullscreen();
	}
	const webkitVideo = media;
	if (isFunction(webkitVideo.webkitSetPresentationMode)) {
		webkitVideo.webkitSetPresentationMode("fullscreen");
		return;
	}
	const video = media;
	if (isFunction(video.requestFullscreen)) return video.requestFullscreen();
}
async function exitFullscreen(media) {
	const doc = document;
	const webkitVideo = media;
	if (webkitVideo.webkitPresentationMode === "fullscreen" && isFunction(webkitVideo.webkitSetPresentationMode)) {
		webkitVideo.webkitSetPresentationMode("inline");
		return;
	}
	if (isFunction(doc.exitFullscreen)) return doc.exitFullscreen();
	if (isFunction(doc.webkitExitFullscreen)) return doc.webkitExitFullscreen();
	const video = media;
	if (isFunction(video.exitFullscreen)) return video.exitFullscreen();
}

//#endregion
//#region ../core/dist/dev/dom/presentation/pip.js
function isPictureInPictureEnabled() {
	if (document.pictureInPictureEnabled) {
		const isSafari = /.*Version\/.*Safari\/.*/.test(navigator.userAgent);
		const isPWA = typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
		return !isSafari || !isPWA;
	}
	const video = document.createElement("video");
	return isFunction(video.webkitSetPresentationMode);
}
/**
* Whether this media can enter picture-in-picture at all, which is a separate question from whether the browser
* supports it. Mirrors the branches `requestPictureInPicture` takes below, so anything it would refuse to act on
* reports as incapable here — an iframe embed whose provider has no picture-in-picture can never enter it, however
* capable the browser is.
*/
function isPictureInPictureCapable(media) {
	if (isFunction(media.webkitSetPresentationMode)) return true;
	return isMediaPictureInPictureCapable(media);
}
function isPictureInPicture(media) {
	if (media.webkitPresentationMode === "picture-in-picture") return true;
	if (document.pictureInPictureElement === getRegisteredMedia(media)) return true;
	return media.isPictureInPicture ?? false;
}
async function requestPictureInPicture(media) {
	const webkitVideo = media;
	if (isFunction(webkitVideo.webkitSetPresentationMode)) {
		webkitVideo.webkitSetPresentationMode("picture-in-picture");
		return;
	}
	const video = media;
	if (isFunction(video.requestPictureInPicture)) return video.requestPictureInPicture();
}
async function exitPictureInPicture(media) {
	const webkitVideo = media;
	if (webkitVideo.webkitPresentationMode === "picture-in-picture" && isFunction(webkitVideo.webkitSetPresentationMode)) {
		webkitVideo.webkitSetPresentationMode("inline");
		return;
	}
	if (isFunction(document.exitPictureInPicture)) return document.exitPictureInPicture();
	const video = media;
	if (isFunction(video.exitPictureInPicture)) return video.exitPictureInPicture();
}

//#endregion
//#region ../core/dist/dev/dom/store/features/fullscreen.js
const fullscreenFeature = definePlayerFeature({
	name: "fullscreen",
	state: ({ target }) => ({
		isFullscreen: false,
		fullscreenAvailability: "unavailable",
		async requestFullscreen() {
			const { media, container } = target();
			if (isPictureInPicture(media)) await exitPictureInPicture(media);
			return requestFullscreen(container, media);
		},
		async exitFullscreen() {
			const { media } = target();
			return exitFullscreen(media);
		}
	}),
	attach({ target, signal, set }) {
		const { media, container } = target;
		set({ fullscreenAvailability: isFullscreenEnabled() ? "available" : "unsupported" });
		const sync = () => set({ isFullscreen: isFullscreen(container, media) });
		sync();
		listen(document, "fullscreenchange", sync, { signal });
		listen(document, "webkitfullscreenchange", sync, { signal });
		if ("webkitPresentationMode" in media) listen(media, "webkitpresentationmodechanged", sync, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/live.js
/**
* Player feature exposing `liveEdgeStart` and `targetLiveWindow` in store state for media that implements
* `MediaLiveCapability` (currently `HlsJsAdapter` and its delegates).
*
* - `liveEdgeStart` — presentation time marking the start of the Live Edge Window. Playing at the live edge when
*   `currentTime >= liveEdgeStart`. `NaN` when the stream isn't live or the value is unknown.
* - `targetLiveWindow` — `0` for standard latency live, `Infinity` for DVR, `NaN` for on-demand or unknown.
*
* Included by the {@link liveVideoFeatures} and {@link liveAudioFeatures} presets; apps can also compose it into a
* custom preset.
*
* @see https://github.com/video-dev/media-ui-extensions/blob/main/proposals/0007-live-edge.md
*/
const liveFeature = definePlayerFeature({
	name: "live",
	state: () => ({
		liveEdgeStart: NaN,
		targetLiveWindow: NaN
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaLiveCapable(media)) return;
		const sync = () => set({
			liveEdgeStart: media.liveEdgeStart,
			targetLiveWindow: media.targetLiveWindow
		});
		sync();
		listen(media, "targetlivewindowchange", sync, { signal });
		listen(media, "streamtypechange", sync, { signal });
		listen(media, "loadedmetadata", sync, { signal });
		listen(media, "canplay", sync, { signal });
		listen(media, "progress", sync, { signal });
		listen(media, "durationchange", sync, { signal });
		listen(media, "timeupdate", sync, { signal });
		listen(media, "emptied", sync, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/metadata.js
const MEDIA_TITLE = Symbol("@videojs/media-title");
const USER_TITLE = Symbol("@videojs/user-title");
const SET_USER_TITLE = Symbol("@videojs/set-user-title");
const DEFAULT_TITLE = "";
const MEDIA_POSTER = Symbol("@videojs/media-poster");
const USER_POSTER = Symbol("@videojs/user-poster");
const SET_USER_POSTER = Symbol("@videojs/set-user-poster");
const DEFAULT_POSTER = "";
/**
* Resolves content metadata into player state, preferring what the author set over what the media carries. Included in
* the standard audio, video, and live presets.
*/
const metadataFeature = definePlayerFeature({
	name: "metadata",
	config: {
		/** The title to display. Takes precedence over the title the media carries. */
		title: {
			action: SET_USER_TITLE,
			state: USER_TITLE,
			html: { attribute: "content-title" }
		},
		/** The poster to display. Takes precedence over the poster the media carries. */
		poster: {
			action: SET_USER_POSTER,
			state: USER_POSTER
		}
	},
	state: ({ set }) => ({
		[MEDIA_TITLE]: void 0,
		[USER_TITLE]: void 0,
		[SET_USER_TITLE]: (value) => set({ [USER_TITLE]: value }),
		[MEDIA_POSTER]: void 0,
		[USER_POSTER]: void 0,
		[SET_USER_POSTER]: (value) => set({ [USER_POSTER]: value })
	}),
	derived: {
		/** The resolved content title. Set it through the player, not through the store. */
		title: ({ get }) => get()[USER_TITLE] ?? get()[MEDIA_TITLE] ?? DEFAULT_TITLE,
		/**
		* The resolved poster URL, independent of the media component's own `poster`. Set it through the player, not
		* through the store.
		*/
		poster: ({ get }) => get()[USER_POSTER] ?? get()[MEDIA_POSTER] ?? DEFAULT_POSTER
	},
	attach({ target, signal, set }) {
		const { media } = target;
		const sync = () => {
			const contentData = isMediaContentDataCapable(media) ? media.contentData : void 0;
			set({
				[MEDIA_TITLE]: contentData?.title,
				[MEDIA_POSTER]: contentData?.poster
			});
		};
		const bind = () => {
			sync();
			if (!isMediaContentDataCapable(media)) return;
			listen(media, "contentdatachange", sync, { signal });
		};
		bind();
		listen(media, "loadstart", bind, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/pip.js
const pipFeature = definePlayerFeature({
	name: "pip",
	state: ({ target }) => ({
		isPictureInPicture: false,
		pictureInPictureAvailability: "unavailable",
		async requestPictureInPicture() {
			const { media, container } = target();
			if (!isPictureInPictureCapable(media)) return;
			if (!isMediaSourceCapable(media) || !hasMetadata(media)) throw new DOMException("The media has no video data yet.", "InvalidStateError");
			if (isFullscreen(container, media)) await exitFullscreen(media);
			return requestPictureInPicture(media);
		},
		async exitPictureInPicture() {
			const { media } = target();
			return exitPictureInPicture(media);
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		const supported = isPictureInPictureEnabled() && isPictureInPictureCapable(media);
		const sync = () => set({
			isPictureInPicture: isPictureInPicture(media),
			pictureInPictureAvailability: supported ? isMediaSourceCapable(media) && hasMetadata(media) ? "available" : "unavailable" : "unsupported"
		});
		sync();
		listen(media, "enterpictureinpicture", sync, { signal });
		listen(media, "leavepictureinpicture", sync, { signal });
		listen(media, "loadstart", sync, { signal });
		listen(media, "loadedmetadata", sync, { signal });
		listen(media, "emptied", sync, { signal });
		if ("webkitPresentationMode" in media) listen(media, "webkitpresentationmodechanged", sync, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/playback.js
const playbackFeature = definePlayerFeature({
	name: "playback",
	state: ({ target, set }) => ({
		paused: true,
		ended: false,
		started: false,
		waiting: false,
		play() {
			const { media } = target();
			const playing = media.play();
			if (isMediaPauseCapable(media) && !media.paused) set({
				paused: false,
				ended: false,
				started: true
			});
			return playing;
		},
		pause() {
			const { media } = target();
			if (isMediaPauseCapable(media)) {
				media.pause();
				set({ paused: media.paused });
			}
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaPauseCapable(media) || !isMediaSeekCapable(media) || !isMediaSourceCapable(media)) return;
		let starvedAt = null;
		const sync = () => {
			const starved = media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !media.paused;
			if (!starved) starvedAt = null;
			else starvedAt ??= media.currentTime;
			set({
				paused: media.paused,
				ended: media.ended,
				started: !media.paused || media.currentTime > 0,
				waiting: starved && starvedAt === media.currentTime
			});
		};
		const starve = () => {
			starvedAt = media.currentTime;
			sync();
		};
		sync();
		listen(media, "emptied", starve, { signal });
		listen(media, "play", starve, { signal });
		listen(media, "pause", sync, { signal });
		listen(media, "ended", sync, { signal });
		listen(media, "playing", sync, { signal });
		listen(media, "waiting", starve, { signal });
		listen(media, "seeking", starve, { signal });
		listen(media, "seeked", sync, { signal });
		listen(media, "canplay", sync, { signal });
		listen(media, "timeupdate", sync, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/playback-rate.js
const DEFAULT_RATES = [
	.2,
	.5,
	.7,
	1,
	1.2,
	1.5,
	1.7,
	2
];
const playbackRateFeature = definePlayerFeature({
	name: "playbackRate",
	state: ({ target }) => ({
		playbackRates: DEFAULT_RATES,
		playbackRate: 1,
		setPlaybackRate(rate) {
			const { media } = target();
			if (isMediaPlaybackRateCapable(media)) media.playbackRate = rate;
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaPlaybackRateCapable(media)) return;
		const sync = () => set({ playbackRate: media.playbackRate });
		sync();
		listen(media, "ratechange", sync, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/quality.js
const QUALITY_AUTO_VALUE = "auto";
function getRenditionValue(rendition, index) {
	return rendition.id || String(index);
}
function toMediaRendition(rendition, index) {
	return {
		id: getRenditionValue(rendition, index),
		...rendition.width !== void 0 && { width: rendition.width },
		...rendition.height !== void 0 && { height: rendition.height },
		...rendition.bitrate !== void 0 && { bitrate: rendition.bitrate },
		...rendition.frameRate !== void 0 && { frameRate: rendition.frameRate },
		...rendition.codec !== void 0 && { codec: rendition.codec },
		selected: rendition.selected
	};
}
function getSize(rendition) {
	if (rendition.width && rendition.height) return Math.min(rendition.width, rendition.height);
	return rendition.height ?? rendition.width;
}
const qualityFeature = definePlayerFeature({
	name: "quality",
	state: ({ target }) => ({
		videoRenditionList: [],
		activeVideoRendition: null,
		selectVideoRendition(value) {
			const { media } = target();
			if (!isMediaVideoRenditionCapable(media)) return;
			if (value === QUALITY_AUTO_VALUE) {
				media.videoRenditions.selectedIndex = -1;
				return;
			}
			const index = [...media.videoRenditions].findIndex((rendition, renditionIndex) => getRenditionValue(rendition, renditionIndex) === value);
			if (index !== -1) media.videoRenditions.selectedIndex = index;
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		let videoRenditions = null;
		let cleanup = null;
		const getVideoRenditions = () => isMediaVideoRenditionCapable(media) ? media.videoRenditions : null;
		const getActiveRendition = (list) => {
			if (!list) return null;
			const renditions = [...list];
			const active = renditions.find((rendition) => rendition.active);
			if (active) return active;
			if (!isMediaVideoDimensionsCapable(media) || !media.videoWidth && !media.videoHeight) return null;
			const size = getSize({
				width: media.videoWidth || void 0,
				height: media.videoHeight || void 0
			});
			const matches = renditions.filter((rendition) => getSize(rendition) === size);
			return matches.length === 1 ? matches[0] : null;
		};
		const sync = (list = getVideoRenditions()) => {
			const renditions = list ? [...list] : [];
			const active = getActiveRendition(list);
			set({
				videoRenditionList: renditions.map(toMediaRendition),
				activeVideoRendition: active ? toMediaRendition(active, renditions.indexOf(active)) : null
			});
		};
		const bind = () => {
			const nextVideoRenditions = getVideoRenditions();
			if (nextVideoRenditions === videoRenditions) {
				sync(nextVideoRenditions);
				return;
			}
			cleanup?.abort();
			cleanup = new AbortController();
			videoRenditions = nextVideoRenditions;
			if (videoRenditions) {
				listen(videoRenditions, "addrendition", () => sync(videoRenditions), { signal: cleanup.signal });
				listen(videoRenditions, "removerendition", () => sync(videoRenditions), { signal: cleanup.signal });
				listen(videoRenditions, "change", () => sync(videoRenditions), { signal: cleanup.signal });
				listen(videoRenditions, "activechange", () => sync(videoRenditions), { signal: cleanup.signal });
			}
			sync(videoRenditions);
		};
		bind();
		listen(media, "loadstart", bind, { signal });
		listen(media, "resize", () => sync(videoRenditions), { signal });
		signal.addEventListener("abort", () => cleanup?.abort(), { once: true });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/remote-playback.js
const remotePlaybackFeature = definePlayerFeature({
	name: "remotePlayback",
	state: ({ target }) => ({
		remotePlaybackState: "disconnected",
		remotePlaybackAvailability: "unsupported",
		async promptRemotePlayback() {
			const { media, container } = target();
			if (isRemotePlaybackConnected(media)) return requestRemotePlayback(media);
			if (isFullscreen(container, media)) await exitFullscreen(media);
			return await requestRemotePlayback(media);
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaRemotePlaybackCapable(media)) return;
		if (isWebKitAirPlayCapable(media)) {
			const syncConnection = () => {
				set({ remotePlaybackState: media.webkitCurrentPlaybackTargetIsWireless ? "connected" : "disconnected" });
			};
			const syncAvailability = (event) => {
				const { availability } = event;
				set({ remotePlaybackAvailability: availability === "available" ? "available" : "unavailable" });
			};
			listen(media, "webkitplaybacktargetavailabilitychanged", syncAvailability, { signal });
			listen(media, "webkitcurrentplaybacktargetiswirelesschanged", syncConnection, { signal });
			syncConnection();
			return;
		}
		const syncState = () => set({ remotePlaybackState: media.remote.state });
		syncState();
		listen(media.remote, "connect", syncState, { signal });
		listen(media.remote, "connecting", syncState, { signal });
		listen(media.remote, "disconnect", syncState, { signal });
		media.remote.watchAvailability((available) => {
			set({ remotePlaybackAvailability: available ? "available" : "unavailable" });
		}).catch(() => {
			set({ remotePlaybackAvailability: "unsupported" });
		});
		signal.addEventListener("abort", () => {
			media.remote?.cancelWatchAvailability?.().catch(() => {});
		});
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/source.js
const sourceFeature = definePlayerFeature({
	name: "source",
	state: () => ({
		currentSrc: "",
		canPlay: false
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaSourceCapable(media)) return;
		const sync = () => set({
			currentSrc: media.currentSrc,
			canPlay: media.readyState >= MediaReadyState.HAVE_FUTURE_DATA
		});
		sync();
		listen(media, "canplay", sync, { signal });
		listen(media, "canplaythrough", sync, { signal });
		listen(media, "loadstart", sync, { signal });
		listen(media, "emptied", sync, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/text-cues.js
/**
* Plain cue data from a text track's cue list, every end clamped to the media duration once that is finite.
*
* Cues delivered with a stream can be open-ended — a chapters document leaves its last chapter open, and the track
* carries that as a very large `endTime` because engines reject `Infinity` — so a consumer reading the list gets each
* cue ending no later than the media does. While the duration is unknown or infinite the ends pass through unchanged.
* Pure: the result is fresh data, never the live cues, so a store can expose it without leaking DOM objects.
*/
function clampCuesToDuration(cues, duration) {
	if (!cues) return [];
	const max = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
	return Array.from(cues, (cue) => ({
		startTime: cue.startTime,
		endTime: Math.min(cue.endTime, max),
		text: cue.text ?? ""
	}));
}

//#endregion
//#region ../core/dist/dev/dom/store/features/text-track.js
function getTrackId(track, index) {
	return track.id || `track:${index}:${track.kind}:${track.language}:${track.label}`;
}
/** Caption/subtitle tracks paired with the ids exposed through `textTrackList`, in captions menu order. */
function getSubtitlesTracks(media) {
	return getCaptionOrSubtitleTracks(Array.from(media.textTracks, (track, index) => ({
		id: getTrackId(track, index),
		kind: track.kind,
		track
	})));
}
/** Show at most one caption/subtitle track; passing `null` disables them all. */
function showOnly(tracks, active) {
	for (const { track } of tracks) {
		const mode = track === active ? "showing" : "disabled";
		if (track.mode !== mode) track.mode = mode;
	}
}
function findLocaleTrack(tracks, locale) {
	const localeKey = getLocaleKey(locale);
	const keys = findLocaleKeys(locale);
	if (localeKey !== "en" && !localeKey.startsWith(`${"en"}-`)) keys.pop();
	for (const key of keys) {
		const exact = tracks.find(({ track }) => getLocaleKey(track.language) === key);
		if (exact) return exact;
		const regional = tracks.find(({ track }) => getLocaleKey(track.language).startsWith(`${key}-`));
		if (regional) return regional;
	}
}
const textTrackFeature = definePlayerFeature({
	name: "textTrack",
	state: ({ target }) => {
		let lastShownId = null;
		return {
			textTrackList: [],
			subtitlesShowing: false,
			toggleSubtitles(forceShow) {
				const { media } = target();
				if (!isMediaTextTrackCapable(media)) return false;
				const subtitlesTracks = getSubtitlesTracks(media);
				if (!subtitlesTracks.length) return false;
				const showing = subtitlesTracks.find(({ track }) => track.mode === "showing");
				const nextShowing = forceShow ?? !showing;
				if (showing) lastShownId = showing.id;
				if (!nextShowing) {
					showOnly(subtitlesTracks, null);
					return false;
				}
				const next = showing ?? subtitlesTracks.find(({ id }) => id === lastShownId) ?? findLocaleTrack(subtitlesTracks, globalThis.navigator?.language ?? "") ?? subtitlesTracks[0];
				lastShownId = next.id;
				showOnly(subtitlesTracks, next.track);
				return true;
			},
			selectSubtitlesTrack(id) {
				const { media } = target();
				if (!isMediaTextTrackCapable(media)) return;
				const subtitlesTracks = getSubtitlesTracks(media);
				if (!subtitlesTracks.length) return;
				if (isNull(id)) {
					const showing = subtitlesTracks.find(({ track }) => track.mode === "showing");
					if (showing) lastShownId = showing.id;
					showOnly(subtitlesTracks, null);
					return;
				}
				const active = subtitlesTracks.find((entry) => entry.id === id);
				if (!active) return;
				lastShownId = active.id;
				showOnly(subtitlesTracks, active.track);
			},
			chaptersCues: [],
			thumbnailsTrack: null
		};
	},
	attach({ target, signal, set }) {
		const { media } = target;
		if (!isMediaTextTrackCapable(media)) return;
		let trackCleanup = null;
		const sync = () => {
			trackCleanup?.abort();
			trackCleanup = new AbortController();
			let chaptersTrack = null;
			let thumbnailsTextTrack = null;
			const textTrackList = [];
			let subtitlesShowing = false;
			for (let i = 0; i < media.textTracks.length; i++) {
				const track = media.textTracks[i];
				if (!chaptersTrack && track.kind === "chapters") chaptersTrack = track;
				if (!thumbnailsTextTrack && track.kind === "metadata" && track.label === "thumbnails") thumbnailsTextTrack = track;
				textTrackList.push({
					id: getTrackId(track, i),
					kind: track.kind,
					label: track.label,
					language: track.language,
					mode: track.mode
				});
				if (isCaptionOrSubtitleTrack(track) && track.mode === "showing") subtitlesShowing = true;
			}
			const chaptersCues = clampCuesToDuration(chaptersTrack?.cues, isMediaSeekCapable(media) ? media.duration : NaN);
			let thumbnailsTrack = null;
			if (thumbnailsTextTrack) thumbnailsTrack = {
				cues: thumbnailsTextTrack.cues ? Array.from(thumbnailsTextTrack.cues) : [],
				src: findTrackElement(media, thumbnailsTextTrack)?.src ?? null,
				crossOrigin: isMediaSourceCapable(media) ? toMediaCrossOrigin(media.crossOrigin) : null
			};
			const tracks = isQuerySelectorAllCapable(media) && media.querySelectorAll("track") || [];
			const shadowTracks = media instanceof HTMLElement && media.shadowRoot?.querySelectorAll("track") || [];
			for (const trackEl of [...tracks, ...shadowTracks]) if (!trackEl.track?.cues?.length) listen(trackEl, "load", sync, { signal: trackCleanup.signal });
			set({
				textTrackList,
				subtitlesShowing,
				chaptersCues,
				thumbnailsTrack
			});
		};
		sync();
		const textTracks = media.textTracks;
		if (textTracks instanceof EventTarget) {
			listen(textTracks, "addtrack", sync, { signal });
			listen(textTracks, "removetrack", sync, { signal });
			listen(textTracks, "change", sync, { signal });
		}
		listen(media, "loadstart", sync, { signal });
		listen(media, "durationchange", sync, { signal });
		signal.addEventListener("abort", () => trackCleanup?.abort(), { once: true });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/signal-keys.js
const signalKeys = { seek: Symbol.for("@videojs/seek") };

//#endregion
//#region ../core/dist/dev/dom/store/features/time.js
const timeFeature = definePlayerFeature({
	name: "time",
	state: ({ target, signals, set }) => ({
		currentTime: 0,
		duration: 0,
		seeking: false,
		async seek(time) {
			const { media } = target(), signal = signals.supersede(signalKeys.seek);
			if (!isMediaSeekCapable(media) || !isMediaSourceCapable(media)) return 0;
			listen(media, "emptied", () => signals.supersede(signalKeys.seek), {
				signal,
				once: true
			});
			if (!hasMetadata(media)) {
				if (!await onEvent(media, "loadedmetadata", { signal }).catch(() => false)) return media.currentTime;
			}
			const clampedTime = Math.max(0, Math.min(time, media.duration || Infinity));
			set({
				currentTime: clampedTime,
				seeking: true
			});
			media.currentTime = clampedTime;
			await onEvent(media, "seeked", { signal }).catch(noop);
			return media.currentTime;
		}
	}),
	attach({ target, signal, set, get }) {
		const { media } = target;
		if (!isMediaSeekCapable(media)) return;
		const resolveDuration = () => {
			const { duration } = media;
			if (duration === Number.POSITIVE_INFINITY && isMediaBufferCapable(media)) {
				const { seekable } = media;
				return seekable.length > 0 ? seekable.end(seekable.length - 1) : 0;
			}
			return Number.isFinite(duration) ? duration : 0;
		};
		const sync = () => set({
			currentTime: media.currentTime,
			duration: resolveDuration(),
			seeking: media.seeking
		});
		const syncUnlessSeeking = () => {
			if (get().seeking) return;
			sync();
		};
		let cancel;
		const stop = () => {
			cancel?.();
			cancel = void 0;
		};
		const frame = () => {
			if (!isMediaPauseCapable(media) || media.paused || media.ended) {
				stop();
				return;
			}
			const state = get();
			const currentTime = media.currentTime;
			if (!state.seeking && currentTime !== state.currentTime) set({ currentTime });
			cancel = animationFrame(frame);
		};
		const start = () => {
			if (!cancel && isMediaPauseCapable(media) && !media.paused && !media.ended) cancel = animationFrame(frame);
		};
		const finish = () => {
			stop();
			syncUnlessSeeking();
		};
		sync();
		start();
		signal.addEventListener("abort", stop, { once: true });
		listen(media, "play", start, { signal });
		listen(media, "playing", start, { signal });
		listen(media, "pause", finish, { signal });
		listen(media, "ended", finish, { signal });
		listen(media, "timeupdate", () => {
			if (!cancel || document.hidden) syncUnlessSeeking();
		}, { signal });
		listen(media, "durationchange", sync, { signal });
		listen(media, "seeking", sync, { signal });
		listen(media, "seeked", sync, { signal });
		listen(media, "loadedmetadata", sync, { signal });
		listen(media, "emptied", () => {
			stop();
			sync();
		}, { signal });
		listen(media, "progress", syncUnlessSeeking, { signal });
	}
});

//#endregion
//#region ../core/dist/dev/dom/store/features/volume.js
/** Volume to restore when unmuting at zero. */
const UNMUTE_VOLUME = .25;
const volumeFeature = definePlayerFeature({
	name: "volume",
	state: ({ target, set }) => ({
		volume: 1,
		muted: false,
		volumeAvailability: "unavailable",
		mutedAvailability: "unavailable",
		setVolume(volume) {
			const { media } = target();
			if (!isMediaVolumeCapable(media)) return 0;
			const clamped = Math.max(0, Math.min(1, volume));
			if (clamped > 0 && media.muted) media.muted = false;
			media.volume = clamped;
			set({
				volume: media.volume,
				muted: media.muted
			});
			return media.volume;
		},
		setMuted(muted) {
			const { media } = target();
			if (!isMediaMutedCapable(media)) return false;
			media.muted = muted;
			const volumeCapable = isMediaVolumeCapable(media);
			if (!muted && volumeCapable && media.volume === 0) media.volume = UNMUTE_VOLUME;
			set({
				volume: volumeCapable ? media.volume : 1,
				muted: media.muted
			});
			return media.muted;
		}
	}),
	attach({ target, signal, set }) {
		const { media } = target;
		const volumeCapable = isMediaVolumeCapable(media);
		const mutedCapable = isMediaMutedCapable(media);
		if (!volumeCapable && !mutedCapable) return;
		set({
			volumeAvailability: volumeCapable ? canSetVolume() : "unavailable",
			mutedAvailability: mutedCapable ? "available" : "unavailable"
		});
		const sync = () => set({
			volume: volumeCapable ? media.volume : 1,
			muted: mutedCapable ? media.muted : false
		});
		sync();
		listen(media, "volumechange", sync, { signal });
	}
});
/** Check if volume can be programmatically set (fails on iOS Safari). */
function canSetVolume() {
	const video = document.createElement("video");
	try {
		video.volume = .5;
		return video.volume === .5 ? "available" : "unsupported";
	} catch {
		return "unsupported";
	}
}

//#endregion
export { throwDestroyedError as C, isInteractiveActivation as D, isEditableTarget as E, animationFrame as O, setPlayerConfigValue as S, AbortControllerRegistry as T, audioTrackFeature as _, remotePlaybackFeature as a, combinePlayerFeatureConfigs as b, playbackFeature as c, liveFeature as d, fullscreenFeature as f, bufferFeature as g, getGestureCoordinator as h, sourceFeature as i, pipFeature as l, controlsFeature as m, timeFeature as n, qualityFeature as o, errorFeature as p, textTrackFeature as r, playbackRateFeature as s, volumeFeature as t, metadataFeature as u, getGestureActionValue as v, throwNoTargetError as w, definePlayerFeature as x, getMediaInputActionValue as y };
//# sourceMappingURL=volume-aFyxrX8a.js.map