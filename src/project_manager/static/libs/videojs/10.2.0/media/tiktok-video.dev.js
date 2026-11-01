/*! Video.js | https://videojs.org/help */
import { c as isObject, d as isString, f as isUndefined, s as isNumber } from "../predicate-3rF1m2uv.js";
import { t as deepEqual } from "../deep-equal-mHeggeG2.js";
import { t as CustomMediaElement } from "../custom-media-element-CfmsPmjg.js";
import { a as escapeHtml } from "../attributes-CI6LN9fK.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as createPublicPromise, t as MediaPlayedRangesMixin } from "../media-played-ranges-B4JAhSRt.js";
import { t as tryCall } from "../try-call-CA5eo1yN.js";
import { n as EMPTY_TEXT_TRACKS, r as EMPTY_TIME_RANGES } from "../constants-CMPy89v9.js";
import { t as MediaError } from "../media-error-zO-Hg4un.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";
import { t as serializeEmbedParams } from "../embed-params-b1s4s7nw.js";
import { t as createTimeRange } from "../time-ranges-BRGzv3TE.js";

//#region ../media/dist/dev/core/source/tiktok.js
/**
* Parse a TikTok source string. Recognizes raw numeric ids, `player/v1/` embed URLs, `share/video/` links, and the
* `@user/video/` URLs the app hands out.
*
* @internal
*/
function parseTikTokSource(src) {
	if (!src) return null;
	if (MATCH_ID.test(src)) return { id: src };
	const id = MATCH_SRC.exec(src)?.[1];
	return id ? { id } : null;
}
const MATCH_ID = /^\d+$/;
const MATCH_SRC = /tiktok\.com\/(?:player\/v1\/|share\/video\/|@[^/]+\/video\/)(\d+)/;

//#endregion
//#region ../adapters/tiktok-video/dist/dev/source.js
/**
* Whether the embed has to carry an `autoplay` nobody asked for. TikTok builds its player lazily: without one it
* creates no media element, never reports `onPlayerReady`, and drops every command silently, until something is clicked
* inside the frame — which a frame under a player skin never gets. The host parks the player as soon as it is up, so
* this buys one that answers commands, not a video that plays.
*
* @internal
*/
function shouldBootstrapTikTokEmbed(props = {}) {
	return !props.autoplay && props.preload !== "none" && props.controls !== true;
}
/**
* Build the iframe `src` URL for a TikTok embed from the given props.
*
* @internal
*/
function buildTikTokIframeSrc(src, props = {}) {
	const parsed = parseTikTokSource(src);
	if (!parsed) return "";
	const { referrerPolicy: _referrerPolicy, ...tiktok } = props.source?.engine?.tiktok ?? {};
	const params = {
		controls: props.controls === true ? null : 0,
		autoplay: props.autoplay || shouldBootstrapTikTokEmbed(props) || null,
		muted: props.defaultMuted || null,
		loop: props.loop || null,
		rel: 0,
		...tiktok
	};
	return `${EMBED_BASE}/${parsed.id}?${serializeEmbedParams(params)}`;
}
const EMBED_BASE = "https://www.tiktok.com/player/v1";

//#endregion
//#region ../adapters/tiktok-video/dist/dev/player-api.js
/** Marker every player message carries, whichever way it travels. */
const PLAYER_MESSAGE_KEY = "x-tiktok-player";
/** Whether a `message` event's data is one of the embed's; every frame posts here, so the marker tells them apart. */
function isTikTokPlayerMessage(data) {
	if (!isObject(data)) return false;
	const message = data;
	return !!message["x-tiktok-player"] && isString(message.type);
}
/** Whether a value is the pair `onCurrentTime` reports. */
function isTikTokCurrentTime(value) {
	return isObject(value) && isNumber(value.currentTime);
}
/** Whether a value is the payload `onPlayerError` reports. */
function isTikTokPlayerError(value) {
	return isObject(value) && isNumber(value.errorCode);
}
/** Build a command message. A command without a value must not carry one at all. */
function createTikTokPlayerCommand(type, value) {
	return {
		[PLAYER_MESSAGE_KEY]: true,
		type,
		...isNumber(value) && { value }
	};
}

