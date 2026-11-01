import { f as isUndefined } from "./predicate-3rF1m2uv.js";
import { t as ContextProvider } from "./context-provider-2u40YNUB.js";
import { n as getFallbackTranslator, r as i18nContext, t as I18nController } from "./controller-CKtzV_P4.js";
import { r as walkAncestors } from "./focus-CkXNMiCg.js";
import { n as ReactiveElement } from "./ui-element--3_7he7k.js";
import { t as safeDefine } from "./safe-define-THEasJ9B.js";
import { DEFAULT_LOCALE, createTranslator, findLocaleKeys, getBrowserTranslations, getI18nTranslations, loadLocale, onI18nRegistryChange, registerI18n, shouldAttemptBrowserTranslation, translateText } from "./i18n.dev.js";

//#region ../utils/dist/i18n/direction.js
const RTL_SCRIPTS = /* @__PURE__ */ new Set([
	"Adlm",
	"Arab",
	"Hebr",
	"Mand",
	"Mend",
	"Nkoo",
	"Rohg",
	"Samr",
	"Syrc",
	"Thaa",
	"Yezi"
]);
/**
* Resolve the writing direction of a BCP 47 locale.
*
* @internal
*/
function getTextDirection(locale) {
	try {
		const script = new Intl.Locale(locale).maximize().script;
		return script && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
	} catch {
		return "ltr";
	}
}

//#endregion
//#region ../utils/dist/dom/locale/effective-locale.js
/**
* Resolves locale: explicit non-empty value → ambient `lang` → {@link fallback}.
*
* @internal
*/
function effectiveLocale(explicitLocale, ambientLang, fallback = "en") {
	if (!isUndefined(explicitLocale) && explicitLocale.trim() !== "") return explicitLocale;
	if (!isUndefined(ambientLang) && ambientLang.trim() !== "") return ambientLang;
	return fallback;
}

//#endregion
//#region ../utils/dist/dom/locale/find-nearest-lang.js
function getElementLang(node) {
	const fromAttribute = node.getAttribute("lang")?.trim();
	if (fromAttribute) return fromAttribute;
	if ("lang" in node && typeof node.lang === "string") {
		const fromProperty = node.lang.trim();
		if (fromProperty) return fromProperty;
	}
}
/**
* First non-empty `lang` on `start` or an ancestor (HTML language inheritance).
*
* @internal
*/
function findNearestLang(start) {
	return walkAncestors(start, getElementLang);
}

//#endregion
//#region ../utils/dist/dom/locale/merge-locale-overlays.js
/**
* Loads overlay layers for each resolved locale key, least-specific first, then merges most-specific-last (same
* semantics as the core i18n registry).
*
* @internal
*/
async function mergeLocaleOverlays(locale, load, findKeys) {
	const chain = findKeys(locale);
	const layers = await Promise.all(chain.map((tag) => load(tag)));
	const loadedTags = [];
	const merged = {};
	for (let i = 0; i < chain.length; i++) {
		const layer = layers[i];
		if (layer && Object.keys(layer).length > 0) loadedTags.push(chain[i]);
	}
	for (let i = chain.length - 1; i >= 0; i--) {
		const layer = layers[i];
		if (layer) Object.assign(merged, layer);
	}
	return {
		merged,
		loadedTags
	};
}

//#endregion
//#region ../utils/dist/dom/locale/resolve-lang-attr.js
/**
* Normalizes a raw `lang` string (e.g. from {@link findNearestLang}): empty or whitespace-only → `undefined`, otherwise
* the trimmed value.
*
* @internal
*/
function resolveLangAttr(raw) {
	if (isUndefined(raw) || raw.trim() === "") return;
	return raw.trim();
}

