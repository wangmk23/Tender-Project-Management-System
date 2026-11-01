/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { i as snapshotAttributes, n as restoreAttributes } from "../attributes-CI6LN9fK.js";
import { r as getElementChildren } from "../children-D2Flrhz2.js";
import { t as PositionController } from "../position-controller-qaVECOVu.js";
import { r as walkAncestors, t as getDeepActiveElement } from "../focus-CkXNMiCg.js";
import { r as readCSSLength } from "../style-CFppx62l.js";
import { i as getInlineExtent, n as getElementPadding, o as measureElement, s as measureElementChildren, t as getBlockExtent } from "../layout-BqK_K8jO.js";
import { n as observeElements } from "../observe-elements-B5qhV5BC.js";
import { c as tryShowPopover, s as tryHidePopover } from "../vars-CTJASilF.js";
import { t as containsComposed } from "../tree-idPlGAlz.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext, t as containerContext } from "../context-CL8SSE10.js";
import { t as SnapshotController } from "../snapshot-controller-CR9Xu35W.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { r as selectControls } from "../selectors-B0umcXKn.js";
import { i as getRootPositionOptions, o as MenuCSSVars, r as createMenu, t as MenuPositioningCSSVars } from "../menu--bNbak0v.js";
import { i as MenuPopupDataAttrs, n as resolveMenuOptionState, r as MenuContentDataAttrs, t as MenuCore } from "../core-C7j2Xy0P.js";
import { t as createTransition } from "../transition-C9TiIy5V.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as popupGroupContext } from "../popup-group-context-DFsPDSN9.js";
import { t as POPUP_HOST_ATTR } from "../host-BJbdoUVc.js";
import { t as menuContext } from "../context-D5Xgpnkx.js";

