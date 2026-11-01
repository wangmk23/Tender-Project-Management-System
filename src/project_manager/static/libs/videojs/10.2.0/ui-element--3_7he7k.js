//#region ../element/dist/dev/destroy-mixin.js
/**
* Mixin that adds a deferred destruction lifecycle to a `ReactiveElement`.
*
* On disconnect, schedules destruction after two animation frames. If the element reconnects before the frames fire
* (e.g. DOM shuffling, framework reconciliation), the `isConnected` check prevents destruction.
*
* The `keep-alive` attribute prevents automatic destruction entirely — call `destroy()` manually when done.
*
* Subclasses override `destroyCallback()` (calling `super.destroyCallback()`) to release heavy resources like stores or
* imperative APIs.
*
* Mirrors `addController`/`removeController` to track controllers (needed because `ReactiveElement.#controllers` is
* hard-private), calls `hostDestroyed()` on all tracked controllers in `destroyCallback`, and guards `performUpdate()`
* so no updates run after destruction.
*/
function DestroyMixin(SuperClass) {
	class DestroyableElement extends SuperClass {
		#destroyed = false;
		#trackedControllers = /* @__PURE__ */ new Set();
		get destroyed() {
			return this.#destroyed;
		}
		destroy() {
			if (this.#destroyed) return;
			this.#destroyed = true;
			this.destroyCallback();
		}
		destroyCallback() {
			for (const c of this.#trackedControllers) c.hostDestroyed?.();
		}
		addController(controller) {
			super.addController(controller);
			this.#trackedControllers.add(controller);
		}
		removeController(controller) {
			super.removeController(controller);
			this.#trackedControllers.delete(controller);
		}
		connectedCallback() {
			if (this.#destroyed) return;
			super.connectedCallback();
		}
		disconnectedCallback() {
			super.disconnectedCallback();
			if (!this.#destroyed && !this.hasAttribute("keep-alive")) requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (!this.isConnected) this.destroy();
				});
			});
		}
		performUpdate() {
			if (this.#destroyed) return;
			super.performUpdate();
		}
	}
	return DestroyableElement;
}

//#endregion
//#region ../element/dist/dev/reactive-element.js
const cache = /* @__PURE__ */ new WeakMap();
const propertyKeys = /* @__PURE__ */ new Map();
const HTMLElementBase = globalThis.HTMLElement ?? class {};
/**
* Lightweight reactive custom element base class.
*
* Drop-in subset of Lit's `ReactiveElement` — supports `static properties`, attribute-to-property conversion, batched
* async updates, and reactive controllers. No Shadow DOM, no `static styles`, no decorators.
*
* Updates are batched using the same Promise-based scheduling as Lit: property changes enqueue a microtask, and the
* update is gated behind `connectedCallback` so the first update only runs once the element is in the document.
*
* Subclasses that extend another element with properties must spread them:
*
* @example
*   ```ts
*   class MyButton extends ReactiveElement {
*     static override properties = {
*       label: { type: String },
*       disabled: { type: Boolean },
*     };
*
*     label = 'Click me';
*     disabled = false;
*
*     protected override update(changed: PropertyValues): void {
*       super.update(changed);
*       this.textContent = this.label;
*     }
*   }
*
*   // Inheritance — spread parent properties
*   class FancyButton extends MyButton {
*     static override properties = {
*       ...MyButton.properties,
*       variant: { type: String },
*     };
*
*     variant = 'primary';
*   }
*   ```;
*/
var ReactiveElement = class extends HTMLElementBase {
	static {
		this.properties = {};
	}
	/** Returns a list of attributes corresponding to the registered properties. */
	static get observedAttributes() {
		return [...resolve(this).attrToProp.keys()];
	}
	#controllers;
	#changedProperties;
	#instanceProperties;
	#propertiesUpgraded;
	/**
	* Promise that gates the first update until `connectedCallback`. Also used to serialize updates — each
	* `#enqueueUpdate` awaits the previous `#updatePromise`, so property changes are batched and updates never overlap.
	* Matches Lit's scheduling model.
	*/
	#updatePromise;
	constructor() {
		super();
		this.#controllers = /* @__PURE__ */ new Set();
		this.#changedProperties = /* @__PURE__ */ new Map();
		this.#propertiesUpgraded = false;
		this.isUpdatePending = false;
		this.hasUpdated = false;
		this.#updatePromise = new Promise((res) => this.enableUpdating = res);
		const { props } = resolve(this.constructor);
		for (const name of props.keys()) if (Object.hasOwn(this, name)) {
			(this.#instanceProperties ??= /* @__PURE__ */ new Map()).set(name, this[name]);
			delete this[name];
		}
		this.requestUpdate();
	}
	/**
	* Note, this method should be considered final and not overridden. It is overridden on the element instance with a
	* function that triggers the first update.
	*/
	enableUpdating(_requestedUpdate) {}
	/**
	* Registers a {@linkcode ReactiveController} to participate in the element's reactive update cycle. The element
	* automatically calls into any registered controllers during its lifecycle callbacks.
	*
	* If the element is connected when `addController()` is called, the controller's `hostConnected()` callback will be
	* immediately called.
	*/
	addController(controller) {
		this.#controllers.add(controller);
		if (this.isConnected) controller.hostConnected?.();
	}
	/** Removes a {@linkcode ReactiveController} from the element. */
	removeController(controller) {
		this.#controllers.delete(controller);
	}
	/** On first connection, enables updating and notifies controllers. */
	connectedCallback() {
		this.#upgradeProperties();
		this.enableUpdating(true);
		for (const c of this.#controllers) c.hostConnected?.();
	}
	disconnectedCallback() {
		for (const c of this.#controllers) c.hostDisconnected?.();
	}
	/**
	* Synchronizes property values when attributes change.
	*
	* Specifically, when an attribute is set, the corresponding property is set. You should rarely need to implement this
	* callback. If this method is overridden, `super.attributeChangedCallback(name, _old, value)` must be called.
	*/
	attributeChangedCallback(attr, oldValue, newValue) {
		if (oldValue === newValue) return;
		const { props, attrToProp } = resolve(this.constructor);
		const propName = attrToProp.get(attr);
		if (!propName) return;
		const decl = props.get(propName);
		if (!decl) return;
		let value = newValue;
		if (decl.type === Boolean) value = newValue !== null;
		else if (decl.type === Number) value = newValue === null ? null : Number(newValue);
		this[propName] = value;
	}
	/**
	* Requests an update which is processed asynchronously. This should be called when an element should update based on
	* some state not triggered by setting a reactive property. In this case, pass no arguments. It should also be called
	* when manually implementing a property setter. In this case, pass the property `name` and `oldValue` to ensure that
	* any configured property options are honored.
	*/
	requestUpdate(name, oldValue) {
		if (name !== void 0 && !this.#changedProperties.has(name)) this.#changedProperties.set(name, oldValue);
		if (this.isUpdatePending) return;
		this.#updatePromise = this.#enqueueUpdate();
	}
	/**
	* Sets up the element to asynchronously update. Awaits the previous `#updatePromise` which both serializes updates
	* and (on first update) waits for `connectedCallback` to resolve the gate.
	*/
	async #enqueueUpdate() {
		this.isUpdatePending = true;
		try {
			await this.#updatePromise;
		} catch (e) {
			Promise.reject(e);
		}
		const result = this.scheduleUpdate();
		if (result != null) await result;
		return !this.isUpdatePending;
	}
	/**
	* Schedules an element update. You can override this method to change the timing of updates by returning a Promise.
	* The update will await the returned Promise, and you should resolve the Promise to allow the update to proceed. If
	* this method is overridden, `super.scheduleUpdate()` must be called.
	*
	* For instance, to schedule updates to occur just before the next frame:
	*
	* ```ts
	* override protected async scheduleUpdate(): Promise<unknown> {
	*   await new Promise((resolve) => requestAnimationFrame(() => resolve()));
	*   super.scheduleUpdate();
	* }
	* ```
	*/
	scheduleUpdate() {
		this.performUpdate();
	}
	/**
	* Performs an element update. Note, if an exception is thrown during the update, `firstUpdated` and `updated` will
	* not be called.
	*
	* Call `performUpdate()` to immediately process a pending update. This should generally not be needed, but it can be
	* done in rare cases when you need to update synchronously.
	*/
	performUpdate() {
		if (!this.isUpdatePending) return;
		const changed = this.#changedProperties;
		this.willUpdate(changed);
		for (const c of this.#controllers) c.hostUpdate?.();
		this.update(changed);
		this.#changedProperties = /* @__PURE__ */ new Map();
		this.isUpdatePending = false;
		for (const c of this.#controllers) c.hostUpdated?.();
		if (!this.hasUpdated) {
			this.hasUpdated = true;
			this.firstUpdated(changed);
		}
		this.updated(changed);
	}
	/**
	* Invoked before `update()` to compute values needed during the update.
	*
	* Implement `willUpdate` to compute property values that depend on other properties and are used in the rest of the
	* update process.
	*
	* ```ts
	* willUpdate(changed) {
	*   if (changed.has('firstName') || changed.has('lastName')) {
	*     this.sha = computeSHA(`${this.firstName} ${this.lastName}`);
	*   }
	* }
	* ```
	*/
	willUpdate(_changed) {}
	/**
	* Updates the element. Override it to render and keep the element's DOM up to date; properties are not reflected to
	* attributes. Setting properties inside this method will _not_ trigger another update.
	*/
	update(_changed) {}
	/**
	* Invoked when the element is first updated. Implement to perform one time work on the element after update.
	*
	* Setting properties inside this method will trigger the element to update again after this update cycle completes.
	*/
	firstUpdated(_changed) {}
	/**
	* Invoked whenever the element is updated. Implement to perform post-updating tasks via DOM APIs, for example,
	* focusing an element.
	*
	* Setting properties inside this method will trigger the element to update again after this update cycle completes.
	*/
	updated(_changed) {}
	/**
	* Returns a Promise that resolves when the element has completed updating. The Promise value is a boolean that is
	* `true` if the element completed the update without triggering another update. The Promise result is `false` if a
	* property was set inside `updated()`.
	*/
	get updateComplete() {
		return this.#updatePromise;
	}
	/**
	* Replays properties set before registration through their reactive accessors. This runs after subclass fields have
	* initialized but before connection lifecycle consumers, so user values win over defaults and are immediately
	* usable.
	*/
	#upgradeProperties() {
		if (this.#propertiesUpgraded) return;
		this.#propertiesUpgraded = true;
		const { props } = resolve(this.constructor);
		for (const name of props.keys()) {
			const hasSavedValue = this.#instanceProperties?.has(name) ?? false;
			const hasOwnValue = Object.hasOwn(this, name);
			if (!hasSavedValue && !hasOwnValue) continue;
			const value = hasSavedValue ? this.#instanceProperties?.get(name) : Reflect.get(this, name);
			if (hasOwnValue) Reflect.deleteProperty(this, name);
			Reflect.set(this, name, value);
		}
		this.#instanceProperties = void 0;
	}
};
/**
* Resolve `ctor.properties` into lookup Maps and install reactive accessors on the prototype. Runs once per class,
* result is cached.
*
* Subclasses that need parent properties must spread them: `static override properties = { ...Parent.properties, ...
* }`.
*/
function resolve(ctor) {
	const existing = cache.get(ctor);
	if (existing) return existing;
	const props = /* @__PURE__ */ new Map();
	const attrToProp = /* @__PURE__ */ new Map();
	for (const [name, decl] of Object.entries(ctor.properties)) {
		props.set(name, decl);
		attrToProp.set(decl.attribute ?? name, name);
		if (!Object.getOwnPropertyDescriptor(ctor.prototype, name)?.get) {
			let key = propertyKeys.get(name);
			if (!key) {
				key = Symbol(name);
				propertyKeys.set(name, key);
			}
			Object.defineProperty(ctor.prototype, name, {
				get() {
					return this[key];
				},
				set(value) {
					const old = this[key];
					this[key] = value;
					if (!Object.is(old, value)) this.requestUpdate(name, old);
				},
				configurable: true,
				enumerable: true
			});
		}
	}
	const meta = {
		props,
		attrToProp
	};
	cache.set(ctor, meta);
	return meta;
}

//#endregion
//#region ../html/dist/dev/ui/ui-element.js
/** Base class for interactive media UI elements. */
var UIElement = class extends DestroyMixin(ReactiveElement) {};

//#endregion
export { ReactiveElement as n, UIElement as t };
//# sourceMappingURL=ui-element--3_7he7k.js.map