//#endregion
//#region ../utils/dist/dom/locale/subscribe-ambient-lang.js
const subscribers = /* @__PURE__ */ new Set();
let observer;
let queued = false;
const flush = () => {
	queued = false;
	for (const cb of subscribers) cb();
};
const schedule = () => {
	if (!queued) {
		queued = true;
		queueMicrotask(flush);
	}
};
function start() {
	if (observer || typeof document === "undefined") return;
	observer = new MutationObserver(schedule);
	observer.observe(document.documentElement, {
		subtree: true,
		attributes: true,
		attributeFilter: ["lang"],
		childList: true
	});
}
function stop() {
	if (subscribers.size || !observer) return;
	observer.disconnect();
	observer = void 0;
	queued = false;
}
/**
* Subscribes to DOM updates that can change inherited `lang`: any `lang` attribute edit, or subtree structural changes
* under `<html>` (which can move nodes between labeled ancestors).
*
* @internal
*/
function subscribeAmbientLang(onStoreChange) {
	if (typeof document === "undefined") return () => {};
	subscribers.add(onStoreChange);
	start();
	return () => {
		subscribers.delete(onStoreChange);
		stop();
	};
}

//#endregion
//#region ../html/dist/dev/i18n/locale.js
/**
* Delegates to {@link effectiveLocale}; result is typed as {@link Locale} for player UI.
*
* @internal
*/
function resolvePlayerLocale(explicit, inherited) {
	return effectiveLocale(explicit, inherited);
}
/**
* Effective locale for an i18n provider element (explicit `lang` → ancestor `lang` chain → `en`).
*
* @internal
*/
function resolveProviderLocale(host) {
	const explicit = resolveLangAttr(host.lang);
	const root = host.parentElement ?? (typeof document !== "undefined" ? document.documentElement : null);
	return resolvePlayerLocale(explicit, resolveLangAttr(findNearestLang(root)));
}

//#endregion
//#region ../html/dist/dev/i18n/provider-mixin.js
function createI18nProviderMixin({ context, loader = loadLocale }) {
	return (Base) => {
		class I18nProviderElement extends Base {
			constructor(..._args) {
				super(..._args);
				this.lang = "";
				this.dir = "";
				this.#i18nProvider = new ContextProvider(this, {
					context,
					initialValue: {
						translator: getFallbackTranslator(),
						locale: DEFAULT_LOCALE
					}
				});
				this.#registryEpoch = 0;
				this.#lazyLayer = {};
				this.#lazySeq = 0;
				this.#i18nValue = {
					translator: getFallbackTranslator(),
					locale: DEFAULT_LOCALE
				};
				this.#publishedRegistryEpoch = -1;
			}
			static {
				this.properties = {
					...Base.properties,
					lang: {
						type: String,
						reflect: true
					},
					dir: {
						type: String,
						reflect: true
					}
				};
			}
			#i18nProvider;
			#registryUnsubscribe;
			#ambientUnsubscribe;
			#registryEpoch;
			#lazyLayer;
			#lazySeq;
			/** Tracks locale used for `#lazyLayer`; ambient `lang` can change without the `lang` property. */
			#resolvedLocaleForLazy;
			/** Locale snapshot when the current `#lazySeq` async load was started (see `willUpdate` drift guard). */
			#lazyResetStartedForLocale;
			#i18nValue;
			#publishedLocale;
			#publishedRegistryEpoch;
			#publishedLazyLayer;
			#derivedDirection;
			get i18nValue() {
				return this.#i18nValue;
			}
			connectedCallback() {
				super.connectedCallback();
				this.#registryUnsubscribe = onI18nRegistryChange(() => {
					this.#registryEpoch += 1;
					this.requestUpdate();
				});
				this.#ambientUnsubscribe = subscribeAmbientLang(() => this.requestUpdate());
				this.#resetLazyAndLoad();
				this.#publish();
				this.requestUpdate();
			}
			disconnectedCallback() {
				super.disconnectedCallback();
				this.#registryUnsubscribe?.();
				this.#registryUnsubscribe = void 0;
				this.#ambientUnsubscribe?.();
				this.#ambientUnsubscribe = void 0;
				this.#lazySeq += 1;
				this.#lazyLayer = {};
				this.#resolvedLocaleForLazy = void 0;
				this.#lazyResetStartedForLocale = void 0;
			}
			willUpdate(changed) {
				super.willUpdate(changed);
				const locale = resolveProviderLocale(this);
				if (this.#resolvedLocaleForLazy !== locale) {
					const hadLocale = this.#resolvedLocaleForLazy !== void 0;
					this.#resolvedLocaleForLazy = locale;
					const localeDriftedBeforeFirstPaint = !hadLocale && this.#lazyResetStartedForLocale !== void 0 && locale !== this.#lazyResetStartedForLocale;
					if (hadLocale || localeDriftedBeforeFirstPaint) this.#resetLazyAndLoad();
				}
				this.#syncDirection(locale);
				this.#publish();
			}
			#resetLazyAndLoad() {
				const localeSnapshot = resolveProviderLocale(this);
				this.#lazyResetStartedForLocale = localeSnapshot;
				this.#lazySeq += 1;
				const seq = this.#lazySeq;
				this.#lazyLayer = {};
				(async () => {
					try {
						const { merged, loadedTags } = await mergeLocaleOverlays(localeSnapshot, loader, findLocaleKeys);
						if (seq !== this.#lazySeq) return;
						if (shouldAttemptBrowserTranslation(localeSnapshot, loadedTags, merged)) {
							const browser = await getBrowserTranslations(localeSnapshot);
							if (seq !== this.#lazySeq) return;
							if (Object.keys(browser).length) registerI18n(localeSnapshot, browser);
						}
						if (seq !== this.#lazySeq) return;
						this.#lazyLayer = merged;
						this.requestUpdate();
					} catch {}
				})();
			}
			#resolvedLocale() {
				return resolveProviderLocale(this);
			}
			#syncDirection(locale) {
				const current = this.dir.trim().toLowerCase();
				const isDerived = this.#derivedDirection !== void 0 && current === this.#derivedDirection;
				if (!this.lang.trim()) {
					if (isDerived) this.dir = "";
					this.#derivedDirection = void 0;
					return;
				}
				if (current && !isDerived) {
					this.#derivedDirection = void 0;
					return;
				}
				const direction = getTextDirection(locale);
				this.#derivedDirection = direction;
				if (this.dir !== direction) this.dir = direction;
			}
			#publish() {
				const locale = this.#resolvedLocale();
				if (this.#publishedLocale === locale && this.#publishedRegistryEpoch === this.#registryEpoch && this.#publishedLazyLayer === this.#lazyLayer) return;
				const registryLayer = getI18nTranslations(locale);
				const translations = {
					...this.#lazyLayer,
					...registryLayer
				};
				const translator = createTranslator(translations, locale);
				this.#i18nValue = {
					translator,
					locale
				};
				this.#publishedLocale = locale;
				this.#publishedRegistryEpoch = this.#registryEpoch;
				this.#publishedLazyLayer = this.#lazyLayer;
				this.#i18nProvider.setValue(this.#i18nValue);
			}
		}
		return I18nProviderElement;
	};
}

