import { n as onEvent } from "./abort-DsWgOZ8b.js";
import { Bt as SVTA_NO_SUPPORTED_AUDIO_TRACK, Dt as defineCompositionFactory, Et as flattenFeatures, Gt as effect, Ut as SVTA_UNSUPPORTED_PLAYBACK_FEATURE, c as mediaSourceFeature, d as errorFeature, l as hlsLoadingFeature, m as calculateDurationFeature, n as hasUnsupportedFeatureCause, p as currentTimeFeature, r as withAlternativeMediaSuggestion, s as UNSUPPORTED_PLAYBACK_FEATURE_MESSAGE, t as firstFatal } from "./error-surface-BdkX1wpk.js";
import { r as toMediaCrossOrigin } from "./types-D8a85nGw.js";
import { t as HTMLMediaAdapter } from "./html-media-adapter-GddOWzPG.js";
import { _ as airPlayFeature, c as multiCdnFeature, d as chaptersFeature, f as audioFeature, l as initialLoadFeature, n as startPositionFeature, r as shiftTimestampsFeature, t as crossOriginToRequestCredentials, u as endStallRecoveryFeature } from "./request-credentials-Brxpq2bX.js";

//#region ../media/dist/dev/dom/html-audio-adapter/html-audio-adapter.js
/** @internal */
var HTMLAudioAdapter = class extends HTMLMediaAdapter {};

