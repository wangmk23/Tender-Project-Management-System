/*! Video.js | https://videojs.org/help */
import { i as isFunction } from "../predicate-3rF1m2uv.js";
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as listen } from "../listen-CO63BggB.js";
import { t as PositionController } from "../position-controller-qaVECOVu.js";
import { c as tryShowPopover, s as tryHidePopover } from "../vars-CTJASilF.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as containerContext } from "../context-CL8SSE10.js";
import { t as SnapshotController } from "../snapshot-controller-CR9Xu35W.js";
import { t as HOTKEY_SHORTCUT_CHANGE_EVENT } from "../hotkey-events-CwmzKlPW.js";
import { n as getTransitionFlags, t as TransitionDataAttrs } from "../transition-CzuKD0-9.js";
import { t as createPopover } from "../popover-BfzYkhvl.js";
import { t as createTransition } from "../transition-C9TiIy5V.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as popupGroupContext } from "../popup-group-context-DFsPDSN9.js";
import { t as POPUP_HOST_ATTR } from "../host-BJbdoUVc.js";
import { t as tooltipGroupContext } from "../context-DFwp_F7d.js";
import { t as TooltipLabelElement } from "../label-D5xv21nM.js";
import { t as TooltipShortcutElement } from "../shortcut-DUZRMLty.js";
import { translateText } from "../i18n.dev.js";

//#region ../core/dist/dev/dom/ui/tooltip/tooltip.js
/** Map popover reasons to tooltip reasons, filtering out click/outside-click. */
const REASON_MAP = {
	hover: "hover",
	focus: "focus",
	escape: "escape",
	blur: "blur",
	"imperative-action": "imperative-action"
};
/** @internal */
function createTooltip(options) {
	const popoverOpts = {
		transition: options.transition,
		onOpenChange(open, details) {
			const reason = REASON_MAP[details.reason];
			if (!reason) return;
			const group = options.group?.();
			if (open) group?.notifyOpen();
			else group?.notifyClose();
			const tooltipDetails = details.event ? {
				reason,
				event: details.event
			} : { reason };
			options.onOpenChange(open, tooltipDetails);
		},
		closeOnEscape: () => true,
		closeOnOutsideClick: () => false,
		openOnHover: () => true,
		delay: () => {
			const group = options.group?.();
			if (group?.shouldSkipDelay()) return 0;
			return options.delay?.() ?? group?.delay ?? 600;
		},
		closeDelay: () => {
			const group = options.group?.();
			return options.closeDelay?.() ?? group?.closeDelay ?? 0;
		}
	};
	if (options.onOpenChangeComplete) popoverOpts.onOpenChangeComplete = options.onOpenChangeComplete;
	const popover = createPopover(popoverOpts);
	let isPointerDown = false;
	let popupGroup;
	let unsubscribe;
	function isTriggerPopupOpen() {
		return popupGroup?.isOpenFor(popover.triggerElement) ?? false;
	}
	function isSticky() {
		return options.sticky?.() ?? false;
	}
	function syncPopupGroup() {
		const next = options.popupGroup?.();
		if (next === popupGroup) return;
		unsubscribe?.();
		popupGroup = next;
		unsubscribe = popupGroup?.subscribe(() => {
			if (isTriggerPopupOpen() && !isSticky()) popover.close("imperative-action");
		});
	}
	function setTriggerElement(el) {
		popover.setTriggerElement(el);
		syncPopupGroup();
		if (isTriggerPopupOpen() && !isSticky()) popover.close("imperative-action");
	}
	const { onClick: _, ...baseTriggerProps } = popover.triggerProps;
	const triggerProps = {
		...baseTriggerProps,
		onPointerDown() {
			syncPopupGroup();
			isPointerDown = true;
			if (!isSticky()) popover.close("imperative-action");
		},
		onPointerEnter(event) {
			syncPopupGroup();
			if (options.disabled?.()) return;
			if (isTriggerPopupOpen() && !isSticky()) return;
			if (event.pointerType === "touch") return;
			baseTriggerProps.onPointerEnter(event);
		},
		onFocusIn(event) {
			syncPopupGroup();
			if (options.disabled?.()) return;
			if (isTriggerPopupOpen() && !isSticky()) return;
			if (isPointerDown) {
				isPointerDown = false;
				return;
			}
			baseTriggerProps.onFocusIn(event);
		}
	};
	const popupProps = {
		...popover.popupProps,
		onPointerEnter(event) {
			if (options.disableHoverablePopup?.()) return;
			popover.popupProps.onPointerEnter(event);
		}
	};
	return {
		...popover,
		triggerProps,
		popupProps,
		get triggerElement() {
			return popover.triggerElement;
		},
		setTriggerElement,
		open: () => {
			syncPopupGroup();
			if (!isTriggerPopupOpen() || isSticky()) popover.open("hover");
		},
		close: (reason = "hover") => popover.close(reason),
		destroy() {
			unsubscribe?.();
			popover.destroy();
		}
	};
}

