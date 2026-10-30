/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";

//#region ../html/dist/dev/ui/slider/value.js
/** Writes the formatted current or pointer slider value into its own text content, replacing any children. */
var SliderValueElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.type = "current";
		this.#ctx = new ContextConsumer(this, {
			context: sliderContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-slider-value";
	}
	static {
		this.properties = { type: { type: String } };
	}
	#ctx;
	connectedCallback() {
		super.connectedCallback();
		this.setAttribute("aria-live", "off");
	}
	update(_changed) {
		super.update(_changed);
		const ctx = this.#ctx.value;
		if (!ctx) return;
		const value = this.type === "pointer" ? ctx.pointerValue : ctx.state.value;
		this.textContent = ctx.formatValue ? ctx.formatValue(value, this.type) : String(Math.round(value));
		applyStateDataAttrs(this, ctx.state, ctx.stateAttrMap);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/slider-value.js
safeDefine(SliderValueElement);

//#endregion
//# sourceMappingURL=slider-value.dev.js.map