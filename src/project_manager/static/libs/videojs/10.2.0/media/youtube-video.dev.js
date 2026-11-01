/*! Video.js | https://videojs.org/help */
import { c as isObject, s as isNumber } from "../predicate-3rF1m2uv.js";
import { t as deepEqual } from "../deep-equal-mHeggeG2.js";
import { t as CustomMediaElement } from "../custom-media-element-CfmsPmjg.js";
import { a as escapeHtml } from "../attributes-CI6LN9fK.js";
import { t as noop } from "../noop-DBLxABor.js";
import { t as loadScript } from "../script--drPGKYR.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { n as createPublicPromise, t as MediaPlayedRangesMixin } from "../media-played-ranges-B4JAhSRt.js";
import { t as tryCall } from "../try-call-CA5eo1yN.js";
import { r as EMPTY_TIME_RANGES } from "../constants-CMPy89v9.js";
import { t as MediaError } from "../media-error-zO-Hg4un.js";
import { t as MediaAttachMixin } from "../media-attach-mixin-yt2XYok0.js";
import { t as serializeEmbedParams } from "../embed-params-b1s4s7nw.js";
import { t as createTimeRange } from "../time-ranges-BRGzv3TE.js";

//#region ../media/dist/dev/core/source/youtube.js
/**
* Parse a YouTube source string. Recognizes raw 11-character ids, `youtube/<id>` and `youtube/shorts/<id>` shorthands,
* `youtu.be` short links, `watch?v=`, `embed/`, `v/`, `shorts/` and `live/` URLs (with or without the `-nocookie`
* host), playlist URLs via the `list` parameter, and start times via the `t` parameter.
*
* @internal
*/
function parseYouTubeSource(src) {
	if (!src) return null;
	if (/^[\w-]{11}$/.test(src)) return {
		id: src,
		kind: "video",
		listId: null,
		startTime: null,
		noCookie: false
	};
	const shorthandId = SHORTHAND_SRC.exec(src)?.[1];
	if (shorthandId) return {
		id: shorthandId,
		kind: "video",
		listId: null,
		startTime: null,
		noCookie: true
	};
	const noCookie = src.includes("-nocookie");
	const videoMatch = VIDEO_MATCH_SRC.exec(src);
	const listMatch = PLAYLIST_MATCH_SRC.exec(src);
	const videoId = videoMatch?.[1] ?? null;
	const id = videoId === "videoseries" ? null : videoId;
	if (!id && !listMatch) return null;
	return {
		id,
		kind: id ? "video" : "playlist",
		listId: listMatch?.[1] ?? null,
		startTime: parseStartTime(src),
		noCookie
	};
}
/**
* Parse the `t` parameter from a YouTube URL and convert it to seconds. Supports formats like: `t=171`, `t=171s`,
* `t=2m51s`, `t=2m`, `t=1h30m15s`.
*/
function parseStartTime(url) {
	const tValue = /[?&]t=([\dhms]+)/i.exec(url)?.[1]?.toLowerCase();
	if (!tValue) return null;
	let totalSeconds = 0;
	let hasValue = false;
	const hours = /(\d+)h/.exec(tValue)?.[1];
	if (hours) {
		totalSeconds += Number.parseInt(hours, 10) * 3600;
		hasValue = true;
	}
	const minutes = /(\d+)m/.exec(tValue)?.[1];
	if (minutes) {
		totalSeconds += Number.parseInt(minutes, 10) * 60;
		hasValue = true;
	}
	const seconds = /(\d+)s?$/.exec(tValue)?.[1];
	if (seconds) {
		totalSeconds += Number.parseInt(seconds, 10);
		hasValue = true;
	}
	return hasValue ? totalSeconds : null;
}
const SHORTHAND_SRC = /^youtube\/(?:shorts\/)?([\w-]{11})$/;
const VIDEO_MATCH_SRC = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))((?:\w|-){11})/;
const PLAYLIST_MATCH_SRC = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/.*?[?&]list=)([\w-]+)/;

