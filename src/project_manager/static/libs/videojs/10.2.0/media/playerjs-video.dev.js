/*! Video.js | https://videojs.org/help */
import { c as isObject, d as isString, f as isUndefined, r as isBoolean, s as isNumber } from "../predicate-3rF1m2uv.js";
import { t as deepEqual } from "../deep-equal-mHeggeG2.js";
import { t as CustomMediaElement } from "../custom-media-element-CfmsPmjg.js";
import { a as escapeHtml } from "../attributes-CI6LN9fK.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as generateId } from "../generate-id-DHFQ63E5.js";
import { n as createPublicPromise, t as MediaPlayedRangesMixin } from "../media-played-ranges-B4JAhSRt.js";
import { t as tryCall } from "../try-call-CA5eo1yN.js";
import { n as EMPTY_TEXT_TRACKS, r as EMPTY_TIME_RANGES } from "../constants-CMPy89v9.js";
import { t as MediaError } from "../media-error-zO-Hg4un.js";
import { t as clamp } from "../number-D2skb7-A.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";
import { t as createTimeRange } from "../time-ranges-BRGzv3TE.js";

//#region ../adapters/playerjs-video/dist/dev/providers.js
/**
* Every provider hides as much of its own chrome as it allows without `controls`, since a player skin above the frame
* is expected to be the UI. Parameters a service defaults the wrong way for that (Gumlet and Streamable loop, Bunny
* autoplays) are spelled out either way rather than left to the service; the rest are only written when turned on.
*/
const PROVIDERS = [
	{
		name: "gumlet",
		matches: (url) => url.hostname === "play.gumlet.io",
		params: ({ autoplay, loop, controls }) => ({
			autoplay: autoplay ? "true" : "false",
			loop: loop ? "true" : "false",
			disable_player_controls: controls ? null : "true"
		})
	},
	{
		name: "streamable",
		matches: (url) => url.hostname === "streamable.com" || url.hostname === "www.streamable.com",
		params: ({ autoplay, defaultMuted, loop, controls }) => ({
			autoplay: autoplay ? "1" : null,
			muted: defaultMuted ? "1" : null,
			loop: loop ? null : "0",
			nocontrols: controls ? null : "1"
		})
	},
	{
		name: "bunny",
		matches: (url) => url.hostname === "iframe.mediadelivery.net" || url.hostname === "player.mediadelivery.net",
		params: ({ autoplay, defaultMuted, loop, controls, preload }) => ({
			autoplay: autoplay ? "true" : "false",
			muted: defaultMuted ? "true" : null,
			loop: loop ? "true" : "false",
			preload: preload === "none" ? "false" : null,
			...!controls && {
				compactControls: "true",
				showSpeed: "false",
				showHeatmap: "false",
				chromecast: "false",
				disableAirPlay: "true"
			}
		})
	},
	{
		name: "livid",
		matches: (url) => url.hostname === "livid.com" || url.hostname === "www.livid.com",
		params: ({ autoplay, defaultMuted, loop, controls, preload }) => ({
			autoplay: autoplay ? "1" : null,
			muted: defaultMuted ? "1" : null,
			loop: loop ? "1" : null,
			controls: controls ? null : "0",
			preload: preload ?? null
		})
	},
	{
		name: "framerate",
		matches: (url) => url.hostname === "framerate.tv" || url.hostname === "www.framerate.tv",
		params: ({ autoplay, defaultMuted, loop, controls }) => ({
			autoplay: autoplay ? "1" : null,
			muted: defaultMuted ? "1" : null,
			loop: loop ? "1" : null,
			...!controls && {
				show_controls: "0",
				initial_play_btn: "0"
			}
		})
	},
	{
		name: "mux",
		matches: (url) => url.hostname === "player.mux.com",
		params: ({ autoplay, defaultMuted, loop, preload }) => ({
			autoplay: autoplay ? "true" : null,
			muted: defaultMuted ? "true" : null,
			loop: loop ? "true" : null,
			preload: preload ?? null
		})
	}
];
/** The known service an embed URL belongs to, if any. */
function getPlayerJsProvider(url) {
	return PROVIDERS.find((provider) => provider.matches(url));
}

