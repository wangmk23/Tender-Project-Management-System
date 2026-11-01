/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { a as isMenuNavigationKey, r as createMenu } from "../menu--bNbak0v.js";
import { n as resolveMenuOptionState, r as MenuContentDataAttrs, t as MenuCore } from "../core-C7j2Xy0P.js";
import { t as createTransition } from "../transition-C9TiIy5V.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as menuContext } from "../context-D5Xgpnkx.js";

//#region ../html/dist/dev/ui/menu/content.js
let idCounter = 0;
/** One accessible menu page. Root and nested pages are sibling children of `<media-menu>`. */
var MenuContentElement = class MenuContentElement extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.open = false;
		this.defaultOpen = false;
		this.#root = new ContextConsumer(this, {
			context: menuContext,
			subscribe: true
		});
		this.#provider = new ContextProvider(this, { context: menuContext });
		this.#core = new MenuCore();
		this.#generatedId = `vjs-menu-content-${idCounter++}`;
		this.#context = null;
		this.#menu = null;
		this.#parentMenu = null;
		this.#rootMenu = null;
		this.#ownsMenu = false;
		this.#disconnect = null;
		this.#cleanupRegistration = null;
		this.#cleanupParentRegistration = null;
		this.#optionStates = /* @__PURE__ */ new Map();
		this.#optionSource = Symbol("menu");
		this.#optionState = null;
		this.#optionParent = null;
		this.#stateTrigger = null;
		this.#triggerWasDisabled = false;
		this.#triggerWasHidden = false;
		this.#wasActive = false;
		this.#normalizing = false;
		this.#handleKeyDown = (event) => {
			const isNavigationKey = isMenuNavigationKey(event);
			const defaultPrevented = event.defaultPrevented;
			this.#menu?.contentProps.onKeyDown(event);
			if (this.#parentMenu && (event.key === "ArrowLeft" || event.key === "Escape") && !defaultPrevented) {
				event.preventDefault();
				this.#menu?.close("escape");
			}
			if (event.key !== "Escape" && isNavigationKey) event.stopPropagation();
		};
		this.#handleFocusOut = (event) => {
			this.#menu?.contentProps.onFocusOut(event);
		};
		this.#setOptionState = (source, optionState) => {
			const previous = this.#optionStates.get(source);
			if (optionState && isSameOptionState(previous, optionState)) return;
			if (!optionState && !previous) return;
			if (optionState) this.#optionStates.set(source, optionState);
			else this.#optionStates.delete(source);
			this.#optionState = resolveMenuOptionState(this.#optionStates.values());
			if ((this.#optionState?.disabled || this.#optionState?.hidden) && this.open && this.#parentMenu) this.close("imperative-action");
			this.#syncOptionState(this.#findTrigger());
			this.#optionParent?.setOptionState(this.#optionSource, this.#optionState);
		};
	}
	static {
		this.tagName = "media-menu-content";
	}
	static {
		this.properties = {
			open: { type: Boolean },
			defaultOpen: {
				type: Boolean,
				attribute: "default-open"
			}
		};
	}
	#root;
	#provider;
	#core;
	#generatedId;
	#context;
	#menu;
	#parentMenu;
	#rootMenu;
	#ownsMenu;
	#disconnect;
	#cleanupRegistration;
	#cleanupParentRegistration;
	#optionStates;
	#optionSource;
	#optionState;
	#optionParent;
	#stateTrigger;
	#triggerWasDisabled;
	#triggerWasHidden;
	#wasActive;
	#normalizing;
	get context() {
		return this.#context;
	}
	connectedCallback() {
		super.connectedCallback();
		if (this.#normalizing) return;
		this.#disconnect = new AbortController();
		applyElementProps(this, {
			onKeyDown: this.#handleKeyDown,
			onFocusOut: this.#handleFocusOut
		}, { signal: this.#disconnect.signal });
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		if (this.#normalizing) return;
		this.#cleanupMenu();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	openMenu(reason = "imperative-action") {
		this.#menu?.open(reason);
	}
	close(reason = "imperative-action") {
		this.#menu?.close(reason);
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		if (!this.hasUpdated && this.defaultOpen && !this.open) this.open = true;
		if (this.#ownsMenu && this.#menu && changed.has("open")) this.#menu.syncOpen(this.open);
	}
	update(changed) {
		super.update(changed);
		const root = this.#root.value ?? null;
		if (!root) return;
		if (!this.id) this.id = this.#generatedId;
		const trigger = this.#findTrigger();
		const parentContent = trigger?.closest(MenuContentElement.tagName) ?? null;
		if (parentContent && !parentContent.context) {
			this.hidden = true;
			requestAnimationFrame(() => this.requestUpdate());
			return;
		}
		const parentMenu = parentContent?.context?.menu ?? null;
		const isSubmenu = parentMenu !== null;
		if (root.menu !== this.#rootMenu || parentMenu !== this.#parentMenu) {
			this.#cleanupMenu();
			this.#rootMenu = root.menu;
			this.#parentMenu = parentMenu;
			this.#setupMenu(root, parentMenu);
		}
		this.#setOptionParent(parentContent?.context ?? root);
		const menu = this.#menu;
		if (!menu) return;
		const input = menu.input.current;
		this.#core.setInput({
			...input,
			isSubmenu
		});
		const state = this.#core.getState();
		const active = !isSubmenu || state.open || state.status === "ending";
		applyElementProps(this, {
			...this.#core.getContentAttrs(),
			hidden: !active
		});
		applyStateDataAttrs(this, state, MenuContentDataAttrs);
		if (trigger) {
			menu.setTriggerElement(trigger);
			applyElementProps(trigger, this.#core.getTriggerAttrs(state, active ? this.id : void 0));
			this.#syncOptionState(trigger);
		}
		if (isSubmenu && active && !this.#wasActive) menu.highlightInitialItem({ preventScroll: true });
		this.#wasActive = active;
		this.#context = {
			core: this.#core,
			menu,
			popup: root.popup,
			state,
			setOptionState: this.#setOptionState
		};
		this.#provider.setValue(this.#context);
		root.popup.sync();
		this.#normalize();
	}
	#setupMenu(root, parentMenu) {
		if (parentMenu !== null) {
			this.#ownsMenu = true;
			this.#menu = createMenu({
				transition: createTransition(),
				onOpenChange: (nextOpen, details) => {
					if (this.dispatchEvent(new CustomEvent("open-change", {
						bubbles: true,
						cancelable: true,
						composed: true,
						detail: {
							open: nextOpen,
							...details
						}
					}))) this.open = nextOpen;
				},
				closeOnEscape: () => true,
				closeOnOutsideClick: () => false
			});
			this.#menu.setPopupElement(this);
			this.#cleanupParentRegistration = parentMenu.registerSubmenu(this.#menu);
			const signal = this.#disconnect?.signal;
			if (signal) this.#menu.input.subscribe(() => this.requestUpdate(), { signal });
			this.#menu.syncOpen(this.open);
		} else {
			this.#ownsMenu = false;
			this.#menu = root.menu;
		}
		this.#cleanupRegistration = root.popup.registerContent({
			menu: this.#menu,
			parent: parentMenu,
			element: this
		});
	}
	#cleanupMenu() {
		this.#cleanupRegistration?.();
		this.#cleanupRegistration = null;
		this.#cleanupParentRegistration?.();
		this.#cleanupParentRegistration = null;
		this.#setOptionParent(null);
		this.#clearOptionState();
		this.#optionStates.clear();
		this.#optionState = null;
		if (this.#ownsMenu) this.#menu?.destroy();
		this.#menu = null;
		this.#context = null;
		this.#rootMenu = null;
		this.#parentMenu = null;
		this.#ownsMenu = false;
		this.#wasActive = false;
	}
	#findTrigger() {
		if (!this.id) return null;
		return [...this.getRootNode().querySelectorAll("[commandfor], media-menu-item")].find((element) => element.getAttribute("commandfor") === this.id || element.commandfor === this.id) ?? null;
	}
	/** Keep every page as a direct popup child, including authored nested pages. */
	#normalize() {
		const popup = this.closest("media-menu");
		if (!popup || this.parentElement === popup) return;
		this.#normalizing = true;
		popup.append(this);
		this.#normalizing = false;
	}
	#handleKeyDown;
	#handleFocusOut;
	#setOptionState;
	#setOptionParent(parent) {
		if (parent?.menu === this.#optionParent?.menu) {
			this.#optionParent = parent;
			return;
		}
		this.#optionParent?.setOptionState(this.#optionSource, null);
		this.#optionParent = parent;
		this.#optionParent?.setOptionState(this.#optionSource, this.#optionState);
	}
	#syncOptionState(trigger) {
		if (trigger !== this.#stateTrigger) {
			this.#clearOptionState();
			this.#stateTrigger = trigger;
			this.#triggerWasDisabled = trigger ? isTriggerExplicitlyDisabled(trigger) : false;
			this.#triggerWasHidden = trigger?.hidden === true;
		}
		if (!trigger) return;
		const disabled = this.#optionState?.disabled || this.#triggerWasDisabled;
		applyElementProps(trigger, {
			disabled: disabled || void 0,
			"aria-disabled": disabled ? "true" : void 0,
			"data-availability": this.#optionState?.availability,
			hidden: this.#triggerWasHidden || this.#optionState?.hidden || void 0
		});
		const value = trigger.querySelector("[data-part~=\"value\"], [data-part~=\"hint\"]");
		if (value && value.textContent !== this.#optionState?.value) value.textContent = this.#optionState?.value ?? "";
	}
	#clearOptionState() {
		const trigger = this.#stateTrigger;
		if (!trigger) return;
		applyElementProps(trigger, {
			disabled: this.#triggerWasDisabled || void 0,
			"aria-disabled": this.#triggerWasDisabled ? "true" : void 0,
			"data-availability": void 0,
			hidden: this.#triggerWasHidden || void 0
		});
		const value = trigger.querySelector("[data-part~=\"value\"], [data-part~=\"hint\"]");
		if (value?.textContent) value.textContent = "";
		this.#stateTrigger = null;
		this.#triggerWasDisabled = false;
		this.#triggerWasHidden = false;
	}
};
function isSameOptionState(a, b) {
	return a?.value === b.value && a.disabled === b.disabled && a.hidden === b.hidden && a.availability === b.availability;
}
function isTriggerExplicitlyDisabled(trigger) {
	return trigger.hasAttribute("disabled") || "disabled" in trigger && trigger.disabled === true;
}

//#endregion
//#region ../html/dist/dev/define/ui/menu-content.js
safeDefine(MenuContentElement);

//#endregion
//# sourceMappingURL=menu-content.dev.js.map