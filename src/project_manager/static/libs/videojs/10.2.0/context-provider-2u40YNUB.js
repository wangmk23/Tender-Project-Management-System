import { n as ContextRequestEvent } from "./create-context-Dp8VhaeT.js";

//#region ../../node_modules/.pnpm/@lit+context@1.1.6/node_modules/@lit/context/development/lib/value-notifier.js
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
/**
* A simple class which stores a value, and triggers registered callbacks when
* the value is changed via its setter.
*
* An implementor might use other observable patterns such as MobX or Redux to
* get behavior like this. But this is a pretty minimal approach that will
* likely work for a number of use cases.
*/
var ValueNotifier = class {
	get value() {
		return this._value;
	}
	set value(v) {
		this.setValue(v);
	}
	setValue(v, force = false) {
		const update = force || !Object.is(v, this._value);
		this._value = v;
		if (update) this.updateObservers();
	}
	constructor(defaultValue) {
		this.subscriptions = /* @__PURE__ */ new Map();
		this.updateObservers = () => {
			for (const [callback, { disposer }] of this.subscriptions) callback(this._value, disposer);
		};
		if (defaultValue !== void 0) this.value = defaultValue;
	}
	addCallback(callback, consumerHost, subscribe) {
		if (!subscribe) {
			callback(this.value);
			return;
		}
		if (!this.subscriptions.has(callback)) this.subscriptions.set(callback, {
			disposer: () => {
				this.subscriptions.delete(callback);
			},
			consumerHost
		});
		const { disposer } = this.subscriptions.get(callback);
		callback(this.value, disposer);
	}
	clearCallbacks() {
		this.subscriptions.clear();
	}
};

//#endregion
//#region ../../node_modules/.pnpm/@lit+context@1.1.6/node_modules/@lit/context/development/lib/controllers/context-provider.js
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
var ContextProviderEvent = class extends Event {
	/**
	*
	* @param context the context which this provider can provide
	* @param contextTarget the original context target of the provider
	*/
	constructor(context, contextTarget) {
		super("context-provider", {
			bubbles: true,
			composed: true
		});
		this.context = context;
		this.contextTarget = contextTarget;
	}
};
/**
* A ReactiveController which adds context provider behavior to a
* custom element.
*
* This controller simply listens to the `context-request` event when
* the host is connected to the DOM and registers the received callbacks
* against its observable Context implementation.
*
* The controller may also be attached to any HTML element in which case it's
* up to the user to call hostConnected() when attached to the DOM. This is
* done automatically for any custom elements implementing
* ReactiveControllerHost.
*/
var ContextProvider = class extends ValueNotifier {
	constructor(host, contextOrOptions, initialValue) {
		super(contextOrOptions.context !== void 0 ? contextOrOptions.initialValue : initialValue);
		this.onContextRequest = (ev) => {
			if (ev.context !== this.context) return;
			const consumerHost = ev.contextTarget ?? ev.composedPath()[0];
			if (consumerHost === this.host) return;
			ev.stopPropagation();
			this.addCallback(ev.callback, consumerHost, ev.subscribe);
		};
		/**
		* When we get a provider request event, that means a child of this element
		* has just woken up. If it's a provider of our context, then we may need to
		* re-parent our subscriptions, because is a more specific provider than us
		* for its subtree.
		*/
		this.onProviderRequest = (ev) => {
			if (ev.context !== this.context) return;
			if ((ev.contextTarget ?? ev.composedPath()[0]) === this.host) return;
			const seen = /* @__PURE__ */ new Set();
			for (const [callback, { consumerHost }] of this.subscriptions) {
				if (seen.has(callback)) continue;
				seen.add(callback);
				consumerHost.dispatchEvent(new ContextRequestEvent(this.context, consumerHost, callback, true));
			}
			ev.stopPropagation();
		};
		this.host = host;
		if (contextOrOptions.context !== void 0) this.context = contextOrOptions.context;
		else this.context = contextOrOptions;
		this.attachListeners();
		this.host.addController?.(this);
	}
	attachListeners() {
		this.host.addEventListener("context-request", this.onContextRequest);
		this.host.addEventListener("context-provider", this.onProviderRequest);
	}
	hostConnected() {
		this.host.dispatchEvent(new ContextProviderEvent(this.context, this.host));
	}
};

//#endregion
export { ContextProvider as t };
//# sourceMappingURL=context-provider-2u40YNUB.js.map