//#region ../core/dist/dev/dom/ui/menu/popup.js
/**
* Coordinates sibling Contents and sizes their shared Popup.
*
* @internal
*/
function createMenuPopup() {
	const contents = /* @__PURE__ */ new Set();
	const exitFrames = /* @__PURE__ */ new Map();
	let element = null;
	let frame = 0;
	function scheduleSync() {
		cancelAnimationFrame(frame);
		sync();
		frame = requestAnimationFrame(sync);
	}
	function getChildren(parent) {
		return [...contents].filter((content) => content.parent === parent);
	}
	function getActiveChild(parent) {
		return getChildren(parent).find(({ menu }) => {
			const input = menu.input.current;
			return input.active && input.status !== "ending";
		}) ?? null;
	}
	function getClosingChild(parent) {
		return getChildren(parent).find(({ menu }) => {
			const input = menu.input.current;
			return input.active && input.status === "ending";
		}) ?? null;
	}
	function cancelChildExit(content) {
		cancelAnimationFrame(exitFrames.get(content) ?? 0);
		exitFrames.delete(content);
	}
	function scheduleChildExit(content) {
		if (exitFrames.has(content)) return;
		const exitFrame = requestAnimationFrame(() => {
			exitFrames.set(content, requestAnimationFrame(() => {
				exitFrames.delete(content);
				if (!contents.has(content) || getActiveChild(content.menu)) return;
				content.element.removeAttribute(MenuContentDataAttrs.childOpen);
				sync();
			}));
		});
		exitFrames.set(content, exitFrame);
	}
	function getCurrentContent() {
		let current = [...contents].find((content) => content.parent === null) ?? null;
		while (current) {
			const child = getActiveChild(current.menu) ?? (exitFrames.has(current) ? getClosingChild(current.menu) : null);
			if (!child) return current;
			current = child;
		}
		return null;
	}
	function setInactive(content, inactive) {
		if (inactive) {
			content.element.setAttribute("aria-hidden", "true");
			content.element.setAttribute("inert", "");
		} else restoreAttributes(content.element, content.accessibility);
	}
	function restoreFocusBeforeHiding(content) {
		const hasFocus = () => {
			const active = getDeepActiveElement(content.element.ownerDocument);
			return active instanceof Element && containsComposed(content.element, active);
		};
		if (!hasFocus()) return;
		content.menu.restoreFocus();
		const parentInput = content.parent?.input.current;
		if (hasFocus() && parentInput?.active && parentInput.status !== "ending") content.menu.triggerElement?.focus();
		const active = getDeepActiveElement(content.element.ownerDocument);
		if (hasFocus() && active instanceof HTMLElement) active.blur();
	}
	function getAvailableWidth(popup) {
		return walkAncestors(popup, (ancestor) => {
			const width = readCSSLength(ancestor, MenuCSSVars.availableWidth);
			return width !== null && width > 0 ? width : void 0;
		}) ?? null;
	}
	function getVerticalScrollbarWidth(content) {
		if (content.scrollHeight <= content.clientHeight) return 0;
		const style = getComputedStyle(content);
		const inlineBorder = (Number.parseFloat(style.borderInlineStartWidth) || 0) + (Number.parseFloat(style.borderInlineEndWidth) || 0);
		return Math.max(0, content.offsetWidth - content.clientWidth - inlineBorder);
	}
	function measureContent(content, availableWidth) {
		const children = getElementChildren(content, (child) => child instanceof HTMLElement && !child.hidden);
		if (children.length === 0) return measureElement(content, {
			overflow: "both",
			styles: {
				width: "max-content",
				height: "auto",
				minWidth: "0px",
				maxWidth: "none"
			}
		});
		return measureElementChildren(content, {
			children,
			includePadding: true,
			maxWidth: availableWidth,
			measure: (child, width) => measureElement(child, {
				overflow: "both",
				styles: {
					insetInlineStart: "0px",
					insetInlineEnd: "auto",
					width: width === void 0 ? "max-content" : `${width}px`,
					height: "auto",
					minWidth: "0px",
					maxWidth: "none"
				}
			})
		});
	}
	function sync() {
		if (!element) return;
		const inactiveContents = /* @__PURE__ */ new Map();
		for (const content of contents) {
			const activeChild = getActiveChild(content.menu);
			if (activeChild) {
				cancelChildExit(content);
				content.menu.highlight(null);
				content.element.setAttribute(MenuContentDataAttrs.childOpen, "");
			} else if (getClosingChild(content.menu) && content.element.hasAttribute(MenuContentDataAttrs.childOpen)) scheduleChildExit(content);
			else {
				cancelChildExit(content);
				content.element.removeAttribute(MenuContentDataAttrs.childOpen);
			}
			const input = content.menu.input.current;
			const isExitingPage = content.parent !== null && input.active && input.status === "ending";
			inactiveContents.set(content, activeChild !== null || isExitingPage);
			setInactive(content, false);
		}
		for (const [content, inactive] of inactiveContents) {
			const input = content.menu.input.current;
			if (content.parent !== null && input.active && input.status === "ending") restoreFocusBeforeHiding(content);
			setInactive(content, inactive);
		}
		const current = getCurrentContent();
		if (!current) return;
		const popupPadding = current.parent === null ? getElementPadding(element) : null;
		const inlinePadding = popupPadding ? getInlineExtent(popupPadding) : 0;
		const blockPadding = popupPadding ? getBlockExtent(popupPadding) : 0;
		const availableWidth = getAvailableWidth(element);
		const contentAvailableWidth = availableWidth === null ? null : Math.max(0, availableWidth - inlinePadding);
		const size = measureContent(current.element, contentAvailableWidth);
		const width = Math.ceil(size.width + inlinePadding);
		const height = Math.ceil(size.height + blockPadding);
		element.style.setProperty(MenuCSSVars.width, `${width}px`);
		element.style.setProperty(MenuCSSVars.height, `${height}px`);
		const scrollbarWidth = getVerticalScrollbarWidth(current.element);
		if (scrollbarWidth > 0) element.style.setProperty(MenuCSSVars.width, `${width + scrollbarWidth}px`);
	}
	function setElement(next) {
		element = next;
		scheduleSync();
	}
	function registerContent(registration) {
		const registered = {
			...registration,
			accessibility: snapshotAttributes(registration.element, ["aria-hidden", "inert"]),
			stopObserving: () => {},
			unsubscribe: () => {}
		};
		registered.unsubscribe = registration.menu.input.subscribe(scheduleSync);
		registered.stopObserving = observeElements({
			root: registration.element,
			getElements: () => [registration.element],
			mutations: {
				childList: true,
				subtree: true,
				characterData: true
			},
			onChange: scheduleSync
		});
		contents.add(registered);
		registration.menu.setContentElement(registration.element);
		scheduleSync();
		return () => {
			cancelChildExit(registered);
			contents.delete(registered);
			registered.unsubscribe();
			registered.stopObserving();
			restoreAttributes(registration.element, registered.accessibility);
			registration.element.removeAttribute(MenuContentDataAttrs.childOpen);
			if (registration.menu.contentElement === registration.element) registration.menu.setContentElement(null);
			scheduleSync();
		};
	}
	function destroy() {
		cancelAnimationFrame(frame);
		for (const exitFrame of exitFrames.values()) cancelAnimationFrame(exitFrame);
		exitFrames.clear();
		for (const content of contents) {
			content.unsubscribe();
			content.stopObserving();
			restoreAttributes(content.element, content.accessibility);
			content.element.removeAttribute(MenuContentDataAttrs.childOpen);
			if (content.menu.contentElement === content.element) content.menu.setContentElement(null);
		}
		contents.clear();
		element = null;
	}
	return {
		get element() {
			return element;
		},
		setElement,
		registerContent,
		sync,
		destroy
	};
}

