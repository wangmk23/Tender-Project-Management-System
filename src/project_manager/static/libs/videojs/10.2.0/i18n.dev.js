/*! Video.js | https://videojs.org/help */
import { c as isObject } from "./predicate-3rF1m2uv.js";
import { a as onI18nRegistryChange, c as isDefaultLocale, i as hasRegisteredLocale, l as flattenTranslations, n as getI18nTranslations, o as registerI18n, r as getLocaleKey, s as DEFAULT_LOCALE, t as findLocaleKeys } from "./i18n-ByQGZLGb.js";
import { t as resolveText } from "./resolve-text-CQ6OnJ11.js";
import { n as interpolate, t as translateText } from "./translate-text-4JIqxuMT.js";

//#region ../core/dist/dev/i18n/locales/en.js
var en_default = {
	buttons: {
		play: "Play",
		pause: "Pause",
		replay: "Replay",
		mute: "Mute",
		unmute: "Unmute"
	},
	seek: {
		forward: "Seek forward {seconds} seconds",
		backward: "Seek backward {seconds} seconds"
	},
	fullscreen: {
		enter: "Enter fullscreen",
		exit: "Exit fullscreen"
	},
	captions: {
		enable: "Enable captions",
		disable: "Disable captions"
	},
	pip: {
		enter: "Enter picture-in-picture",
		exit: "Exit picture-in-picture"
	},
	live: {
		playing: "Playing live",
		seekToEdge: "Seek to live edge",
		badge: "Live"
	},
	cast: {
		start: "Start casting",
		stop: "Stop casting",
		connecting: "Connecting"
	},
	airplay: {
		start: "Start AirPlay",
		stop: "Stop AirPlay"
	},
	slider: { seek: "Seek" },
	time: {
		current: "Current time",
		duration: "Duration",
		remaining: "Remaining",
		elapsedSuffix: "{duration} elapsed",
		durationSuffix: "{duration} duration",
		remainingSuffix: "{duration} remaining",
		showElapsed: "Show elapsed time, {duration}.",
		showDuration: "Show duration, {duration}.",
		showRemaining: "Show remaining time, {duration}.",
		toggleElapsed: "Toggle between elapsed and remaining time.",
		toggleDuration: "Toggle between duration and remaining time.",
		position: "{current} of {duration}",
		unknown: "Media not loaded, unknown time."
	},
	playback: { rate: "Playback rate {rate}" },
	volume: {
		mutedValue: "{percent}, muted",
		muted: "Muted",
		label: "Volume",
		value: "Volume {value}"
	},
	status: {
		captionsOn: "Captions on",
		captionsOff: "Captions off",
		paused: "Paused",
		playing: "Playing",
		fullscreen: "Fullscreen",
		pip: "Picture in picture",
		exitPip: "Exit picture in picture",
		seekedTo: "Seeked to {time}"
	},
	container: { label: "Media player" },
	errors: {
		aborted: "You stopped media playback before it finished.",
		network: "This media could not be loaded due to a network or server issue.",
		decode: "This media could not be played. It may be corrupted, or your browser may not support its format.",
		source: "This media could not be loaded. It may be unavailable, or your browser may not support its format.",
		encrypted: "This media could not be played because it could not be decrypted.",
		unplayable: "This media is unsupported by the player.",
		title: "Something went wrong.",
		unexpected: "An unexpected error occurred."
	},
	common: {
		empty: "",
		ok: "OK"
	},
	menu: {
		settings: "Settings",
		quality: "Quality",
		audio: "Audio",
		default: "Default",
		speed: "Speed",
		captions: "Captions",
		playbackRate: "Playback rate",
		back: "Back",
		off: "Off",
		auto: "Auto",
		autoWithLabel: "Auto ({label})",
		subtitles: "Subtitles"
	}
};