//#endregion
//#region ../adapters/tiktok-video/dist/dev/adapter.js
/**
* @fires sourcechange - Fired when `source` changes, either directly or by resolving a new `src`. Read `source` for the
*   new value.
*/
var TikTokAdapter = class TikTokAdapter extends MediaPlayedRangesMixin(EventTarget) {
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
	#target = null;
	#loadComplete = createPublicPromise();
	#messages = null;
	#attachId = 0;
	#src = TikTokAdapter.defaultProps.src;
	#autoplay = TikTokAdapter.defaultProps.autoplay;
	#defaultMuted = TikTokAdapter.defaultProps.defaultMuted;
	#loop = TikTokAdapter.defaultProps.loop;
	#controls = TikTokAdapter.defaultProps.controls;
	#playsInline = TikTokAdapter.defaultProps.playsInline;
	#preload = TikTokAdapter.defaultProps.preload;
	#poster = TikTokAdapter.defaultProps.poster;
	#source = TikTokAdapter.defaultProps.source;
	#paused = true;
	#ended = false;
	#seeking = false;
	#loaded = false;
	#srcUnsupported = false;
	#playRequested = false;
	#bootstrap = "off";
	#parkPosition = 0;
	#playFired = false;
	#currentTime = 0;
	#duration = NaN;
	#muted = false;
	#readyState = READY_STATE_HAVE_NOTHING;
	#error = null;
	#isFullscreen = false;
	static {
		this.PLAYER_SOFTWARE_NAME = "tiktok-video";
	}
	/** The embed's window. TikTok publishes no player object; commands are posted to the frame. Null until rendered. */
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
		this.#createPlayer();
	}
	detach() {
		if (!this.#target) return;
		this.#attachId++;
		this.#messages?.abort();
		this.#messages = null;
		this.#target = null;
		this.#playRequested = false;
		this.#loadComplete.resolve();
		this.#resetState();
	}
	destroy() {
		this.detach();
		super.destroy();
	}
	get src() {
		return this.#src;
	}
	/** TikTok URL or id. Setting it re-derives `source`, carrying its player parameters over. */
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
		const embedSrc = this.#src ? buildTikTokIframeSrc(this.#src, this.#snapshotProps()) : "";
		if (embedSrc && target.getAttribute("src") === embedSrc) {
			if (this.#loaded) load.resolve();
			return;
		}
		this.#resetState();
		this.dispatchEvent(new Event("emptied"));
		if (!this.#src) {
			load.resolve();
			target.removeAttribute("src");
			return;
		}
		this.dispatchEvent(new Event("loadstart"));
		if (!embedSrc) {
			this.#srcUnsupported = true;
			this.#error = new MediaError(`Unrecognized TikTok source: ${this.#src}`, MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
			this.dispatchEvent(new Event("error"));
			load.resolve();
			this.#post("pause");
			return;
		}
		this.#bootstrap = shouldBootstrapTikTokEmbed(this.#snapshotProps()) ? "parking" : "off";
		target.src = embedSrc;
	}
	#beginLoad() {
		this.#loadComplete.resolve();
		this.#loadComplete = createPublicPromise();
		return this.#loadComplete;
	}
	get #hasSource() {
		return !!this.#src && !this.#srcUnsupported;
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
		if (!this.#hasSource) return;
		this.#playRequested = true;
		if (this.#bootstrap === "parking") return;
		this.#takeOver();
		this.#post("play");
	}
	pause() {
		this.#playRequested = false;
		this.#post("pause");
	}
	get currentTime() {
		return this.#currentTime;
	}
	set currentTime(value) {
		if (this.#currentTime === value) return;
		if (this.#bootstrap !== "off") this.#parkPosition = value;
		this.#seeking = true;
		this.#currentTime = value;
		this.dispatchEvent(new Event("seeking"));
		this.dispatchEvent(new Event("timeupdate"));
		this.#afterLoad(() => {
			this.#post("seekTo", value);
			if (this.#bootstrap === "parked") this.#settleSeek();
		});
	}
	get duration() {
		return this.#duration;
	}
	get muted() {
		return this.#muted;
	}
	set muted(value) {
		if (this.#muted === value) return;
		this.#muted = value;
		this.#afterLoad(() => this.#post(value ? "mute" : "unMute"));
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
		if (!this.#loaded) this.#muted = value;
	}
	get loop() {
		return this.#loop;
	}
	set loop(value) {
		this.#loop = value;
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
	/** TikTok URL or id in `src`, player params under `engine.tiktok`. Re-derives `src`; equal sources skip reload. */
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		const engineChanged = !deepEqual(this.#source?.engine?.tiktok ?? null, source?.engine?.tiktok ?? null);
		this.#source = source;
		this.#src = src;
		if (srcChanged || engineChanged) this.load();
		this.dispatchEvent(new Event("sourcechange"));
	}
	get buffered() {
		return this.#currentTime > 0 ? createTimeRange(0, this.#currentTime) : EMPTY_TIME_RANGES;
	}
	get seekable() {
		return this.#duration > 0 && Number.isFinite(this.#duration) ? createTimeRange(0, this.#duration) : EMPTY_TIME_RANGES;
	}
	get error() {
		return this.#error;
	}
	/** Always empty: `closed_caption` is the embed's only say over captions. */
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
	#createPlayer() {
		const target = this.#target;
		if (!target) return false;
		const props = this.#snapshotProps();
		if (target.getAttribute("src")) {
			this.#bootstrap = shouldBootstrapTikTokEmbed(props) ? "parking" : "off";
			this.dispatchEvent(new Event("loadstart"));
			return true;
		}
		const initialSrc = buildTikTokIframeSrc(this.#src, props);
		if (!initialSrc) {
			this.#loadComplete.resolve();
			return false;
		}
		this.#bootstrap = shouldBootstrapTikTokEmbed(props) ? "parking" : "off";
		target.src = initialSrc;
		this.dispatchEvent(new Event("loadstart"));
		return true;
	}
	#listen(target) {
		const win = globalThis.window;
		if (isUndefined(win)) return;
		const attachId = this.#attachId;
		this.#messages = new AbortController();
		win.addEventListener("message", (event) => this.#onMessage(event, target, attachId), { signal: this.#messages.signal });
	}
	#onMessage(event, target, attachId) {
		if (this.#isStale(attachId)) return;
		const frame = target.contentWindow;
		if (!frame || event.source !== frame) return;
		const message = event.data;
		if (!isTikTokPlayerMessage(message)) return;
		if (this.#srcUnsupported) return;
		if (this.#hasSource) this.#onLoaded();
		switch (message.type) {
			case "onPlayerReady": break;
			case "onStateChange":
				if (isNumber(message.value)) this.#onStateChange(message.value);
				break;
			case "onCurrentTime":
				if (isTikTokCurrentTime(message.value)) this.#onCurrentTime(message.value.currentTime, message.value.duration);
				break;
			case "onVolumeChange": break;
			case "onMute":
				if (this.#bootstrap !== "off") break;
				this.#muted = !!message.value;
				this.dispatchEvent(new Event("volumechange"));
				break;
			case "onPlayerError":
				if (isTikTokPlayerError(message.value)) this.#onPlayerError(message.value);
				break;
			case "onError":
				this.#onError("TikTok player error; visit https://developers.tiktok.com/doc/embed-player for what the embed supports.", isMediaErrorCode(message.value) ? message.value : MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
				break;
			default: console.warn(`Unhandled TikTok player message: ${message.type}`);
		}
	}
	#isStale(attachId) {
		return attachId !== this.#attachId;
	}
	#afterLoad(fn) {
		this.#loadComplete.then(() => {
			if (!this.#target) return;
			tryCall(fn);
		}, () => {});
	}
	#post(type, value) {
		const frame = this.#target?.contentWindow;
		if (!frame) return;
		frame.postMessage(createTikTokPlayerCommand(type, value), "*");
	}
	get #nextMuted() {
		return this.#defaultMuted || this.#muted;
	}
	#snapshotProps() {
		return {
			autoplay: this.#autoplay,
			defaultMuted: this.#nextMuted,
			loop: this.#loop,
			controls: this.#controls,
			preload: this.#preload,
			source: this.#source
		};
	}
	#resetState() {
		this.#currentTime = 0;
		this.#duration = NaN;
		this.#muted = this.#nextMuted;
		this.#paused = !this.#autoplay;
		this.#ended = false;
		this.#readyState = READY_STATE_HAVE_NOTHING;
		this.#seeking = false;
		this.#loaded = false;
		this.#srcUnsupported = false;
		this.#playFired = false;
		this.#bootstrap = "off";
		this.#parkPosition = 0;
		this.#error = null;
		this.#isFullscreen = false;
	}
	#onLoaded() {
		if (this.#loaded) return;
		this.#loaded = true;
		this.#readyState = READY_STATE_HAVE_METADATA;
		if (this.#muted) this.#post("mute");
		if (this.#bootstrap === "parking") {
			this.#post("pause");
			this.#post("seekTo", this.#parkPosition);
		} else if (this.#playRequested) {
			this.#playRequested = false;
			this.#post("play");
		}
		for (const type of ["loadedmetadata", "loadcomplete"]) this.dispatchEvent(new Event(type));
		this.#loadComplete.resolve();
	}
	#park() {
		if (this.#bootstrap === "parked") return;
		this.#bootstrap = "parked";
		this.#currentTime = this.#parkPosition;
		this.#paused = true;
		this.#playFired = false;
		if (!this.#muted) this.#post("unMute");
		this.#settleSeek();
		if (this.#playRequested) {
			this.#playRequested = false;
			this.#takeOver();
			this.#post("play");
		}
	}
	#takeOver() {
		if (this.#bootstrap === "parked") this.#bootstrap = "off";
	}
	#settleSeek() {
		if (!this.#seeking) return;
		this.#seeking = false;
		this.dispatchEvent(new Event("seeked"));
	}
	#onPlayerError({ errorCode, errorType }) {
		if (errorCode === 3002) {
			console.warn("The TikTok embed refused to play: the browser blocked it. A cross-origin embed needs its own user activation, or a muted video, before it will start.");
			return;
		}
		const named = errorType ? ` (${errorType})` : "";
		this.#onError(`TikTok player error ${errorCode}${named}; visit https://developers.tiktok.com/doc/embed-player for what the embed supports.`, toMediaErrorCode(errorCode));
	}
	#onError(message, code) {
		this.#error = new MediaError(message, code);
		this.dispatchEvent(new Event("error"));
		this.#loadComplete.resolve();
	}
	#onStateChange(state) {
		const emit = (type) => this.dispatchEvent(new Event(type));
		if (this.#bootstrap !== "off") {
			if (state === 1 || state === 3) this.#post("pause");
			else if (state === 2 || state === 0) this.#park();
			return;
		}
		if (state === 1 || state === 3) {
			if (!this.#playFired) {
				this.#playFired = true;
				this.#paused = false;
				this.#ended = false;
				emit("play");
			}
		}
		if (state === 3) emit("waiting");
		else if (state === 1) {
			this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
			this.#paused = false;
			emit("playing");
		} else if (state === 2) {
			this.#playFired = false;
			this.#paused = true;
			emit("pause");
		} else if (state === 0) {
			this.#playFired = false;
			this.#paused = true;
			emit("pause");
			this.#ended = true;
			emit("ended");
			if (this.#loop) this.play();
		} else if (state === -1) {
			this.#playFired = false;
			this.#paused = true;
		}
	}
	#onCurrentTime(currentTime, duration) {
		if (this.#bootstrap === "off") {
			if (currentTime !== this.#currentTime) {
				this.#currentTime = currentTime;
				this.dispatchEvent(new Event("timeupdate"));
			}
			if (this.#seeking) {
				this.#seeking = false;
				this.dispatchEvent(new Event("seeked"));
			}
		}
		if (isNumber(duration) && duration > 0 && duration !== this.#duration) {
			this.#duration = duration;
			this.dispatchEvent(new Event("durationchange"));
		}
	}
};
/** Read a TikTok player error code as a `MediaError` one; TikTok groups codes by category, so the category is read. */
function toMediaErrorCode(errorCode) {
	if (errorCode >= 2e3 && errorCode < 3e3) return MediaError.MEDIA_ERR_NETWORK;
	if (errorCode >= 3e3 && errorCode < 4e3) return MediaError.MEDIA_ERR_DECODE;
	return MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
}
/** Whether a reported value is one of the codes a `MediaError` can carry. */
function isMediaErrorCode(value) {
	return isNumber(value) && value >= MediaError.MEDIA_ERR_ABORTED && value <= MediaError.MEDIA_ERR_ENCRYPTED;
}
const READY_STATE_HAVE_NOTHING = 0;
const READY_STATE_HAVE_METADATA = 1;
const READY_STATE_HAVE_FUTURE_DATA = 3;