//#endregion
//#region ../core/dist/dev/core/ui/tooltip/core.js
/** @internal */
var TooltipCore = class TooltipCore {
	static defaultProps = {
		side: "top",
		align: "center",
		open: false,
		defaultOpen: false,
		delay: 600,
		closeDelay: 0,
		disableHoverablePopup: true,
		disabled: false,
		sticky: false
	};
	#props = { ...TooltipCore.defaultProps };
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, TooltipCore.defaultProps);
	}
	#input = null;
	setInput(input) {
		this.#input = input;
	}
	getState() {
		const input = this.#input;
		return {
			open: input.active,
			status: input.status,
			side: this.#props.side,
			align: this.#props.align,
			...getTransitionFlags(input.status)
		};
	}
	getPopupAttrs(_state) {
		return {
			popover: "manual",
			role: "presentation"
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/tooltip/data.js
/** @internal */
const TooltipDataAttrs = {
	/** Present when the tooltip is open. */
	open: "data-open",
	/** Indicates the rendered side of the tooltip after collision handling. */
	side: "data-side",
	/** Indicates how the tooltip is aligned relative to the specified side. */
	align: "data-align",
	...TransitionDataAttrs
};

//#endregion
//#region ../core/dist/dev/core/ui/tooltip/vars.js
/** @internal */
const TooltipCSSVars = {
	/** Distance between the popup and the trigger along the side axis. */
	sideOffset: "--media-tooltip-side-offset",
	/** Distance between the popup and the trigger along the alignment axis. */
	alignOffset: "--media-tooltip-align-offset",
	/** Minimum distance between the popup and the positioning boundary. */
	boundaryOffset: "--media-tooltip-boundary-offset",
	/** The anchor element's width. */
	anchorWidth: "--media-tooltip-anchor-width",
	/** The anchor element's height. */
	anchorHeight: "--media-tooltip-anchor-height",
	/** Available width between the trigger and the boundary edge. */
	availableWidth: "--media-tooltip-available-width",
	/** Available height between the trigger and the boundary edge. */
	availableHeight: "--media-tooltip-available-height"
};

//#endregion
//#region ../html/dist/dev/ui/tooltip/element.js
function isLabelTrigger(el) {
	return "$state" in el;
}
/** @fires open-change - Fired when the tooltip's open state changes. */
var TooltipElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.open = TooltipCore.defaultProps.open;
		this.defaultOpen = TooltipCore.defaultProps.defaultOpen;
		this.side = TooltipCore.defaultProps.side;
		this.align = TooltipCore.defaultProps.align;
		this.delay = TooltipCore.defaultProps.delay;
		this.closeDelay = TooltipCore.defaultProps.closeDelay;
		this.disableHoverablePopup = TooltipCore.defaultProps.disableHoverablePopup;
		this.disabled = TooltipCore.defaultProps.disabled;
		this.sticky = TooltipCore.defaultProps.sticky;
		this.boundary = "container";
		this.trigger = "";
		this.#core = new TooltipCore();
		this.#i18n = new I18nController(this, i18nContext);
		this.#groupConsumer = new ContextConsumer(this, { context: tooltipGroupContext });
		this.#containerCtx = new ContextConsumer(this, {
			context: containerContext,
			subscribe: true
		});
		this.#popupGroupCtx = new ContextConsumer(this, { context: popupGroupContext });
		this.#position = new PositionController(this);
		this.#tooltip = null;
		this.#snapshot = null;
		this.#disconnect = null;
		this.#triggerAbort = null;
		this.#currentTrigger = null;
	}
	static {
		this.tagName = "media-tooltip";
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
			delay: { type: Number },
			closeDelay: {
				type: Number,
				attribute: "close-delay"
			},
			disableHoverablePopup: {
				type: Boolean,
				attribute: "disable-hoverable-popup"
			},
			disabled: { type: Boolean },
			sticky: { type: Boolean },
			boundary: { type: String },
			trigger: { type: String }
		};
	}
	#core;
	#i18n;
	#groupConsumer;
	#containerCtx;
	#popupGroupCtx;
	#position;
	#tooltip;
	#snapshot;
	#disconnect;
	#triggerAbort;
	#currentTrigger;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.setAttribute(POPUP_HOST_ATTR, "");
		this.#disconnect = new AbortController();
		this.#tooltip = createTooltip({
			transition: createTransition(),
			onOpenChange: (nextOpen, details) => {
				this.open = nextOpen;
				this.dispatchEvent(new CustomEvent("open-change", { detail: {
					open: nextOpen,
					...details
				} }));
			},
			delay: () => this.delay,
			closeDelay: () => this.closeDelay,
			disableHoverablePopup: () => this.disableHoverablePopup,
			disabled: () => this.disabled,
			sticky: () => this.sticky,
			group: () => this.#groupConsumer.value,
			popupGroup: () => this.#popupGroupCtx.value
		});
		this.#tooltip.setPopupElement(this);
		applyElementProps(this, this.#tooltip.popupProps, { signal: this.#disconnect.signal });
		if (this.#snapshot) this.#snapshot.track(this.#tooltip.input);
		else this.#snapshot = new SnapshotController(this, this.#tooltip.input);
	}
	firstUpdated(changed) {
		super.firstUpdated(changed);
		if (this.defaultOpen && !this.open) this.#tooltip?.open();
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#cleanupTrigger();
		this.#tooltip?.destroy();
		this.#tooltip = null;
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	close(reason = "imperative-action") {
		this.#tooltip?.close(reason);
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		this.#core.setProps(this);
		if (this.#tooltip && changed.has("open")) {
			const { active: interactionOpen } = this.#tooltip.input.current;
			if (this.open !== interactionOpen) {
				if (this.open) this.#tooltip.open();
				else this.#tooltip.close();
			}
		}
	}
	update(_changed) {
		super.update(_changed);
		if (!this.#tooltip) return;
		const triggerEl = this.#position.findTrigger(this.trigger);
		this.#syncTrigger(triggerEl);
		if (this.#currentTrigger && isLabelTrigger(this.#currentTrigger)) this.#syncContent(this.#currentTrigger);
		const input = this.#tooltip.input.current;
		this.#core.setInput(input);
		const state = this.#core.getState();
		applyElementProps(this, this.#core.getPopupAttrs(state));
		applyStateDataAttrs(this, state, TooltipDataAttrs);
		if (state.open) tryShowPopover(this);
		else tryHidePopover(this);
		if (!state.open) {
			this.#position.cleanup();
			return;
		}
		this.#position.sync({
			anchorName: this.id,
			position: {
				side: state.side,
				align: state.align
			},
			trigger: this.#currentTrigger,
			boundary: this.boundary,
			container: this.#containerCtx.value?.container ?? null,
			cssVars: TooltipCSSVars,
			onSideChange: (side) => this.setAttribute(TooltipDataAttrs.side, side)
		});
	}
	#syncTrigger(triggerEl) {
		if (triggerEl === this.#currentTrigger) return;
		this.#position.cleanup();
		this.#cleanupTrigger();
		this.#currentTrigger = triggerEl;
		this.#tooltip?.setTriggerElement(triggerEl);
		if (triggerEl && this.#tooltip) {
			this.#triggerAbort = new AbortController();
			applyElementProps(triggerEl, this.#tooltip.triggerProps, { signal: this.#triggerAbort.signal });
			if (isLabelTrigger(triggerEl)) {
				this.#syncContent(triggerEl);
				triggerEl.$state.subscribe(() => this.#syncContent(triggerEl), { signal: this.#triggerAbort.signal });
				listen(triggerEl, HOTKEY_SHORTCUT_CHANGE_EVENT, () => this.#syncContent(triggerEl), { signal: this.#triggerAbort.signal });
			}
		}
	}
	#syncContent(triggerEl) {
		const label = triggerEl.getLabel();
		let resolved = isFunction(triggerEl.getResolvedLabel) ? triggerEl.getResolvedLabel() : void 0;
		if (resolved === void 0 && label) resolved = translateText(label, this.#i18n.value);
		const shortcut = triggerEl.getShortcut?.();
		let labelEl = TooltipLabelElement.findIn(this);
		let shortcutEl = TooltipShortcutElement.findIn(this);
		if (!labelEl && !shortcutEl) {
			if (this.#hostHasAuthoredTooltipContent()) return;
			labelEl = TooltipLabelElement.create();
			shortcutEl = TooltipShortcutElement.create();
			this.replaceChildren(labelEl, shortcutEl);
		}
		labelEl?.setSyncedText(resolved ?? "");
		shortcutEl?.setSyncedShortcut(shortcut);
	}
	#hostHasAuthoredTooltipContent() {
		return Array.from(this.childNodes).some((node) => !!node.textContent?.trim());
	}
	#cleanupTrigger() {
		this.#triggerAbort?.abort();
		this.#triggerAbort = null;
		this.#currentTrigger = null;
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/tooltip.js
safeDefine(TooltipElement);

//#endregion
//# sourceMappingURL=tooltip.dev.js.map