//#endregion
//#region ../html/dist/dev/ui/menu/element.js
/**
* Root menu state and positioned popup. Content pages are direct children.
*
* @fires open-change - Fired before the menu's open state changes. Cancel the event to prevent the change.
*/
var MenuElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.open = MenuCore.defaultProps.open;
		this.defaultOpen = MenuCore.defaultProps.defaultOpen;
		this.side = MenuCore.defaultProps.side;
		this.align = MenuCore.defaultProps.align;
		this.closeOnEscape = MenuCore.defaultProps.closeOnEscape;
		this.closeOnOutsideClick = MenuCore.defaultProps.closeOnOutsideClick;
		this.boundary = "container";
		this.#core = new MenuCore();
		this.#provider = new ContextProvider(this, { context: menuContext });
		this.#position = new PositionController(this);
		this.#controlsState = new PlayerController(this, playerContext, selectControls);
		this.#containerCtx = new ContextConsumer(this, {
			context: containerContext,
			subscribe: true
		});
		this.#popupGroupCtx = new ContextConsumer(this, { context: popupGroupContext });
		this.#menu = null;
		this.#popup = null;
		this.#snapshot = null;
		this.#disconnect = null;
		this.#triggerAbort = null;
		this.#currentTrigger = null;
		this.#triggerWasDisabled = false;
		this.#triggerWasHidden = false;
		this.#releaseControlsLock = null;
		this.#optionStates = /* @__PURE__ */ new Map();
		this.#optionState = null;
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
			if ((this.#optionState?.disabled || this.#optionState?.hidden) && this.open) this.close("imperative-action");
			this.#syncOptionState(this.#currentTrigger);
		};
	}
	static {
		this.tagName = "media-menu";
	}
	static {
		this.properties = {
			open: { type: Boolean },
			defaultOpen: {
				type: Boolean,
				attribute: "default-open"
			},
			side: { type: String },
			align: { type: String },
			closeOnEscape: {
				type: Boolean,
				attribute: "close-on-escape"
			},
			closeOnOutsideClick: {
				type: Boolean,
				attribute: "close-on-outside-click"
			},
			boundary: { type: String }
		};
	}
	#core;
	#provider;
	#position;
	#controlsState;
	#containerCtx;
	#popupGroupCtx;
	#menu;
	#popup;
	#snapshot;
	#disconnect;
	#triggerAbort;
	#currentTrigger;
	#triggerWasDisabled;
	#triggerWasHidden;
	#releaseControlsLock;
	#optionStates;
	#optionState;
	get menu() {
		return this.#menu;
	}
	get popup() {
		return this.#popup;
	}
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.setAttribute(POPUP_HOST_ATTR, "");
		this.#disconnect = new AbortController();
		this.#popup = createMenuPopup();
		this.#popup.setElement(this);
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
			closeOnEscape: () => this.closeOnEscape,
			closeOnOutsideClick: () => this.closeOnOutsideClick,
			group: () => this.#popupGroupCtx.value
		});
		this.#menu.setPopupElement(this);
		applyElementProps(this, { onFocusOut: this.#handleFocusOut }, { signal: this.#disconnect.signal });
		if (this.#snapshot) this.#snapshot.track(this.#menu.input);
		else this.#snapshot = new SnapshotController(this, this.#menu.input);
	}
	disconnectedCallback() {
		this.#releaseControlsVisibilityLock();
		super.disconnectedCallback();
		this.#position.cleanup();
		this.#cleanupTrigger();
		this.#popup?.destroy();
		this.#popup = null;
		this.#menu?.destroy();
		this.#menu = null;
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	close(reason = "imperative-action") {
		this.#menu?.close(reason);
	}
	openMenu(reason = "imperative-action") {
		this.#menu?.open(reason);
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		if (!this.hasUpdated && this.defaultOpen && !this.open) this.open = true;
		this.#core.setProps({
			open: this.open,
			defaultOpen: this.defaultOpen,
			side: this.side,
			align: this.align,
			closeOnEscape: this.closeOnEscape,
			closeOnOutsideClick: this.closeOnOutsideClick
		});
		if (this.#menu && changed.has("open")) this.#menu.syncOpen(this.open);
	}
	update(changed) {
		super.update(changed);
		if (!this.#menu || !this.#popup) return;
		const input = this.#menu.input.current;
		this.#core.setInput({
			...input,
			isSubmenu: false
		});
		const state = this.#core.getState();
		if (state.open) this.#releaseControlsLock ??= this.#controlsState.value?.requestControlsLock() ?? null;
		else this.#releaseControlsVisibilityLock();
		const triggerElement = this.#position.findTrigger();
		this.#syncTrigger(triggerElement);
		applyElementProps(this, this.#core.getPopupAttrs());
		applyStateDataAttrs(this, state, MenuPopupDataAttrs);
		if (state.open) tryShowPopover(this);
		else tryHidePopover(this);
		if (this.#currentTrigger) {
			applyElementProps(this.#currentTrigger, this.#core.getTriggerAttrs(state, this.#menu.contentElement?.id));
			this.#syncOptionState(this.#currentTrigger);
		}
		if (!state.open) this.#position.cleanup();
		else {
			this.#popup.sync();
			const positionOptions = getRootPositionOptions(state.side, state.align);
			if (positionOptions && this.#currentTrigger) this.#position.sync({
				anchorName: this.id,
				position: positionOptions,
				trigger: this.#currentTrigger,
				boundary: this.boundary,
				container: this.#containerCtx.value?.container ?? null,
				cssVars: MenuPositioningCSSVars,
				trackResize: false,
				onSideChange: (side) => this.setAttribute(MenuPopupDataAttrs.side, side)
			});
		}
		this.#provider.setValue({
			core: this.#core,
			menu: this.#menu,
			popup: this.#popup,
			state,
			setOptionState: this.#setOptionState
		});
	}
	#releaseControlsVisibilityLock() {
		this.#releaseControlsLock?.();
		this.#releaseControlsLock = null;
	}
	#handleFocusOut;
	#syncTrigger(triggerElement) {
		if (triggerElement === this.#currentTrigger) return;
		this.#position.cleanup();
		this.#cleanupTrigger();
		this.#currentTrigger = triggerElement;
		this.#triggerWasDisabled = triggerElement ? isTriggerExplicitlyDisabled(triggerElement) : false;
		this.#triggerWasHidden = triggerElement?.hidden === true;
		this.#menu?.setTriggerElement(triggerElement);
		if (triggerElement && this.#menu) {
			this.#triggerAbort = new AbortController();
			applyElementProps(triggerElement, this.#menu.triggerProps, { signal: this.#triggerAbort.signal });
			this.#syncOptionState(triggerElement);
		}
	}
	#setOptionState;
	#syncOptionState(trigger) {
		if (!trigger) return;
		applyElementProps(trigger, {
			disabled: this.#triggerWasDisabled || this.#optionState?.disabled || void 0,
			"aria-disabled": this.#triggerWasDisabled || this.#optionState?.disabled ? "true" : void 0,
			"data-availability": this.#optionState?.availability,
			hidden: this.#triggerWasHidden || this.#optionState?.hidden || void 0
		});
		const value = trigger.querySelector("[data-part~=\"value\"], [data-part~=\"hint\"]");
		if (value && value.textContent !== this.#optionState?.value) value.textContent = this.#optionState?.value ?? "";
	}
	#cleanupTrigger() {
		if (this.#currentTrigger) {
			applyElementProps(this.#currentTrigger, {
				"aria-expanded": void 0,
				"aria-haspopup": void 0,
				"aria-controls": void 0,
				disabled: this.#triggerWasDisabled || void 0,
				"aria-disabled": this.#triggerWasDisabled ? "true" : void 0,
				"data-availability": void 0,
				hidden: this.#triggerWasHidden || void 0
			});
			const value = this.#currentTrigger.querySelector("[data-part~=\"value\"], [data-part~=\"hint\"]");
			if (value?.textContent) value.textContent = "";
		}
		this.#triggerAbort?.abort();
		this.#triggerAbort = null;
		this.#currentTrigger = null;
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
//#region ../html/dist/dev/define/ui/menu.js
safeDefine(MenuElement);

//#endregion
//# sourceMappingURL=menu.dev.js.map