//#endregion
//#region ../adapters/youtube-video/dist/dev/source.js
/**
* Build the iframe `src` URL for an initial YouTube embed from the given props.
*
* @internal
*/
function buildYouTubeIframeSrc(src, props = {}) {
	const parsed = parseYouTubeSource(src);
	if (!parsed) return "";
	const embedBase = parsed.noCookie ? EMBED_BASE_NOCOOKIE : EMBED_BASE;
	const params = {
		controls: props.controls === true ? null : 0,
		autoplay: props.autoplay,
		loop: props.loop,
		mute: props.defaultMuted,
		playsinline: props.playsInline ?? true,
		preload: props.preload ?? "metadata",
		enablejsapi: 1,
		rel: 0,
		iv_load_policy: 3,
		start: parsed.startTime,
		...props.source?.engine?.youtube ?? void 0
	};
	if (parsed.kind === "playlist" && parsed.listId) return `${embedBase}?${serializeEmbedParams({
		listType: "playlist",
		list: parsed.listId,
		...params
	})}`;
	return `${embedBase}/${parsed.id}?${serializeEmbedParams(params)}`;
}
const EMBED_BASE = "https://www.youtube.com/embed";
const EMBED_BASE_NOCOOKIE = "https://www.youtube-nocookie.com/embed";

//#endregion
//#region ../adapters/youtube-video/dist/dev/iframe-api.js
const API_URL = "https://www.youtube.com/iframe_api";
/** Load the iframe API once, reusing it if another host already pulled it in. */
async function loadYouTubeApi() {
	const existing = globalThis.YT;
	if (existing?.Player) return existing;
	await loadScript(API_URL);
	const api = globalThis.YT;
	if (!api) throw new Error("YouTube iframe API failed to load");
	await new Promise((resolve) => api.ready(resolve));
	return api;
}
const youtubeErrorCodeToMediaErrorCode = {
	2: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED,
	5: MediaError.MEDIA_ERR_DECODE,
	100: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED,
	101: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED,
	150: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
};

