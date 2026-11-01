/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";

//#region ../html/dist/dev/ui/slider/fill.js
var SliderFillElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: sliderContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-slider-fill";
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/slider-fill.js
safeDefine(SliderFillElement);

//#endregion
//# sourceMappingURL=slider-fill.dev.js.map