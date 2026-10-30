/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as tooltipGroupContext } from "../context-DFwp_F7d.js";

//#region ../core/dist/dev/core/ui/tooltip/group.js
/** @internal */
var TooltipGroupCore = class TooltipGroupCore {
	static defaultProps = {
		delay: 600,
		closeDelay: 0,
		timeout: 400
	};
	#props = { ...TooltipGroupCore.defaultProps };
	#lastCloseTime = 0;
	#isOpen = false;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, TooltipGroupCore.defaultProps);
	}
	get delay() {
		return this.#props.delay;
	}
	get closeDelay() {
		return this.#props.closeDelay;
	}
	shouldSkipDelay() {
		if (this.#isOpen) return true;
		return Date.now() - this.#lastCloseTime < this.#props.timeout;
	}
	notifyOpen() {
		this.#isOpen = true;
	}
	notifyClose() {
		this.#isOpen = false;
		this.#lastCloseTime = Date.now();
	}
};

//#endregion
//#region ../html/dist/dev/ui/tooltip/group.js
var TooltipGroupElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.delay = TooltipGroupCore.defaultProps.delay;
		this.closeDelay = TooltipGroupCore.defaultProps.closeDelay;
		this.timeout = TooltipGroupCore.defaultProps.timeout;
		this.#core = new TooltipGroupCore();
		this.#provider = new ContextProvider(this, {
			context: tooltipGroupContext,
			initialValue: this.#core
		});
	}
	static {
		this.tagName = "media-tooltip-group";
	}
	static {
		this.properties = {
			delay: { type: Number },
			closeDelay: {
				type: Number,
				attribute: "close-delay"
			},
			timeout: { type: Number }
		};
	}
	#core;
	#provider;
	update(_changed) {
		super.update(_changed);
		this.#core.setProps(this);
		this.#provider.setValue(this.#core);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/tooltip-group.js
safeDefine(TooltipGroupElement);

//#endregion
//# sourceMappingURL=tooltip-group.dev.js.map