//#endregion
//#region ../core/dist/dev/core/i18n/browser-translation.js
const NAMED_PLACEHOLDER = /\{([^{}]+)\}/g;
const INDEX_PLACEHOLDER = /\{\s*(\d+)\s*\}/g;
/**
* Replaces `{seconds}` with `{0}`, `{1}`, … so the Browser Translation API sees one full sentence (grammar/word order
* preserved) while opaque numeric slots are left alone.
*/
function maskNamedPlaceholders(source) {
	const slots = [];
	return {
		masked: source.replace(NAMED_PLACEHOLDER, (_, name) => {
			slots.push(name);
			return `{${slots.length - 1}}`;
		}),
		slots
	};
}
function restoreNamedPlaceholders(translated, slots) {
	return translated.replace(INDEX_PLACEHOLDER, (match, index) => {
		const name = slots[Number(index)];
		return name !== void 0 ? `{${name}}` : match;
	});
}
async function translateProtectingPlaceholders(translator, value) {
	const { masked, slots } = maskNamedPlaceholders(value);
	if (slots.length === 0) return translator.translate(value);
	return restoreNamedPlaceholders(await translator.translate(masked), slots);
}
const cache = /* @__PURE__ */ new Map();
function getBrowserTranslator() {
	if (!("Translator" in globalThis)) return void 0;
	return globalThis.Translator;
}
/**
* First non-default tag in the lookup chain used as the browser translation target.
*
* @internal
*/
function resolveBrowserTranslationTarget(locale) {
	for (const tag of findLocaleKeys(locale)) if (!isDefaultLocale(tag)) return tag;
}
/**
* Whether to invoke the Browser Translation API for this locale after lazy built-in loading.
*
* @internal
*/
function shouldAttemptBrowserTranslation(locale, loadedLazyTags, translations) {
	if (!resolveBrowserTranslationTarget(locale)) return false;
	if (loadedLazyTags.some((tag) => !isDefaultLocale(tag))) return translations !== void 0 && hasMissingEnglishTranslations(translations);
	return !findLocaleKeys(locale).some((tag) => !isDefaultLocale(tag) && hasRegisteredLocale(tag));
}
function hasMissingEnglishTranslations(translations) {
	const english = flattenTranslations(en_default);
	return Object.keys(english).some((key) => translations[key] === void 0);
}
/**
* Translates English registry values via the on-device Browser Translation API when a pre-installed model is available.
* Results are cached per target language tag.
*
* @internal
*/
async function getBrowserTranslations(locale, options) {
	const target = resolveBrowserTranslationTarget(locale);
	if (!target) return {};
	const cached = cache.get(target);
	if (cached) return cached;
	const Translator = getBrowserTranslator();
	if (!Translator) return {};
	const downloadIfNeeded = options?.downloadIfNeeded ?? false;
	const availability = await Translator.availability({
		sourceLanguage: "en",
		targetLanguage: target
	});
	if (availability === "unavailable") return {};
	if (!downloadIfNeeded && availability !== "available") return {};
	const needsDownload = downloadIfNeeded && (availability === "downloadable" || availability === "downloading");
	let downloadStarted = false;
	const notifyDownloadStart = () => {
		if (!needsDownload || downloadStarted) return;
		downloadStarted = true;
		options?.onModelDownload?.start?.(target);
	};
	notifyDownloadStart();
	const english = flattenTranslations(en_default);
	const keys = Object.keys(english);
	const translator = await Translator.create({
		sourceLanguage: "en",
		targetLanguage: target,
		...downloadIfNeeded ? { monitor(monitor) {
			monitor.addEventListener("downloadprogress", notifyDownloadStart);
		} } : {}
	});
	if (downloadStarted) options?.onModelDownload?.finish?.(target);
	const entries = await Promise.all(keys.map(async (key) => {
		const value = english[key];
		if (!value) return [key, ""];
		return [key, await translateProtectingPlaceholders(translator, value)];
	}));
	const result = Object.fromEntries(entries);
	cache.set(target, result);
	return result;
}

