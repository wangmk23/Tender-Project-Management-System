import { t as UIElement } from "./ui-element--3_7he7k.js";

//#region ../html/dist/dev/ui/tooltip/label.js
function hasAuthoredContent(host) {
	return Array.from(host.childNodes).some((node) => !!node.textContent?.trim());
}
/** Label region inside `media-tooltip`; parent syncs text from the trigger when linked to a media button. */
var TooltipLabelElement = class TooltipLabelElement extends UIElement {
	static {
		this.tagName = "media-tooltip-label";
	}
	#hasAuthoredContent = false;
	static findIn(host) {
		return host.querySelector(TooltipLabelElement.tagName);
	}
	static create() {
		return document.createElement(TooltipLabelElement.tagName);
	}
	connectedCallback() {
		this.#hasAuthoredContent ||= hasAuthoredContent(this);
		super.connectedCallback();
	}
	setSyncedText(text) {
		if (this.#hasAuthoredContent) return;
		this.textContent = text;
	}
};

//#endregion
export { TooltipLabelElement as t };
//# sourceMappingURL=label-D5xv21nM.js.map