/*! Video.js | https://videojs.org/help */
import { a as isNil, c as isObject, d as isString, f as isUndefined, s as isNumber } from "../predicate-3rF1m2uv.js";
import { t as deepEqual } from "../deep-equal-mHeggeG2.js";
import { t as CustomMediaElement } from "../custom-media-element-CfmsPmjg.js";
import { a as escapeHtml } from "../attributes-CI6LN9fK.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as createPublicPromise, t as MediaPlayedRangesMixin } from "../media-played-ranges-B4JAhSRt.js";
import { n as EMPTY_TEXT_TRACKS, r as EMPTY_TIME_RANGES } from "../constants-CMPy89v9.js";
import { t as MediaError } from "../media-error-zO-Hg4un.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";
import { t as createTimeRange } from "../time-ranges-BRGzv3TE.js";

//#region ../media/dist/dev/core/source/twitch.js
/**
* Parse a Twitch source string. Recognizes VOD URLs (`twitch.tv/videos/<id>` and `twitch.tv/?video=<id>`) and channel
* URLs (`twitch.tv/<channel>`), with or without the `www.` and `go.` hosts, and with or without a trailing slash.
*
* @internal
*/
function parseTwitchSource(src) {
	if (!src) return null;
	const videoId = MATCH_VIDEO.exec(src)?.[1];
	if (videoId) return {
		kind: "video",
		id: videoId,
		channel: null
	};
	const channel = MATCH_CHANNEL.exec(src)?.[1];
	if (channel) return {
		kind: "channel",
		id: null,
		channel
	};
	return null;
}
const MATCH_VIDEO = /(?:^|\/\/)(?:www\.|go\.)?twitch\.tv\/(?:videos?\/|\?video=)(\d+)\/?(?:$|\?)/;
const MATCH_CHANNEL = /(?:^|\/\/)(?:www\.|go\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/?(?:$|\?)/;

//#endregion
//#region ../adapters/twitch-video/dist/dev/player-api.js
/** Embed origin: where the embed is served from and where commands are posted. */
const TWITCH_PLAYER_ORIGIN = "https://player.twitch.tv";
/** Namespace on the commands the host posts, and on the state snapshots that come back. */
const PLAYER_PROXY_NAMESPACE = "twitch-embed-player-proxy";
const PLAYBACK_ENDED = "Ended";
/** Narrow a `message` payload to something the embed sent; any page can post here, so the namespace is the filter. */
function isTwitchMessage(data) {
	if (!isObject(data)) return false;
	const { namespace, eventName } = data;
	return isString(eventName) && (namespace === "twitch-embed" || namespace === "twitch-embed-player-proxy");
}

//#endregion
//#region ../adapters/twitch-video/dist/dev/source.js
/**
* Build the iframe `src` URL for an initial Twitch embed from the given props.
*
* @internal
*/
function buildTwitchIframeSrc(src, props = {}) {
	const parsed = parseTwitchSource(src);
	if (!parsed) return "";
	const { parent, referrerPolicy: _referrerPolicy, ...twitch } = props.source?.engine?.twitch ?? {};
	const params = {
		...parsed.kind === "video" ? { video: `v${parsed.id}` } : { channel: parsed.channel },
		controls: props.controls === true ? null : false,
		autoplay: props.autoplay === true ? null : false,
		muted: props.defaultMuted ?? false,
		preload: props.preload ?? "metadata",
		...twitch
	};
	const query = new URLSearchParams();
	for (const key in params) {
		const value = params[key];
		if (isNil(value) || value === "") continue;
		query.set(key, String(value));
	}
	for (const host of resolveParentHosts(parent)) query.append("parent", host);
	if (!query.has("parent")) console.warn("[vjs-twitch] The Twitch embed refuses to play without a `parent` hostname. Set `engine.twitch.parent` to the host page.");
	return `${TWITCH_PLAYER_ORIGIN}/?${query.toString()}`;
}
/** The configured parent hostnames plus the page's own, deduplicated. */
function resolveParentHosts(parent) {
	const hosts = [...isString(parent) ? [parent] : parent ?? [], globalThis.location?.hostname];
	return [...new Set(hosts.filter((host) => isString(host) && host !== ""))];
}

//#endregion
//#region ../adapters/twitch-video/dist/dev/adapter.js
/**
* @fires sourcechange - Fired when `source` changes, either directly or by resolving a new `src`. Read `source` for the
*   new value.
*/
var TwitchAdapter = class TwitchAdapter extends MediaPlayedRangesMixin(EventTarget) {
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
	#messages = null;
	#playerReady = false;
	#pendingLoad = false;
	#rebuilding = false;
	#loadComplete = createPublicPromise();
	#attachId = 0;
	#embedSrc = "";
	#src = TwitchAdapter.defaultProps.src;
	#autoplay = TwitchAdapter.defaultProps.autoplay;
	#defaultMuted = TwitchAdapter.defaultProps.defaultMuted;
	#loop = TwitchAdapter.defaultProps.loop;
	#controls = TwitchAdapter.defaultProps.controls;
	#playsInline = TwitchAdapter.defaultProps.playsInline;
	#preload = TwitchAdapter.defaultProps.preload;
	#poster = TwitchAdapter.defaultProps.poster;
	#source = TwitchAdapter.defaultProps.source;
	#kind = null;
	#playback = null;
	#paused = true;
	#seeking = false;
	#loaded = false;
	#currentTime = 0;
	#duration = NaN;
	#volume = 1;
	#muted = false;
	#playbackRate = 1;
	#progress = 0;
	#readyState = READY_STATE_HAVE_NOTHING;
	#error = null;
	#isFullscreen = false;
	static {
		this.PLAYER_SOFTWARE_NAME = "twitch-video";
	}
	/** The embed's own window, which every command is posted to. Null until an embed is bound and in a document. */
	get engine() {
		return this.#messages ? this.#target?.contentWindow ?? null : null;
	}
	get target() {
		return this.#target;
	}
	/** Bind the iframe hosting the embed. The embed follows once a URL resolves; `load()` retries if none does yet. */
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
		this.#messages?.abort();
		this.#messages = null;
		this.#playerReady = false;
		this.#pendingLoad = false;
		this.#rebuilding = false;
		this.#embedSrc = "";
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
	/** Twitch VOD or channel URL. Setting it re-derives `source`, carrying its embed parameters over. */
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
	/** Reload the current source, swapping it into the running embed where possible. */
	async load() {
		if (!this.#messages || !this.#playerReady) {
			this.#pendingLoad = !!this.#target;
			if (this.#target && !this.#messages) {
				const load = this.#beginLoad();
				await Promise.resolve();
				if (load !== this.#loadComplete) return;
				this.#pendingLoad = false;
				this.#createPlayer();
			}
			return;
		}
		const load = this.#beginLoad();
		this.#resetState();
		this.dispatchEvent(new Event("emptied"));
		if (!this.#src) {
			load.resolve();
			this.#sendCommand(2);
			return;
		}
		this.dispatchEvent(new Event("loadstart"));
		const parsed = parseTwitchSource(this.#src);
		if (!parsed) {
			this.#error = new MediaError(`Unrecognized Twitch source: ${this.#src}`, MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
			this.dispatchEvent(new Event("error"));
			load.resolve();
			return;
		}
		this.#kind = parsed.kind;
		const nextEmbedSrc = buildTwitchIframeSrc(this.#src, this.#snapshotProps());
		if (isContentOnlyChange(this.#embedSrc, nextEmbedSrc)) {
			this.#embedSrc = nextEmbedSrc;
			if (parsed.kind === "video") this.#sendCommand(9, `v${parsed.id}`);
			else this.#sendCommand(5, parsed.channel);
			return;
		}
		this.#embedSrc = nextEmbedSrc;
		this.#playerReady = false;
		this.#rebuilding = true;
		if (this.#target) this.#target.src = nextEmbedSrc;
	}
	#beginLoad() {
		this.#loadComplete.resolve();
		this.#loadComplete = createPublicPromise();
		return this.#loadComplete;
	}
	get paused() {
		if (!this.#playback) return this.#paused;
		return this.#playback !== "Playing" && this.#playback !== "Buffering";
	}
	get ended() {
		if (this.#kind === "channel") return false;
		return this.#playback === PLAYBACK_ENDED;
	}
	get seeking() {
		return this.#seeking;
	}
	async play() {
		await this.#loadComplete;
		if (!this.#src) return;
		this.#paused = false;
		this.#sendCommand(3);
	}
	pause() {
		this.#paused = true;
		this.#sendCommand(2);
	}
	get currentTime() {
		return this.#currentTime;
	}
	set currentTime(value) {
		if (this.#currentTime === value) return;
		this.#currentTime = value;
		this.#afterLoad(() => this.#sendCommand(4, value));
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
		this.dispatchEvent(new Event("volumechange"));
		this.#afterLoad(() => this.#sendCommand(11, value));
	}
	get muted() {
		return this.#muted;
	}
	set muted(value) {
		if (this.#muted === value) return;
		this.#muted = value;
		this.dispatchEvent(new Event("volumechange"));
		this.#afterLoad(() => this.#sendCommand(10, value));
	}
	get playbackRate() {
		return this.#playbackRate;
	}
	set playbackRate(value) {
		this.#playbackRate = value;
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
	/** Twitch VOD or channel URL in `src`, plus embed parameters under `engine.twitch`. Replacing it re-derives `src`. */
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		const engineChanged = !deepEqual(this.#source?.engine?.twitch ?? null, source?.engine?.twitch ?? null);
		this.#source = source;
		this.#src = src;
		if (srcChanged || engineChanged) this.load();
		this.dispatchEvent(new Event("sourcechange"));
	}
	get buffered() {
		return this.#progress > 0 ? createTimeRange(this.#currentTime, this.#currentTime + this.#progress) : EMPTY_TIME_RANGES;
	}
	get seekable() {
		return this.#duration > 0 && Number.isFinite(this.#duration) ? createTimeRange(0, this.#duration) : EMPTY_TIME_RANGES;
	}
	get error() {
		return this.#error;
	}
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
		if (!target || this.#messages) return false;
		const existingSrc = target.getAttribute("src");
		if (!existingSrc) {
			const initialSrc = buildTwitchIframeSrc(this.#src, this.#snapshotProps());
			if (!initialSrc) {
				this.#loadComplete.resolve();
				return false;
			}
			target.src = initialSrc;
		} else {
			const withParent = withPageParent(existingSrc);
			if (withParent !== existingSrc) target.src = withParent;
		}
		this.#kind = parseTwitchSource(this.#src)?.kind ?? null;
		this.#embedSrc = target.getAttribute("src") ?? "";
		const attachId = this.#attachId;
		this.#messages = new AbortController();
		globalThis.addEventListener("message", (event) => void this.#onMessage(event, attachId), { signal: this.#messages.signal });
		this.dispatchEvent(new Event("loadstart"));
		return true;
	}
	#isStale(attachId) {
		return attachId !== this.#attachId;
	}
	#afterLoad(fn) {
		this.#loadComplete.then(() => {
			if (!this.#messages) return;
			fn();
		}, () => {});
	}
	#sendCommand(command, params) {
		const embedWindow = this.#target?.contentWindow;
		if (!embedWindow) return;
		const message = {
			namespace: PLAYER_PROXY_NAMESPACE,
			eventName: command,
			params
		};
		embedWindow.postMessage(message, TWITCH_PLAYER_ORIGIN);
	}
	#snapshotProps() {
		return {
			autoplay: this.#autoplay,
			defaultMuted: this.#defaultMuted,
			loop: this.#loop,
			controls: this.#controls,
			playsInline: this.#playsInline,
			preload: this.#preload || TwitchAdapter.defaultProps.preload,
			source: this.#source
		};
	}
	#resetState() {
		this.#kind = null;
		this.#playback = null;
		this.#currentTime = 0;
		this.#duration = NaN;
		this.#muted = false;
		this.#paused = !this.#autoplay;
		this.#playbackRate = 1;
		this.#progress = 0;
		this.#readyState = READY_STATE_HAVE_NOTHING;
		this.#seeking = false;
		this.#loaded = false;
		this.#volume = 1;
		this.#error = null;
		this.#isFullscreen = false;
	}
	async #onMessage(event, attachId) {
		if (this.#isStale(attachId)) return;
		const embedWindow = this.#target?.contentWindow;
		if (!embedWindow || event.source !== embedWindow) return;
		const { data } = event;
		if (!isTwitchMessage(data)) return;
		if (data.namespace === "twitch-embed") {
			await new Promise((resolve) => setTimeout(resolve, STATE_SETTLE_MS));
			if (this.#isStale(attachId)) return;
			this.#onEmbedEvent(data.eventName);
			return;
		}
		if (data.eventName === "UPDATE_STATE") this.#onUpdateState(data.params ?? {});
	}
	#onEmbedEvent(eventName) {
		if (eventName !== "ready" && !this.#src) return;
		switch (eventName) {
			case "ready":
				this.#playerReady = true;
				this.#rebuilding = false;
				if (this.#pendingLoad) {
					this.#pendingLoad = false;
					this.load();
					return;
				}
				this.#onLoaded();
				return;
			case "seek":
				this.#seeking = true;
				this.dispatchEvent(new Event("seeking"));
				return;
			case "playing":
				if (this.#seeking) {
					this.#seeking = false;
					this.dispatchEvent(new Event("seeked"));
				}
				this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
				this.dispatchEvent(new Event("playing"));
				return;
			case "ended":
				this.dispatchEvent(new Event("ended"));
				if (this.#loop) {
					this.currentTime = 0;
					this.play();
				}
				return;
			default: this.dispatchEvent(new Event(eventName));
		}
	}
	#onUpdateState(state) {
		if (this.#rebuilding) return;
		if (!this.#src) return;
		if (this.#playerReady && !this.#loaded) this.#onLoaded();
		if (state.playback && state.playback !== this.#playback) {
			if (state.playback === "Buffering") this.dispatchEvent(new Event("waiting"));
			this.#playback = state.playback;
		}
		if (this.#kind !== "channel" && isNumber(state.duration) && state.duration !== this.#duration) {
			this.#duration = state.duration;
			this.dispatchEvent(new Event("durationchange"));
		}
		if (isNumber(state.currentTime) && state.currentTime !== this.#currentTime) {
			this.#currentTime = state.currentTime;
			this.dispatchEvent(new Event("timeupdate"));
		}
		const volumeChanged = isNumber(state.volume) && state.volume !== this.#volume;
		const mutedChanged = !isUndefined(state.muted) && state.muted !== this.#muted;
		if (volumeChanged || mutedChanged) {
			if (isNumber(state.volume)) this.#volume = state.volume;
			if (!isUndefined(state.muted)) this.#muted = state.muted;
			this.dispatchEvent(new Event("volumechange"));
		}
		const bufferSize = state.stats?.videoStats?.bufferSize;
		if (isNumber(bufferSize) && bufferSize !== this.#progress) {
			this.#progress = bufferSize;
			if (this.#readyState >= READY_STATE_HAVE_FUTURE_DATA && bufferSize > 0) this.#readyState = READY_STATE_HAVE_ENOUGH_DATA;
			this.dispatchEvent(new Event("progress"));
		}
	}
	#onLoaded() {
		if (this.#loaded) return;
		this.#loaded = true;
		this.#readyState = READY_STATE_HAVE_METADATA;
		this.dispatchEvent(new Event("loadedmetadata"));
		if (this.#kind === "channel") {
			this.#duration = Number.POSITIVE_INFINITY;
			this.dispatchEvent(new Event("durationchange"));
		}
		this.dispatchEvent(new Event("loadcomplete"));
		this.#loadComplete.resolve();
	}
};
function isContentOnlyChange(current, next) {
	const currentBase = withoutContent(current);
	const nextBase = withoutContent(next);
	return currentBase !== null && currentBase === nextBase;
}
function withPageParent(embedSrc) {
	const hostname = globalThis.location?.hostname;
	if (!hostname) return embedSrc;
	let url;
	try {
		url = new URL(embedSrc);
	} catch {
		return embedSrc;
	}
	if (url.origin !== "https://player.twitch.tv") return embedSrc;
	if (url.searchParams.getAll("parent").includes(hostname)) return embedSrc;
	url.searchParams.append("parent", hostname);
	return url.toString();
}
function withoutContent(embedSrc) {
	if (!embedSrc) return null;
	try {
		const url = new URL(embedSrc);
		url.searchParams.delete("video");
		url.searchParams.delete("channel");
		return url.toString();
	} catch {
		return null;
	}
}
const STATE_SETTLE_MS = 10;
const READY_STATE_HAVE_NOTHING = 0;
const READY_STATE_HAVE_METADATA = 1;
const READY_STATE_HAVE_FUTURE_DATA = 3;
const READY_STATE_HAVE_ENOUGH_DATA = 4;

//#endregion
//#region ../html/dist/dev/media/twitch-video/adapter.js
var TwitchCustomMediaElement = class extends CustomMediaElement("iframe", TwitchAdapter) {
	static {
		this.getTemplateHTML = (attrs) => {
			const initialSrc = buildTwitchIframeSrc(attrs.src ?? "", templateAttrsToEmbedProps(attrs));
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
        allow="accelerometer; fullscreen; autoplay; encrypted-media; picture-in-picture;"
        sandbox="allow-modals allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        scrolling="no"
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
		playsInline: attrs.playsinline !== void 0,
		preload: attrs.preload ?? "metadata"
	};
}
var TwitchVideo = class extends MediaAttachMixin(TwitchCustomMediaElement) {};

//#endregion
//#region ../html/dist/dev/define/media/twitch-video.js
var TwitchVideoElement = class extends TwitchVideo {
	static {
		this.tagName = "twitch-video";
	}
};
safeDefine(TwitchVideoElement);

//#endregion
export { TwitchVideoElement };
//# sourceMappingURL=twitch-video.dev.js.map