//#endregion
//#region ../core/dist/dev/core/i18n/load-locale.js
const loaders = {
	ar: () => import("./ar-CYcjzRuQ.js").then((n) => n.n),
	az: () => import("./az-DY1HOK6-.js").then((n) => n.n),
	bs: () => import("./bs-Q_7RORw5.js").then((n) => n.n),
	bg: () => import("./bg-DDW5K0b5.js").then((n) => n.n),
	bn: () => import("./bn-BT-So8gH.js").then((n) => n.n),
	ca: () => import("./ca-EfYxwhhK.js").then((n) => n.n),
	cs: () => import("./cs-Cky7yHyA.js").then((n) => n.n),
	cy: () => import("./cy-DlPyg6bJ.js").then((n) => n.n),
	da: () => import("./da-CrJwaTaM.js").then((n) => n.n),
	de: () => import("./de-Brq2WJLk.js").then((n) => n.n),
	el: () => import("./el-HONBIsUU.js").then((n) => n.n),
	es: () => import("./es-DDnyTWJd.js").then((n) => n.n),
	et: () => import("./et-BIqyd3EC.js").then((n) => n.n),
	eu: () => import("./eu-5AzAfcrv.js").then((n) => n.n),
	fa: () => import("./fa-T83ohzME.js").then((n) => n.n),
	fi: () => import("./fi-sIiVoIn0.js").then((n) => n.n),
	fr: () => import("./fr-DHgKsIG6.js").then((n) => n.n),
	gd: () => import("./gd-Bge3Z5X0.js").then((n) => n.n),
	gl: () => import("./gl-D_Fcl8fl.js").then((n) => n.n),
	he: () => import("./he-spI3XY1g.js").then((n) => n.n),
	hi: () => import("./hi-Bs2ZMKQ4.js").then((n) => n.n),
	hr: () => import("./hr-DDL_6mX6.js").then((n) => n.n),
	hu: () => import("./hu-jJPJi1AJ.js").then((n) => n.n),
	id: () => import("./id-Cwc4T_3Q.js").then((n) => n.n),
	it: () => import("./it-tlHe0OGC.js").then((n) => n.n),
	ja: () => import("./ja-BTSgScwZ.js").then((n) => n.n),
	ko: () => import("./ko-DZXmhgIV.js").then((n) => n.n),
	lt: () => import("./lt-CGzbQqX4.js").then((n) => n.n),
	lv: () => import("./lv-dOpB3t-I.js").then((n) => n.n),
	mr: () => import("./mr-DFLdG-ee.js").then((n) => n.n),
	nb: () => import("./nb-DJ3wkGN7.js").then((n) => n.n),
	nl: () => import("./nl-DI9RSBpF.js").then((n) => n.n),
	nn: () => import("./nn-BeD9ArY3.js").then((n) => n.n),
	ne: () => import("./ne-BYAE2lTu.js").then((n) => n.n),
	oc: () => import("./oc-BtZD2z6h.js").then((n) => n.n),
	pl: () => import("./pl-DdMvL7-s.js").then((n) => n.n),
	"pt-br": () => import("./pt-BR-D0NjMuuX.js").then((n) => n.n),
	"pt-pt": () => import("./pt-PT-BndAMcAQ.js").then((n) => n.n),
	ro: () => import("./ro-iLU7aSrA.js").then((n) => n.n),
	ru: () => import("./ru-DDwuPsHG.js").then((n) => n.n),
	sk: () => import("./sk-r191vult.js").then((n) => n.n),
	sl: () => import("./sl-CqKPkcIT.js").then((n) => n.n),
	sr: () => import("./sr-DmsDGG1J.js").then((n) => n.n),
	sv: () => import("./sv-Ci90ID4i.js").then((n) => n.n),
	te: () => import("./te-C8pdoVdp.js").then((n) => n.n),
	th: () => import("./th-DSoZmy3R.js").then((n) => n.n),
	tr: () => import("./tr-BF5UVnbP.js").then((n) => n.n),
	uk: () => import("./uk-C53KC5hH.js").then((n) => n.n),
	vi: () => import("./vi-Bo7A4CXq.js").then((n) => n.n),
	"zh-cn": () => import("./zh-CN-CEvne5LK.js").then((n) => n.n),
	"zh-tw": () => import("./zh-TW-BCobCBub.js").then((n) => n.n),
	pt: () => import("./pt-pi2KqX5u.js").then((n) => n.t),
	zh: () => import("./zh-CwVuNJhr.js").then((n) => n.t)
};
/**
* Lazy-import the built-in locale pack for a tag, or its closest fallback in the {@link findLocaleKeys} chain. Resolves
* to `undefined` when that chain reaches a registered locale first or no built-in pack matches.
*
* @param tag - BCP 47 tag to load, such as `fr-CA`.
* @public
*/
async function loadLocale(tag) {
	if (hasRegisteredLocale(tag)) return void 0;
	for (const chainTag of findLocaleKeys(tag)) {
		if (hasRegisteredLocale(chainTag)) return void 0;
		const load = loaders[getLocaleKey(chainTag)];
		if (load) return flattenTranslations((await load()).default);
	}
}

//#endregion
//#region ../core/dist/dev/core/i18n/resolve-translation.js
/**
* Translate a key with a translator, requiring the template params that key's English default declares.
*
* @param translator - Translator from `createTranslator`.
* @param key - Translation key, such as `seek.forward`.
* @param args - The key's template params, plus an optional `default` string.
* @public
*/
function resolveTranslation(translator, key, ...args) {
	const [params] = args;
	const translate = translator;
	return params !== void 0 ? translate(key, params) : translate(key);
}

//#endregion
//#region ../core/dist/dev/core/i18n/text.js
/**
* Whether a value is a text descriptor: a translation key with its English default.
*
* @param value - Value to check.
* @public
*/
function isText(value) {
	return isObject(value) && "key" in value && "text" in value;
}

//#endregion
//#region ../core/dist/dev/core/i18n/translator.js
/**
* Builds a typed translator from a resolved translation map (typically from `getI18nTranslations`).
*
* @param translations - Merged translation map for the active locale.
* @param locale - BCP 47 tag associated with the map (reserved for future locale-aware behavior).
* @public
*/
function createTranslator(translations, locale) {
	const translate = (input, params) => {
		const options = params;
		const isDescriptor = typeof input !== "string";
		const key = isDescriptor ? input.key : input;
		const translation = translations[key];
		if (translation === void 0 && !isDescriptor && options?.default === void 0) console.warn(`[videojs] Missing translation for "${key}".`);
		const fallback = options?.default;
		const values = options ? { ...options } : void 0;
		if (values) delete values.default;
		const raw = translation ?? (isDescriptor ? input.text : fallback) ?? String(key);
		return interpolate(raw, values);
	};
	return translate;
}

//#endregion
export { DEFAULT_LOCALE, createTranslator, findLocaleKeys, getBrowserTranslations, getI18nTranslations, hasRegisteredLocale, isText, loadLocale, onI18nRegistryChange, registerI18n, resolveBrowserTranslationTarget, resolveText, resolveTranslation, shouldAttemptBrowserTranslation, translateText };
//# sourceMappingURL=i18n.dev.js.map