//#endregion
//#region ../html/dist/dev/i18n/provider-element.js
/** @internal */
const I18nProviderMixin = createI18nProviderMixin({ context: i18nContext });
var I18nProviderElement = class extends I18nProviderMixin(ReactiveElement) {
	static {
		this.tagName = "media-i18n";
	}
};

//#endregion
//#region ../html/dist/dev/i18n/text-mixin.js
function createTextMixin({ context }) {
	return (Base) => {
		class MediaText extends Base {
			constructor(..._args) {
				super(..._args);
				this.#i18n = new I18nController(this, context);
				this.token = "";
			}
			static {
				this.properties = { token: { type: String } };
			}
			#i18n;
			#text;
			connectedCallback() {
				this.#text ??= this.textContent?.trim() ?? "";
				super.connectedCallback();
			}
			updated(changed) {
				super.updated(changed);
				if (!this.#text) {
					this.textContent = "";
					return;
				}
				const text = this.token ? {
					key: this.token,
					text: this.#text
				} : this.#text;
				this.textContent = typeof text === "string" ? text : translateText(text, this.#i18n.value);
			}
		}
		return MediaText;
	};
}

//#endregion
//#region ../html/dist/dev/ui/text/element.js
/** @internal */
const I18nTextMixin = createTextMixin({ context: i18nContext });
var TextElement = class extends I18nTextMixin(ReactiveElement) {
	static {
		this.tagName = "media-text";
	}
};

//#endregion
//#region ../html/dist/dev/define/i18n.js
safeDefine(I18nProviderElement);
safeDefine(TextElement);

//#endregion
//# sourceMappingURL=i18n-BJnsQW04.js.map