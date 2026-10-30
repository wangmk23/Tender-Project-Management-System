import { c as isObject, r as isBoolean } from "./predicate-3rF1m2uv.js";
import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { r as i18nContext, t as I18nController } from "./controller-CKtzV_P4.js";
import { n as getHotkeyCoordinator } from "./hotkey-T5EtQ6E0.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { t as containerContext } from "./context-CL8SSE10.js";
import { t as HOTKEY_SHORTCUT_CHANGE_EVENT } from "./hotkey-events-CwmzKlPW.js";
import { t as createButton } from "./button-BpO-7OFK.js";
import { t as applyElementProps } from "./element-props-CYmZOrQN.js";
import { t as logMissingFeature } from "./log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "./state-data-attrs-DiSfe3GX.js";
import { isText, resolveText, translateText } from "./i18n.dev.js";

//#region ../html/dist/dev/ui/hotkey/aria-key-shortcuts-controller.js
/** Provides hotkey shortcut metadata for a given hotkey action name. */
var AriaKeyShortcutsController = class {
	#host;
	#action;
	#getValue;
	#container;
	#unsubscribe = null;
	/**
	* @param host - Host element whose nearest player container supplies hotkey registrations.
	* @param action - Registered hotkey action to look up.
	* @param options - Optional value resolver for value-dependent shortcuts.
	*/
	constructor(host, action, options = {}) {
		this.#host = host;
		this.#action = action;
		this.#getValue = options.value;
		this.#container = new ContextConsumer(host, {
			context: containerContext,
			callback: (ctx) => this.#connect(ctx?.container),
			subscribe: true
		});
		host.addController(this);
	}
	get value() {
		return this.aria;
	}
	get aria() {
		return this.details.aria;
	}
	get shortcut() {
		return this.details.shortcut;
	}
	get details() {
		const container = this.#container.value?.container;
		if (!container) return {};
		return getHotkeyCoordinator(container).getShortcut(this.#action, this.#getValue?.());
	}
	hostConnected() {
		this.#connect(this.#container.value?.container);
	}
	hostDisconnected() {
		this.#disconnect();
	}
	#connect(container) {
		this.#disconnect();
		if (!container) return;
		const coordinator = getHotkeyCoordinator(container);
		const notify = () => {
			this.#host.requestUpdate();
		};
		this.#unsubscribe = coordinator.subscribeShortcutChanges(notify);
		notify();
	}
	#disconnect() {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
	}
};

//#endregion
//#region ../html/dist/dev/ui/media-button-element.js
/**
* Abstract base for HTML custom elements that render a media-control button. `ComponentState` is the state the button
* reflects to data attributes, and `MediaState` is the player state it reads and acts on. Pass both: a subclass that
* omits them still compiles, but types `activate(state)` and `mediaState` as the `ButtonState` and `object` defaults.
*/
var MediaButtonElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.disabled = false;
		this.label = "";
		this.hotkeyAction = void 0;
		this.#disconnect = null;
		this.#hotkeyRegistry = null;
		this.#i18n = new I18nController(this, i18nContext);
	}
	static {
		this.properties = {
			label: { type: String },
			disabled: { type: Boolean }
		};
	}
	getIsButtonDisabled() {
		return this.disabled || !this.mediaState.value;
	}
	handleActivate(event, source) {
		Promise.resolve(this.activate(this.mediaState.value, event, source)).catch((error) => {
			console.error(`[${this.localName}]`, error);
		});
	}
	/** Override to match hotkeys that use action values, such as seek steps. */
	get hotkeyValue() {}
	get $state() {
		return this.core.state;
	}
	#disconnect;
	#hotkeyRegistry;
	#lastHotkeyShortcut;
	#i18n;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		if (this.hotkeyAction && !this.#hotkeyRegistry) this.#hotkeyRegistry = new AriaKeyShortcutsController(this, this.hotkeyAction, { value: () => this.hotkeyValue });
		this.#disconnect = new AbortController();
		const buttonProps = createButton({
			onActivate: (event, source) => this.handleActivate(event, source),
			isDisabled: () => this.getIsButtonDisabled()
		});
		applyElementProps(this, buttonProps, { signal: this.#disconnect.signal });
		if (!this.mediaState.value && this.mediaState.displayName) logMissingFeature(this.localName, this.mediaState.displayName);
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	/** Returns the button's current label derived from media state. */
	getLabel() {
		return this.core.state.current.label ? resolveText(this.core.state.current.label) : void 0;
	}
	getShortcut() {
		return this.#hotkeyRegistry?.shortcut;
	}
	/** Resolved label for tooltips and other display surfaces. */
	getResolvedLabel() {
		const media = this.mediaState.value;
		if (!media) return void 0;
		this.core.setMedia(media);
		const state = this.core.getState();
		return translateText(this.core.getLabel(state), this.#i18n.value, this.core.getLabelParams?.(state));
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		this.core.setProps?.(this);
	}
	update(changed) {
		super.update(changed);
		const media = this.mediaState.value;
		this.#syncHotkeyShortcut();
		if (!media) return;
		this.core.setMedia(media);
		const state = this.core.getState();
		const attrs = this.core.getAttrs?.(state) ?? {};
		if (isText(attrs["aria-label"])) attrs["aria-label"] = translateText(attrs["aria-label"], this.#i18n.value, this.core.getLabelParams?.(state));
		applyElementProps(this, {
			...attrs,
			"aria-keyshortcuts": this.#hotkeyRegistry?.aria,
			...isHideable(state) && { hidden: state.hidden ? "" : void 0 }
		});
		applyStateDataAttrs(this, state, this.stateAttrMap);
	}
	#syncHotkeyShortcut() {
		const shortcut = this.getShortcut();
		if (shortcut === this.#lastHotkeyShortcut) return;
		this.#lastHotkeyShortcut = shortcut;
		this.dispatchEvent(new CustomEvent(HOTKEY_SHORTCUT_CHANGE_EVENT));
	}
};
/** Whether a button's core reports whether it should be shown at all. */
function isHideable(state) {
	return isObject(state) && isBoolean(state.hidden);
}

//#endregion
export { MediaButtonElement as t };
//# sourceMappingURL=media-button-element-C2m_z2c8.js.map