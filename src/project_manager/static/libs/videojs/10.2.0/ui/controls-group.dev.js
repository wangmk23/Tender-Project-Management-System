/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";
import { t as controlsContext } from "../context-xorj553w.js";

//#region ../html/dist/dev/ui/controls/group.js
var ControlsGroupElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: controlsContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-controls-group";
	}
	connectedCallback() {
		super.connectedCallback();
		if (this.hasAttribute("aria-label") || this.hasAttribute("aria-labelledby")) this.setAttribute("role", "group");
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/controls-group.js
safeDefine(ControlsGroupElement);

//#endregion
//# sourceMappingURL=controls-group.dev.js.map