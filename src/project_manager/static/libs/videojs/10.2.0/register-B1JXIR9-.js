import { i as isFunction } from "./predicate-3rF1m2uv.js";
import { n as createShadowStyle, r as ensureGlobalStyle, t as applyShadowStyles } from "./shadow-styles-CjVI1B1u.js";
import { a as renderTemplate } from "./template-Cya7joDn.js";
import { n as ReactiveElement } from "./ui-element--3_7he7k.js";

//#region ../html/dist/dev/define/global.js
var global_default = "@property --media-slider-fill {\n  syntax: \"<percentage>\";\n  inherits: true;\n  initial-value: 0%;\n}\n\n@property --media-slider-buffer {\n  syntax: \"<percentage>\";\n  inherits: true;\n  initial-value: 0%;\n}\n\nvideo-player, live-video-player, media-i18n, media-dialog, media-alert-dialog, media-error-dialog, media-controls {\n  display: contents;\n}\n\nmedia-container video, media-container [slot=\"poster\"] {\n  width: 100%;\n  height: 100%;\n  display: block;\n}\n\nmedia-container video::-webkit-media-text-track-container {\n  z-index: 1;\n  scale: .98;\n  translate: 0 var(--media-caption-track-y, 0);\n  transition: translate var(--media-caption-track-duration, 0) ease-out;\n  transition-delay: var(--media-caption-track-delay, 0);\n  font-family: inherit;\n}\n";

//#endregion
//#region ../html/dist/dev/define/shadow.js
var shadow_default = ":host {\n  width: 100%;\n  display: grid;\n}\n\n:host(:focus) {\n  outline: none !important;\n}\n\n::slotted(video), ::slotted(audio) {\n  margin: 0 !important;\n}\n";

//#endregion
//#region ../html/dist/dev/presets/skin.js
const STYLES_ID = "__media-styles";
const shadowSheet = createShadowStyle(shadow_default);
/**
* Base element for skin definitions. Attaches a shadow root, clones `static template` into it, and applies shared +
* per-skin styles via `adoptedStyleSheets` (or `<style>` fallback).
*/
var SkinElement = class extends ReactiveElement {
	static {
		this.shadowRootOptions = { mode: "open" };
	}
	constructor() {
		super();
		ensureGlobalStyle(STYLES_ID, global_default);
		if (!this.shadowRoot) {
			const ctor = this.constructor;
			this.attachShadow(ctor.shadowRootOptions);
			if (ctor.template) renderTemplate(this.shadowRoot, ctor.template);
			const sheets = [shadowSheet];
			if (ctor.styles) sheets.push(ctor.styles);
			applyShadowStyles(this.shadowRoot, sheets);
		}
	}
};

//#endregion
//#region ../html/dist/dev/icons/dist/element/base.js
const HTMLElementBase = globalThis.HTMLElement ?? class {};
/** Renders registered SVG icon families in the light DOM. */
var MediaIconElement = class MediaIconElement extends HTMLElementBase {
	static #families = /* @__PURE__ */ new Map();
	static #loaders = /* @__PURE__ */ new Map();
	static #loading = /* @__PURE__ */ new Map();
	static #instances = /* @__PURE__ */ new Set();
	static register(family, icons) {
		const familyIcons = MediaIconElement.#families.get(family) ?? /* @__PURE__ */ new Map();
		for (const [name, svg] of Object.entries(icons)) familyIcons.set(name, svg);
		MediaIconElement.#families.set(family, familyIcons);
		for (const icon of MediaIconElement.#instances) if (icon.#family === family) icon.#render();
	}
	static registerLoader(family, load) {
		MediaIconElement.#loaders.set(family, load);
		for (const icon of MediaIconElement.#instances) if (icon.#family === family) icon.#render();
	}
	static load(family) {
		if (MediaIconElement.#families.has(family)) return Promise.resolve();
		const pending = MediaIconElement.#loading.get(family);
		if (pending) return pending;
		const loader = MediaIconElement.#loaders.get(family);
		if (!loader) return Promise.resolve();
		const loading = Promise.resolve().then(loader).then((icons) => MediaIconElement.register(family, icons)).finally(() => MediaIconElement.#loading.delete(family));
		MediaIconElement.#loading.set(family, loading);
		return loading;
	}
	static get observedAttributes() {
		return ["name", "family"];
	}
	connectedCallback() {
		MediaIconElement.#instances.add(this);
		this.#render();
	}
	disconnectedCallback() {
		MediaIconElement.#instances.delete(this);
	}
	attributeChangedCallback() {
		this.#render();
	}
	get #family() {
		return this.getAttribute("family") || "default";
	}
	#render() {
		if (!this.isConnected) return;
		const name = this.getAttribute("name");
		const family = this.#family;
		const familyIcons = MediaIconElement.#families.get(family);
		const svg = name ? familyIcons?.get(name) : void 0;
		if (svg !== void 0) {
			if (this.innerHTML !== svg) this.innerHTML = svg;
			return;
		}
		this.replaceChildren();
		if (familyIcons || !name || !MediaIconElement.#loaders.has(family)) return;
		MediaIconElement.load(family).then(() => {
			if (this.isConnected && this.getAttribute("name") === name && this.#family === family) this.#render();
		}, () => {});
	}
};

//#endregion
//#region ../html/dist/dev/icons/element/register/index.js
/** Register an exact set of SVGs for generated source that renders `<media-icon>`. */
function registerIcons(family, icons) {
	const customElementRegistry = globalThis.customElements;
	const registeredElement = customElementRegistry?.get("media-icon");
	if (registeredElement && !supportsIconRegistration(registeredElement)) throw new Error("The registered <media-icon> element does not support icon registration.");
	(registeredElement ?? MediaIconElement).register(family, icons);
	if (customElementRegistry && globalThis.HTMLElement && !registeredElement) customElementRegistry.define("media-icon", MediaIconElement);
}
function supportsIconRegistration(element) {
	return "register" in element && isFunction(element.register);
}

//#endregion
export { SkinElement as n, registerIcons as t };
//# sourceMappingURL=register-B1JXIR9-.js.map