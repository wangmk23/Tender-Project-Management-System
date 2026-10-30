import { t as shallowEqual } from "./shallow-equal-C7S8rj2f.js";
import { t as noop } from "./noop-DBLxABor.js";

//#region ../store/dist/dev/core/state.js
let isFlushScheduled = false;
function scheduleFlush() {
	if (isFlushScheduled) return;
	isFlushScheduled = true;
	queueMicrotask(flush);
}
const pendingContainers = /* @__PURE__ */ new Set();
/** @internal */
function flush() {
	isFlushScheduled = false;
	for (const container of pendingContainers) container.flush();
	pendingContainers.clear();
}
const hasOwnProp = Object.prototype.hasOwnProperty;
var StateContainer = class {
	#current;
	#listeners = /* @__PURE__ */ new Set();
	#pending = false;
	constructor(initial) {
		this.#current = Object.freeze({ ...initial });
	}
	get current() {
		return this.#current;
	}
	patch(partial) {
		const next = { ...this.#current };
		let changed = false;
		for (const key of Reflect.ownKeys(partial)) {
			if (!hasOwnProp.call(partial, key)) continue;
			const value = partial[key];
			if (!Object.is(this.#current[key], value)) {
				next[key] = value;
				changed = true;
			}
		}
		if (changed) {
			this.#current = Object.freeze(next);
			this.#markPending();
		}
	}
	replace(next) {
		if (shallowEqual(this.#current, next)) return;
		this.#current = Object.freeze({ ...next });
		this.#markPending();
	}
	subscribe(callback, options) {
		const signal = options?.signal;
		if (signal?.aborted) return noop;
		this.#listeners.add(callback);
		if (!signal) return () => this.#listeners.delete(callback);
		const onAbort = () => this.#listeners.delete(callback);
		signal.addEventListener("abort", onAbort, { once: true });
		return () => {
			signal.removeEventListener("abort", onAbort);
			this.#listeners.delete(callback);
		};
	}
	flush() {
		if (!this.#pending) return;
		this.#pending = false;
		for (const fn of this.#listeners) fn();
	}
	#markPending() {
		this.#pending = true;
		pendingContainers.add(this);
		scheduleFlush();
	}
};
/** @internal */
function createState(initial) {
	return new StateContainer(initial);
}

//#endregion
export { createState as t };
//# sourceMappingURL=state-DLDF0q4U.js.map