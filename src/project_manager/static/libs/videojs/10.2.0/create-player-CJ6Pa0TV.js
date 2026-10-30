import { a as isNil, f as isUndefined, i as isFunction, o as isNull } from "./predicate-3rF1m2uv.js";
import { n as ContextRequestEvent } from "./create-context-Dp8VhaeT.js";
import { t as ContextProvider } from "./context-provider-2u40YNUB.js";
import { S as setPlayerConfigValue, _ as audioTrackFeature, a as remotePlaybackFeature, b as combinePlayerFeatureConfigs, c as playbackFeature, d as liveFeature, f as fullscreenFeature, g as bufferFeature, i as sourceFeature, l as pipFeature, m as controlsFeature, n as timeFeature, o as qualityFeature, p as errorFeature, r as textTrackFeature, s as playbackRateFeature, t as volumeFeature, u as metadataFeature } from "./volume-aFyxrX8a.js";
import { n as kebabCase, t as camelCase } from "./casing-4lg59-o1.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { i as playerContext, n as extensionContext, r as mediaContext, t as containerContext } from "./context-CL8SSE10.js";
import { n as createPlayerController, r as createStore } from "./controller-BArmvAzk.js";
import { t as REGISTERED_MEDIA } from "./registered-media-Xx5cjTln.js";

//#region ../../node_modules/.pnpm/@lit+context@1.1.6/node_modules/@lit/context/development/lib/context-root.js
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
/**
* A ContextRoot can be used to gather unsatisfied context requests and
* re-dispatch them when new providers which satisfy matching context keys are
* available.
*
* This allows providers to be added to a DOM tree, or upgraded, after the
* consumers.
*/
var ContextRoot = class {
	constructor() {
		this.pendingContextRequests = /* @__PURE__ */ new Map();
		this.onContextProvider = (event) => {
			const pendingRequestData = this.pendingContextRequests.get(event.context);
			if (pendingRequestData === void 0) return;
			this.pendingContextRequests.delete(event.context);
			const { requests } = pendingRequestData;
			for (const { elementRef, callbackRef } of requests) {
				const element = elementRef.deref();
				const callback = callbackRef.deref();
				if (element === void 0 || callback === void 0) {} else element.dispatchEvent(new ContextRequestEvent(event.context, element, callback, true));
			}
		};
		this.onContextRequest = (event) => {
			if (event.subscribe !== true) return;
			const element = event.contextTarget ?? event.composedPath()[0];
			const callback = event.callback;
			let pendingContextRequests = this.pendingContextRequests.get(event.context);
			if (pendingContextRequests === void 0) this.pendingContextRequests.set(event.context, pendingContextRequests = {
				callbacks: /* @__PURE__ */ new WeakMap(),
				requests: []
			});
			let callbacks = pendingContextRequests.callbacks.get(element);
			if (callbacks === void 0) pendingContextRequests.callbacks.set(element, callbacks = /* @__PURE__ */ new WeakSet());
			if (callbacks.has(callback)) return;
			callbacks.add(callback);
			pendingContextRequests.requests.push({
				elementRef: new WeakRef(element),
				callbackRef: new WeakRef(callback)
			});
		};
	}
	/**
	* Attach the ContextRoot to a given element to intercept `context-request` and
	* `context-provider` events.
	*
	* @param element an element to add event listeners to
	*/
	attach(element) {
		element.addEventListener("context-request", this.onContextRequest);
		element.addEventListener("context-provider", this.onContextProvider);
	}
	/**
	* Removes the ContextRoot event listeners from a given element.
	*
	* @param element an element from which to remove event listeners
	*/
	detach(element) {
		element.removeEventListener("context-request", this.onContextRequest);
		element.removeEventListener("context-provider", this.onContextProvider);
	}
};

