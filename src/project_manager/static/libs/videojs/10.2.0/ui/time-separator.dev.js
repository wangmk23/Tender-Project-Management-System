/*! Video.js | https://videojs.org/help */
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";

//#region ../html/dist/dev/ui/time/separator.js
var TimeSeparatorElement = class extends UIElement {
	static {
		this.tagName = "media-time-separator";
	}
	connectedCallback() {
		super.connectedCallback();
		this.setAttribute("aria-hidden", "true");
		if (!this.textContent?.trim()) this.textContent = "/";
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/time-separator.js
safeDefine(TimeSeparatorElement);

//#endregion
//# sourceMappingURL=time-separator.dev.js.map