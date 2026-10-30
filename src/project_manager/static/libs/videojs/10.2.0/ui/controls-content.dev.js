/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";
import { t as controlsContext } from "../context-xorj553w.js";

//#region ../html/dist/dev/ui/controls/content.js
/** Interactive surface that reflects its owning controls state. */
var ControlsContentElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: controlsContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-controls-content";
	}
	connectedCallback() {
		super.connectedCallback();
		this.setAttribute("data-interactive", "");
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/controls-content.js
safeDefine(ControlsContentElement);

//#endregion
//# sourceMappingURL=controls-content.dev.js.map