//#endregion
//#region ../core/dist/dev/dom/extensions/media.js
/**
* Wrap `media` so reads, writes, and method calls consult each source's `mediaOverride` first (the first source with a
* defined value for the member wins) and otherwise reach the media itself. The result still satisfies `instanceof`,
* `in`, and Element methods for the underlying media, and answers `REGISTERED_MEDIA` with it so `getRegisteredMedia()`
* can see through for identity checks.
*
* `sources` is called on every access, so a live collection can grow and shrink without rebuilding the facade.
*/
function createMediaFacade(media, sources) {
	return new Proxy(media, {
		get(target, prop) {
			if (prop === REGISTERED_MEDIA) return target;
			const owner = findOverride(sources, prop) ?? target;
			const value = owner[prop];
			return isFunction(value) && prop !== "constructor" ? value.bind(owner) : value;
		},
		set(target, prop, value) {
			const owner = findOverride(sources, prop) ?? target;
			return Reflect.set(owner, prop, value);
		},
		has(target, prop) {
			return !isNil(findOverride(sources, prop)) || prop in target;
		}
	});
}
/**
* The first source whose override defines `prop`, or `null` when the media owns it. Members inherited from
* `Object.prototype` (`constructor`, `toString`, …) are never overridable: every override object has them, so they
* would otherwise shadow the media's own whenever any extension is installed.
*/
function findOverride(sources, prop) {
	if (Object.hasOwn(Object.prototype, prop)) return null;
	for (const { mediaOverride } of sources()) if (!isNil(mediaOverride) && !isUndefined(mediaOverride[prop])) return mediaOverride;
	return null;
}

