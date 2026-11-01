/*! Video.js | https://videojs.org/help */
import { s as isNumber } from "../predicate-3rF1m2uv.js";
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

//#region ../media/dist/dev/core/source/spotify.js
/**
* Parse a Spotify source string. Recognizes `open.spotify.com` URLs for every embeddable entity — including the
* localized (`/intl-de/`) and already-embedded (`/embed/`) forms, since the entity type and id sit in the same place in
* all of them — `spotify:<type>:<id>` URIs, and start positions via the `t` parameter.
*
* @internal
*/
function parseSpotifySource(src) {
	if (!src) return null;
	const match = MATCH_URI.exec(src) ?? MATCH_SRC.exec(src);
	const type = match?.[1]?.toLowerCase();
	const id = match?.[2];
	if (!type || !id) return null;
	return {
		type,
		id,
		startTime: parseStartTime(src)
	};
}
/** Parse the `t` parameter from a Spotify share URL. Spotify spells it in seconds. */
function parseStartTime(url) {
	const value = /[?&]t=(\d+)/.exec(url)?.[1];
	return value ? Number.parseInt(value, 10) : null;
}
const MATCH_SRC = /open\.spotify\.com\/(?:[\w-]+\/)*?(track|episode|album|playlist|show|artist)\/(\w+)/i;
const MATCH_URI = /^spotify:(track|episode|album|playlist|show|artist):(\w+)$/i;

//#endregion
//#region ../adapters/spotify-audio/dist/dev/source.js
/**
* Build the iframe `src` URL for an initial Spotify embed from the given props.
*
* @internal
*/
function buildSpotifyIframeSrc(src, props = {}) {
	const parsed = parseSpotifySource(src);
	if (!parsed) return "";
	const { preferVideo, referrerPolicy: _referrerPolicy, ...spotify } = props.source?.engine?.spotify ?? {};
	const params = {
		t: parsed.startTime,
		...spotify
	};
	const videoPath = preferVideo ? "/video" : "";
	const query = serializeEmbedParams(params);
	return `${EMBED_BASE}/embed/${parsed.type}/${parsed.id}${videoPath}${query ? `?${query}` : ""}`;
}
const EMBED_BASE = "https://open.spotify.com";

//#endregion
//#region ../adapters/spotify-audio/dist/dev/iframe-api.js
const API_URL = "https://open.spotify.com/embed/iframe-api/v1";
let apiPromise = null;
/** Load the iframe API once, reusing it if another host already pulled it in. */
function loadSpotifyIframeApi() {
	const globals = globalThis;
	const existing = globals.SpotifyIframeApi;
	if (existing) return Promise.resolve(existing);
	apiPromise ??= new Promise((resolve, reject) => {
		const hostReady = globals.onSpotifyIframeApiReady;
		globals.onSpotifyIframeApiReady = (api) => {
			resolve(api);
			hostReady?.(api);
		};
		loadScript(API_URL).catch(reject);
	}).catch((error) => {
		apiPromise = null;
		throw error;
	});
	return apiPromise;
}