//#endregion
//#region ../spf/dist/dev/engines/hls-audio.js
/**
* The features the audio-only HLS playback engine composes, in order. A feature's behaviors compose in its position,
* and a later feature's `defaultConfig` and `initialState` values replace an earlier one's.
*/
const features = [
	initialLoadFeature,
	hlsLoadingFeature,
	multiCdnFeature,
	errorFeature,
	calculateDurationFeature,
	mediaSourceFeature,
	audioFeature,
	shiftTimestampsFeature,
	airPlayFeature,
	currentTimeFeature,
	startPositionFeature,
	endStallRecoveryFeature,
	chaptersFeature
];
const composed = flattenFeatures(features);
/**
* The behaviors the engine composes, in setup order: its features' behaviors, each composed once. The engine's state
* and context types are derived from this list, so adding or removing a feature changes them with no separate type to
* update.
*/
const behaviors = composed.behaviors;
/**
* The defaults `createEngine` fills in for every config key the caller leaves `undefined`: its features' merged
* `defaultConfig`. Each is optional in `EngineConfig`, so a caller may override it.
*/
const defaultConfig = composed.defaultConfig;
/** The state the engine starts with: its features' merged `initialState`. */
const initialState = composed.initialState;
/**
* Create an audio-only HLS playback engine.
*
* Subtractive composition variant of the HLS video engine (`./hls-video`): omits video-side behaviors
* (`resolveVideoTrack`, `switchVideoTrack`, `setupVideoBufferActors`, `loadVideoSegments`) and subtitle behaviors
* (`switchTextTrack`, `resolveTextTrack`, `syncTextTracks`, `setupTextTrackActors`, `loadTextTrackSegments`). Chapters
* (`loadChapters`) stay: they are session data, not a subtitle rendition. The remaining audio pipeline composes
* unchanged.
*
* Handles both truly audio-only HLS sources (no video stream-inf) and mixed-AV HLS sources where the audio rendition is
* selected and video / subtitle renditions are ignored at composition time. The variant decision is encoded by adapter
* choice; this engine does not branch on source shape.
*
* @example
*   ```ts
*   const engine = createEngine();
*
*   engine.context.mediaElement.set(audioEl);
*   engine.state.presentation.set({ url: 'https://example.com/stream.m3u8' });
*   ```;
*/
const createEngine = defineCompositionFactory(behaviors, {
	defaultConfig,
	initialState
});

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-audio/mixin.js
/**
* Which reported conditions this composition treats as fatal. Only the audio verdict: an audio-only engine composes no
* video selection, so `SVTA_NO_SUPPORTED_VIDEO_TRACK` is never reported and surfacing it would describe a track type
* this media doesn't have.
*/
const FATAL_SVTA_CODES = /* @__PURE__ */ new Set([SVTA_NO_SUPPORTED_AUDIO_TRACK]);
/**
* Mixin that adds SPF audio-only HLS playback to any base class.
*
* Parallel to `HlsVideoMixin` with one substantive difference: the underlying engine is the audio-only variant
* (`createEngine`), which omits video and text-track behaviors. The src / preload / disableRemotePlayback / play()
* contract per the WHATWG HTML spec is identical to the default adapter.
*
* Selecting this adapter is the variant decision: instantiating `HlsAudioAdapterCore` opts the consumer into audio-only
* delivery even when the source is a mixed-AV HLS manifest.
*
* @example
*   class HlsAudioAdapter extends HlsAudioMixin(HTMLVideoAdapter) {}
*
*   const media = new HlsAudioAdapter();
*   media.attach(document.querySelector('video'));
*   media.src = 'https://stream.mux.com/abc123.m3u8';
*
* @fires error - Fired when a fatal condition is reported. Read `error` for it.
*/
function HlsAudioMixin(BaseClass) {
	class HlsAudioImpl extends BaseClass {
		static defaultProps = {
			src: "",
			source: null,
			preload: "",
			crossOrigin: null,
			disableRemotePlayback: false
		};
		/**
		* A complete sentence naming the Media to reach for when this one can't play a source. Appended to the copy this
		* adapter logs.
		*
		* Empty here, and overridden the same way as on the video adapter — see its note. `hls-audio` has no
		* better-equipped sibling of its own; the Mux audio Media built on this engine does, and points at the
		* hls.js-backed one.
		*/
		static get alternativeMediaSuggestion() {}
		#engine;
		#config;
		#preload = HlsAudioImpl.defaultProps.preload;
		#crossOrigin = toMediaCrossOrigin(HlsAudioImpl.defaultProps.crossOrigin);
		#disableRemotePlayback = HlsAudioImpl.defaultProps.disableRemotePlayback;
		#error = null;
		/** Reported condition currently surfaced — see the video adapter's note. */
		#reportedCode = null;
		#stopErrorSync;
		/** Aborting a generation cancels all retries, including ones not yet registered. */
		#playGeneration = new AbortController();
		#source = HlsAudioImpl.defaultProps.source;
		constructor(...args) {
			super(...args);
			const { config } = args[0] ?? {};
			this.#config = config ?? {};
			this.#engine = this.#createEngine();
			this.#stopErrorSync = effect(() => {
				const errors = this.#engine.state.errors.get();
				this.#setError(firstFatal(errors, FATAL_SVTA_CODES), errors);
			});
		}
		/**
		* The current fatal error, or `null`. Only _fatal_ conditions appear here — the engine reports non-fatal ones too,
		* which stay in `engine.state.errors`. Resets per source. Fires `'error'` when set.
		*/
		get error() {
			return this.#error;
		}
		#setError(reported, errors) {
			if (!reported) {
				this.#error = null;
				this.#reportedCode = null;
				return;
			}
			if (this.#reportedCode === reported.code) return;
			this.#reportedCode = reported.code;
			const unsupported = hasUnsupportedFeatureCause(errors);
			if (unsupported) console.error(this.#withSuggestion(UNSUPPORTED_PLAYBACK_FEATURE_MESSAGE), { conditions: errors });
			this.#error = {
				code: unsupported ? SVTA_UNSUPPORTED_PLAYBACK_FEATURE : reported.code,
				message: reported.message ?? "",
				...reported.data === void 0 ? {} : { data: reported.data }
			};
			this.dispatchEvent?.(new Event("error"));
		}
		/**
		* Underlying playback engine — the low-level SPF reactive composition that drives playback. An advanced escape
		* hatch for direct engine access; normal playback is driven through this element's own properties and methods.
		*/
		get engine() {
			return this.#engine;
		}
		attach(mediaElement) {
			if (mediaElement !== this.#engine.context.mediaElement.get()) this.#cancelPendingPlay();
			super.attach?.(mediaElement);
			this.#engine.context.mediaElement.set(mediaElement);
			this.#crossOrigin = toMediaCrossOrigin(mediaElement.crossOrigin) ?? this.#crossOrigin;
			mediaElement.crossOrigin = this.#crossOrigin;
		}
		detach() {
			this.#cancelPendingPlay();
			this.#engine.context.mediaElement.set(void 0);
			super.detach?.();
		}
		destroy() {
			this.#cancelPendingPlay();
			this.#stopErrorSync();
			this.#engine.destroy();
		}
		get crossOrigin() {
			return this.#crossOrigin;
		}
		set crossOrigin(value) {
			this.#crossOrigin = toMediaCrossOrigin(value);
			const mediaElement = this.#engine.context.mediaElement.get();
			if (mediaElement) mediaElement.crossOrigin = value;
		}
		/** Preload type (`'none'` / `'metadata'` / `'auto'`). */
		get preload() {
			return this.#preload;
		}
		set preload(value) {
			this.#preload = value;
			if (value) this.#engine.state.preload.set(value);
		}
		get disableRemotePlayback() {
			return this.#disableRemotePlayback;
		}
		set disableRemotePlayback(value) {
			this.#disableRemotePlayback = value;
			this.#engine.state.disableRemotePlayback.set(value);
		}
		get src() {
			return this.#engine.state.presentation.get()?.url ?? "";
		}
		set src(value) {
			if (value === this.src) return;
			this.#source = value ? { src: value } : null;
			this.#applySrc(value);
			this.dispatchEvent?.(new Event("sourcechange"));
		}
		/**
		* Structured source, the same shape the video flavor takes so one object serves either.
		*
		* `drm` is accepted and inert: this engine composes no EME. It is kept in the shape rather than removed so a source
		* can be handed to both flavors — and because Mux encrypts video renditions and leaves audio clear, so a protected
		* playback ID plays here regardless.
		*
		* @fires sourcechange - Fired when `source` changes. Read `source` for the new value.
		*/
		get source() {
			return this.#source;
		}
		set source(value) {
			const source = value ?? null;
			if (source === this.#source) return;
			this.#source = source;
			this.#applySrc(source?.src ?? "");
			this.dispatchEvent?.(new Event("sourcechange"));
		}
		/** Point the engine at a URL; an unchanged one is not a reload request. */
		#applySrc(value) {
			if (value === this.src) return;
			this.#cancelPendingPlay();
			this.#engine.state.presentation.set(value ? { url: value } : void 0);
		}
		play() {
			const mediaElement = this.#engine.context.mediaElement.get();
			if (!mediaElement) return Promise.reject(/* @__PURE__ */ new Error("HlsAudioAdapterCore: no media element attached"));
			const { signal } = this.#playGeneration;
			this.#engine.state.loadActivated.set(true);
			return mediaElement.play().catch((err) => {
				signal.throwIfAborted();
				if (this.src) return onEvent(mediaElement, "loadstart", { signal }).then(() => {
					signal.throwIfAborted();
					return mediaElement.play();
				});
				throw err;
			});
		}
		/** `message`, plus the alternative-Media sentence when this class names one. */
		#withSuggestion(message) {
			return withAlternativeMediaSuggestion(message, this);
		}
		#createEngine() {
			return createEngine({
				...this.#config,
				requestCredentials: this.#config?.requestCredentials ?? (() => crossOriginToRequestCredentials(this.#crossOrigin))
			});
		}
		#cancelPendingPlay() {
			this.#playGeneration.abort();
			this.#playGeneration = new AbortController();
		}
	}
	return HlsAudioImpl;
}
/** Standalone SPF audio-only media adapter with no base class. */
var HlsAudioAdapterCore = class extends HlsAudioMixin(class {}) {};

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-audio/adapter.js
var HlsAudioAdapter = class extends HlsAudioMixin(HTMLAudioAdapter) {};

//#endregion
export { HlsAudioAdapter as t };
//# sourceMappingURL=adapter-D8eYKG7L.js.map