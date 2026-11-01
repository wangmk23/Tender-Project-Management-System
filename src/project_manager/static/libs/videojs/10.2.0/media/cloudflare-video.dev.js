/*! Video.js | https://videojs.org/help */
import { t as deepEqual } from "../deep-equal-mHeggeG2.js";
import { t as CustomMediaElement } from "../custom-media-element-CfmsPmjg.js";
import { a as escapeHtml } from "../attributes-CI6LN9fK.js";
import { t as loadScript } from "../script--drPGKYR.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as createPublicPromise, t as MediaPlayedRangesMixin } from "../media-played-ranges-B4JAhSRt.js";
import { t as tryCall } from "../try-call-CA5eo1yN.js";
import { n as EMPTY_TEXT_TRACKS, r as EMPTY_TIME_RANGES } from "../constants-CMPy89v9.js";
import { t as MediaError } from "../media-error-zO-Hg4un.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";
import { t as serializeEmbedParams } from "../embed-params-b1s4s7nw.js";
import { t as createTimeRange } from "../time-ranges-BRGzv3TE.js";

//#region ../media/dist/dev/core/source/cloudflare.js
/**
* Parse a Cloudflare Stream source string. Recognizes `videodelivery.net` and `cloudflarestream.com` URLs (embed,
* iframe, manifest, and thumbnail paths all carry the id in the same position), raw 32-character video UIDs, and signed
* tokens, which stand in for the UID wherever it appears.
*
* @internal
*/
function parseCloudflareSource(src) {
	if (!src) return null;
	const id = MATCH_SRC.exec(src)?.[1] ?? (MATCH_VIDEO_ID.test(src) || MATCH_SIGNED_TOKEN.test(src) ? src : null);
	if (!id) return null;
	return {
		id,
		signed: MATCH_SIGNED_TOKEN.test(id),
		origin: MATCH_CUSTOMER_ORIGIN.exec(src)?.[1] ?? null
	};
}
const MATCH_SRC = /(?:cloudflarestream\.com|videodelivery\.net)\/([\w-.]+)/i;
const MATCH_CUSTOMER_ORIGIN = /^(https?:\/\/customer-[\w-]+\.cloudflarestream\.com)/i;
const MATCH_VIDEO_ID = /^[a-z\d]{32}$/i;
const MATCH_SIGNED_TOKEN = /^[\w-]+\.[\w-]+\.[\w-]+$/;

//#endregion
//#region ../adapters/cloudflare-video/dist/dev/source.js
/**
* Build the iframe `src` URL for an initial Cloudflare Stream embed from the given props.
*
* @internal
*/
function buildCloudflareIframeSrc(src, props = {}) {
	const parsed = parseCloudflareSource(src);
	if (!parsed) return "";
	const { referrerPolicy: _referrerPolicy, ...cloudflare } = props.source?.engine?.cloudflare ?? {};
	const params = {
		controls: props.controls === true ? null : 0,
		autoplay: props.autoplay || null,
		loop: props.loop || null,
		muted: props.defaultMuted || null,
		preload: props.preload || "metadata",
		poster: props.poster || null,
		...cloudflare
	};
	return `${parsed.origin ? `${parsed.origin}/${parsed.id}/iframe` : `${EMBED_BASE}/${parsed.id}`}?${serializeEmbedParams(params)}`;
}
const EMBED_BASE = "https://iframe.videodelivery.net";

//#endregion
//#region ../adapters/cloudflare-video/dist/dev/stream-api.js
const API_URL = "https://embed.videodelivery.net/embed/sdk.latest.js";
/** Load the Stream SDK once, reusing it if another host already pulled it in. */
async function loadCloudflareStreamApi() {
	const existing = globalThis.Stream;
	if (existing) return existing;
	await loadScript(API_URL);
	const api = globalThis.Stream;
	if (!api) throw new Error("Cloudflare Stream SDK failed to load");
	return api;
}

