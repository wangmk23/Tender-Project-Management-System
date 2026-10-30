import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { i as playerContext, t as containerContext } from "./context-CL8SSE10.js";
import { t as PlayerController } from "./controller-BArmvAzk.js";
import { n as getMediaSnapshot, o as getRenderedIndicatorState, r as subscribeToInputActions, s as isIndicatorPresent, t as getIndicatorVisibilityCoordinator } from "./input-action-DMBaa6h-.js";
import { t as applyStateDataAttrs } from "./state-data-attrs-DiSfe3GX.js";

//#region ../html/dist/dev/ui/input-indicator/element.js
var InputIndicatorElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.player = new PlayerController(this, playerContext);
		this.container = new ContextConsumer(this, {
			context: containerContext,
			callback: () => this.#reconnect(),
			subscribe: true
		});
		this.#disconnect = null;
		this.#inputActionUnsubscribe = null;
		this.#visibilityUnsubscribe = null;
		this.#visibilityHandle = null;
		this.#lastGeneration = 0;
		this.#snapshot = null;
	}
	get options() {
		return {};
	}
	#disconnect;
	#inputActionUnsubscribe;
	#visibilityUnsubscribe;
	#visibilityHandle;
	#lastGeneration;
	#snapshot;
	#getVisibilityHandle() {
		return this.#visibilityHandle ??= { close: () => this.core.close() };
	}
	#payloadSnapshot() {
		return this.#snapshot ?? this.core.state.current;
	}
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#snapshot = this.core.state.current;
		this.#disconnect = new AbortController();
		this.core.state.subscribe(() => this.requestUpdate(), { signal: this.#disconnect.signal });
		this.transition.state.subscribe(() => this.requestUpdate(), { signal: this.#disconnect.signal });
		this.hidden = true;
		this.#reconnect();
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#inputActionUnsubscribe?.();
		this.#visibilityUnsubscribe?.();
		this.#inputActionUnsubscribe = null;
		this.#visibilityUnsubscribe = null;
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	destroyCallback() {
		this.#inputActionUnsubscribe?.();
		this.#visibilityUnsubscribe?.();
		this.core.destroy();
		this.transition.destroy();
		this.liveIndicator.remove();
		super.destroyCallback();
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		this.syncCoreProps();
	}
	update(changed) {
		super.update(changed);
		this.#syncTransition();
		const currentState = this.core.state.current;
		const transitionState = this.transition.state.current;
		if (!isIndicatorPresent(currentState, transitionState)) {
			this.liveIndicator.remove();
			return;
		}
		const state = getRenderedIndicatorState(currentState, this.#payloadSnapshot(), transitionState);
		this.liveIndicator.render(state);
	}
	#syncTransition() {
		const currentState = this.core.state.current;
		if (currentState.open) {
			this.#snapshot = currentState;
			if (this.#lastGeneration !== currentState.generation) {
				this.#lastGeneration = currentState.generation;
				const transitionState = this.transition.state.current;
				if (!transitionState.active || this.options.replayOnUpdate !== false) this.transition.open(this.liveIndicator.element);
				else if (transitionState.status === "ending") this.transition.cancel();
			}
			return;
		}
		const { active, status } = this.transition.state.current;
		if (active && status !== "ending") this.transition.close(this.liveIndicator.element);
	}
	#reconnect() {
		if (!this.container) return;
		this.#inputActionUnsubscribe?.();
		this.#visibilityUnsubscribe?.();
		this.#inputActionUnsubscribe = null;
		this.#visibilityUnsubscribe = null;
		const container = this.container.value?.container;
		if (!container) return;
		const visibility = getIndicatorVisibilityCoordinator(container);
		const visibilityHandle = this.#getVisibilityHandle();
		this.#visibilityUnsubscribe = visibility.register(visibilityHandle);
		this.#inputActionUnsubscribe = subscribeToInputActions(container, (event) => {
			if (this.core.processEvent(event, getMediaSnapshot(this.player.value))) visibility.show(visibilityHandle);
		});
	}
};

//#endregion
//#region ../html/dist/dev/ui/input-indicator/live-indicator.js
var LiveIndicator = class {
	#host;
	#dataAttrs;
	#render;
	constructor(options) {
		this.#host = options.host;
		this.#dataAttrs = options.dataAttrs;
		this.#render = options.render;
	}
	get element() {
		return this.#host;
	}
	render(state) {
		this.#host.hidden = false;
		applyStateDataAttrs(this.#host, state, this.#dataAttrs);
		this.#render(this.#host, state);
		return this.#host;
	}
	remove() {
		this.#host.hidden = true;
		for (const key in this.#dataAttrs) {
			const name = this.#dataAttrs[key];
			if (name) this.#host.removeAttribute(name);
		}
	}
};

//#endregion
export { InputIndicatorElement as n, LiveIndicator as t };
//# sourceMappingURL=live-indicator-CshLlWRO.js.map