//#endregion
//#region ../adapters/spotify-audio/dist/dev/adapter.js
/**
* @fires sourcechange - Fired when `source` changes, either directly or by resolving a new `src`. Read `source` for the
*   new value.
*/
var SpotifyAdapter = class SpotifyAdapter extends MediaPlayedRangesMixin(EventTarget) {
	static {
		this.defaultProps = {
			src: "",
			autoplay: false,
			loop: false,
			controls: false,
			playsInline: true,
			preload: "metadata",
			poster: "",
			source: null
		};
	}
	#target = null;
	#controller = null;
	#controllerReady = false;
	#pendingLoad = false;
	#creatingController = false;
	#loadComplete = createPublicPromise();
	#attachId = 0;
	#src = SpotifyAdapter.defaultProps.src;
	#autoplay = SpotifyAdapter.defaultProps.autoplay;
	#loop = SpotifyAdapter.defaultProps.loop;
	#controls = SpotifyAdapter.defaultProps.controls;
	#playsInline = SpotifyAdapter.defaultProps.playsInline;
	#preload = SpotifyAdapter.defaultProps.preload;
	#poster = SpotifyAdapter.defaultProps.poster;
	#source = SpotifyAdapter.defaultProps.source;
	#paused = true;
	#ended = false;
	#seeking = false;
	#loaded = false;
	#currentTime = 0;
	#duration = NaN;
	#readyState = READY_STATE_HAVE_NOTHING;
	#error = null;
	#waiting = false;
	#pauseRequested = false;
	#closeToEnded = false;
	static {
		this.PLAYER_SOFTWARE_NAME = "spotify-audio";
	}
	/** Underlying Spotify iframe API controller (null until the API loads). */
	get engine() {
		return this.#controller;
	}
	/** The iframe holding the embed, which everything from the embed URL down is written to. */
	get target() {
		return this.#target;
	}
	/** Bind the iframe hosting the embed; the API and controller follow as soon as an embed URL resolves. */
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
		tryCall(() => {
			if (this.#controller) {
				this.#controller.iframeElement = createControllerPlaceholderFrame();
				this.#controller.destroy();
			}
		});
		this.#controller = null;
		this.#controllerReady = false;
		this.#pendingLoad = false;
		this.#creatingController = false;
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
	/** Spotify URL or URI. Setting it re-derives `source`, carrying its embed options over. */
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
	/** Reload the current source via the iframe API; deferred until the controller is ready. */
	async load() {
		if (!this.#controller || !this.#controllerReady) {
			this.#pendingLoad = !!this.#target;
			if (this.#target && !this.#controller && !this.#creatingController) {
				const load = this.#beginLoad();
				await Promise.resolve();
				if (load !== this.#loadComplete) return;
				this.#createPlayer();
			}
			return;
		}
		const load = this.#beginLoad();
		this.#resetState();
		this.dispatchEvent(new Event("emptied"));
		if (!this.#src) {
			load.resolve();
			tryCall(() => this.#controller?.pause());
			return;
		}
		this.dispatchEvent(new Event("loadstart"));
		const parsed = parseSpotifySource(this.#src);
		if (!parsed) {
			this.#error = new MediaError(`Unrecognized Spotify source: ${this.#src}`, MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
			this.dispatchEvent(new Event("error"));
			load.resolve();
			return;
		}
		const target = this.#target;
		const embedSrc = buildSpotifyIframeSrc(this.#src, this.#snapshotProps());
		const embeddedSrc = target?.getAttribute("src") ?? "";
		const rebuild = embedOptionsOf(embedSrc) !== embedOptionsOf(embeddedSrc) || isVideoEmbed(embedSrc) && embedPathOf(embedSrc) !== embedPathOf(embeddedSrc);
		if (target && embedSrc && rebuild) {
			target.src = embedSrc;
			return;
		}
		this.#controller.loadUri(`spotify:${parsed.type}:${parsed.id}`);
		const startTime = this.#source?.engine?.spotify?.t ?? parsed.startTime;
		if (isNumber(startTime)) this.currentTime = startTime;
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
		await this.#loadComplete;
		if (!this.#src) return;
		this.#controller?.resume();
	}
	pause() {
		this.#pauseRequested = true;
		this.#controller?.pause();
	}
	get currentTime() {
		return this.#currentTime;
	}
	set currentTime(value) {
		if (this.#currentTime === value) return;
		this.#seeking = true;
		this.#closeToEnded = false;
		this.#ended = false;
		this.#currentTime = value;
		this.dispatchEvent(new Event("seeking"));
		this.dispatchEvent(new Event("timeupdate"));
		this.#afterLoad((controller) => controller.seek(value));
	}
	get duration() {
		return this.#duration;
	}
	get autoplay() {
		return this.#autoplay;
	}
	set autoplay(value) {
		this.#autoplay = value;
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
	/** Spotify URL or URI in `src`, plus embed options under `engine.spotify`. Replacing it re-derives `src`. */
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		const engineChanged = !deepEqual(this.#source?.engine?.spotify ?? null, source?.engine?.spotify ?? null);
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
	/** Always empty: the embed exposes no captions or other text tracks. */
	get textTracks() {
		return EMPTY_TEXT_TRACKS;
	}
	#createPlayer() {
		const target = this.#target;
		if (!target || this.#controller || this.#creatingController) return false;
		if (!target.getAttribute("src")) {
			const initialSrc = buildSpotifyIframeSrc(this.#src, this.#snapshotProps());
			if (!initialSrc) {
				this.#loadComplete.resolve();
				return false;
			}
			target.src = initialSrc;
		}
		this.#creatingController = true;
		this.dispatchEvent(new Event("loadstart"));
		this.#createControllerApi(target);
		return true;
	}
	async #createControllerApi(target) {
		const attachId = this.#attachId;
		let api;
		try {
			api = await loadSpotifyIframeApi();
		} catch {
			if (this.#isStale(attachId)) return;
			this.#creatingController = false;
			this.#error = new MediaError("Failed to load the Spotify iframe API", MediaError.MEDIA_ERR_NETWORK);
			this.dispatchEvent(new Event("error"));
			this.#loadComplete.resolve();
			return;
		}
		if (this.#isStale(attachId) || this.#target !== target) return;
		const { referrerPolicy: _referrerPolicy, ...options } = this.#source?.engine?.spotify ?? {};
		const controller = await new Promise((resolve) => api.createController(createControllerPlaceholder(), options, resolve));
		if (this.#isStale(attachId) || this.#target !== target) {
			tryCall(() => controller.destroy());
			return;
		}
		controller.iframeElement = target;
		this.#controller = controller;
		this.#creatingController = false;
		this.#bindControllerEvents(controller, attachId);
	}
	#isStale(attachId) {
		return attachId !== this.#attachId;
	}
	#afterLoad(fn) {
		this.#loadComplete.then(() => {
			const controller = this.#controller;
			if (controller) tryCall(() => fn(controller));
		}, () => {});
	}
	#snapshotProps() {
		return {
			autoplay: this.#autoplay,
			loop: this.#loop,
			controls: this.#controls,
			playsInline: this.#playsInline,
			preload: this.#preload || SpotifyAdapter.defaultProps.preload,
			source: this.#source
		};
	}
	#resetState() {
		this.#currentTime = 0;
		this.#duration = NaN;
		this.#paused = !this.#autoplay;
		this.#ended = false;
		this.#readyState = READY_STATE_HAVE_NOTHING;
		this.#seeking = false;
		this.#loaded = false;
		this.#waiting = false;
		this.#pauseRequested = false;
		this.#closeToEnded = false;
		this.#error = null;
	}
	#onControllerReady() {
		this.#controllerReady = true;
		if (this.#pendingLoad) {
			this.#pendingLoad = false;
			this.load();
			return;
		}
		this.#onLoaded();
	}
	#onLoaded() {
		if (this.#loaded) return;
		this.#loaded = true;
		this.#readyState = READY_STATE_HAVE_METADATA;
		for (const type of [
			"loadedmetadata",
			"durationchange",
			"loadcomplete"
		]) this.dispatchEvent(new Event(type));
		this.#loadComplete.resolve();
		if (this.#autoplay) this.play();
	}
	#bindControllerEvents(controller, attachId) {
		controller.addListener("ready", () => {
			if (this.#isStale(attachId)) return;
			this.#onControllerReady();
		});
		controller.addListener("playback_update", (event) => {
			if (this.#isStale(attachId)) return;
			this.#onPlaybackUpdate(event.data);
		});
	}
	#onPlaybackUpdate(data) {
		if (!this.#src) return;
		if (!this.#loaded) this.#onLoaded();
		if (this.#restartFromEnd(data)) return;
		this.#syncDuration(data.duration);
		this.#syncPosition(data.position);
		if (this.#syncPlayState(data)) return;
		this.#checkEnded();
	}
	#isStarting(data) {
		return data.isBuffering || !data.isPaused;
	}
	#restartFromEnd(data) {
		if (!this.#closeToEnded || !this.#paused || !this.#isStarting(data)) return false;
		this.#closeToEnded = false;
		this.currentTime = REPLAY_POSITION;
		return true;
	}
	#syncDuration(duration) {
		const seconds = duration / 1e3;
		if (seconds === this.#duration) return;
		this.#closeToEnded = false;
		this.#duration = seconds;
		this.dispatchEvent(new Event("durationchange"));
	}
	#syncPosition(position) {
		const seconds = position / 1e3;
		if (this.#seeking) {
			if (seconds < Math.floor(this.#currentTime) || seconds > this.#currentTime + SNAPSHOT_INTERVAL) return;
			this.#seeking = false;
			this.dispatchEvent(new Event("seeked"));
		}
		if (seconds === this.#currentTime) return;
		if (Math.ceil(seconds) < this.#duration) {
			this.#closeToEnded = false;
			this.#ended = false;
		}
		this.#currentTime = seconds;
		this.dispatchEvent(new Event("timeupdate"));
	}
	#syncPlayState(data) {
		if (!this.#paused && data.isPaused) {
			if (data.isBuffering && !this.#pauseRequested) {
				if (this.#waiting) return false;
				this.#waiting = true;
				this.dispatchEvent(new Event("waiting"));
				return true;
			}
			this.#pauseRequested = false;
			this.#waiting = false;
			this.#paused = true;
			this.dispatchEvent(new Event("pause"));
			return true;
		}
		if (this.#paused && this.#isStarting(data)) {
			this.#pauseRequested = false;
			this.#paused = false;
			this.#ended = false;
			this.dispatchEvent(new Event("play"));
			this.#waiting = data.isBuffering;
			if (!this.#waiting) this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
			this.dispatchEvent(new Event(this.#waiting ? "waiting" : "playing"));
			return true;
		}
		if (this.#waiting && !data.isPaused) {
			this.#waiting = false;
			this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
			this.dispatchEvent(new Event("playing"));
			return true;
		}
		return false;
	}
	#checkEnded() {
		if (this.#paused || this.#seeking || this.#closeToEnded) return;
		if (!(this.#duration > 0) || !Number.isFinite(this.#duration)) return;
		if (Math.ceil(this.#currentTime) < this.#duration) return;
		this.#closeToEnded = true;
		if (this.#loop) {
			this.currentTime = REPLAY_POSITION;
			return;
		}
		this.#paused = true;
		this.#ended = true;
		this.pause();
		this.dispatchEvent(new Event("pause"));
		this.dispatchEvent(new Event("ended"));
	}
};
function createControllerPlaceholder() {
	return globalThis.document.createElement("div");
}
function createControllerPlaceholderFrame() {
	return globalThis.document.createElement("iframe");
}
function embedOptionsOf(src) {
	const [, query] = src.split("?");
	const params = new URLSearchParams(query);
	params.delete("t");
	params.sort();
	return `${isVideoEmbed(src) ? "video" : "audio"}?${params}`;
}
function embedPathOf(src) {
	return src.split("?")[0] ?? "";
}
function isVideoEmbed(src) {
	return embedPathOf(src).endsWith("/video");
}
const READY_STATE_HAVE_NOTHING = 0;
const READY_STATE_HAVE_METADATA = 1;
const READY_STATE_HAVE_FUTURE_DATA = 3;
const REPLAY_POSITION = 1;
const SNAPSHOT_INTERVAL = 1;

//#endregion
//#region ../html/dist/dev/media/spotify-audio/adapter.js
var SpotifyCustomMediaElement = class extends CustomMediaElement("iframe", SpotifyAdapter) {
	static {
		this.getTemplateHTML = (attrs) => {
			const initialSrc = buildSpotifyIframeSrc(attrs.src ?? "", templateAttrsToEmbedProps(attrs));
			return `
      <style>
        :host {
          display: block;
          min-width: 160px;
          min-height: 80px;
          position: relative;
        }
        iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
        }
        /*
         * Without Spotify's own chrome the embed is a transport and nothing else:
         * its player UI would otherwise show through whatever skin is drawn over
         * it. Hidden rather than merely inert, and important so a consumer's own
         * display rule cannot put it back on screen. An iframe in a hidden subtree
         * still loads and plays its src.
         */
        :host(:not([controls])) {
          display: none !important;
        }
      </style>
      <iframe
        part="iframe"
        ${initialSrc ? ` src="${escapeHtml(initialSrc)}"` : ""}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
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
		loop: attrs.loop !== void 0,
		controls: attrs.controls !== void 0,
		playsInline: attrs.playsinline !== void 0,
		preload: attrs.preload ?? "metadata"
	};
}
var SpotifyAudio = class extends MediaAttachMixin(SpotifyCustomMediaElement) {};

//#endregion
//#region ../html/dist/dev/define/media/spotify-audio.js
var SpotifyAudioElement = class extends SpotifyAudio {
	static {
		this.tagName = "spotify-audio";
	}
};
safeDefine(SpotifyAudioElement);

//#endregion
export { SpotifyAudioElement };
//# sourceMappingURL=spotify-audio.dev.js.map