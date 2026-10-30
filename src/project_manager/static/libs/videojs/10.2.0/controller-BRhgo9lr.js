import { i as getTemplateRoot, r as getTemplateElement, t as cloneTemplateRoot } from "./template-Cya7joDn.js";
import { t as applyElementProps } from "./element-props-CYmZOrQN.js";
import { t as MenuRadioItemElement } from "./radio-item-BNMHAymS.js";
import { t as MenuItemIndicatorElement } from "./item-indicator-C7NitMbg.js";
import { translateText } from "./i18n.dev.js";

//#region ../core/dist/dev/i18n/text/menu.js
const prefix = "menu.";
const settingsText = {
	key: `${prefix}settings`,
	text: "Settings"
};
const qualityText = {
	key: `${prefix}quality`,
	text: "Quality"
};
const audioText = {
	key: `${prefix}audio`,
	text: "Audio"
};
const defaultText = {
	key: `${prefix}default`,
	text: "Default"
};
const speedText = {
	key: `${prefix}speed`,
	text: "Speed"
};
const captionsText = {
	key: `${prefix}captions`,
	text: "Captions"
};
const playbackRateText = {
	key: `${prefix}playbackRate`,
	text: "Playback rate"
};
const backText = {
	key: `${prefix}back`,
	text: "Back"
};
const offText = {
	key: `${prefix}off`,
	text: "Off"
};
const autoText = {
	key: `${prefix}auto`,
	text: "Auto"
};
const autoWithLabelText = {
	key: `${prefix}autoWithLabel`,
	text: "Auto ({label})"
};
const subtitlesText = {
	key: `${prefix}subtitles`,
	text: "Subtitles"
};

//#endregion
//#region ../html/dist/dev/i18n/cache-key.js
/** Serialize text content and parameters so dynamic labels invalidate their caches. */
function cacheKey(text, params) {
	return JSON.stringify([text, params]);
}

//#endregion
//#region ../html/dist/dev/ui/radio-options/controller.js
/** Renders normalized options into menu radio items and manages their interaction lifecycle. */
var RadioOptionsController = class {
	#host;
	#config;
	#contentKey = "";
	#translator = null;
	#disconnect = null;
	constructor(host, config) {
		this.#host = host;
		this.#config = config;
		host.addController(this);
	}
	hostConnected() {
		this.#disconnect = new AbortController();
		this.#host.addEventListener("value-change", this.#handleValueChange, { signal: this.#disconnect.signal });
	}
	hostDisconnected() {
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	hostDestroyed() {
		this.hostDisconnected();
	}
	sync(state, translator, locale) {
		this.#host.value = state.value;
		applyElementProps(this.#host, {
			"aria-disabled": state.disabled ? "true" : void 0,
			hidden: state.hidden ? "" : void 0
		});
		const template = getTemplateElement(this.#host);
		const templateRoot = template ? getTemplateRoot(template) : null;
		const itemRoot = templateRoot?.localName === MenuRadioItemElement.tagName ? templateRoot : null;
		const contentKey = `${state.options.map((option) => `${option.value}:${cacheKey(option.label, option.labelParams)}:${this.#config.getOptionCacheKey?.(option) ?? ""}`).join("|")}::${locale}::${template?.innerHTML ?? ""}`;
		if (contentKey !== this.#contentKey || translator !== this.#translator) {
			this.#contentKey = contentKey;
			this.#translator = translator;
			for (const child of [...this.#host.children]) {
				if (child === template) continue;
				child.remove();
			}
			const items = state.options.map((option) => {
				const item = itemRoot ? cloneTemplateRoot(itemRoot, this.#host.ownerDocument) : this.#host.ownerDocument.createElement(MenuRadioItemElement.tagName);
				item.value = option.value;
				this.#config.setItemAttributes?.(item, option);
				const label = translateText(option.label, translator, option.labelParams);
				if (this.#config.renderItem) this.#config.renderItem(item, label, option);
				else this.#setItemLabel(item, label);
				return item;
			});
			this.#host.append(...items);
		}
		const optionsByValue = new Map(state.options.map((option) => [option.value, option]));
		for (const item of this.#host.querySelectorAll(MenuRadioItemElement.tagName)) {
			const checked = item.value === state.value;
			const option = optionsByValue.get(item.value);
			item.disabled = state.disabled || option?.disabled === true;
			for (const indicator of item.querySelectorAll(MenuItemIndicatorElement.tagName)) indicator.checked = checked;
		}
	}
	#handleValueChange = (event) => {
		if (event.target !== this.#host) return;
		const { value } = event.detail;
		this.#config.onValueChange(value);
	};
	#setItemLabel(item, label) {
		const labelPart = item.querySelector("[data-part~=\"label\"]");
		if (labelPart) labelPart.textContent = label;
		else item.textContent = label;
	}
};

//#endregion
export { captionsText as a, qualityText as c, autoWithLabelText as i, subtitlesText as l, audioText as n, offText as o, autoText as r, playbackRateText as s, RadioOptionsController as t };
//# sourceMappingURL=controller-BRhgo9lr.js.map