//#endregion
//#region ../html/dist/dev/media/tiktok-video/adapter.js
var TikTokCustomMediaElement = class extends CustomMediaElement("iframe", TikTokAdapter) {
	static {
		this.getTemplateHTML = (attrs) => {
			const initialSrc = buildTikTokIframeSrc(attrs.src ?? "", templateAttrsToEmbedProps(attrs));
			return `
      <style>
        :host {
          display: inline-block;
          /* TikTok videos are portrait, and the player refuses to draw its chrome
             below 325x578, so that is where this host starts rather than the
             300x150 the landscape embeds use. */
          min-width: 325px;
          min-height: 578px;
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
           never sees the hover that reveals the controls. Kept out of hit-testing
           except where the host leaves TikTok's player dormant, which is the same
           pair of cases shouldBootstrapTikTokEmbed opts out of: then the frame's
           own controls are the only thing that can still start it. */
        :host(:not([controls]):not([preload="none"])) {
          pointer-events: none;
        }
      </style>
      <iframe
        part="iframe"
        title="TikTok video player"
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
		preload: attrs.preload
	};
}
var TikTokVideo = class extends MediaAttachMixin(TikTokCustomMediaElement) {};

//#endregion
//#region ../html/dist/dev/define/media/tiktok-video.js
var TikTokVideoElement = class extends TikTokVideo {
	static {
		this.tagName = "tiktok-video";
	}
};
safeDefine(TikTokVideoElement);

//#endregion
export { TikTokVideoElement };
//# sourceMappingURL=tiktok-video.dev.js.map