//#endregion
//#region ../core/dist/dev/dom/extensions/coordinator.js
/** Whether `extension` can take over media members, as opposed to only observing the player. */
function overridesMedia(extension) {
	return !!extension && "mediaOverride" in extension;
}
/**
* Holds one extension per class for a player and keeps them attached to the player's current media.
*
* Create one per player, when the player is created: its creation time is the player's `initTime`, and it outlives any
* store the player replaces. Registered extensions connect to its {@link ExtensionPlayer}. The player wraps its media
* with {@link PlayerExtensionCoordinator.getStoreMedia} before attaching the store, and re-attaches the store whenever
* `onChange` fires so features re-read members an extension now owns (such as `remote`).
*
* @internal
*/
var PlayerExtensionCoordinator = class {
	#extensions = /* @__PURE__ */ new Map();
	#facades = /* @__PURE__ */ new WeakMap();
	#player = { initTime: Date.now() };
	#onChange;
	#target = null;
	/** @param onChange - Called after an extension that overrides media members is registered or released. */
	constructor(onChange) {
		this.#onChange = onChange;
	}
	get size() {
		return this.#extensions.size;
	}
	get(Extension) {
		return this.#extensions.get(Extension);
	}
	/**
	* Register `extension`, replacing any earlier instance of the same class: connect it to the player and attach it to
	* the current target. Returns a release callback that only removes this exact instance.
	*/
	register(extension) {
		const Extension = extension.constructor;
		const previous = this.#extensions.get(Extension);
		if (previous !== extension) {
			if (previous) this.#leave(previous);
			this.#extensions.set(Extension, extension);
			extension.connect?.(this.#player);
			if (this.#target) extension.attach?.(this.#target);
			if (overridesMedia(previous) || overridesMedia(extension)) this.#onChange();
		}
		return () => this.#release(extension);
	}
	/**
	* Attach every extension to `target`. Extensions follow the media: a target with the same media is recorded without
	* re-attaching them, so a container change never restarts an extension's session.
	*/
	attach(target) {
		if (this.#target?.media === target.media) {
			this.#target = target;
			return;
		}
		this.detach();
		this.#target = target;
		for (const extension of this.#extensions.values()) extension.attach?.(target);
	}
	detach() {
		if (!this.#target) return;
		for (const extension of this.#extensions.values()) extension.detach?.();
		this.#target = null;
	}
	/** Detach, disconnect, and drop every registration. Extensions are destroyed by their owners, not here. */
	destroy() {
		this.detach();
		for (const extension of this.#extensions.values()) extension.disconnect?.();
		this.#extensions.clear();
	}
	/**
	* The media as the store should see it: `media` itself unless a registered extension can override media members,
	* otherwise a facade that routes each member through the extensions' overrides first.
	*/
	getStoreMedia(media) {
		if (!this.#hasMediaOverrides()) return media;
		let facade = this.#facades.get(media);
		if (!facade) {
			facade = createMediaFacade(media, () => this.#extensions.values());
			this.#facades.set(media, facade);
		}
		return facade;
	}
	#hasMediaOverrides() {
		for (const extension of this.#extensions.values()) if (overridesMedia(extension)) return true;
		return false;
	}
	#release(extension) {
		const Extension = extension.constructor;
		if (this.#extensions.get(Extension) !== extension) return;
		this.#extensions.delete(Extension);
		this.#leave(extension);
		if (overridesMedia(extension)) this.#onChange();
	}
	/** Undo `register` for an extension that is no longer registered: detach it from the media, then disconnect it. */
	#leave(extension) {
		if (this.#target) extension.detach?.();
		extension.disconnect?.();
	}
};

//#endregion
//#region ../store/dist/dev/core/combine.js
/**
* Combines multiple slices into a single slice.
*
* @param slices - The slices to combine.
* @returns A new slice that represents the combination of the input slices.
* @internal
*/
function combine(...slices) {
	const derivedDefinitions = slices.map((slice) => slice.derived ?? {});
	warnDuplicates("derived", derivedDefinitions);
	return {
		state: (ctx) => {
			const states = slices.map((slice) => slice.state(ctx));
			warnDuplicates("state", states);
			warnOverlaps(states, derivedDefinitions);
			return Object.assign({}, ...states);
		},
		preserve: Array.from(new Set(slices.flatMap((slice) => slice.preserve ?? []))),
		derived: Object.assign({}, ...derivedDefinitions),
		attach: (ctx) => {
			for (const slice of slices) try {
				slice.attach?.(ctx);
			} catch (err) {
				ctx.reportError(err);
			}
		}
	};
}
function warnDuplicates(namespace, objects) {
	const seen = /* @__PURE__ */ new Set();
	for (const object of objects) for (const key of Reflect.ownKeys(object)) {
		if (seen.has(key)) console.warn(`[vjs-store] combine(): duplicate ${namespace} key "${String(key)}" — later slice overwrites earlier one`);
		seen.add(key);
	}
}
function warnOverlaps(states, derivedDefinitions) {
	const stateKeys = new Set(states.flatMap((state) => Reflect.ownKeys(state)));
	for (const key of new Set(derivedDefinitions.flatMap((derived) => Reflect.ownKeys(derived)))) if (stateKeys.has(key)) console.warn(`[vjs-store] combine(): state and derived key "${String(key)}" overlap — derived state overwrites source state`);
}

//#endregion
//#region ../core/dist/dev/dom/store/features/presets.js
const videoFeatures = [
	playbackFeature,
	playbackRateFeature,
	qualityFeature,
	audioTrackFeature,
	volumeFeature,
	timeFeature,
	sourceFeature,
	bufferFeature,
	fullscreenFeature,
	pipFeature,
	remotePlaybackFeature,
	controlsFeature,
	textTrackFeature,
	errorFeature,
	metadataFeature
];
const audioFeatures = [
	playbackFeature,
	playbackRateFeature,
	volumeFeature,
	timeFeature,
	sourceFeature,
	bufferFeature,
	errorFeature,
	metadataFeature
];
const backgroundFeatures = [];
/**
* Features for a live video player. Mirrors {@link videoFeatures} but drops {@link playbackRateFeature} (not meaningful
* for live) along with {@link qualityFeature} and {@link audioTrackFeature}, and adds {@link liveFeature} so store
* consumers can read `liveEdgeStart` and `targetLiveWindow`.
*/
const liveVideoFeatures = [
	playbackFeature,
	volumeFeature,
	timeFeature,
	sourceFeature,
	bufferFeature,
	fullscreenFeature,
	pipFeature,
	remotePlaybackFeature,
	controlsFeature,
	textTrackFeature,
	errorFeature,
	liveFeature,
	metadataFeature
];
/**
* Features for a live audio player. Mirrors {@link audioFeatures} but drops {@link playbackRateFeature} (not meaningful
* for live) and adds {@link liveFeature} so store consumers can read `liveEdgeStart` and `targetLiveWindow`.
*/
const liveAudioFeatures = [
	playbackFeature,
	volumeFeature,
	timeFeature,
	sourceFeature,
	bufferFeature,
	errorFeature,
	liveFeature,
	metadataFeature
];

//#endregion
//#region ../html/dist/dev/player/element.js
function resolveInputs(config) {
	return Object.entries(config).map(([key, entry]) => {
		const declared = entry.html?.attribute;
		const attribute = declared ?? kebabCase(key);
		if (declared && declared !== kebabCase(declared)) console.warn(`[vjs-html] config html.attribute "${declared}" is not kebab-case and will never match`);
		return {
			property: camelCase(attribute),
			attribute,
			entry
		};
	});
}
function createPlayerElement(options) {
	const inputs = resolveInputs(options.config);
	class ConfiguredPlayerElement extends UIElement {
		static {
			this.properties = {
				...UIElement.properties,
				...Object.fromEntries(inputs.map(({ property, attribute }) => [property, {
					type: String,
					attribute
				}]))
			};
		}
		#store = options.factory();
		#contextRoot = new ContextRoot();
		#configuredStore = null;
		#detach = null;
		#connected = false;
		#media = null;
		#nativeMedia = null;
		#container = null;
		#attached = null;
		#mediaRegistrations = [];
		#containerRegistrations = [];
		#observer = new MutationObserver(() => this.#syncNativeMedia());
		#extensions = new PlayerExtensionCoordinator(() => this.#syncExtensions());
		#registerExtension = (extension) => this.#extensions.register(extension);
		#registerMedia = (media) => {
			const registration = { value: media };
			this.#mediaRegistrations.push(registration);
			this.#syncMedia();
			return () => {
				const index = this.#mediaRegistrations.indexOf(registration);
				if (index < 0) return;
				this.#mediaRegistrations.splice(index, 1);
				this.#syncNativeMedia();
				this.#syncMedia();
			};
		};
		#registerContainer = (container) => {
			const registration = { value: container };
			this.#containerRegistrations.push(registration);
			this.#syncContainer();
			return () => {
				const index = this.#containerRegistrations.indexOf(registration);
				if (index < 0) return;
				this.#containerRegistrations.splice(index, 1);
				this.#syncContainer();
			};
		};
		#playerProvider = new ContextProvider(this, {
			context: options.playerContext,
			initialValue: this.store
		});
		#mediaProvider = new ContextProvider(this, {
			context: options.mediaContext,
			initialValue: {
				media: this.#media,
				registerMedia: this.#registerMedia
			}
		});
		#containerProvider = new ContextProvider(this, {
			context: options.containerContext,
			initialValue: {
				container: this.#container,
				registerContainer: this.#registerContainer
			}
		});
		constructor() {
			super();
			new ContextProvider(this, {
				context: options.extensionContext,
				initialValue: { registerExtension: this.#registerExtension }
			});
		}
		get store() {
			if (isNull(this.#store)) this.#store = options.factory();
			return this.#store;
		}
		connectedCallback() {
			this.#connected = true;
			this.#contextRoot.attach(this);
			super.connectedCallback();
			this.#syncInitialConfig();
			this.#playerProvider.setValue(this.store);
			this.#publishMedia();
			this.#publishContainer();
			this.#observer.observe(this, {
				childList: true,
				subtree: true
			});
			queueMicrotask(() => {
				if (this.#connected) this.#syncNativeMedia();
			});
			this.#tryAttach();
		}
		disconnectedCallback() {
			this.#connected = false;
			this.#contextRoot.detach(this);
			this.#observer.disconnect();
			this.#detachStore();
			super.disconnectedCallback();
		}
		destroyCallback() {
			this.#contextRoot.detach(this);
			this.#observer.disconnect();
			this.#detachStore();
			this.#extensions.destroy();
			this.#store?.destroy();
			this.#store = null;
			super.destroyCallback();
		}
		willUpdate(changed) {
			super.willUpdate(changed);
			for (const { property, entry } of inputs) {
				if (!changed.has(property)) continue;
				const configProperty = property;
				setPlayerConfigValue(this.store, entry, this[configProperty]);
			}
		}
		#syncMedia() {
			const media = this.#mediaRegistrations.at(-1)?.value ?? null ?? this.#nativeMedia;
			if (this.#media === media) return;
			this.#media = media;
			this.#publishMedia();
			this.#tryAttach();
		}
		#syncContainer() {
			const container = this.#containerRegistrations.at(-1)?.value ?? null;
			if (this.#container === container) return;
			this.#container = container;
			this.#publishContainer();
			this.#tryAttach();
		}
		#syncNativeMedia() {
			const media = this.querySelector("video, audio");
			if (this.#nativeMedia === media) return;
			this.#nativeMedia = media;
			this.#syncMedia();
		}
		#publishMedia() {
			this.#mediaProvider.setValue({
				media: this.#media,
				registerMedia: this.#registerMedia
			});
		}
		#publishContainer() {
			this.#containerProvider.setValue({
				container: this.#container,
				registerContainer: this.#registerContainer
			});
		}
		#tryAttach() {
			if (!this.#connected || !this.#store) return;
			if (!this.#media) {
				this.#detachStore();
				return;
			}
			const target = {
				media: this.#media,
				container: this.#container
			};
			const hasMediaChanged = this.#attached?.media !== target.media;
			const hasContainerChanged = this.#attached?.container !== target.container;
			if (hasMediaChanged || hasContainerChanged) this.#attach(target);
		}
		/**
		* Extensions attach before the store so their overrides are in place when features first read the media; the store
		* then sees the media through the extensions' facade. Extensions follow the media only, so a container change
		* re-attaches the store but leaves them attached.
		*/
		#attach(target) {
			const store = this.#store;
			if (!store) return;
			this.#detach?.();
			this.#attached = target;
			this.#extensions.attach(target);
			this.#detach = store.attach({
				media: this.#extensions.getStoreMedia(target.media),
				container: target.container
			});
		}
		/**
		* An extension that overrides media members was added or removed. Features hold members read at attach time (such
		* as `remote`), so the store re-attaches to the same target to pick up what the extensions now own. Observers such
		* as analytics never get here. Extensions themselves stay attached.
		*/
		#syncExtensions() {
			if (this.#attached) this.#attach(this.#attached);
		}
		#detachStore() {
			this.#detach?.();
			this.#detach = null;
			this.#extensions.detach();
			this.#attached = null;
		}
		#syncInitialConfig() {
			const store = this.store;
			if (this.#configuredStore === store) return;
			for (const { property, entry } of inputs) {
				const configProperty = property;
				setPlayerConfigValue(store, entry, this[configProperty]);
			}
			this.#configuredStore = store;
		}
	}
	return ConfiguredPlayerElement;
}

//#endregion
//#region ../html/dist/dev/player/create-player.js
function createPlayer(config) {
	const slice = combine(...config.features);
	const featureConfig = combinePlayerFeatureConfigs(config.features);
	return {
		PlayerElement: createPlayerElement({
			playerContext,
			mediaContext,
			containerContext,
			extensionContext,
			factory: () => createStore()(slice),
			config: featureConfig
		}),
		PlayerController: createPlayerController(playerContext),
		playerContext
	};
}

//#endregion
export { liveVideoFeatures as a, liveAudioFeatures as i, audioFeatures as n, videoFeatures as o, backgroundFeatures as r, createPlayer as t };
//# sourceMappingURL=create-player-CJ6Pa0TV.js.map