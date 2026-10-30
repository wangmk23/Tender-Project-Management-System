//#region ../../node_modules/.pnpm/@lit+context@1.1.6/node_modules/@lit/context/development/lib/context-request-event.js
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
/**
* An event fired by a context requester to signal it desires a specified context with the given key.
*
* A provider should inspect the `context` property of the event to determine if it has a value that can
* satisfy the request, calling the `callback` with the requested value if so.
*
* If the requested context event contains a truthy `subscribe` value, then a provider can call the callback
* multiple times if the value is changed, if this is the case the provider should pass an `unsubscribe`
* method to the callback which consumers can invoke to indicate they no longer wish to receive these updates.
*
* If no `subscribe` value is present in the event, then the provider can assume that this is a 'one time'
* request for the context and can therefore not track the consumer.
*/
var ContextRequestEvent = class extends Event {
	/**
	*
	* @param context the context key to request
	* @param contextTarget the original context target of the requester
	* @param callback the callback that should be invoked when the context with the specified key is available
	* @param subscribe when, true indicates we want to subscribe to future updates
	*/
	constructor(context, contextTarget, callback, subscribe) {
		super("context-request", {
			bubbles: true,
			composed: true
		});
		this.context = context;
		this.contextTarget = contextTarget;
		this.callback = callback;
		this.subscribe = subscribe ?? false;
	}
};

//#endregion
//#region ../../node_modules/.pnpm/@lit+context@1.1.6/node_modules/@lit/context/development/lib/create-context.js
/**
* @license
* Copyright 2021 Google LLC
* SPDX-License-Identifier: BSD-3-Clause
*/
/**
* Creates a typed Context.
*
* Contexts are compared with strict equality.
*
* If you want two separate `createContext()` calls to referer to the same
* context, then use a key that will by equal under strict equality like a
* string for `Symbol.for()`:
*
* ```ts
* // true
* createContext('my-context') === createContext('my-context')
* // true
* createContext(Symbol.for('my-context')) === createContext(Symbol.for('my-context'))
* ```
*
* If you want a context to be unique so that it's guaranteed to not collide
* with other contexts, use a key that's unique under strict equality, like
* a `Symbol()` or object.:
*
* ```
* // false
* createContext({}) === createContext({})
* // false
* createContext(Symbol('my-context')) === createContext(Symbol('my-context'))
* ```
*
* @param key a context key value
* @template ValueType the type of value that can be provided by this context.
* @returns the context key value cast to `Context<K, ValueType>`
*/
function createContext(key) {
	return key;
}

//#endregion
export { ContextRequestEvent as n, createContext as t };
//# sourceMappingURL=create-context-Dp8VhaeT.js.map