//#endregion
//#region ../adapters/youtube-video/dist/dev/text-tracks.js
var TextTrackEvent = class extends Event {
	constructor(type, track) {
		super(type);
		this.track = track;
	}
};
/** A caption track the embed reports. YouTube renders its cues inside the iframe, so none are exposed here. */
var YouTubeTextTrack = class {
	#mode;
	#onModeChange;
	constructor(label, language, onModeChange) {
		this.id = "";
		this.kind = "subtitles";
		this.cues = null;
		this.#mode = "disabled";
		this.label = label;
		this.language = language;
		this.#onModeChange = onModeChange;
	}
	get mode() {
		return this.#mode;
	}
	set mode(value) {
		if (this.#mode === value) return;
		this.#mode = value;
		this.#onModeChange();
	}
};
/**
* The text tracks of a YouTube embed. Unlike a `<video>` element's list, tracks can be removed, so each source starts
* empty. Events are queued like native ones, and mode changes within a tick report as one `change`.
*/
var YouTubeTextTrackList = class extends EventTarget {
	#tracks = [];
	#changeQueued = false;
	get length() {
		return this.#tracks.length;
	}
	[Symbol.iterator]() {
		return this.#tracks[Symbol.iterator]();
	}
	getTrackByLanguage(language) {
		return this.#tracks.find((track) => track.language === language);
	}
	add(label, language) {
		const track = new YouTubeTextTrack(label, language, () => this.#queueChange());
		Object.defineProperty(this, this.#tracks.length, {
			value: track,
			configurable: true,
			enumerable: true
		});
		this.#tracks.push(track);
		queueMicrotask(() => this.dispatchEvent(new TextTrackEvent("addtrack", track)));
		return track;
	}
	clear() {
		const removed = this.#tracks;
		this.#tracks = [];
		for (const [index, track] of removed.entries()) {
			delete this[index];
			queueMicrotask(() => this.dispatchEvent(new TextTrackEvent("removetrack", track)));
		}
	}
	#queueChange() {
		if (this.#changeQueued) return;
		this.#changeQueued = true;
		queueMicrotask(() => {
			this.#changeQueued = false;
			this.dispatchEvent(new Event("change"));
		});
	}
};

//#endregion
//#region ../adapters/youtube-video/dist/dev/adapter.js
const SEEK_TOLERANCE = 1;
const SEEK_SETTLE_TIMEOUT = 1e3;
const PLAYER_SETTINGS = [
	"volume",
	"muted",
	"playbackRate"
];
var YouTubeAdapter = class YouTubeAdapter extends MediaPlayedRangesMixin(EventTarget) {
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
	#playerReady = false;
	#pendingLoad = false;
	#creatingPlayer = false;
	#pendingEmbedOptions = false;
	#restoreSettings = /* @__PURE__ */ new Set();
	#writtenSettings = /* @__PURE__ */ new Set();
	#playerSettingsRead = false;
	#recreations = 0;
	#pendingWrites = [];
	#loadComplete = createPublicPromise();
	#attachId = 0;
	#src = YouTubeAdapter.defaultProps.src;
	#autoplay = YouTubeAdapter.defaultProps.autoplay;
	#defaultMuted = YouTubeAdapter.defaultProps.defaultMuted;
	#loop = YouTubeAdapter.defaultProps.loop;
	#controls = YouTubeAdapter.defaultProps.controls;
	#playsInline = YouTubeAdapter.defaultProps.playsInline;
	#preload = YouTubeAdapter.defaultProps.preload;
	#poster = YouTubeAdapter.defaultProps.poster;
	#source = YouTubeAdapter.defaultProps.source;
	#paused = true;
	#ended = false;
	#seeking = false;
	#seekTarget = null;
	#seekOrigin = null;
	#seekStartedAt = 0;
	#loaded = false;
	#playFired = false;
	#currentTime = 0;
	#duration = NaN;
	#volume = 1;
	#muted = false;
	#playbackRate = 1;
	#progress = 0;
	#readyState = READY_STATE_HAVE_NOTHING;
	#error = null;
	#isFullscreen = false;
	#pollInterval = null;
	#textTracks = new YouTubeTextTrackList();
	#captionLanguage = null;
	#captionSelected = false;
	static {
		this.PLAYER_SOFTWARE_NAME = "youtube-video";
	}
	constructor() {
		super();
		this.#textTracks.addEventListener("change", () => this.#onTextTracksChange());
	}
	/** Underlying YouTube iframe API player instance (null until the API loads). */
	get engine() {
		return this.#player;
	}
	get target() {
		return this.#target;
	}
	/**
	* Bind the iframe hosting the embed. The player follows once an embed URL can be resolved, which may not be now: an
	* iframe attached before `src` is set is picked up by the next `load()`.
	*/
	attach(target) {
		if (!target || this.#target === target) return;
		if (this.#target) this.detach();
		this.#target = target;
		this.#beginLoad();
		this.#createPlayer();
	}
	detach() {
		const target = this.#target;
		if (!target) return;
		const { parentNode, nextSibling } = target;
		this.#teardown();
		if (parentNode && !target.parentNode) parentNode.insertBefore(target, nextSibling?.parentNode === parentNode ? nextSibling : null);
	}
	#teardown() {
		this.#attachId++;
		this.#stopPolling();
		tryCall(() => this.#player?.destroy());
		this.#player = null;
		this.#playerReady = false;
		this.#pendingLoad = false;
		this.#creatingPlayer = false;
		this.#restoreSettings = /* @__PURE__ */ new Set();
		this.#writtenSettings = /* @__PURE__ */ new Set();
		this.#playerSettingsRead = false;
		this.#pendingWrites = [];
		this.#target = null;
		this.#loadComplete.resolve();
		this.#resetState();
		this.#volume = 1;
		this.#muted = false;
		this.#playbackRate = 1;
	}
	destroy() {
		this.detach();
		super.destroy();
	}
	get src() {
		return this.#src;
	}
	/** YouTube URL or id. Setting it re-derives `source`, carrying its player parameters over. */
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
	/** Reload the current source via the iframe API; deferred until the player is ready. */
	async load() {
		if (!this.#player || !this.#playerReady) {
			this.#pendingLoad = !!this.#target;
			if (this.#target && !this.#player && !this.#creatingPlayer) {
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
			this.#stopPolling();
			tryCall(() => this.#player?.stopVideo());
			return;
		}
		this.dispatchEvent(new Event("loadstart"));
		const parsed = parseYouTubeSource(this.#src);
		if (!parsed) {
			this.#error = new MediaError(`Unrecognized YouTube source: ${this.#src}`, MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED);
			this.dispatchEvent(new Event("error"));
			load.resolve();
			return;
		}
		if (parsed.kind === "playlist" && parsed.listId) {
			const options = {
				list: parsed.listId,
				listType: "playlist"
			};
			if (this.#autoplay) this.#player.loadPlaylist(options);
			else this.#player.cuePlaylist(options);
		} else if (parsed.id) {
			const options = { videoId: parsed.id };
			if (parsed.startTime != null) options.startSeconds = parsed.startTime;
			if (this.#autoplay) this.#player.loadVideoById(options);
			else this.#player.cueVideoById(options);
		}
	}
	#beginLoad() {
		this.#loadComplete.resolve();
		this.#loadComplete = createPublicPromise();
		this.#flushAfterLoad();
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
		let recreations;
		do {
			recreations = this.#recreations;
			await this.#loadComplete;
		} while (recreations !== this.#recreations && this.#target);
		if (!this.#src) return;
		this.#player?.playVideo();
	}
	pause() {
		this.#player?.pauseVideo();
	}
	get currentTime() {
		return this.#currentTime;
	}
	set currentTime(value) {
		if (this.#currentTime === value) return;
		this.#currentTime = value;
		this.#afterLoad((p) => {
			this.#seekTarget = value;
			this.#seekOrigin = p.getCurrentTime();
			this.#seekStartedAt = Date.now();
			if (!this.#seeking) {
				this.#seeking = true;
				this.dispatchEvent(new Event("seeking"));
			}
			p.seekTo(value, true);
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
		this.#writtenSettings.add("volume");
		this.#afterLoad((p) => p.setVolume(value * 100));
	}
	get muted() {
		return this.#muted;
	}
	set muted(value) {
		if (this.#muted === value) return;
		this.#muted = value;
		this.#writtenSettings.add("muted");
		this.#afterLoad((p) => value ? p.mute() : p.unMute());
	}
	get playbackRate() {
		return this.#playbackRate;
	}
	set playbackRate(value) {
		if (this.#playbackRate === value) return;
		this.#playbackRate = value;
		this.#writtenSettings.add("playbackRate");
		this.#afterLoad((p) => p.setPlaybackRate(value));
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
	/** YouTube URL or id in `src`, plus player parameters under `engine.youtube`. Replacing it re-derives `src`. */
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		const engineChanged = !deepEqual(this.#source?.engine?.youtube ?? null, source?.engine?.youtube ?? null);
		this.#pendingEmbedOptions ||= engineChanged;
		this.#source = source;
		this.#src = src;
		const target = this.#target;
		const embedSrc = this.#pendingEmbedOptions && target?.getAttribute("src") ? buildYouTubeIframeSrc(src, this.#snapshotProps()) : "";
		if (target && embedSrc) {
			const parent = target.parentNode;
			const nextSibling = target.nextSibling;
			const volume = this.#volume;
			const muted = this.#muted;
			const playbackRate = this.#playbackRate;
			const pendingWrites = this.#pendingWrites;
			const playerSettingsRead = this.#playerSettingsRead;
			const writtenSettings = this.#writtenSettings;
			const restoreSettings = new Set(playerSettingsRead ? PLAYER_SETTINGS : writtenSettings);
			this.#teardown();
			target.src = embedSrc;
			this.#pendingEmbedOptions = false;
			parent?.insertBefore(target, nextSibling);
			this.#target = target;
			this.#volume = volume;
			this.#muted = muted;
			this.#playbackRate = playbackRate;
			this.#restoreSettings = restoreSettings;
			this.#writtenSettings = writtenSettings;
			this.#playerSettingsRead = playerSettingsRead;
			this.#pendingWrites = pendingWrites;
			this.#recreations++;
			this.#beginLoad();
			this.dispatchEvent(new Event("emptied"));
			this.#createPlayer();
		} else if (srcChanged || engineChanged) this.load();
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
	get textTracks() {
		return this.#textTracks;
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
		if (!target.getAttribute("src") || this.#pendingEmbedOptions) {
			const initialSrc = buildYouTubeIframeSrc(this.#src, this.#snapshotProps());
			if (!initialSrc) {
				this.#loadComplete.resolve();
				return false;
			}
			target.src = initialSrc;
		}
		this.#pendingEmbedOptions = false;
		this.#creatingPlayer = true;
		this.dispatchEvent(new Event("loadstart"));
		this.#createPlayerApi(target);
		return true;
	}
	async #createPlayerApi(target) {
		const attachId = this.#attachId;
		let api;
		try {
			api = await loadYouTubeApi();
		} catch {
			if (this.#isStale(attachId)) return;
			this.#creatingPlayer = false;
			this.#error = new MediaError("Failed to load the YouTube iframe API", MediaError.MEDIA_ERR_NETWORK);
			this.dispatchEvent(new Event("error"));
			this.#loadComplete.resolve();
			return;
		}
		if (this.#isStale(attachId) || this.#target !== target) return;
		const player = new api.Player(target, { events: {
			onReady: () => {
				if (this.#isStale(attachId)) return;
				this.#onPlayerReady();
			},
			onError: (event) => {
				if (this.#isStale(attachId)) return;
				this.#onError(event.data);
			}
		} });
		this.#player = player;
		this.#creatingPlayer = false;
		this.#bindPlayerEvents(player, attachId);
	}
	#isStale(attachId) {
		return attachId !== this.#attachId;
	}
	#afterLoad(fn) {
		this.#pendingWrites.push(fn);
		this.#flushAfterLoad();
	}
	#flushAfterLoad() {
		const load = this.#loadComplete;
		load.then(() => {
			if (load !== this.#loadComplete) return;
			const player = this.#player;
			if (!player) return;
			while (load === this.#loadComplete && player === this.#player) {
				const write = this.#pendingWrites.shift();
				if (!write) break;
				tryCall(() => write(player));
			}
		}, noop);
	}
	#snapshotProps() {
		return {
			autoplay: this.#autoplay,
			defaultMuted: this.#defaultMuted,
			loop: this.#loop,
			controls: this.#controls,
			playsInline: this.#playsInline,
			preload: this.#preload || YouTubeAdapter.defaultProps.preload,
			source: this.#source
		};
	}
	#resetState() {
		this.#currentTime = 0;
		this.#duration = NaN;
		this.#paused = !this.#autoplay;
		this.#ended = false;
		this.#progress = 0;
		this.#readyState = READY_STATE_HAVE_NOTHING;
		this.#seeking = false;
		this.#seekTarget = null;
		this.#seekOrigin = null;
		this.#seekStartedAt = 0;
		this.#loaded = false;
		this.#playFired = false;
		this.#error = null;
		this.#isFullscreen = false;
		this.#captionLanguage = null;
		this.#captionSelected = false;
		this.#textTracks.clear();
	}
	#onPlayerReady() {
		this.#playerReady = true;
		const player = this.#player;
		const restore = this.#restoreSettings;
		if (restore.size && player) {
			const volume = this.#volume;
			const muted = this.#muted;
			const playbackRate = this.#playbackRate;
			this.#restoreSettings = /* @__PURE__ */ new Set();
			tryCall(() => {
				if (restore.has("volume")) player.setVolume(volume * 100);
				if (restore.has("muted")) {
					if (muted) player.mute();
					else player.unMute();
				}
				if (restore.has("playbackRate")) player.setPlaybackRate(playbackRate);
			});
		}
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
		const player = this.#player;
		if (player) {
			this.#duration = player.getDuration() || NaN;
			this.#muted = player.isMuted();
			this.#volume = player.getVolume() / 100;
			this.#playbackRate = player.getPlaybackRate();
			this.#playerSettingsRead = true;
		}
		for (const type of [
			"loadedmetadata",
			"durationchange",
			"volumechange",
			"loadcomplete"
		]) this.dispatchEvent(new Event(type));
		this.#loadComplete.resolve();
		this.#startPolling();
	}
	#onError(code) {
		const error = new MediaError(`YouTube iframe player error #${code}; visit https://developers.google.com/youtube/iframe_api_reference#onError for the full error message.`, youtubeErrorCodeToMediaErrorCode[code] ?? MediaError.MEDIA_ERR_CUSTOM, true);
		error.data = { youtubeErrorCode: code };
		this.#error = error;
		this.dispatchEvent(new Event("error"));
		this.#loadComplete.resolve();
	}
	#bindPlayerEvents(player, attachId) {
		const emit = (type) => this.dispatchEvent(new Event(type));
		player.addEventListener("onStateChange", ({ data: state }) => {
			if (this.#isStale(attachId)) return;
			if (this.#src && !this.#loaded && state !== -1) this.#onLoaded();
			if (state === 1 || state === 3) {
				if (!this.#playFired) {
					this.#playFired = true;
					this.#paused = false;
					this.#ended = false;
					emit("play");
				}
				this.#syncTextTracks(player);
			}
			if (state === 3) emit("waiting");
			else if (state === 1) {
				if (this.#seeking && this.#seekTarget === null) {
					this.#seeking = false;
					emit("seeked");
				}
				this.#readyState = READY_STATE_HAVE_FUTURE_DATA;
				this.#paused = false;
				emit("playing");
			} else if (state === 2) {
				const diff = Math.abs(player.getCurrentTime() - this.#currentTime);
				if (!this.#seeking && diff > .1) {
					this.#seeking = true;
					emit("seeking");
				}
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
			}
		});
		player.addEventListener("onPlaybackRateChange", () => {
			if (this.#isStale(attachId)) return;
			this.#playbackRate = player.getPlaybackRate();
			emit("ratechange");
		});
		player.addEventListener("onVolumeChange", () => {
			if (this.#isStale(attachId)) return;
			this.#volume = player.getVolume() / 100;
			this.#muted = player.isMuted();
			emit("volumechange");
		});
		player.addEventListener("onApiChange", () => {
			if (this.#isStale(attachId)) return;
			this.#syncTextTracks(player);
		});
	}
	#startPolling() {
		this.#stopPolling();
		this.#pollInterval = setInterval(() => this.#poll(), 50);
	}
	#stopPolling() {
		if (this.#pollInterval !== null) {
			clearInterval(this.#pollInterval);
			this.#pollInterval = null;
		}
	}
	#hasAppliedSeek(time) {
		const target = this.#seekTarget;
		const origin = this.#seekOrigin;
		if (target === null || origin === null) return false;
		return (time !== origin || Date.now() - this.#seekStartedAt >= SEEK_SETTLE_TIMEOUT) && Math.abs(time - target) <= SEEK_TOLERANCE;
	}
	#poll() {
		const player = this.#player;
		if (!player) return;
		const time = player.getCurrentTime();
		const duration = player.getDuration();
		const bufferedEnd = player.getVideoLoadedFraction() * duration;
		const wasSeeking = this.#seeking;
		const appliedSeek = this.#hasAppliedSeek(time);
		if (!wasSeeking && player.getPlayerState() !== 1 && Math.abs(time - this.#currentTime) > .1) {
			this.#seeking = true;
			this.dispatchEvent(new Event("seeking"));
		}
		if ((this.#seekTarget === null || appliedSeek) && time !== this.#currentTime) {
			this.#currentTime = time;
			this.dispatchEvent(new Event("timeupdate"));
		}
		if (wasSeeking && (appliedSeek || this.#seekTarget === null && bufferedEnd > .1)) {
			this.#seeking = false;
			this.#seekTarget = null;
			this.#seekOrigin = null;
			this.#seekStartedAt = 0;
			this.dispatchEvent(new Event("seeked"));
		}
		if (isNumber(duration) && duration > 0 && duration !== this.#duration) {
			this.#duration = duration;
			this.dispatchEvent(new Event("durationchange"));
		}
		if (bufferedEnd !== this.#progress) {
			this.#progress = bufferedEnd;
			if (duration > 0 && bufferedEnd >= duration) this.#readyState = READY_STATE_HAVE_ENOUGH_DATA;
			this.dispatchEvent(new Event("progress"));
		}
	}
	#syncTextTracks(player) {
		const tracklist = player.getOption("captions", "tracklist") ?? [];
		const current = player.getOption("captions", "track");
		for (const track of tracklist) this.#addTextTrack(track);
		if (isObject(current)) this.#addTextTrack(current);
		if (this.#captionSelected || !isObject(current)) return;
		this.#captionLanguage = current.languageCode || null;
		for (const track of this.#textTracks) track.mode = track.language === this.#captionLanguage ? "showing" : "disabled";
	}
	#addTextTrack({ languageCode, displayName }) {
		if (!languageCode || this.#textTracks.getTrackByLanguage(languageCode)) return;
		this.#textTracks.add(displayName ?? "", languageCode);
	}
	#onTextTracksChange() {
		const player = this.#player;
		if (!player) return;
		const language = Array.from(this.#textTracks).find((track) => track.mode === "showing")?.language ?? null;
		if (language === this.#captionLanguage) return;
		this.#captionLanguage = language;
		this.#captionSelected = true;
		tryCall(() => player.setOption("captions", "track", language ? { languageCode: language } : {}));
	}
};
const READY_STATE_HAVE_NOTHING = 0;
const READY_STATE_HAVE_METADATA = 1;
const READY_STATE_HAVE_FUTURE_DATA = 3;
const READY_STATE_HAVE_ENOUGH_DATA = 4;

//#endregion
//#region ../html/dist/dev/media/youtube-video/adapter.js
var YouTubeCustomMediaElement = class extends CustomMediaElement("iframe", YouTubeAdapter) {
	static {
		this.getTemplateHTML = (attrs) => {
			const initialSrc = buildYouTubeIframeSrc(attrs.src ?? "", templateAttrsToEmbedProps(attrs));
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
		playsInline: attrs.playsinline !== void 0,
		preload: attrs.preload ?? "metadata"
	};
}
var YouTubeVideo = class extends MediaAttachMixin(YouTubeCustomMediaElement) {};

//#endregion
//#region ../html/dist/dev/define/media/youtube-video.js
var YouTubeVideoElement = class extends YouTubeVideo {
	static {
		this.tagName = "youtube-video";
	}
};
safeDefine(YouTubeVideoElement);

//#endregion
export { YouTubeVideoElement };
//# sourceMappingURL=youtube-video.dev.js.map