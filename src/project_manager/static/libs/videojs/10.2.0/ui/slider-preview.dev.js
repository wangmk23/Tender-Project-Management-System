/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as applyStyles } from "../style-CFppx62l.js";
import { i as observeResize } from "../observe-elements-B5qhV5BC.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as getSliderPreviewStyle } from "../css-vars-CBwz-Iu0.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";

//#region ../html/dist/dev/ui/slider/preview.js
var SliderPreviewElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.overflow = "clamp";
		this.#ctx = new ContextConsumer(this, {
			context: sliderContext,
			subscribe: true
		});
		this.#stopObservingResize = null;
		this.#width = 0;
	}
	static {
		this.tagName = "media-slider-preview";
	}
	static {
		this.properties = { overflow: { type: String } };
	}
	#ctx;
	#stopObservingResize;
	#width;
	connectedCallback() {
		super.connectedCallback();
		this.#stopObservingResize = observeResize(this, ([entry]) => {
			this.#width = entry.contentRect.width;
			this.#applyPosition();
		});
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#stopObservingResize?.();
		this.#stopObservingResize = null;
	}
	#applyPosition() {
		applyStyles(this, getSliderPreviewStyle(this.#width, this.overflow));
	}
	update(_changed) {
		super.update(_changed);
		const ctx = this.#ctx.value;
		if (ctx) applyStateDataAttrs(this, ctx.state, ctx.stateAttrMap);
		this.#applyPosition();
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/slider-preview.js
safeDefine(SliderPreviewElement);

//#endregion
//# sourceMappingURL=slider-preview.dev.js.map