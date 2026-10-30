/*! Video.js | https://videojs.org/help */
import { f as isUndefined } from "../predicate-3rF1m2uv.js";
import { t as loadScript } from "../script--drPGKYR.js";
import { r as isCaptionOrSubtitleTrack } from "../text-track-CnWDzah_.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { r as getMediaElement, t as PlayerExtensionElement } from "../player-extension-element-E95ZSTu0.js";

//#region ../extensions/google-cast/dist/dev/utils.js
var InvalidStateError = class extends Error {};
var NotSupportedError = class extends Error {};
var NotFoundError = class extends Error {};
const GOOGLE_CAST_FRAMEWORK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const HLS_RESPONSE_HEADERS = [
	"application/x-mpegURL",
	"application/vnd.apple.mpegurl",
	"audio/mpegurl"
];
var IterableWeakSet = class {
	#refs = /* @__PURE__ */ new Set();
	#seen = /* @__PURE__ */ new WeakMap();
	add(value) {
		if (this.#seen.has(value)) return this;
		const ref = new WeakRef(value);
		this.#seen.set(value, ref);
		this.#refs.add(ref);
		return this;
	}
	delete(value) {
		const ref = this.#seen.get(value);
		if (!ref) return false;
		this.#seen.delete(value);
		return this.#refs.delete(ref);
	}
	forEach(fn) {
		for (const ref of this.#refs) {
			const value = ref.deref();
			if (value) fn(value);
			else this.#refs.delete(ref);
		}
	}
};
function onCastApiAvailable(callback) {
	const whenDefined = () => customElements.whenDefined("google-cast-button").then(callback);
	if (!globalThis.chrome?.cast?.isAvailable) globalThis.__onGCastApiAvailable = whenDefined;
	else if (typeof cast === "undefined" || !cast.framework) whenDefined();
	else callback();
}
function requiresCastFramework() {
	return Boolean(globalThis.chrome);
}
async function loadCastFramework() {
	if (globalThis.chrome?.cast) return;
	await loadScript(GOOGLE_CAST_FRAMEWORK_URL);
}
function getCastContext() {
	return typeof cast === "undefined" ? void 0 : cast.framework?.CastContext.getInstance();
}
function currentSession() {
	return getCastContext()?.getCurrentSession();
}
function currentMedia() {
	return currentSession()?.getSessionObj().media[0] ?? void 0;
}
function editTracksInfo(request) {
	return new Promise((resolve, reject) => {
		currentMedia().editTracksInfo(request, resolve, reject);
	});
}
function getMediaStatus(request) {
	return new Promise((resolve, reject) => {
		currentMedia().getStatus(request, resolve, reject);
	});
}
const MEDIA_NAMESPACE = "urn:x-cast:com.google.cast.media";
let requestId = 0;
function setPlaybackRate(rate) {
	const media = currentMedia();
	return currentSession().sendMessage(MEDIA_NAMESPACE, {
		type: "SET_PLAYBACK_RATE",
		playbackRate: rate,
		mediaSessionId: media?.mediaSessionId,
		requestId: ++requestId
	});
}
function setCastOptions(options) {
	getCastContext().setOptions({
		...getDefaultCastOptions(),
		...options
	});
}
function getDefaultCastOptions() {
	return {
		receiverApplicationId: "CC1AD845",
		autoJoinPolicy: globalThis.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED ?? "origin_scoped",
		androidReceiverCompatible: false,
		language: "en-US",
		resumeSavedSession: true
	};
}
function getFormat(segment) {
	if (!segment) return void 0;
	const match = segment.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
	return match ? match[1] : null;
}
function parsePlaylistUrls(playlistContent) {
	const lines = playlistContent.split("\n");
	const urls = [];
	for (let i = 0; i < lines.length; i++) if (lines[i].trim().startsWith("#EXT-X-STREAM-INF")) {
		const nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
		if (nextLine && !nextLine.startsWith("#")) urls.push(nextLine);
	}
	return urls;
}
function parseSegment(playlistContent) {
	return playlistContent.split("\n").find((line) => !line.trim().startsWith("#") && line.trim() !== "");
}
async function isHls(url) {
	if (!url) return false;
	if (/\.m3u8?(\?.*)?$/i.test(url)) return true;
	if (url.startsWith("blob:")) return false;
	try {
		const contentType = (await fetch(url, { method: "HEAD" })).headers.get("Content-Type");
		if (!contentType) return false;
		const normalizedContentType = contentType.toLowerCase().split(";")[0].trim();
		return HLS_RESPONSE_HEADERS.some((header) => normalizedContentType === header.toLowerCase());
	} catch (err) {
		console.error("Error while trying to get the Content-Type of the manifest", err);
		return false;
	}
}
async function getPlaylistSegmentFormat(url) {
	try {
		const mainManifestContent = await (await fetch(url)).text();
		let availableChunksContent = mainManifestContent;
		const playlists = parsePlaylistUrls(mainManifestContent);
		if (playlists.length > 0) {
			const chosenPlaylistUrl = new URL(playlists[0], url).toString();
			availableChunksContent = await (await fetch(chosenPlaylistUrl)).text();
		}
		return getFormat(parseSegment(availableChunksContent));
	} catch (err) {
		console.error("Error while trying to parse the manifest playlist", err);
		return;
	}
}

//#endregion
//#region ../extensions/google-cast/dist/dev/registry.js
const googleCastInstances = new IterableWeakSet();
let castFramework;
let pendingCastFramework = null;
async function ensureCastFramework() {
	if (castFramework) return castFramework;
	if (!pendingCastFramework) {
		pendingCastFramework = loadCastFramework().then(() => new Promise((resolve, reject) => {
			onCastApiAvailable(() => {
				registerCastFramework();
				if (castFramework) {
					resolve(castFramework);
					return;
				}
				reject(new DOMException("Google Cast framework is unavailable.", "NotSupportedError"));
			});
		}));
		pendingCastFramework.catch(() => {
			pendingCastFramework = null;
		});
	}
	return pendingCastFramework;
}
function registerCastFramework() {
	if (!globalThis.chrome?.cast?.isAvailable) {
		console.debug("chrome.cast.isAvailable", globalThis.chrome?.cast?.isAvailable);
		return;
	}
	if (!castFramework) {
		castFramework = cast.framework;
		getCastContext().addEventListener(castFramework.CastContextEventType.CAST_STATE_CHANGED, () => {
			googleCastInstances.forEach((provider) => provider.onCastStateChanged());
		});
		getCastContext().addEventListener(castFramework.CastContextEventType.SESSION_STATE_CHANGED, () => {
			googleCastInstances.forEach((provider) => provider.onSessionStateChanged());
		});
		googleCastInstances.forEach((provider) => provider.onCastFrameworkAvailable());
	}
}

//#endregion
//#region ../extensions/google-cast/dist/dev/remote-playback.js
let callbackIdCount = 0;
/**
* Implementation of the W3C [`RemotePlayback`](https://developer.mozilla.org/en-US/docs/Web/API/RemotePlayback)
* interface backed by Google Cast.
*
* Surfaced via `host.remote` while the {@link GoogleCastProvider} is in the provider chain. The public API must
* strictly conform to the W3C spec:
*
* - Properties: `state`
* - Methods: `watchAvailability`, `cancelWatchAvailability`, `prompt`
* - Events: `connecting`, `connect`, `disconnect`
*
* Internal state mutations are pushed by {@link GoogleCastProvider} through private callbacks registered via
* `provider.bindHooks(...)` in the constructor — do not add public methods or properties that aren't part of the spec.
*/
var RemotePlayback = class extends EventTarget {
	#provider;
	#state = "disconnected";
	#available = false;
	#callbacks = /* @__PURE__ */ new Map();
	constructor(provider) {
		super();
		this.#provider = provider;
		provider.bindHooks({
			setState: (next) => this.#setState(next),
			setAvailable: (available) => this.#setAvailable(available)
		});
	}
	get state() {
		return this.#state;
	}
	async watchAvailability(callback) {
		this.#assertEnabled();
		const id = ++callbackIdCount;
		this.#callbacks.set(id, callback);
		queueMicrotask(() => callback(this.#provider.hasDevicesAvailable()));
		return id;
	}
	async cancelWatchAvailability(callbackId) {
		this.#assertEnabled();
		if (callbackId === void 0) {
			this.#callbacks.clear();
			return;
		}
		if (!this.#callbacks.delete(callbackId)) throw new NotFoundError(`Callback not found for id ${callbackId}.`);
	}
	async prompt() {
		this.#assertEnabled();
		await this.#provider.requestCastSession();
	}
	#assertEnabled() {
		if (this.#provider.target?.disableRemotePlayback) throw new InvalidStateError("disableRemotePlayback attribute is present.");
	}
	#setState(next) {
		if (this.#state === next) return;
		this.#state = next;
		if (next === "connecting") this.dispatchEvent(new Event("connecting"));
		else if (next === "connected") this.dispatchEvent(new Event("connect"));
		else this.dispatchEvent(new Event("disconnect"));
	}
	#setAvailable(available) {
		if (this.#available === available) return;
		this.#available = available;
		for (const callback of this.#callbacks.values()) callback(available);
	}
};

//#endregion
//#region ../extensions/google-cast/dist/dev/provider.js
/**
* Cast provider + lifecycle. Created by the {@link GoogleCastExtension} and installed as the player's media override
* while a cast session is connected, so its getters/setters route through the cast receiver; when disconnected the
* player falls through to the attached media. Also owns the cast framework integration, the `RemotePlayback` instance
* exposed via {@link GoogleCastProvider#remote}, and dispatches media events on the attached target (which the media
* forwards to the player) while casting.
*/
var GoogleCastProvider = class {
	#googleCast;
	#loadedSrc;
	#hooks;
	#remotePlayback;
	#isInit;
	#isCasting;
	#seeking;
	#remotePlayer;
	#remoteListeners;
	#listenersAttached;
	#playbackRate;
	#localPaused;
	#onTextTrackChange;
	#onMediaUpdate;
	constructor(googleCast) {
		this.target = null;
		this.#loadedSrc = null;
		this.#hooks = {};
		this.#isInit = false;
		this.#isCasting = false;
		this.#seeking = false;
		this.#listenersAttached = false;
		this.#playbackRate = 1;
		this.#localPaused = false;
		this.#onTextTrackChange = () => this.#updateRemoteTextTrack();
		this.#onMediaUpdate = () => this.#checkPlaybackRate();
		this.#googleCast = googleCast;
		this.#remotePlayback = new RemotePlayback(this);
		googleCastInstances.add(this);
		this.onCastFrameworkAvailable();
	}
	get remote() {
		if (this.target && !this.target.disableRemotePlayback) ensureCastFramework();
		return this.#remotePlayback;
	}
	/**
	* Source this provider has sent, or is sending, to the receiver. `null` while nothing is on its way, after a
	* disconnect, and after a failed load so the same source can be retried.
	*/
	get loadedSrc() {
		return this.#loadedSrc;
	}
	attach(target) {
		this.target = target;
		target.textTracks.addEventListener("change", this.#onTextTrackChange);
	}
	detach() {
		this.target?.textTracks.removeEventListener("change", this.#onTextTrackChange);
		this.target = null;
	}
	destroy() {
		this.detach();
		googleCastInstances.delete(this);
		currentMedia()?.removeUpdateListener(this.#onMediaUpdate);
		this.#detachRemoteListeners();
		this.#isCasting = false;
		this.#isInit = false;
	}
	/** @internal Wires up callbacks pushed from {@link RemotePlayback}; not part of the public surface. */
	bindHooks(hooks) {
		Object.assign(this.#hooks, hooks);
	}
	hasDevicesAvailable() {
		const state = getCastContext()?.getCastState();
		return !!state && state !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
	}
	async requestCastSession() {
		if (this.target?.disableRemotePlayback) throw new InvalidStateError("disableRemotePlayback attribute is present.");
		await ensureCastFramework();
		if (!this.#isCastApiAvailable()) throw new NotSupportedError("The RemotePlayback API is disabled on this platform.");
		const willDisconnect = this.#isCasting;
		this.#isCasting = true;
		this.#applyCastOptions();
		this.#attachRemoteListeners();
		try {
			await getCastContext().requestSession();
		} catch (err) {
			if (!willDisconnect) this.#isCasting = false;
			if (err === "cancel") return;
			throw new Error(err);
		}
		this.#localPaused = this.target?.paused ?? true;
		this.target?.pause();
		this.muted = this.target?.muted ?? false;
		try {
			await this.load();
		} catch (err) {
			console.error(err);
		}
	}
	async load() {
		if (!this.#isCasting) {
			await this.target?.load();
			return;
		}
		const { src } = this.#googleCast;
		if (!src) return;
		this.#loadedSrc = src;
		try {
			const request = await this.#createLoadRequest(src);
			await currentSession()?.loadMedia(request);
		} catch (error) {
			if (this.#loadedSrc === src) this.#loadedSrc = null;
			throw error;
		}
		this.target?.dispatchEvent(new Event("volumechange"));
	}
	async #createLoadRequest(src) {
		const mediaInfo = new chrome.cast.media.MediaInfo(src, this.#googleCast.contentType ?? "");
		mediaInfo.customData = this.#googleCast.customData ?? null;
		const { target } = this;
		const subtitles = [...target?.querySelectorAll?.("track") ?? []].filter((el) => el.src && isCaptionOrSubtitleTrack(el));
		const { Track, TrackType, TextTrackType } = chrome.cast.media;
		const activeTrackIds = [];
		if (subtitles.length) mediaInfo.tracks = subtitles.map((el, i) => {
			const trackId = i + 1;
			if (!activeTrackIds.length && el.track.mode === "showing") activeTrackIds.push(trackId);
			const track = new Track(trackId, TrackType.TEXT);
			track.trackContentId = el.src;
			track.trackContentType = "text/vtt";
			track.subtype = el.kind === "captions" ? TextTrackType.CAPTIONS : TextTrackType.SUBTITLES;
			track.name = el.label;
			track.language = el.srclang;
			return track;
		});
		mediaInfo.streamType = this.#googleCast.streamType === "live" ? chrome.cast.media.StreamType.LIVE : chrome.cast.media.StreamType.BUFFERED;
		mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
		mediaInfo.metadata.images = [new chrome.cast.Image(target?.poster ?? "")];
		if (await isHls(src)) {
			mediaInfo.contentType ||= "application/x-mpegURL";
			const fmt = await getPlaylistSegmentFormat(src) ?? "";
			const { HlsSegmentFormat: HS, HlsVideoSegmentFormat: HVS } = chrome.cast.media;
			if (fmt.includes("m4s") || fmt.includes("mp4")) {
				mediaInfo.hlsSegmentFormat = HS.FMP4;
				mediaInfo.hlsVideoSegmentFormat = HVS.FMP4;
			} else if (fmt.includes("ts")) {
				mediaInfo.hlsSegmentFormat = HS.TS;
				mediaInfo.hlsVideoSegmentFormat = HVS.TS;
			}
		}
		const request = new chrome.cast.media.LoadRequest(mediaInfo);
		request.currentTime = this.target?.currentTime ?? 0;
		request.autoplay = !this.#localPaused;
		request.activeTrackIds = activeTrackIds;
		return request;
	}
	get paused() {
		if (!this.#remotePlayer.isMediaLoaded) return this.target?.paused ?? true;
		return this.#remotePlayer.isPaused || this.ended;
	}
	get ended() {
		return this.#remotePlayer.playerState === chrome.cast.media.PlayerState.IDLE && currentMedia()?.idleReason === chrome.cast.media.IdleReason.FINISHED;
	}
	get seeking() {
		return this.#seeking;
	}
	get readyState() {
		switch (this.#remotePlayer.playerState) {
			case chrome.cast.media.PlayerState.IDLE: return 0;
			case chrome.cast.media.PlayerState.BUFFERING: return 2;
			default: return 3;
		}
	}
	get duration() {
		if (!this.#remotePlayer.isMediaLoaded) return this.target?.duration ?? NaN;
		return this.#remotePlayer.duration ?? NaN;
	}
	get currentTime() {
		if (!this.#remotePlayer.isMediaLoaded) return this.target?.currentTime ?? 0;
		return this.#remotePlayer.currentTime ?? 0;
	}
	set currentTime(value) {
		this.#remotePlayer.currentTime = value;
		this.#notifySeeking();
		this.#remotePlayer.controller?.seek();
	}
	get muted() {
		return this.#remotePlayer.isMuted;
	}
	set muted(value) {
		if (value !== this.#remotePlayer.isMuted) this.#remotePlayer.controller?.muteOrUnmute();
	}
	get volume() {
		return this.#remotePlayer.volumeLevel ?? 1;
	}
	set volume(value) {
		this.#remotePlayer.volumeLevel = +value;
		this.#remotePlayer.controller?.setVolumeLevel();
	}
	get playbackRate() {
		return currentMedia()?.playbackRate ?? 1;
	}
	set playbackRate(value) {
		setPlaybackRate(value);
	}
	async play() {
		if (!this.#remotePlayer.isMediaLoaded) {
			this.#localPaused = false;
			await this.load();
			return;
		}
		if (this.paused) {
			this.#remotePlayer.controller?.playOrPause();
			return new Promise((resolve) => {
				this.target?.addEventListener("play", () => resolve(), { once: true });
			});
		}
	}
	pause() {
		if (!this.paused) this.#remotePlayer.controller?.playOrPause();
	}
	onCastFrameworkAvailable() {
		if (!castFramework || this.#isInit) return;
		this.#isInit = true;
		this.#applyCastOptions();
		this.onCastStateChanged();
		this.#remotePlayer = new castFramework.RemotePlayer();
		new castFramework.RemotePlayerController(this.#remotePlayer);
		this.#remoteListeners = {
			[castFramework.RemotePlayerEventType.IS_CONNECTED_CHANGED]: (event) => {
				if (event?.value === true) this.#hooks.setState?.("connected");
				else {
					this.#disconnect();
					this.#hooks.setState?.("disconnected");
				}
			},
			[castFramework.RemotePlayerEventType.DURATION_CHANGED]: () => {
				this.target?.dispatchEvent(new Event("durationchange"));
			},
			[castFramework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED]: () => {
				this.target?.dispatchEvent(new Event("volumechange"));
			},
			[castFramework.RemotePlayerEventType.IS_MUTED_CHANGED]: () => {
				this.target?.dispatchEvent(new Event("volumechange"));
			},
			[castFramework.RemotePlayerEventType.CURRENT_TIME_CHANGED]: () => {
				if (!this.#isCasting || !this.#remotePlayer.isMediaLoaded) return;
				this.#notifySeeked();
				this.target?.dispatchEvent(new Event("timeupdate"));
			},
			[castFramework.RemotePlayerEventType.VIDEO_INFO_CHANGED]: () => {
				this.target?.dispatchEvent(new Event("resize"));
			},
			[castFramework.RemotePlayerEventType.IS_PAUSED_CHANGED]: () => {
				this.target?.dispatchEvent(new Event(this.#isCasting && this.#remotePlayer.isPaused ? "pause" : "play"));
			},
			[castFramework.RemotePlayerEventType.PLAYER_STATE_CHANGED]: () => {
				const PS = chrome.cast.media.PlayerState;
				const state = this.#isCasting ? this.#remotePlayer.playerState : void 0;
				if (state !== PS.BUFFERING) this.#notifySeeked();
				if (state === PS.PAUSED) return;
				if (state === PS.IDLE) {
					const finished = currentMedia()?.idleReason === chrome.cast.media.IdleReason.FINISHED;
					this.target?.dispatchEvent(new Event(finished ? "ended" : "emptied"));
					return;
				}
				if (state === PS.PLAYING) this.target?.dispatchEvent(new Event("playing"));
				else if (state === PS.BUFFERING) this.target?.dispatchEvent(new Event("waiting"));
			},
			[castFramework.RemotePlayerEventType.IS_MEDIA_LOADED_CHANGED]: async () => {
				if (!this.#isCasting || !this.#remotePlayer.isMediaLoaded) return;
				await Promise.resolve();
				this.#onRemoteMediaLoaded();
			}
		};
	}
	onCastStateChanged() {
		if (!this.#isInit) return;
		const CS = cast.framework.CastState;
		const state = getCastContext().getCastState();
		if (this.#isCasting && state === CS.CONNECTING) this.#hooks.setState?.("connecting");
		this.#hooks.setAvailable?.(!!state && state !== CS.NO_DEVICES_AVAILABLE);
	}
	async onSessionStateChanged() {
		if (!this.#isInit) return;
		const { SESSION_RESUMED } = castFramework.SessionState;
		if (getCastContext().getSessionState() === SESSION_RESUMED) {
			const { src } = this.#googleCast;
			if (src && src === currentMedia()?.media?.contentId) {
				this.#isCasting = true;
				this.#loadedSrc = src;
				this.#attachRemoteListeners();
				try {
					await getMediaStatus(new chrome.cast.media.GetStatusRequest());
				} catch (error) {
					console.error(error);
				}
				this.#remoteListeners[castFramework.RemotePlayerEventType.IS_PAUSED_CHANGED]();
				this.#remoteListeners[castFramework.RemotePlayerEventType.PLAYER_STATE_CHANGED]();
				this.target?.dispatchEvent(new Event("ratechange"));
			}
		}
	}
	#isCastApiAvailable() {
		return Boolean(globalThis.chrome?.cast?.isAvailable);
	}
	#applyCastOptions() {
		const { receiver } = this.#googleCast;
		setCastOptions(receiver ? { receiverApplicationId: receiver } : {});
	}
	#attachRemoteListeners() {
		if (this.#listenersAttached) return;
		const controller = this.#remotePlayer?.controller;
		if (!controller) return;
		for (const [type, handler] of Object.entries(this.#remoteListeners)) controller.addEventListener(type, handler);
		this.#listenersAttached = true;
	}
	#detachRemoteListeners() {
		if (!this.#listenersAttached) return;
		const controller = this.#remotePlayer?.controller;
		if (controller) for (const [type, handler] of Object.entries(this.#remoteListeners)) controller.removeEventListener(type, handler);
		this.#listenersAttached = false;
	}
	#disconnect() {
		if (!this.#isCasting) return;
		currentMedia()?.removeUpdateListener(this.#onMediaUpdate);
		this.#detachRemoteListeners();
		this.#seeking = false;
		this.#playbackRate = 1;
		this.#isCasting = false;
		this.#loadedSrc = null;
		if (this.target) this.target.muted = this.#remotePlayer.isMuted;
		const saved = this.#remotePlayer.savedPlayerState;
		if (saved) {
			if (this.target) this.target.currentTime = saved.currentTime;
			if (saved.isPaused === false && this.target) this.target.play();
		}
	}
	#notifySeeking() {
		this.#seeking = true;
		this.target?.dispatchEvent(new Event("seeking"));
	}
	#notifySeeked() {
		if (!this.#seeking) return;
		this.#seeking = false;
		this.target?.dispatchEvent(new Event("seeked"));
	}
	#onRemoteMediaLoaded() {
		this.#playbackRate = currentMedia()?.playbackRate ?? 1;
		currentMedia()?.addUpdateListener(this.#onMediaUpdate);
		this.#updateRemoteTextTrack();
	}
	#checkPlaybackRate() {
		const rate = currentMedia()?.playbackRate ?? 1;
		if (rate !== this.#playbackRate) {
			this.#playbackRate = rate;
			this.target?.dispatchEvent(new Event("ratechange"));
		}
	}
	async #updateRemoteTextTrack() {
		if (!this.#isCasting || !this.target) return;
		const localSubs = [...this.target.textTracks].filter(isCaptionOrSubtitleTrack);
		const matched = (this.#remotePlayer.mediaInfo?.tracks ?? []).filter(({ type }) => type === chrome.cast.media.TrackType.TEXT).flatMap(({ language, name, trackId }) => {
			const local = localSubs.find((l) => l.language === language && l.label === name);
			return local?.mode ? [{
				mode: local.mode,
				trackId
			}] : [];
		});
		const hidden = new Set(matched.filter((m) => m.mode !== "showing").map((m) => m.trackId));
		const showing = matched.find((m) => m.mode === "showing")?.trackId;
		const active = currentSession()?.getSessionObj().media[0]?.activeTrackIds ?? [];
		const next = new Set(active.filter((id) => !hidden.has(id)));
		if (showing) next.add(showing);
		if (next.size === active.length && active.every((id) => next.has(id))) return;
		try {
			await editTracksInfo(new chrome.cast.media.EditTracksInfoRequest([...next]));
		} catch (error) {
			console.error(error);
		}
	}
};

//#endregion
//#region ../extensions/google-cast/dist/dev/extension.js
/**
* Player extension that adds Google Cast to whatever media the player attaches: a plain `<video>`, a media component,
* or a media adapter. While a cast session is connected, playback members the player reads route to the receiver;
* otherwise only `remote` is taken over so the cast button can prompt.
*
* Its `PlayerExtension` members are internal: the player drives them, and the element and hook that register it check
* that it conforms.
*/
var GoogleCastExtension = class {
	static {
		this.defaultProps = {
			src: void 0,
			contentType: void 0,
			streamType: void 0,
			receiver: void 0,
			customData: void 0
		};
	}
	#src;
	#contentType;
	#streamType;
	#receiver;
	#customData;
	#media = null;
	#provider = null;
	#override = null;
	#connected = false;
	constructor(props = {}) {
		Object.assign(this, props);
	}
	/** @internal Player lifecycle; the player calls it. */
	attach({ media }) {
		const target = media;
		if (this.#media === target) return;
		this.detach();
		this.#media = target;
		if (requiresCastFramework() && !this.#provider) {
			this.#provider = new GoogleCastProvider(this);
			this.#provider.remote.addEventListener("connect", this.#onStateChange);
			this.#provider.remote.addEventListener("disconnect", this.#onStateChange);
			this.#override = this.#createRemoteOverride();
		}
		this.#bindProvider();
		target.addEventListener("loadstart", this.#onLoadStart);
		this.#followSource();
	}
	/** @internal Player lifecycle; the player calls it. */
	detach() {
		this.#media?.removeEventListener("loadstart", this.#onLoadStart);
		this.#media = null;
		this.#provider?.detach();
	}
	destroy() {
		this.detach();
		this.#provider?.destroy();
		this.#provider = null;
		this.#override = null;
		this.#connected = false;
	}
	/** @internal Read by the player to route media members to the receiver. */
	get mediaOverride() {
		return this.#override;
	}
	/**
	* Point the provider at the native element behind the media: its `<track>` children carry the real modes, and events
	* dispatched there already forward through any custom element or adapter to the player's listeners. A custom element
	* or adapter can swap that element (an engine change, for example), so this runs again on every `loadstart`.
	*/
	#bindProvider() {
		const provider = this.#provider;
		const media = this.#media;
		if (!provider || !media) return;
		const element = getMediaElement(media) ?? media;
		if (provider.target === element) return;
		if (provider.target) provider.detach();
		provider.attach(element);
	}
	#onStateChange = () => {
		if (!this.#provider) return;
		this.#connected = this.#provider.remote.state === "connected";
		this.#override = this.#connected ? this.#provider : this.#createRemoteOverride();
	};
	/** The media started loading a new source locally. */
	#onLoadStart = () => {
		this.#bindProvider();
		this.#followSource();
	};
	/**
	* While casting, load the media's current source on the receiver unless it is already there. The provider claims the
	* source before it starts loading, so the several `loadstart`s one local load can produce reach the receiver once.
	*/
	#followSource() {
		const provider = this.#provider;
		if (!provider || !this.#connected) return;
		const { src } = this;
		if (!src || provider.loadedSrc === src) return;
		provider.load();
	}
	#createRemoteOverride() {
		const provider = this.#provider;
		return { get remote() {
			return provider.remote;
		} };
	}
	/**
	* Source URL loaded on the Cast receiver. Falls back to the source the media is playing: its `src`, else the
	* `<source>` child the browser selected (`currentSrc`), else the first `<source>` child before selection has run. An
	* adapter reports the URL it plays on `src`; a `blob:` `currentSrc` is a MediaSource handle a receiver can't load.
	*
	* An embed (YouTube, Vimeo) has no fallback: its `src` is a provider page, not a stream a receiver can play, so it is
	* cast only when this is set explicitly. Without a source, nothing is loaded on the receiver.
	*/
	get src() {
		if (!isUndefined(this.#src)) return this.#src;
		const media = this.#media;
		if (!media || !getMediaElement(media)) return "";
		if (media.src) return media.src;
		if (media.currentSrc && !media.currentSrc.startsWith("blob:")) return media.currentSrc;
		return media.querySelector("source")?.src ?? "";
	}
	set src(value) {
		if (this.#src === value) return;
		this.#src = value;
		this.#load();
	}
	/** MIME type of the Cast source. When unset, the receiver infers it from the URL. */
	get contentType() {
		return this.#contentType;
	}
	set contentType(value) {
		if (this.#contentType === value) return;
		this.#contentType = value;
		this.#load();
	}
	/** Stream type used on the Cast receiver. Falls back to the media's `streamType` if it exposes one. */
	get streamType() {
		return this.#streamType ?? this.#media?.streamType;
	}
	set streamType(value) {
		if (this.#streamType === value) return;
		this.#streamType = value;
		this.#load();
	}
	/** Cast receiver application ID. Read on session start; falls back to the layer's default. */
	get receiver() {
		return this.#receiver;
	}
	set receiver(value) {
		if (this.#receiver === value) return;
		this.#receiver = value;
		this.#load();
	}
	/** Custom data sent to the Cast receiver with the load request. */
	get customData() {
		return this.#customData;
	}
	set customData(value) {
		if (this.#customData === value) return;
		this.#customData = value;
		this.#load();
	}
	#load() {
		if (this.#provider?.remote.state === "connected") this.#provider.load();
	}
};

//#endregion
//#region ../html/dist/dev/extensions/google-cast/extension.js
/**
* Adds the Google Cast extension to the surrounding player.
*
* Renders nothing — place it inside the player and it follows whatever media the player attaches, a plain `<video>`
* included.
*
* @example
*   ```html
*   <video-player>
*   <video src="https://example.com/video.mp4"></video>
*   <google-cast receiver="YOUR_APP_ID"></google-cast>
*   </video-player>
*   ```;
*/
var GoogleCastExtension$1 = class extends PlayerExtensionElement {
	static {
		this.tagName = "google-cast";
	}
	static {
		this.properties = {
			src: { type: String },
			contentType: {
				type: String,
				attribute: "content-type"
			},
			streamType: {
				type: String,
				attribute: "stream-type"
			},
			receiver: { type: String }
		};
	}
	createExtension() {
		return new GoogleCastExtension();
	}
	/** Source URL loaded on the Cast receiver. Falls back to the source the media is playing. */
	get src() {
		return this.extension.src ?? "";
	}
	set src(value) {
		this.extension.src = value ?? void 0;
	}
	/** MIME type of the Cast source. When unset, the receiver infers it from the URL. */
	get contentType() {
		return this.extension.contentType;
	}
	set contentType(value) {
		this.extension.contentType = value ?? void 0;
	}
	/** Stream type used on the Cast receiver. Falls back to the media's `streamType`. */
	get streamType() {
		return this.extension.streamType;
	}
	set streamType(value) {
		this.extension.streamType = value ?? void 0;
	}
	/** Cast receiver application ID. Defaults to Google's default media receiver. */
	get receiver() {
		return this.extension.receiver;
	}
	set receiver(value) {
		this.extension.receiver = value ?? void 0;
	}
	/** Custom data sent to the Cast receiver with the load request. */
	get customData() {
		return this.extension.customData;
	}
	set customData(value) {
		this.extension.customData = value;
	}
};

//#endregion
//#region ../html/dist/dev/define/extensions/google-cast.js
safeDefine(GoogleCastExtension$1);

//#endregion
export { GoogleCastExtension$1 as GoogleCastExtension };
//# sourceMappingURL=google-cast.dev.js.map