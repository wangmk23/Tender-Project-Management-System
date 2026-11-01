import { n as ContextRequestEvent } from "./create-context-Dp8VhaeT.js";

//#region ../../node_modules/.pnpm/@lit+context@1.1.6/node_modules/@lit/context/development/lib/controllers/context-consumer.js
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
/**
* A ReactiveController which adds context consuming behavior to a custom
* element by dispatching `context-request` events.
*
* When the host element is connected to the document it will emit a
* `context-request` event with its context key. When the context request
* is satisfied the controller will invoke the callback, if present, and
* trigger a host update so it can respond to the new value.
*
* It will also call the dispose method given by the provider when the
* host element is disconnected.
*/
var ContextConsumer = class {
	constructor(host, contextOrOptions, callback, subscribe) {
		this.subscribe = false;
		this.provided = false;
		this.value = void 0;
		this._callback = (value, unsubscribe) => {
			if (this.unsubscribe) {
				if (this.unsubscribe !== unsubscribe) {
					this.provided = false;
					this.unsubscribe();
				}
				if (!this.subscribe) this.unsubscribe();
			}
			this.value = value;
			this.host.requestUpdate();
			if (!this.provided || this.subscribe) {
				this.provided = true;
				if (this.callback) this.callback(value, unsubscribe);
			}
			this.unsubscribe = unsubscribe;
		};
		this.host = host;
		if (contextOrOptions.context !== void 0) {
			const options = contextOrOptions;
			this.context = options.context;
			this.callback = options.callback;
			this.subscribe = options.subscribe ?? false;
		} else {
			this.context = contextOrOptions;
			this.callback = callback;
			this.subscribe = subscribe ?? false;
		}
		this.host.addController(this);
	}
	hostConnected() {
		this.dispatchRequest();
	}
	hostDisconnected() {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = void 0;
		}
	}
	dispatchRequest() {
		this.host.dispatchEvent(new ContextRequestEvent(this.context, this.host, this._callback, this.subscribe));
	}
};

//#endregion
export { ContextConsumer as t };
//# sourceMappingURL=context-consumer-LN8LIb2c.js.map