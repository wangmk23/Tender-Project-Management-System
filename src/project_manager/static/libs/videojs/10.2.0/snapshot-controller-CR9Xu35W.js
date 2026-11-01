import { t as shallowEqual } from "./shallow-equal-C7S8rj2f.js";
import { t as noop } from "./noop-DBLxABor.js";

//#region ../store/dist/dev/html/controllers/snapshot-controller.js
/**
* Subscribe to a `State<T>` container with optional selector.
*
* Without selector: returns full state, re-renders on any state change. With selector: returns selected slice,
* re-renders only when the slice changes (shallowEqual).
*
* @example
*   ```ts
*   #state = new SnapshotController(this, sliderState, (s) => s.value);
*   ```;
*/
var SnapshotController = class {
	#host;
	#selector;
	#state;
	#cached;
	#unsubscribe = noop;
	constructor(host, state, selector) {
		this.#host = host;
		this.#state = state;
		this.#selector = selector;
		host.addController(this);
	}
	get value() {
		if (!this.#selector) return this.#state.current;
		this.#cached ??= this.#selector(this.#state.current);
		return this.#cached;
	}
	/** Switch to tracking a different state container. */
	track(state) {
		this.#state = state;
		this.#subscribe();
	}
	hostConnected() {
		this.#subscribe();
	}
	hostDisconnected() {
		this.#unsubscribe();
		this.#unsubscribe = noop;
		this.#cached = void 0;
	}
	#subscribe() {
		this.#unsubscribe();
		if (!this.#selector) {
			this.#unsubscribe = this.#state.subscribe(() => this.#host.requestUpdate());
			return;
		}
		const selector = this.#selector;
		this.#cached = selector(this.#state.current);
		this.#unsubscribe = this.#state.subscribe(() => {
			const next = selector(this.#state.current);
			if (!shallowEqual(this.#cached, next)) {
				this.#cached = next;
				this.#host.requestUpdate();
			}
		});
	}
};

//#endregion
export { SnapshotController as t };
//# sourceMappingURL=snapshot-controller-CR9Xu35W.js.map