import { c as isObject, f as isUndefined, i as isFunction, o as isNull, u as isPromise } from "./predicate-3rF1m2uv.js";
import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { C as throwDestroyedError, T as AbortControllerRegistry, w as throwNoTargetError } from "./volume-aFyxrX8a.js";
import { t as noop } from "./noop-DBLxABor.js";
import { t as SnapshotController } from "./snapshot-controller-CR9Xu35W.js";
import { t as createState } from "./state-DLDF0q4U.js";

//#region ../store/dist/dev/core/store.js
const STORE_SYMBOL = Symbol.for("@videojs/store");
const hasOwnProp = Object.prototype.hasOwnProperty;
/** @internal */
function createStore() {
	return ((slice, options = {}) => {
		let target = null;
		let destroyed = false;
		const setupAbort = new AbortController();
		const signals = new AbortControllerRegistry();
		const actions = /* @__PURE__ */ new WeakMap();
		const reportedErrors = /* @__PURE__ */ new WeakSet();
		let sourceState;
		let state;
		function validate() {
			if (destroyed) throwDestroyedError();
			if (!target) throwNoTargetError();
		}
		const initialSourceState = freezeCopy(slice.state({
			target: () => {
				validate();
				return target;
			},
			signals,
			get: () => sourceState,
			set: (partial) => setSource(partial)
		}));
		sourceState = initialSourceState;
		const initialDerivedState = derive(sourceState);
		state = createState(publish(sourceState, initialDerivedState));
		const store = {
			[STORE_SYMBOL]: true,
			get $state() {
				return state;
			},
			get target() {
				return target;
			},
			get destroyed() {
				return destroyed;
			},
			get state() {
				return state.current;
			},
			attach,
			destroy,
			subscribe
		};
		for (const key of Object.keys(state.current)) Object.defineProperty(store, key, {
			get: () => state.current[key],
			enumerable: true
		});
		for (const key of Object.getOwnPropertySymbols(sourceState)) {
			if (typeof sourceState[key] !== "function") continue;
			Object.defineProperty(store, key, { get: () => sourceState[key] });
		}
		try {
			options.onSetup?.({
				store,
				signal: setupAbort.signal
			});
		} catch (error) {
			reportError(error);
		}
		return store;
		function derive(source) {
			const result = {};
			const definitions = slice.derived;
			if (!definitions) return result;
			const ctx = { get: () => source };
			for (const key of Object.keys(definitions)) result[key] = definitions[key](ctx);
			return result;
		}
		function publish(source, derived) {
			const result = {};
			for (const key of Object.keys(source)) result[key] = source[key];
			Object.assign(result, derived);
			for (const key of Object.keys(result)) {
				const value = result[key];
				if (isFunction(value)) result[key] = wrapAction(value);
			}
			return result;
		}
		function wrapAction(action) {
			const cached = actions.get(action);
			if (cached) return cached;
			const wrapped = function(...args) {
				try {
					const result = action.apply(this, args);
					if (options.onError && isPromise(result)) result.catch(reportError);
					return result;
				} catch (error) {
					if (options.onError) reportError(error);
					throw error;
				}
			};
			actions.set(action, wrapped);
			return wrapped;
		}
		function setSource(partial) {
			const patched = patchSource(sourceState, partial);
			if (!patched) return;
			const nextDerived = derive(patched.next);
			sourceState = patched.next;
			state.replace(publish(sourceState, nextDerived));
		}
		function attach(newTarget) {
			if (destroyed) throwDestroyedError();
			signals.reset();
			target = newTarget;
			const attachContext = {
				target: newTarget,
				signal: signals.base,
				get: () => sourceState,
				set: (partial) => {
					try {
						setSource(partial);
					} catch (error) {
						reportError(error);
					}
				},
				reportError,
				store: {
					get state() {
						return state.current;
					},
					subscribe
				}
			};
			try {
				slice.attach?.(attachContext);
			} catch (error) {
				reportError(error);
			}
			try {
				options.onAttach?.({
					store,
					target: newTarget,
					signal: signals.base
				});
			} catch (error) {
				reportError(error);
			}
			return detach;
		}
		function detach() {
			if (isNull(target)) return;
			signals.reset();
			target = null;
			const resetState = { ...initialSourceState };
			for (const key of slice.preserve ?? []) resetState[key] = sourceState[key];
			setSource(resetState);
		}
		function destroy() {
			if (destroyed) return;
			destroyed = true;
			detach();
			setupAbort.abort();
		}
		function subscribe(callback, options) {
			return state.subscribe(callback, options);
		}
		function reportError(error) {
			if (isObject(error)) {
				if (reportedErrors.has(error)) return;
				reportedErrors.add(error);
			}
			if (options.onError) options.onError({
				store,
				error
			});
			else console.error("[vjs-store]", error);
		}
	});
}
function freezeCopy(value) {
	return Object.freeze({ ...value });
}
function patchSource(current, partial) {
	const next = { ...current };
	let changed = false;
	for (const key of Reflect.ownKeys(partial)) {
		if (!hasOwnProp.call(partial, key)) continue;
		const value = partial[key];
		if (Object.is(current[key], value)) continue;
		next[key] = value;
		changed = true;
	}
	return changed ? { next: Object.freeze(next) } : null;
}
/** @internal */
function isStore(value) {
	return isObject(value) && STORE_SYMBOL in value;
}