//#endregion
//#region ../adapters/cloudflare-video/dist/dev/adapter.js
/**
* @fires sourcechange - Fired when `source` changes, either directly or by resolving a new `src`. Read `source` for the
*   new value.
*/
var CloudflareAdapter = class CloudflareAdapter extends MediaPlayedRangesMixin(EventTarget) {
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
	#player = null;
	#creatingPlayer = false;
	#pendingLoad = false;
	#loadComplete = createPublicPromise();
	#attachId = 0;
	#playerListeners = [];
	#src = CloudflareAdapter.defaultProps.src;
	#autoplay = CloudflareAdapter.defaultProps.autoplay;
	#defaultMuted = CloudflareAdapter.defaultProps.defaultMuted;
	#loop = CloudflareAdapter.defaultProps.loop;
	#controls = CloudflareAdapter.defaultProps.controls;
	#playsInline = CloudflareAdapter.defaultProps.playsInline;
	#preload = CloudflareAdapter.defaultProps.preload;
	#poster = CloudflareAdapter.defaultProps.poster;
	#source = CloudflareAdapter.defaultProps.source;
	#paused = true;
	#ended = false;
	#seeking = false;
	#loaded = false;
	#srcUnsupported = false;
	#currentTime = 0;
	#duration = NaN;
	#volume = 1;
	#muted = false;
	#playbackRate = 1;
	#progress = 0;
	#videoWidth = NaN;
	#videoHeight = NaN;
	#readyState = READY_STATE_HAVE_NOTHING;
	#error = null;
	#isFullscreen = false;
	#textTracksHost = null;
	static {
		this.PLAYER_SOFTWARE_NAME = "cloudflare-video";
	}
	/** Underlying Stream SDK player instance (null until the SDK loads). */
	get engine() {
		return this.#player;
	}
	get target() {
		return this.#target;
	}
	/** Bind the embed iframe. The SDK and player follow once an embed URL resolves, which may not be until `load()`. */
	attach(target) {
		if (!target || this.#target === target) return;
		if (this.#target) this.detach();
		this.#target = target;
		this.#beginLoad();
		this.#createPlayer();
	}
	detach() {
		if (!this.#target) return;
		this.#attachId++;
		this.#unbindPlayerEvents();
		this.#pauseEmbed();
		this.#player = null;
		this.#creatingPlayer = false;
		this.#pendingLoad = false;
		this.#textTracksHost = null;
		this.#target = null;
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
	/** Cloudflare URL, video UID, or signed token. Setting it re-derives `source`, carrying its embed parameters over. */
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
	/** Reload the current source through the Stream player; no-op until `attach()`. */
	async load() {
		if (!this.#player) {
			if (!this.#target) return;
			if (this.#creatingPlayer) {
				this.#pendingLoad = true;
				return;
			}
			const load = this.#beginLoad();
			this.#resetState();
			await Promise.resolve();
			if (load !== this.#loadComplete) return;
			this.#createPlayer();
			return;
		}
		const load = this.#beginLoad();
		this.#resetState();
		this.dispatchEvent(new Event("emptied"));
		if (!this.#src) {
			load.resolve();
			this.#pauseEmbed();
			return;
		}
		this.dispatchEvent(new Event("loadstart"));
		const parsed = parseCloudflareSource(this.#src);
		if (!parsed) {
			this.#srcUnsupported = true;
			this.#error = new MediaError(`Unrecognized Cloudflare Stream source: ${this.#src}`, MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
			this.dispatchEvent(new Event("error"));
			load.resolve();
			this.#pauseEmbed();
			return;
		}
		const target = this.#target;
		const nextSrc = buildCloudflareIframeSrc(this.#src, this.#snapshotProps());
		if (target && nextSrc && embedParamsOf(nextSrc) !== embedParamsOf(target.getAttribute("src") ?? "")) {
			target.src = nextSrc;
			return;
		}
		this.#player.src = parsed.id;
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
		await this.#loadComplete;
		if (!this.#hasSource) return;
		await this.#player?.play();
	}
	pause() {
		this.#player?.pause();
	}
	get currentTime() {
		return this.#currentTime;
	}
	set currentTime(value) {
		if (this.#currentTime === value) return;
		this.#currentTime = value;
		this.#afterLoad((p) => {
			p.currentTime = value;
		});
	}
	get duration() {
		return this.#duration;
	}
	get volume() {
		return this.#volume;
	}
	set volume(value) {
		if (this.#volume === value) return;
		this.#volume = value;
		this.#afterLoad((p) => {
			p.volume = value;
		});
	}
	get muted() {
		return this.#muted;
	}
	set muted(value) {
		if (this.#muted === value) return;
		this.#muted = value;
		this.#afterLoad((p) => {
			p.muted = value;
		});
	}
	get playbackRate() {
		return this.#playbackRate;
	}
	set playbackRate(value) {
		if (this.#playbackRate === value) return;
		this.#playbackRate = value;
		this.#afterLoad((p) => {
			p.playbackRate = value;
		});
	}
	get autoplay() {
		return this.#autoplay;
	}
	set autoplay(value) {
		this.#autoplay = value;
		this.#afterLoad((p) => {
			p.autoplay = value;
		});
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
		this.#afterLoad((p) => {
			p.loop = value;
		});
	}
	get controls() {
		return this.#controls;
	}
	set controls(value) {
		this.#controls = value;
		this.#afterLoad((p) => {
			p.controls = value;
		});
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
		this.#afterLoad((p) => {
			p.preload = value;
		});
	}
	get poster() {
		return this.#poster;
	}
	set poster(value) {
		this.#poster = value;
		this.#afterLoad((p) => {
			p.poster = value;
		});
	}
	/** Structured source: `src` plus embed parameters under `engine.cloudflare`. Replacing it re-derives `src`. */
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		const engineChanged = !deepEqual(this.#source?.engine?.cloudflare ?? null, source?.engine?.cloudflare ?? null);
		this.#source = source;
		this.#src = src;
		if (srcChanged || engineChanged) this.load();
		this.dispatchEvent(new Event("sourcechange"));
	}
	get buffered() {
		return this.#progress > 0 ? createTimeRange(0, this.#progress) : EMPTY_TIME_RANGES;
	}
	get seekable() {
		return this.#duration > 0 && Number.isFinite(this.#duration) ? createTimeRange(0, this.#duration) : EMPTY_TIME_RANGES;
	}
	get error() {
		return this.#error;
	}
	/** Always empty: the SDK exposes no track API, and the embed owns the track picked by `defaultTextTrack`. */
	get textTracks() {
		this.#textTracksHost ??= globalThis.document?.createElement("video") ?? null;
		return this.#textTracksHost?.textTracks ?? EMPTY_TEXT_TRACKS;
	}
	get videoWidth() {
		return this.#videoWidth;
	}
	get videoHeight() {
		return this.#videoHeight;
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
		if (!target || this.#player || this.#creatingPlayer) return false;
		let serverRendered = false;
		if (!target.getAttribute("src")) {
			const initialSrc = buildCloudflareIframeSrc(this.#src, this.#snapshotProps());
			if (!initialSrc) {
				this.#loadComplete.resolve();
				return false;
			}
			target.src = initialSrc;
		} else serverRendered = hasEmbedNavigated(target);
		this.#creatingPlayer = true;
		this.dispatchEvent(new Event("loadstart"));
		this.#createPlayerApi(target, serverRendered);
		return true;
	}
	async #createPlayerApi(target, serverRendered) {
		const attachId = this.#attachId;
		let api;
		try {
			api = await loadCloudflareStreamApi();
		} catch {
			if (this.#isStale(attachId)) return;
			this.#creatingPlayer = false;
			this.#error = new MediaError("Failed to load the Cloudflare Stream SDK", MediaError.MEDIA_ERR_NETWORK);
			this.dispatchEvent(new Event("error"));
			this.#loadComplete.resolve();
			return;
		}
		if (this.#isStale(attachId) || this.#target !== target) return;
		if (serverRendered) target.src = target.src;
		const player = api(target);
		this.#player = player;
		this.#creatingPlayer = false;
		this.#bindPlayerEvents(player, attachId);
		if (this.#pendingLoad) {
			this.#pendingLoad = false;
			this.load();
		}
	}
	#isStale(attachId) {
		return attachId !== this.#attachId;
	}
	#pauseEmbed() {
		tryCall(() => this.#player?.pause());
	}
	#afterLoad(fn) {
		this.#loadComplete.then(() => {
			const player = this.#player;
			if (player) tryCall(() => fn(player));
		}, () => {});
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
			preload: this.#preload || CloudflareAdapter.defaultProps.preload,
			poster: this.#poster,
			source: this.#source
		};
	}
	#resetState() {
		this.#currentTime = 0;
		this.#duration = NaN;
		this.#muted = this.#nextMuted;
		this.#paused = !this.#autoplay;
		this.#ended = false;
		this.#playbackRate = 1;
		this.#progress = 0;
		this.#readyState = READY_STATE_HAVE_NOTHING;
		this.#seeking = false;
		this.#loaded = false;
		this.#srcUnsupported = false;
		this.#volume = 1;
		this.#error = null;
		this.#videoWidth = NaN;
		this.#videoHeight = NaN;
		this.#isFullscreen = false;
	}
	#onLoaded() {
		if (this.#loaded) return;
		this.#loaded = true;
		this.#readyState = READY_STATE_HAVE_METADATA;
		const player = this.#player;
		if (player) {
			this.#duration = toDuration(player.duration);
			this.#muted = player.muted;
			this.#volume = player.volume;
			this.#playbackRate = player.playbackRate;
			this.#videoWidth = player.videoWidth;
			this.#videoHeight = player.videoHeight;
		}
		for (const type of [
			"loadedmetadata",
			"durationchange",
			"volumechange",
			"loadcomplete"
		]) this.dispatchEvent(new Event(type));
		this.#loadComplete.resolve();
	}
	#onError() {
		this.#error = new MediaError("Cloudflare Stream playback error", MediaError.MEDIA_ERR_CUSTOM, true);
		this.dispatchEvent(new Event("error"));
		this.#loadComplete.resolve();
	}
	#bindPlayerEvents(player, attachId) {
		const listen = (type, handle) => {
			const listener = () => {
				if (this.#isStale(attachId) || !this.#hasSource) return;
				handle();
			};
			player.addEventListener(type, listener);
			this.#playerListeners.push([type, listener]);
		};
		const on = (type, update) => listen(type, () => {
			update?.();
			this.dispatchEvent(new Event(type));
		});
		listen("loadedmetadata", () => this.#onLoaded());
		on("loadeddata", () => {
			this.#readyState = READY_STATE_HAVE_CURRENT_DATA;
		});
		on("play", () => {
			this.#paused = false;
			this.#ended = false;
		});
		on("playing", () => {
			this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
			this.#paused = false;
		});
		on("pause", () => {
			this.#paused = true;
		});
		on("ended", () => {
			this.#paused = true;
			this.#ended = true;
		});
		on("timeupdate", () => {
			this.#currentTime = player.currentTime;
		});
		on("durationchange", () => {
			this.#duration = toDuration(player.duration);
		});
		on("volumechange", () => {
			this.#volume = player.volume;
			this.#muted = player.muted;
		});
		on("ratechange", () => {
			this.#playbackRate = player.playbackRate;
		});
		on("progress", () => {
			this.#progress = toBufferedEnd(player);
		});
		on("seeking", () => {
			this.#seeking = true;
		});
		on("seeked", () => {
			this.#seeking = false;
			this.#currentTime = player.currentTime;
		});
		on("resize", () => {
			this.#videoWidth = player.videoWidth;
			this.#videoHeight = player.videoHeight;
		});
		for (const type of PASSTHROUGH_EVENTS) on(type);
		listen("error", () => this.#onError());
	}
	#unbindPlayerEvents() {
		for (const [type, listener] of this.#playerListeners) tryCall(() => this.#player?.removeEventListener(type, listener));
		this.#playerListeners.length = 0;
	}
};
const PASSTHROUGH_EVENTS = [
	"waiting",
	"stalled",
	"suspend",
	"abort",
	"canplay",
	"canplaythrough",
	"encrypted",
	"waitingforkey",
	"stream-adstart",
	"stream-adend",
	"stream-adtimeout"
];
/** The embed reports `0` until it knows the duration; `HTMLMediaElement` reports `NaN`. */
function toDuration(duration) {
	return duration > 0 ? duration : NaN;
}
function toBufferedEnd(player) {
	const { buffered } = player;
	return buffered?.length ? buffered.end(buffered.length - 1) : 0;
}
function embedParamsOf(src) {
	try {
		const url = new URL(src);
		return `${url.origin}${url.search}`;
	} catch {
		return "";
	}
}
function hasEmbedNavigated(target) {
	const frame = target.contentWindow;
	if (!frame) return false;
	try {
		return frame.location.href !== "about:blank";
	} catch {
		return true;
	}
}
const READY_STATE_HAVE_NOTHING = 0;
const READY_STATE_HAVE_METADATA = 1;
const READY_STATE_HAVE_CURRENT_DATA = 2;
const READY_STATE_HAVE_FUTURE_DATA = 3;

//#endregion
//#region ../html/dist/dev/media/cloudflare-video/adapter.js
var CloudflareCustomMediaElement = class extends CustomMediaElement("iframe", CloudflareAdapter) {
	static {
		this.getTemplateHTML = (attrs) => {
			const initialSrc = buildCloudflareIframeSrc(attrs.src ?? "", templateAttrsToEmbedProps(attrs));
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
        :host(:not([controls])) {
          pointer-events: none;
        }
      </style>
      <iframe
        part="iframe"
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
		preload: attrs.preload ?? "metadata",
		poster: attrs.poster ?? ""
	};
}
var CloudflareVideo = class extends MediaAttachMixin(CloudflareCustomMediaElement) {};

//#endregion
//#region ../html/dist/dev/define/media/cloudflare-video.js
var CloudflareVideoElement = class extends CloudflareVideo {
	static {
		this.tagName = "cloudflare-video";
	}
};
safeDefine(CloudflareVideoElement);

//#endregion
export { CloudflareVideoElement };
//# sourceMappingURL=cloudflare-video.dev.js.map