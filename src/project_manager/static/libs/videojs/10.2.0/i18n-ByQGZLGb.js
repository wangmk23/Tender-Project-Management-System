//#region ../utils/dist/object/flatten.js
/** @internal */
function flatten(object, options = {}) {
	const { prefix = "" } = options;
	const result = {};
	for (const [key, value] of Object.entries(object)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === "object" && !Array.isArray(value)) Object.assign(result, flatten(value, { prefix: fullKey }));
		else result[fullKey] = value;
	}
	return result;
}

//#endregion
//#region ../core/dist/dev/core/i18n/utils/flatten.js
/** @internal */
function flattenTranslations(locale, options = {}) {
	return flatten(locale, options);
}

//#endregion
//#region ../utils/dist/i18n.js
/**
* Default locale used when no player or ambient locale is available.
*
* @internal
*/
const DEFAULT_LOCALE = "en";
/**
* Whether the first locale in a lookup list is the default locale or one of its regional variants.
*
* @internal
*/
function isDefaultLocale(locale) {
	const tag = Array.isArray(locale) ? locale[0] : locale;
	if (!tag) return true;
	return tag === "en" || tag.startsWith(`en-`);
}

//#endregion
//#region ../core/dist/dev/core/i18n/registry.js
/**
* Well-known key for the shared registry. Its name and value shape are a cross-version contract: every copy of this
* module in a realm must agree on them, so change the key when the shape changes.
*/
const I18N_REGISTRY_KEY = Symbol.for("@videojs/i18n-registry");
/**
* The registry is realm-global rather than module-global so duplicate copies of this module converge on one set of
* translations.
*
* Duplication is normal, not a bug to fix upstream: separately loaded CDN bundles, a pinned and an unpinned URL for the
* same file, and two bundlers' output on one page all yield distinct module instances. With module-scoped state, a
* `registerI18n` call on one instance is invisible to the player reading from another, and the locale silently falls
* back to English.
*/
function getRegistry() {
	const host = globalThis;
	const existing = host[I18N_REGISTRY_KEY];
	if (existing) return existing;
	const registry = {
		layers: /* @__PURE__ */ new Map(),
		subscribers: /* @__PURE__ */ new Set()
	};
	host[I18N_REGISTRY_KEY] = registry;
	return registry;
}
function notify() {
	for (const cb of getRegistry().subscribers) cb();
}
function normalizeLocaleTag(tag) {
	return tag.trim().replaceAll("_", "-").toLowerCase();
}
/** Strip unicode locale extension sequences (`-u-…`) before any private-use `-x-` block. */
function stripUnicodeExtensions(tag) {
	const xIdx = tag.indexOf("-x-");
	const uIdx = (xIdx === -1 ? tag : tag.slice(0, xIdx)).indexOf("-u-");
	if (uIdx === -1) return tag;
	return tag.slice(0, uIdx) + (xIdx === -1 ? "" : tag.slice(xIdx));
}
function chineseFallback(segments) {
	if (segments[0] !== "zh") return;
	const script = segments.find((segment) => segment === "hant" || segment === "hans");
	return script === "hant" ? "zh-tw" : script === "hans" ? "zh-cn" : void 0;
}
/**
* Normalize a BCP 47 tag to the key the registry stores it under: lowercase, with Unicode extensions removed.
*
* @example
*   `en-US-u-nu-latn` → `en-us`
*
* @param locale - BCP 47 tag to normalize.
* @public
*/
function getLocaleKey(locale) {
	return stripUnicodeExtensions(normalizeLocaleTag(locale));
}
/**
* Most-specific-first BCP 47 lookup tags (normalized). Always ends with `en` when missing from the truncated chain.
*
* @example
*   `es-419-u-nu-latn` → `['es-419', 'es', 'en']`
*
* @param locale - BCP 47 tag to resolve.
* @public
*/
function findLocaleKeys(locale) {
	const base = getLocaleKey(locale);
	if (!base) return ["en"];
	const segments = base.split("-").filter(Boolean);
	const chain = [];
	for (let len = segments.length; len >= 1; len--) chain.push(segments.slice(0, len).join("-"));
	const zhFallback = chineseFallback(segments);
	const zhIndex = chain.indexOf("zh");
	if (zhFallback && zhIndex !== -1) chain.splice(zhIndex, 0, zhFallback);
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const tag of chain) if (!seen.has(tag)) {
		seen.add(tag);
		out.push(tag);
	}
	if (!seen.has("en")) out.push("en");
	return out;
}
function mergeI18nTranslations(chain) {
	const { layers } = getRegistry();
	const merged = {};
	for (let i = chain.length - 1; i >= 0; i--) {
		const tag = chain[i];
		const layer = layers.get(tag);
		if (layer) Object.assign(merged, layer);
	}
	return merged;
}
/**
* Register or merge translation strings for a BCP 47 locale tag.
*
* @param locale - BCP 47 tag (normalized to lowercase; unicode extensions stripped for the registry key).
* @param translations - Partial nested locale values; merges with any existing layer for the tag.
* @public
*/
function registerI18n(locale, translations) {
	const { layers } = getRegistry();
	const tag = getLocaleKey(locale);
	const existing = layers.get(tag) ?? {};
	layers.set(tag, {
		...existing,
		...flattenTranslations(translations)
	});
	notify();
}
/**
* Return the merged registered translation map for a locale. Built-in English defaults are supplied by text
* descriptors.
*
* @param locale - BCP 47 tag to resolve (e.g. `es-MX`, `zh-Hant-HK`).
* @public
*/
function getI18nTranslations(locale) {
	return mergeI18nTranslations(findLocaleKeys(locale));
}
/**
* Subscribe to global registry mutations (for example after `registerI18n` or browser translation prefetch).
*
* @param callback - Invoked when any locale layer changes.
* @public
*/
function onI18nRegistryChange(callback) {
	const { subscribers } = getRegistry();
	subscribers.add(callback);
	return () => {
		subscribers.delete(callback);
	};
}
/**
* Whether an exact locale tag has been registered via `registerI18n` (not whether lazy packs exist).
*
* @param locale - BCP 47 tag to test.
* @public
*/
function hasRegisteredLocale(locale) {
	return getRegistry().layers.has(getLocaleKey(locale));
}

//#endregion
export { onI18nRegistryChange as a, isDefaultLocale as c, hasRegisteredLocale as i, flattenTranslations as l, getI18nTranslations as n, registerI18n as o, getLocaleKey as r, DEFAULT_LOCALE as s, findLocaleKeys as t };
//# sourceMappingURL=i18n-ByQGZLGb.js.map