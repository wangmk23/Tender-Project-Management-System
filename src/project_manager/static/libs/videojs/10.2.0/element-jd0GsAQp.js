import { t as defaults } from "./defaults-nT7MwJ_t.js";
import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { t as PositionController } from "./position-controller-qaVECOVu.js";
import { c as tryShowPopover, s as tryHidePopover } from "./vars-CTJASilF.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { t as containerContext } from "./context-CL8SSE10.js";
import { t as SnapshotController } from "./snapshot-controller-CR9Xu35W.js";
import { n as getTransitionFlags, t as TransitionDataAttrs } from "./transition-CzuKD0-9.js";
import { t as createPopover } from "./popover-BfzYkhvl.js";
import { t as createTransition } from "./transition-C9TiIy5V.js";
import { t as applyElementProps } from "./element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "./state-data-attrs-DiSfe3GX.js";
import { t as popupGroupContext } from "./popup-group-context-DFsPDSN9.js";
import { t as POPUP_HOST_ATTR } from "./host-BJbdoUVc.js";

//#region ../core/dist/dev/core/ui/popover/core.js
/** @internal */
var PopoverCore = class PopoverCore {
	static defaultProps = {
		side: "top",
		align: "center",
		modal: false,
		closeOnEscape: true,
		closeOnOutsideClick: true,
		open: false,
		defaultOpen: false,
		openOnHover: false,
		delay: 300,
		closeDelay: 0
	};
	#props = { ...PopoverCore.defaultProps };
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, PopoverCore.defaultProps);
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
			modal: this.#props.modal,
			...getTransitionFlags(input.status)
		};
	}
	getTriggerAttrs(state, popupId) {
		return {
			"aria-expanded": state.open && state.status !== "ending" ? "true" : "false",
			"aria-haspopup": "dialog",
			"aria-controls": popupId
		};
	}
	getPopupAttrs(state) {
		return {
			popover: "manual",
			role: "dialog",
			"aria-modal": state.modal === true ? "true" : void 0
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/popover/data.js
/** @internal */
const PopoverDataAttrs = {
	/** Present when the popover is open. */
	open: "data-open",
	/** Indicates the rendered side of the popover after collision handling. */
	side: "data-side",
	/** Indicates how the popover is aligned relative to the specified side. */
	align: "data-align",
	...TransitionDataAttrs
};

//#endregion
//#region ../html/dist/dev/ui/popover/element.js
/** @fires open-change - Fired when the popover's open state changes. */
var PopoverElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.open = PopoverCore.defaultProps.open;
		this.defaultOpen = PopoverCore.defaultProps.defaultOpen;
		this.side = PopoverCore.defaultProps.side;
		this.align = PopoverCore.defaultProps.align;
		this.modal = PopoverCore.defaultProps.modal;
		this.closeOnEscape = PopoverCore.defaultProps.closeOnEscape;
		this.closeOnOutsideClick = PopoverCore.defaultProps.closeOnOutsideClick;
		this.openOnHover = PopoverCore.defaultProps.openOnHover;
		this.delay = PopoverCore.defaultProps.delay;
		this.closeDelay = PopoverCore.defaultProps.closeDelay;
		this.boundary = "container";
		this.#core = new PopoverCore();
		this.#containerCtx = new ContextConsumer(this, {
			context: containerContext,
			subscribe: true
		});
		this.#popupGroupCtx = new ContextConsumer(this, { context: popupGroupContext });
		this.#position = new PositionController(this);
		this.#popover = null;
		this.#snapshot = null;
		this.#disconnect = null;
		this.#triggerAbort = null;
		this.#currentTrigger = null;
	}
	static {
		this.tagName = "media-popover";
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
			modal: { type: Boolean },
			closeOnEscape: {
				type: Boolean,
				attribute: "close-on-escape"
			},
			closeOnOutsideClick: {
				type: Boolean,
				attribute: "close-on-outside-click"
			},
			openOnHover: {
				type: Boolean,
				attribute: "open-on-hover"
			},
			delay: { type: Number },
			closeDelay: {
				type: Number,
				attribute: "close-delay"
			},
			boundary: { type: String }
		};
	}
	#core;
	#containerCtx;
	#popupGroupCtx;
	#position;
	#popover;
	#snapshot;
	#disconnect;
	#triggerAbort;
	#currentTrigger;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.setAttribute(POPUP_HOST_ATTR, "");
		this.#disconnect = new AbortController();
		this.#popover = createPopover({
			transition: createTransition(),
			onOpenChange: (nextOpen, details) => {
				this.open = nextOpen;
				this.dispatchEvent(new CustomEvent("open-change", { detail: {
					open: nextOpen,
					...details
				} }));
			},
			closeOnEscape: () => this.closeOnEscape,
			closeOnOutsideClick: () => this.closeOnOutsideClick,
			openOnHover: () => this.openOnHover,
			delay: () => this.delay,
			closeDelay: () => this.closeDelay,
			group: () => this.#popupGroupCtx.value
		});
		this.#popover.setPopupElement(this);
		applyElementProps(this, this.#popover.popupProps, { signal: this.#disconnect.signal });
		if (this.#snapshot) this.#snapshot.track(this.#popover.input);
		else this.#snapshot = new SnapshotController(this, this.#popover.input);
	}
	firstUpdated(changed) {
		super.firstUpdated(changed);
		if (this.defaultOpen && !this.open) this.#popover?.open();
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	destroyCallback() {
		this.#cleanupTrigger();
		this.#popover?.destroy();
		super.destroyCallback();
	}
	close(reason = "imperative-action") {
		this.#popover?.close(reason);
	}
	get triggerElement() {
		return this.#currentTrigger;
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		this.#core.setProps(this);
		if (this.#popover && changed.has("open")) {
			const { active: interactionOpen } = this.#popover.input.current;
			if (this.open !== interactionOpen) {
				if (this.open) this.#popover.open();
				else this.#popover.close();
			}
		}
	}
	update(_changed) {
		super.update(_changed);
		if (!this.#popover) return;
		const triggerEl = this.#position.findTrigger();
		this.#syncTrigger(triggerEl);
		const input = this.#popover.input.current;
		this.#core.setInput(input);
		const state = this.#core.getState();
		applyElementProps(this, this.#core.getPopupAttrs(state));
		applyStateDataAttrs(this, state, PopoverDataAttrs);
		if (state.open) tryShowPopover(this);
		else tryHidePopover(this);
		if (this.#currentTrigger) applyElementProps(this.#currentTrigger, this.#core.getTriggerAttrs(state, this.id));
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
			onSideChange: (side) => this.setAttribute(PopoverDataAttrs.side, side)
		});
	}
	#syncTrigger(triggerEl) {
		if (triggerEl === this.#currentTrigger) return;
		this.#position.cleanup();
		this.#cleanupTrigger();
		this.#currentTrigger = triggerEl;
		this.#popover?.setTriggerElement(triggerEl);
		if (triggerEl && this.#popover) {
			this.#triggerAbort = new AbortController();
			applyElementProps(triggerEl, this.#popover.triggerProps, { signal: this.#triggerAbort.signal });
		}
	}
	#cleanupTrigger() {
		if (this.#currentTrigger) applyElementProps(this.#currentTrigger, {
			"aria-expanded": void 0,
			"aria-haspopup": void 0,
			"aria-controls": void 0
		});
		this.#triggerAbort?.abort();
		this.#triggerAbort = null;
		this.#currentTrigger = null;
	}
};

//#endregion
export { PopoverCore as n, PopoverElement as t };
//# sourceMappingURL=element-jd0GsAQp.js.map