//#endregion
//#region ../adapters/playerjs-video/dist/dev/source.js
/**
* Parse a player.js embed URL. player.js is a protocol, not a host, so any absolute `http(s)` URL qualifies — whether
* the page behind it answers is only known once it reports `ready`. Protocol-relative URLs are read as `https`.
*
* @internal
*/
function parsePlayerJsSource(src) {
	if (!src) return null;
	try {
		const url = new URL(src.startsWith("//") ? `https:${src}` : src);
		return url.protocol === "https:" || url.protocol === "http:" ? url : null;
	} catch {
		return null;
	}
}
/**
* Build the iframe `src` URL for a player.js embed from the given props. Empty when `src` is not an embed URL.
*
* For the services it recognizes (Mux Player, Gumlet, FrameRate, Livid, Bunny Stream, Streamable), the host writes
* `autoplay`, `muted`, `loop`, `controls`, and `preload` in the service's own spelling, and without `controls` hides as
* much of the service's chrome as its URL allows. A parameter already in `src` is left as written, and
* `engine.playerJs` overrides both.
*
* @internal
*/
function buildPlayerJsIframeSrc(src, props = {}) {
	const url = parsePlayerJsSource(src);
	if (!url) return "";
	const derived = getPlayerJsProvider(url)?.params(props) ?? {};
	for (const [key, value] of Object.entries(derived)) if (value !== null && !url.searchParams.has(key)) url.searchParams.set(key, value);
	const { referrerPolicy: _referrerPolicy, ...params } = props.source?.engine?.playerJs ?? {};
	for (const [key, value] of Object.entries(params)) {
		if (value === void 0) continue;
		url.searchParams.delete(key);
		if (value === null) continue;
		for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
	}
	return url.toString();
}

//#endregion
//#region ../adapters/playerjs-video/dist/dev/player-api.js
/** The `context` every player.js message carries, whichever way it travels. */
const PLAYER_CONTEXT = "player.js";
/** The spec version this host speaks. Receivers do not branch on it, but the spec asks for it on every command. */
const PLAYER_VERSION = "0.0.11";
/**
* The spec's own methods and events. They are also what an embed is assumed to support when its `ready` message carries
* no lists, and nothing beyond them: an extension is only used once an embed says it has it.
*/
const SPEC_METHODS = [
	"play",
	"pause",
	"getPaused",
	"mute",
	"unmute",
	"getMuted",
	"setVolume",
	"getVolume",
	"getDuration",
	"setCurrentTime",
	"getCurrentTime",
	"setLoop",
	"getLoop",
	"addEventListener",
	"removeEventListener"
];
const SPEC_EVENTS = [
	"ready",
	"play",
	"pause",
	"ended",
	"timeupdate",
	"progress",
	"error"
];
/**
* Read a `message` event's data as a player.js message. The spec sends JSON strings; some receivers post objects, so
* both are accepted. Anything else on the window — every frame posts here — comes back null.
*/
function parsePlayerJsMessage(data) {
	let message = data;
	if (isString(data)) {
		if (!data.includes("player.js")) return null;
		try {
			message = JSON.parse(data);
		} catch {
			return null;
		}
	}
	if (!isObject(message)) return null;
	const { context, event } = message;
	return context === "player.js" && isString(event) ? message : null;
}
/** Build a command message, serialized the way the spec sends it. */
function createPlayerJsCommand(method, value, listener) {
	const message = {
		context: PLAYER_CONTEXT,
		version: PLAYER_VERSION,
		method,
		...value !== void 0 && { value },
		...listener !== void 0 && { listener }
	};
	return JSON.stringify(message);
}
/** Whether a `ready` payload's lists, where present, are lists of names. */
function isPlayerJsReadyValue(value) {
	if (!isObject(value)) return false;
	const { methods, events } = value;
	return isOptionalStringArray(methods) && isOptionalStringArray(events);
}
/** Whether a `timeupdate` or `progress` payload's fields, where present, are numbers. */
function isPlayerJsTimeValue(value) {
	if (!isObject(value)) return false;
	const { seconds, duration, percent } = value;
	return [
		seconds,
		duration,
		percent
	].every((field) => isUndefined(field) || isNumber(field));
}
/** Whether an `error` payload's fields, where present, have the spec's types. */
function isPlayerJsErrorValue(value) {
	if (!isObject(value)) return false;
	const { code, msg } = value;
	return (isUndefined(code) || isNumber(code)) && (isUndefined(msg) || isString(msg));
}
function isOptionalStringArray(value) {
	return isUndefined(value) || Array.isArray(value) && value.every(isString);
}

