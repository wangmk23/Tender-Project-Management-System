import { t as UIElement } from "./ui-element--3_7he7k.js";

//#region ../html/dist/dev/ui/tooltip/shortcut.js
/**
* Shortcut hint inside `media-tooltip`. CSS skins: `class="media-tooltip__kbd"`; Tailwind skins: `class` from
* `popup.tooltipShortcut`.
*/
var TooltipShortcutElement = class TooltipShortcutElement extends UIElement {
	static {
		this.tagName = "media-tooltip-shortcut";
	}
	static findIn(host) {
		return host.querySelector(TooltipShortcutElement.tagName);
	}
	static create() {
		return document.createElement(TooltipShortcutElement.tagName);
	}
	setSyncedShortcut(shortcut) {
		if (shortcut) {
			this.textContent = shortcut;
			this.hidden = false;
		} else {
			this.textContent = "";
			this.hidden = true;
		}
	}
};

//#endregion
export { TooltipShortcutElement as t };
//# sourceMappingURL=shortcut-DUZRMLty.js.map