//#endregion
//#region ../store/dist/dev/html/store-accessor.js
/**
* Resolves a store from either a direct instance or context.
*
* When given a direct store, provides immediate access. When given a context, sets up a ContextConsumer to receive the
* store.
*
* @example
*   Direct store
*   ```ts
*   const accessor = new StoreAccessor(host, store, (s) => console.log('available', s));
*   accessor.value; // Store (immediately available)
*   ```
*
* @example
*   Context source
*   ```ts
*   const accessor = new StoreAccessor(host, context, (s) => console.log('available', s));
*   accessor.value; // null until context provides store
*   ```
*
* @internal
*/
var StoreAccessor = class {
	#onAvailable;
	#consumer;
	#directStore;
	constructor(host, source, onAvailable) {
		this.#onAvailable = onAvailable ?? noop;
		if (isStore(source)) {
			this.#directStore = source;
			this.#consumer = null;
		} else {
			this.#directStore = null;
			this.#consumer = new ContextConsumer(host, {
				context: source,
				callback: (store) => this.#onAvailable(store),
				subscribe: false
			});
		}
		host.addController(this);
	}
	/** Returns the store, or null if not yet available from context. */
	get value() {
		if (this.#consumer) return this.#consumer.value ?? null;
		return this.#directStore;
	}
	hostConnected() {
		if (this.#directStore) this.#onAvailable(this.#directStore);
	}
};

//#endregion
//#region ../store/dist/dev/html/controllers/store-controller.js
/**
* Access store state and actions.
*
* Without selector: Returns the store, does NOT subscribe to changes. With selector: Returns selected state, triggers
* update when selected state changes (shallowEqual).
*
* @example
*   ```ts
*   // Store access (no subscription) - access actions
*   class Controls extends LitElement {
*   #store = new StoreController(this, storeSource);
*
*   handleClick() {
*   this.#store.value.setVolume(0.5);
*   }
*   }
*
*   // Selector-based subscription - re-renders when playback changes
*   class PlayButton extends LitElement {
*   #playback = new StoreController(this, storeSource, selectPlayback);
*
*   render() {
*   const playback = this.#playback.value;
*   if (!playback) return nothing;
*   return html`<button @click=${playback.toggle}>
*   ${playback.paused ? 'Play' : 'Pause'}
*   </button>`;
*   }
*   }
*   ```
*/
var StoreController = class {
	#host;
	#selector;
	#accessor;
	#snapshot = null;
	constructor(host, source, selector) {
		this.#host = host;
		this.#selector = selector;
		this.#accessor = new StoreAccessor(host, source, (store) => this.#connect(store));
		host.addController(this);
	}
	get value() {
		const store = this.#accessor.value;
		if (isNull(store)) throw new Error("Store not available");
		if (isUndefined(this.#selector)) return store;
		return this.#snapshot.value;
	}
	hostConnected() {}
	#connect(store) {
		if (isUndefined(this.#selector)) return;
		if (!this.#snapshot) this.#snapshot = new SnapshotController(this.#host, store.$state, this.#selector);
		else this.#snapshot.track(store.$state);
	}
};

//#endregion
//#region ../html/dist/dev/player/controller.js
/**
* Reactive controller for accessing player store state.
*
* Without selector: Returns the store, does NOT subscribe to changes. With selector: Returns selected state, subscribes
* with shallowEqual comparison.
*
* @example
*   ```ts
*   // Store access (no subscription)
*   class Controls extends UIElement {
*     #player = new PlayerController(this, playerContext);
*
*     handleClick() {
*       this.#player.value.setVolume(0.5);
*     }
*   }
*
*   // Selector-based subscription
*   class PlayButton extends UIElement {
*     #playback = new PlayerController(this, playerContext, selectPlayback);
*   }
*   ```;
*/
var PlayerController = class {
	#host;
	#selector;
	#consumer;
	#store = null;
	constructor(host, context, selector) {
		this.#host = host;
		this.#selector = selector;
		this.#consumer = new ContextConsumer(host, {
			context,
			callback: (ctx) => this.#connect(ctx),
			subscribe: true
		});
		host.addController(this);
	}
	get value() {
		const store = this.#consumer.value;
		if (!store) return void 0;
		if (!this.#selector) return store;
		return this.#store?.value;
	}
	get displayName() {
		return this.#selector?.displayName;
	}
	hostConnected() {
		const store = this.#consumer.value;
		if (store) this.#connect(store);
	}
	hostDisconnected() {
		this.#store = null;
	}
	#connect(store) {
		if (!this.#store && this.#selector) this.#store = new StoreController(this.#host, store, this.#selector);
	}
};
function createPlayerController(context) {
	class ConfiguredPlayerController extends PlayerController {
		constructor(host, selector) {
			if (selector) super(host, context, selector);
			else super(host, context);
		}
	}
	return ConfiguredPlayerController;
}

//#endregion
export { createPlayerController as n, createStore as r, PlayerController as t };
//# sourceMappingURL=controller-BArmvAzk.js.map