//#endregion
//#region ../adapters/playerjs-video/dist/dev/adapter.js
/**
* Plays any embed that implements the player.js receiver — Mux Player, Gumlet, FrameRate, Livid, Bunny Stream,
* Streamable, and others — through one protocol rather than one adapter per service. Embeds implement the spec to
* varying degrees, so every command is checked against the list the embed advertises with `ready`: a missing getter
* leaves its value at the default (`NaN` for `duration`), and a missing setter leaves the value where the embed has
* it.
*
* @fires sourcechange - Fired when `source` changes, either directly or by resolving a new `src`. Read `source` for the
*   new value.
*/
var PlayerJsAdapter = class PlayerJsAdapter extends MediaPlayedRangesMixin(EventTarget) {
	static {
		this.defaultProps = {
			src: "",
			autoplay: false,
			defaultMuted: false,
			muted: false,
			loop: false,
			controls: false,
			playsInline: true,
			preload: "metadata",
			poster: "",
			source: null
		};
	}
	static {
		this.PLAYER_SOFTWARE_NAME = "playerjs-video";
	}
	#target = null;
	#loadComplete = createPublicPromise();
	#listeners = null;
	#attachId = 0;
	#src = PlayerJsAdapter.defaultProps.src;
	#autoplay = PlayerJsAdapter.defaultProps.autoplay;
	#defaultMuted = PlayerJsAdapter.defaultProps.defaultMuted;
	#loop = PlayerJsAdapter.defaultProps.loop;
	#controls = PlayerJsAdapter.defaultProps.controls;
	#playsInline = PlayerJsAdapter.defaultProps.playsInline;
	#preload = PlayerJsAdapter.defaultProps.preload;
	#poster = PlayerJsAdapter.defaultProps.poster;
	#source = PlayerJsAdapter.defaultProps.source;
	#listenerId = createListenerId();
	#requestCount = 0;
	#requests = /* @__PURE__ */ new Map();
	#ready = false;
	#methods = EMPTY_SET;
	#events = EMPTY_SET;
	#playRequested = false;
	#frameLoaded = true;
	#seekCount = 0;
	#paused = true;
	#ended = false;
	#seeking = false;
	#currentTime = 0;
	#duration = NaN;
	#bufferedEnd = 0;
	#volume = 1;
	#muted = false;
	#playbackRate = 1;
	#readyState = READY_STATE_HAVE_NOTHING;
	#error = null;
	#isFullscreen = false;
	/** The embed's window. player.js publishes no player object; commands are posted to the frame. Null until rendered. */
	get engine() {
		return this.#target?.contentWindow ?? null;
	}
	get target() {
		return this.#target;
	}
	/** Bind the iframe hosting the embed. The embed follows once a `src` resolves, which may be after attach. */
	attach(target) {
		if (!target || this.#target === target) return;
		if (this.#target) this.detach();
		this.#target = target;
		this.#listen(target);
		this.#beginLoad();
		this.#createPlayer(target);
	}
	detach() {
		if (!this.#target) return;
		this.#attachId++;
		this.#listeners?.abort();
		this.#listeners = null;
		this.#target = null;
		this.#playRequested = false;
		this.#loadComplete.resolve();
		this.#resetState();
	}
	destroy() {
		this.detach();
		super.destroy();
	}
	/**
	* Whether the embed advertises a player.js method or event, e.g. `supports('method', 'setCurrentTime')` for seeking.
	* Several names ask whether it supports all of them. Answered from the lists the embed sends with `ready`, so it
	* reads `false` until then; `loadcomplete` marks the moment it becomes meaningful.
	*/
	supports(type, name) {
		if (!this.#ready) return false;
		const supported = type === "method" ? this.#methods : this.#events;
		return (isString(name) ? [name] : name).every((n) => supported.has(n));
	}
	get src() {
		return this.#src;
	}
	/** Embed URL. Setting it re-derives `source`, carrying its engine options over. */
	set src(value) {
		const { engine } = this.#source ?? {};
		const next = {
			...engine && { engine },
			...value && { src: value }
		};
		this.source = Object.keys(next).length > 0 ? next : null;
	}
	get currentSrc() {
		return this.#target?.getAttribute("src") ?? "";
	}
	get readyState() {
		return this.#readyState;
	}
	/** Rebuild the embed for the current source; rewriting the iframe URL is the only load the protocol allows. */
	async load() {
		if (!this.#target) return;
		const load = this.#beginLoad();
		await Promise.resolve();
		if (load !== this.#loadComplete) return;
		const target = this.#target;
		if (!target) return;
		const embedSrc = buildPlayerJsIframeSrc(this.#src, this.#snapshotProps());
		const currentSrc = target.getAttribute("src");
		if (embedSrc && keepsDocument(currentSrc, embedSrc)) {
			if (currentSrc !== embedSrc) target.src = embedSrc;
			if (this.#ready) load.resolve();
			return;
		}
		this.#resetState();
		this.dispatchEvent(new Event("emptied"));
		this.#loadEmbed(target, embedSrc);
	}
	#loadEmbed(target, embedSrc) {
		if (!embedSrc) {
			target.removeAttribute("src");
			this.#loadComplete.resolve();
		} else {
			this.#frameLoaded = false;
			target.src = embedSrc;
		}
		if (!this.#src) return;
		this.dispatchEvent(new Event("loadstart"));
		if (!embedSrc) {
			this.#error = new MediaError(`Unrecognized player.js embed URL: ${this.#src}`, MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
			this.dispatchEvent(new Event("error"));
		}
	}
	#beginLoad() {
		this.#loadComplete.resolve();
		this.#loadComplete = createPublicPromise();
		return this.#loadComplete;
	}
	get paused() {
		return this.#paused;
	}
	get ended() {
		return this.#ended;
	}
	get seeking() {
		return this.#seeking;
	}
	async play() {
		if (!this.#src) return;
		if (!this.#ready) {
			this.#playRequested = true;
			return;
		}
		this.#post("play");
	}
	pause() {
		this.#playRequested = false;
		if (this.#ready) this.#post("pause");
	}
	get currentTime() {
		return this.#currentTime;
	}
	set currentTime(value) {
		if (this.#currentTime === value || !this.#accepts("setCurrentTime")) return;
		this.#seeking = true;
		this.#ended = false;
		this.#currentTime = value;
		this.dispatchEvent(new Event("seeking"));
		this.dispatchEvent(new Event("timeupdate"));
		if (this.#ready) this.#seek(value);
	}
	get duration() {
		return this.#duration;
	}
	get volume() {
		return this.#volume;
	}
	set volume(value) {
		if (this.#volume === value || !this.#accepts("setVolume")) return;
		this.#volume = value;
		this.dispatchEvent(new Event("volumechange"));
		this.#call("setVolume", toEmbedVolume(value));
	}
	get muted() {
		return this.#muted;
	}
	set muted(value) {
		const method = value ? "mute" : "unmute";
		if (this.#muted === value || !this.#accepts(method)) return;
		this.#muted = value;
		this.dispatchEvent(new Event("volumechange"));
		this.#call(method);
	}
	/** Reaches the embed only where it advertises `setPlaybackRate`, an extension to the spec. */
	get playbackRate() {
		return this.#playbackRate;
	}
	set playbackRate(value) {
		if (this.#playbackRate === value || !this.#accepts("setPlaybackRate")) return;
		this.#playbackRate = value;
		this.dispatchEvent(new Event("ratechange"));
		this.#call("setPlaybackRate", value);
	}
	get autoplay() {
		return this.#autoplay;
	}
	set autoplay(value) {
		this.#autoplay = value;
	}
	get defaultMuted() {
		return this.#defaultMuted;
	}
	set defaultMuted(value) {
		this.#defaultMuted = value;
		if (!this.#ready) this.#muted = value;
	}
	get loop() {
		return this.#loop;
	}
	set loop(value) {
		this.#loop = value;
		this.#call("setLoop", value);
	}
	get controls() {
		return this.#controls;
	}
	set controls(value) {
		this.#controls = value;
	}
	get playsInline() {
		return this.#playsInline;
	}
	set playsInline(value) {
		this.#playsInline = value;
	}
	get preload() {
		return this.#preload;
	}
	set preload(value) {
		this.#preload = value;
	}
	get poster() {
		return this.#poster;
	}
	set poster(value) {
		this.#poster = value;
	}
	/** Embed URL in `src`, extra URL parameters under `engine.playerJs`. Re-derives `src`; equal sources skip reload. */
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		const engineChanged = !deepEqual(this.#source?.engine?.playerJs ?? null, source?.engine?.playerJs ?? null);
		this.#source = source;
		this.#src = src;
		if (srcChanged || engineChanged) this.load();
		this.dispatchEvent(new Event("sourcechange"));
	}
	get buffered() {
		const end = Math.max(this.#bufferedEnd, this.#currentTime);
		return end > 0 ? createTimeRange(0, end) : EMPTY_TIME_RANGES;
	}
	get seekable() {
		return this.#duration > 0 && Number.isFinite(this.#duration) && this.#methods.has("setCurrentTime") ? createTimeRange(0, this.#duration) : EMPTY_TIME_RANGES;
	}
	get error() {
		return this.#error;
	}
	/** Always empty: player.js has no text track surface. */
	get textTracks() {
		return EMPTY_TEXT_TRACKS;
	}
	get isFullscreen() {
		return this.#isFullscreen;
	}
	async requestFullscreen() {
		if (!this.#target?.requestFullscreen) return;
		await this.#target.requestFullscreen();
		this.#isFullscreen = true;
	}
	async exitFullscreen() {
		const doc = globalThis.document;
		if (doc?.fullscreenElement && doc.fullscreenElement === this.#target) await doc.exitFullscreen();
		this.#isFullscreen = false;
	}
	#createPlayer(target) {
		if (!target.getAttribute("src")) {
			this.#loadEmbed(target, buildPlayerJsIframeSrc(this.#src, this.#snapshotProps()));
			return;
		}
		this.#frameLoaded = true;
		this.dispatchEvent(new Event("loadstart"));
		this.#requestReady();
	}
	#listen(target) {
		const win = globalThis.window;
		if (isUndefined(win)) return;
		const attachId = this.#attachId;
		this.#listeners = new AbortController();
		const { signal } = this.#listeners;
		win.addEventListener("message", (event) => this.#onMessage(event, target, attachId), { signal });
		target.addEventListener("load", () => {
			this.#frameLoaded = true;
			this.#requestReady();
		}, { signal });
	}
	#onMessage(event, target, attachId) {
		if (attachId !== this.#attachId) return;
		const frame = target.contentWindow;
		if (!frame || event.source !== frame) return;
		const message = parsePlayerJsMessage(event.data);
		if (!message) return;
		const { event: type, listener, value } = message;
		if (type === "ready") {
			const ready = isPlayerJsReadyValue(value) ? value : {};
			if (!this.#frameLoaded && isString(ready.src) && !isSameDocument(ready.src, target.getAttribute("src"))) return;
			this.#onReady(ready);
			return;
		}
		const answer = isUndefined(listener) ? void 0 : this.#requests.get(listener);
		if (answer) {
			this.#requests.delete(listener);
			answer(value);
			return;
		}
		if (!this.#ready || !isUndefined(listener) && listener !== this.#listenerId) return;
		switch (type) {
			case "play":
				this.#onPlay();
				break;
			case "pause":
				this.#onPause();
				break;
			case "ended":
				this.#onEnded();
				break;
			case "timeupdate":
				if (isPlayerJsTimeValue(value)) this.#onTimeUpdate(value);
				break;
			case "progress":
				if (isPlayerJsTimeValue(value)) this.#onProgress(value);
				break;
			case "seeked":
				this.#confirmSeek(isNumber(value) ? value : isPlayerJsTimeValue(value) ? value.seconds : void 0);
				break;
			case "error":
				this.#onPlayerError(isPlayerJsErrorValue(value) ? value : {});
				break;
			case "volumeChange":
			case "volumechange":
				this.#syncVolume();
				break;
			case "playbackRateChange":
			case "playbackratechange": this.#get("getPlaybackRate", isNumber).then((rate) => this.#applyPlaybackRate(rate));
		}
	}
	#onReady({ methods, events }) {
		if (this.#ready || !this.#target?.getAttribute("src")) return;
		this.#ready = true;
		this.#methods = new Set(Array.isArray(methods) ? methods : SPEC_METHODS);
		this.#events = new Set(Array.isArray(events) ? events : SPEC_EVENTS);
		this.#readyState = READY_STATE_HAVE_METADATA;
		for (const type of SUBSCRIBED_EVENTS) if (this.#events.has(type)) this.#post("addEventListener", type, this.#listenerId);
		this.#syncToEmbed();
		for (const type of ["loadedmetadata", "loadcomplete"]) this.dispatchEvent(new Event(type));
		this.#loadComplete.resolve();
		this.#syncFromEmbed();
	}
	#syncToEmbed() {
		if (this.#muted && !this.#call("mute")) {
			this.#muted = false;
			this.dispatchEvent(new Event("volumechange"));
		}
		if (this.#volume !== 1 && !this.#call("setVolume", toEmbedVolume(this.#volume))) {
			this.#volume = 1;
			this.dispatchEvent(new Event("volumechange"));
		}
		if (this.#playbackRate !== 1 && !this.#call("setPlaybackRate", this.#playbackRate)) {
			this.#playbackRate = 1;
			this.dispatchEvent(new Event("ratechange"));
		}
		this.#call("setLoop", this.#loop);
		if (this.#seeking) this.#seek(this.#currentTime);
		if (this.#autoplay || this.#playRequested) {
			this.#playRequested = false;
			this.#post("play");
		}
	}
	#syncFromEmbed() {
		this.#get("getDuration", isNumber).then((duration) => this.#applyDuration(duration));
		this.#get("getPaused", isBoolean).then((paused) => {
			if (paused === false) this.#onPlay();
		});
		this.#get("getCurrentTime", isNumber).then((time) => {
			if (!this.#seeking) this.#applyCurrentTime(time);
		});
		this.#syncVolume();
		this.#get("getPlaybackRate", isNumber).then((rate) => this.#applyPlaybackRate(rate));
	}
	#syncVolume() {
		this.#get("getVolume", isNumber).then((volume) => {
			if (!isUndefined(volume)) this.#applyVolume(fromEmbedVolume(volume), this.#muted);
		});
		this.#get("getMuted", isBoolean).then((muted) => {
			if (!isUndefined(muted)) this.#applyVolume(this.#volume, muted);
		});
	}
	#applyVolume(volume, muted) {
		if (volume === this.#volume && muted === this.#muted) return;
		this.#volume = volume;
		this.#muted = muted;
		this.dispatchEvent(new Event("volumechange"));
	}
	#applyPlaybackRate(rate) {
		if (isUndefined(rate) || rate <= 0 || rate === this.#playbackRate) return;
		this.#playbackRate = rate;
		this.dispatchEvent(new Event("ratechange"));
	}
	#applyDuration(duration) {
		if (!isNumber(duration) || !(duration > 0) || duration === this.#duration) return;
		this.#duration = duration;
		this.dispatchEvent(new Event("durationchange"));
	}
	#applyCurrentTime(time) {
		if (!isNumber(time) || time === this.#currentTime) return;
		this.#currentTime = time;
		this.dispatchEvent(new Event("timeupdate"));
	}
	#seek(time) {
		this.#seekCount++;
		if (!this.#call("setCurrentTime", time)) {
			this.#currentTime = 0;
			this.#settleSeek();
			return;
		}
		if (!this.#events.has("seeked")) this.#confirmSeek();
	}
	#confirmSeek(reported) {
		const seek = this.#seekCount;
		this.#get("getCurrentTime", isNumber).then((position = reported) => {
			if (seek !== this.#seekCount) return;
			this.#applyCurrentTime(position);
			this.#settleSeek();
		});
	}
	#settleSeek() {
		if (!this.#seeking) return;
		this.#seeking = false;
		this.dispatchEvent(new Event("seeked"));
	}
	#onPlay() {
		if (!this.#paused) return;
		this.#paused = false;
		this.#ended = false;
		this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
		this.dispatchEvent(new Event("play"));
		this.dispatchEvent(new Event("playing"));
	}
	#onPause() {
		if (this.#paused) return;
		this.#paused = true;
		this.dispatchEvent(new Event("pause"));
	}
	#onEnded() {
		if (this.#loop) {
			if (!this.#methods.has("setLoop")) {
				this.currentTime = 0;
				this.#post("play");
			}
			return;
		}
		this.#onPause();
		this.#ended = true;
		this.dispatchEvent(new Event("ended"));
	}
	#onTimeUpdate({ seconds, duration }) {
		this.#applyDuration(duration);
		if (!this.#seeking) this.#applyCurrentTime(seconds);
	}
	#onProgress({ seconds, duration, percent }) {
		this.#applyDuration(duration);
		const end = isNumber(percent) && Number.isFinite(this.#duration) ? percent / 100 * this.#duration : seconds;
		if (isNumber(end) && end > this.#bufferedEnd) {
			this.#bufferedEnd = end;
			this.dispatchEvent(new Event("progress"));
		}
	}
	#onPlayerError({ code, msg }) {
		if (code === 2 || code === 3) {
			console.warn(`The player.js embed rejected a command: ${msg || `error ${code}`}`);
			return;
		}
		this.#error = code === 1 ? new MediaError(msg || void 0, MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) : new MediaError(msg || "The embedded player reported an error.", MediaError.MEDIA_ERR_CUSTOM, true);
		this.dispatchEvent(new Event("error"));
		this.#loadComplete.resolve();
	}
	#accepts(method) {
		return !this.#ready || this.#methods.has(method);
	}
	#call(method, value) {
		if (!this.#methods.has(method)) return false;
		this.#post(method, value);
		return true;
	}
	#get(method, is) {
		if (!this.#methods.has(method)) return Promise.resolve(void 0);
		const listener = `${this.#listenerId}:${++this.#requestCount}`;
		return new Promise((resolve) => {
			this.#requests.set(listener, (value) => resolve(is(value) ? value : void 0));
			this.#post(method, void 0, listener);
		});
	}
	#requestReady() {
		this.#post("addEventListener", "ready", this.#listenerId);
	}
	#post(method, value, listener) {
		const frame = this.#target?.contentWindow;
		if (!frame) return;
		tryCall(() => frame.postMessage(createPlayerJsCommand(method, value, listener), "*"));
	}
	#snapshotProps() {
		return {
			autoplay: this.#autoplay,
			defaultMuted: this.#defaultMuted || this.#muted,
			loop: this.#loop,
			controls: this.#controls,
			preload: this.#preload,
			source: this.#source
		};
	}
	#resetState() {
		this.#listenerId = createListenerId();
		this.#requests.clear();
		this.#ready = false;
		this.#methods = EMPTY_SET;
		this.#events = EMPTY_SET;
		this.#currentTime = 0;
		this.#duration = NaN;
		this.#bufferedEnd = 0;
		this.#paused = true;
		this.#ended = false;
		this.#seeking = false;
		this.#readyState = READY_STATE_HAVE_NOTHING;
		this.#error = null;
		this.#isFullscreen = false;
	}
};
/** The events the host subscribes to, where the embed advertises them. `ready` needs no subscription. */
const SUBSCRIBED_EVENTS = [
	"play",
	"pause",
	"ended",
	"timeupdate",
	"progress",
	"seeked",
	"error",
	"volumeChange",
	"playbackRateChange",
	"volumechange",
	"playbackratechange"
];
const EMPTY_SET = /* @__PURE__ */ new Set();
function keepsDocument(current, next) {
	return !!current && current.split("#")[0] === next.split("#")[0];
}
/**
* Whether a URL a receiver reports names the document the frame was pointed at. Receivers report their own location,
* which can differ from the iframe `src` in its query (players add or drop parameters) and a trailing slash, so only
* the origin and path are compared.
*/
function isSameDocument(reported, src) {
	if (!src) return false;
	try {
		const a = new URL(reported);
		const b = new URL(src);
		return a.origin === b.origin && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
	} catch {
		return false;
	}
}
function createListenerId() {
	return `videojs-${generateId()}`;
}
function toEmbedVolume(volume) {
	return Math.round(volume * 100);
}
function fromEmbedVolume(volume) {
	return clamp(volume / 100, 0, 1);
}
const READY_STATE_HAVE_NOTHING = 0;
const READY_STATE_HAVE_METADATA = 1;
const READY_STATE_HAVE_FUTURE_DATA = 3;

//#endregion
//#region ../html/dist/dev/media/playerjs-video/adapter.js
var PlayerJsCustomMediaElement = class extends CustomMediaElement("iframe", PlayerJsAdapter) {
	static {
		this.getTemplateHTML = (attrs) => {
			const initialSrc = buildPlayerJsIframeSrc(attrs.src ?? "", templateAttrsToEmbedProps(attrs));
			return `
      <style>
        :host {
          display: inline-block;
          min-width: 300px;
          min-height: 150px;
          position: relative;
        }
        iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
        }
        /* A cross-origin frame swallows every pointer event, so the skin above it
           never sees the hover that reveals the controls. Not every service lets
           its chrome be hidden, so without controls the frame is kept out of
           hit-testing as well. */
        :host(:not([controls])) {
          pointer-events: none;
        }
      </style>
      <iframe
        part="iframe"
        title="Video player"
        ${initialSrc ? ` src="${escapeHtml(initialSrc)}"` : ""}
        allow="accelerometer; fullscreen; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        frameborder="0"
        width="100%"
        height="100%"
        referrerpolicy="${escapeHtml(attrs.referrerpolicy ?? "")}"
      ></iframe>
    `;
		};
	}
};
function templateAttrsToEmbedProps(attrs) {
	return {
		autoplay: attrs.autoplay !== void 0,
		defaultMuted: attrs.muted !== void 0,
		loop: attrs.loop !== void 0,
		controls: attrs.controls !== void 0,
		preload: attrs.preload ?? PlayerJsAdapter.defaultProps.preload
	};
}
var PlayerJsVideo = class extends MediaAttachMixin(PlayerJsCustomMediaElement) {};

//#endregion
//#region ../html/dist/dev/define/media/playerjs-video.js
var PlayerJsVideoElement = class extends PlayerJsVideo {
	static {
		this.tagName = "playerjs-video";
	}
};
safeDefine(PlayerJsVideoElement);

//#endregion
export { PlayerJsVideoElement };
//# sourceMappingURL=playerjs-video.dev.js.map