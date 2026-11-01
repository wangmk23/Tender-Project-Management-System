import { i as isFunction } from "./predicate-3rF1m2uv.js";
import { t as shallowEqual } from "./shallow-equal-C7S8rj2f.js";
import { t as namedNodeMapToObject } from "./attributes-CI6LN9fK.js";
import { t as listen } from "./listen-CO63BggB.js";
import { n as watchDevicePixelRatio, t as getDevicePixelRatio } from "./device-pixel-ratio-BSKOBkaO.js";
import { n as onEvent } from "./abort-DsWgOZ8b.js";
import { B as sameCandidateSet, Ct as defineBehavior, Dt as defineCompositionFactory, Et as flattenFeatures, F as applyConstraints, Gt as effect, Ht as SVTA_UNSUPPORTED_DRM_SYSTEM, I as applyRules, M as reportAbsentTrackType, Ot as computed, Q as byDescendingResolution, R as excludeUnplayableTracks, Tt as defineFeature, Ut as SVTA_UNSUPPORTED_PLAYBACK_FEATURE, Vt as SVTA_NO_SUPPORTED_VIDEO_TRACK, Wt as SVTA_UNSUPPORTED_VIDEO_FORMAT, c as mediaSourceFeature, d as errorFeature, et as pickAudioTrackFromTracks, ft as getTracksByType, h as reportUnsupportedTrackConditions, k as canPlayTrack, kt as peek, l as hlsLoadingFeature, lt as VIDEO_TYPE_CONFIG, m as calculateDurationFeature, n as hasUnsupportedFeatureCause, o as UNPLAYABLE_SOURCE_MESSAGE, ot as loadVideoSegments, p as currentTimeFeature, rt as tracksUnderPixelArea, st as AUDIO_TYPE_CONFIG, t as firstFatal, x as setupVideoBufferActors, xt as createMachineReactor, y as resolveVideoTrack, yt as isResolvedPresentation } from "./error-surface-BdkX1wpk.js";
import { t as MediaAttachMixin } from "./media-attach-mixin-yt2XYok0.js";
import { t as getTemplateHTML } from "./template-g8ycZc0H.js";
import { t as scaleResolution } from "./resolution-B0j7Y6Nv.js";

//#region ../spf/dist/dev/behaviors/select-tracks.js
/**
* **Default audio/video track selection on src load / unselect on src unload.** When a presentation is resolved, sets
* `selectedVideoTrackId` / `selectedAudioTrackId` from a per-type default rule chain if no selection already exists.
* When the presentation is unset/reset (transitions back to unresolved), clears the selection so a stale id from the
* previous source doesn't persist.
*
* Lifecycle-driven: the pick fires once per transition, and nothing re-picks — that is what separates these from the
* `switch*` variants. External writes (user picks, ABR, programmatic filter-driven re-picks) are left alone, including
* a write naming a track the manifest never offered.
*
* The one thing policed between transitions is a pick the _constraints_ turn against: a rendition's container and
* encryption are only known once its media playlist resolves, which is after the pick was made, so a selection that
* becomes unplayable is dropped. Dropped, never moved — re-picking is exactly the behavior `switchVideoTrack` exists to
* provide. Dropping reports nothing on its own, since whatever made the pick unplayable already reported its own, more
* specific cause.
*
* Selection runs the same rule model `switchVideoTrack` does — a hard `constraints` pre-pass, then an ordered `rules`
* chain, with the pick as the head (see `internal/design/spf/track-switching-model.md`). What differs is reactivity,
* not the rules: this evaluates the chain once on resolve and pins the result, where `switchVideoTrack` re-evaluates
* inside an effect so its rules subscribe to bandwidth and user selection. A rule written for one therefore composes
* into the other unchanged.
*
* Both are config-driven, each per-type export wiring a sensible default: audio's three-tier language policy, and for
* video the _empty_ chain — with nothing narrowing or reordering, the head is the first candidate. The behavior's
* `config` is forwarded to the rules, so options like `preferredAudioLanguage` reach them without an intermediate
* layer.
*
* Note a rule can only pick among real candidates, where the picker it replaced could return any id at all. An id
* absent from the manifest was never selectable, so that narrowing is the point rather than a limitation.
*
* Compose `selectVideoTrack` for the simple "pick a default video track" behavior, or `switchVideoTrack`
* (`./track-switching.ts`) for the ABR-driven variant. Compose `selectAudioTrack` for the simple default pick, or
* `switchAudioTrack` (`./track-switching.ts`) for the filter-reactive + mid-stream-flush slot-owner variant — when
* audio-abr lands, `switchAudioTrack` extends into `switchAudioQuality`. Compose only one per type — they're
* alternatives, not stackable (each writes the same `selected*TrackId` slot). The simple variants tree-shake out the
* heavier machinery (bandwidth estimator, quality selection, flush orchestration).
*
* Text selection has no simple variant here — it's owned by `switchTextTrack` (`./track-switching.ts`), which resolves
* standing `userTextTrackSelection` intent against the constrained, CDN-scoped renditions.
*/
function setupTrackSelection({ state, config: { selectedKey, trackType, constraints, rules, ruleConfig } }) {
	const derivedStateSignal = computed(() => isResolvedPresentation(state.presentation.get()) ? "presentation-resolved" : "presentation-unresolved");
	const deps = {
		state,
		config: ruleConfig
	};
	const candidateSet = computed(() => {
		const presentation = state.presentation.get();
		if (!isResolvedPresentation(presentation)) return [];
		return applyConstraints(constraints, getTracksByType(presentation, trackType), deps);
	}, { equals: sameCandidateSet });
	return createMachineReactor({
		initial: "presentation-unresolved",
		monitor: () => derivedStateSignal.get(),
		states: {
			"presentation-unresolved": {},
			"presentation-resolved": {
				entry: () => {
					if (!state[selectedKey].get()) {
						const id = applyRules(rules, peek(candidateSet), deps)[0]?.id;
						if (id) state[selectedKey].set(id);
					}
					return () => state[selectedKey].set(void 0);
				},
				effects: [() => {
					const selectedId = peek(state[selectedKey]);
					if (!selectedId) return;
					if (candidateSet.get().some((track) => track.id === selectedId)) return;
					const presentation = peek(state.presentation);
					if (isResolvedPresentation(presentation) && getTracksByType(presentation, trackType).some((track) => track.id === selectedId)) state[selectedKey].set(void 0);
				}]
			}
		}
	});
}
/** Default video chain: none. The first candidate is the pick. */
const DEFAULT_VIDEO_RULES = [];
/**
* Default audio chain: the three-tier policy (`preferredAudioLanguage` → `DEFAULT=YES` → first) as a single narrowing
* rule. Returning `[]` when nothing is picked lets `applyRules` fall through to the unnarrowed candidates, so the head
* stays the first track — the same last tier the policy itself ends on.
*/
const preferAudioPolicy = (tracks, { config }) => {
	const id = pickAudioTrackFromTracks(tracks, config);
	const pick = tracks.find((track) => track.id === id);
	return pick ? [pick] : [];
};
const DEFAULT_AUDIO_RULES = [preferAudioPolicy];
/**
* Order the candidates by resolution, largest first, with bandwidth breaking ties between renditions of identical
* dimensions. The background-video default — that variant pins one rendition for the session, and absent a cap the
* largest is the head.
*
* A ranker, so it reorders rather than narrowing: the chain's pick is the head of what it returns, which means ranking
* never has to collapse to one track. Belongs last in a chain — a sort only reorders what survived the filters ahead of
* it, and leaving it last is what lets `applyRules` early-bail before it runs.
*
* Exported because it is a _rule_, not a variant's private policy: the same one composes into `switchVideoTrack`'s
* chain when a ranker is wanted there.
*/
const preferHighestResolution = (tracks) => [...tracks].sort(byDescendingResolution);
/**
* Narrow to the renditions that fit the screen, by pixel area — the screen-size cap from
* `internal/design/spf/features/rendition-selection-caps.md`, as a scope (soft filter) rather than a constraint: an
* over-cap rendition is wasteful, not unplayable, so nothing here may make a source unplayable.
*
* Narrows only — it neither orders the survivors nor resolves the case where none survive, because `applyRules` owns
* both. So it needs a ranker behind it to pick within the cap: `[screenResolutionCap, preferHighestResolution]` yields
* the largest rendition that fits. Composed _last_, the pick would instead be whichever fitting rendition the manifest
* happened to list first.
*
* Reading `state.screenResolution` through its signal is what subscribes a re-evaluating chain (`switchVideoTrack`) to
* screen changes; `selectVideoTrack` pins the first answer instead, by design.
*
* Compares areas rather than matching a `"1080p"`-style tier because a tier only describes a rendition once you assume
* its aspect ratio — the assumption that mis-measures an anamorphic ladder. See `media/dom/screen.ts`.
*
* Three ways the cap ends up not applying, all of them fall-through:
*
* - **No `screenResolution` signal at all**, because the composition omits `trackScreenResolution`. So composing the cap
*   without its signal source is inert rather than broken.
* - **A `screenResolution` of `undefined`**, meaning no screen to read. "Unknown" has to mean "don't cap": treating it as
*   an area of zero would pin every source to its smallest rendition on exactly the environments we know least about.
* - **No rendition fits**, on a screen smaller than the whole ladder. `applyRules` skips the empty result and the chain
*   proceeds unnarrowed, so the ranker behind the cap decides — for `preferHighestResolution`, the largest rendition. A
*   floor is the fix if that ever matters (`rendition-selection-caps.md` carries one), not a special case here.
*/
const screenResolutionCap = (tracks, { state }) => {
	const screenResolution = state?.screenResolution?.get();
	if (!screenResolution) return [];
	return tracksUnderPixelArea(tracks, screenResolution.width * screenResolution.height);
};
/**
* Default video constraints: the capability pre-pass alone. No `excludeFailedCdns` — this variant's compositions run no
* failover monitor, so `failedCdns` has no writer and the constraint would always pass through.
*/
const DEFAULT_VIDEO_CONSTRAINTS = [excludeUnplayableTracks];
/**
* Select a video track when a presentation loads. Clears the selection on src unload.
*
* This is the simple, non-ABR counterpart to `switchVideoTrack` — compose one or the other, not both (both write
* `selectedVideoTrackId`). Composing `selectVideoTrack` alone tree-shakes out the ABR code path (bandwidth-estimator,
* quality-selection); use it for sources without meaningful quality variants, test setups, or players that
* intentionally pin a quality.
*
* @example
*   const reactor = selectVideoTrack.setup({ state });
*/
const selectVideoTrack = defineBehavior({
	stateKeys: ["presentation", "selectedVideoTrackId"],
	contextKeys: [],
	setup: ({ state, config }) => setupTrackSelection({
		state,
		config: {
			selectedKey: VIDEO_TYPE_CONFIG.selectedKey,
			trackType: "video",
			constraints: config?.[VIDEO_TYPE_CONFIG.constraintsKey] ?? DEFAULT_VIDEO_CONSTRAINTS,
			rules: config?.[VIDEO_TYPE_CONFIG.rulesKey] ?? DEFAULT_VIDEO_RULES,
			ruleConfig: config
		}
	})
});
/**
* Select an audio track when a presentation loads. Clears the selection on src unload.
*
* This is the simple, lifecycle-only counterpart to `switchAudioTrack` (in `./track-switching.ts`) — compose one or the
* other, not both (both write `selectedAudioTrackId`). `switchAudioTrack` adds filter-reactivity
* (`userAudioTrackSelection`) and mid-stream-flush orchestration; `selectAudioTrack` covers the default-on-load case
* without those. Use this variant for test setups, audio-only flows that don't expose language switching, or
* composition variants that intentionally pin a track.
*
* @example
*   const reactor = selectAudioTrack.setup({ state });
*
* @example
*   // Language preference, honored by the default audio policy rule
*   const reactor = selectAudioTrack.setup({
*     state,
*     config: { preferredAudioLanguage: 'en' },
*   });
*/
const selectAudioTrack = defineBehavior({
	stateKeys: ["presentation", "selectedAudioTrackId"],
	contextKeys: [],
	setup: ({ state, config }) => setupTrackSelection({
		state,
		config: {
			selectedKey: AUDIO_TYPE_CONFIG.selectedKey,
			trackType: "audio",
			constraints: config?.[AUDIO_TYPE_CONFIG.constraintsKey] ?? [],
			rules: config?.[AUDIO_TYPE_CONFIG.rulesKey] ?? DEFAULT_AUDIO_RULES,
			ruleConfig: config
		}
	})
});

//#endregion
//#region ../spf/dist/dev/media/dom/screen.js
/**
* Screen resolution, as the signal source for a screen-size rendition cap.
*
* Reported as a width and a height rather than a `"720p"`-style tier, because the cap that consumes it compares against
* real track dimensions. A tier only describes a track once you assume its aspect ratio, and that assumption
* mis-measures an anamorphic or otherwise non-16:9 rendition.
*
* The signal source for the screen-size cap in `internal/design/spf/features/rendition-selection-caps.md`.
*
* The screen underneath a window is not stable: rotating a device swaps the axes, and unplugging a monitor or dragging
* the window to another display changes the numbers _and_ which physical screen they describe. So `getScreenResolution`
* reads at call time and caches nothing, and `watchScreenResolution` layers the reacting on top rather than the reader
* holding state of its own.
*/
/**
* Read the screen's resolution, or `undefined` where there isn't one to read.
*
* `undefined` means "unknown", which is the answer a cap needs in order to not cap. `screenResolutionCap` reads it that
* way and declines to narrow, so an unknown screen is "no cap" rather than a cap of zero — the reading a naive `?? 0`
* would produce, which would pin every source to its smallest rendition on exactly the environments we know least
* about.
*
* Dimensions are reported as-is, including the axis swap a rotated device applies to them. Normalizing orientation away
* is a policy question — whether a cap should flap on rotation, or hold the larger budget across both — and belongs to
* the cap rather than to the reading.
*/
function getScreenResolution({ useDevicePixelRatio } = { useDevicePixelRatio: true }) {
	const screen = globalThis.screen;
	if (!screen) return void 0;
	return scaleResolution(screen, useDevicePixelRatio ? getDevicePixelRatio() : 1);
}
/**
* Call `onChange` whenever {@link getScreenResolution} would start answering differently. Returns a function that stops
* watching.
*
* There is no single event for "the screen changed", so this subscribes to every signal that implies one and compares
* readings to decide whether anything actually moved. Comparing is what makes that safe: the signals overlap and
* `resize` in particular is noisy, so over-subscribing costs a discarded read rather than a spurious call.
*
* `onChange` is called once on subscribe with the starting value — including `undefined` where there is no screen — and
* after that only on a genuine change. So a consumer gets its initial state from the watcher and never has to pair it
* with a separate {@link getScreenResolution} call.
*
* The signals, and what each one is here for:
*
* - **`screen`'s own `change`** — the screen itself being reconfigured, or the window landing on a different one. The
*   direct signal, and the only one that catches a window moving between two same-size, same-ratio displays. From the
*   Window Management API, but on the base `Screen` rather than behind `getScreenDetails()`, so it needs no permission
*   — only a secure context. Measured present in Chromium and absent in WebKit and Firefox, hence the three below
*   rather than this alone.
* - **`resize`** — the window changing size, which is also what the OS does to it when the display it was on goes away.
* - **`screen.orientation` change** — rotation, which swaps the axes without necessarily resizing the window.
* - **a `(resolution: <ratio>dppx)` media query** (`watchDevicePixelRatio`) — the device pixel ratio changing under a
*   window that kept its size, which is the cross-display drag between displays of different density.
*
*   Worth keeping despite looking redundant, because it is the only coverage that case has in WebKit and Firefox: neither
*   implements `screen`'s change event, and the drag doesn't resize the window. It is also a cleaner signal in Safari
*   than elsewhere — WebKit holds `devicePixelRatio` independent of page zoom, so there it moves only on a real density
*   change, where Chromium and Gecko fold zoom into it as well.
*
* ⚠️ Known gap, on engines without `screen`'s change event: dragging a window between two different-size displays that
* share a ratio, without the window resizing, changes the reading with nothing firing. Closing it there would mean
* polling, whose interval and battery cost are a policy decision this function shouldn't be making.
*/
function watchScreenResolution(onChange, options = { useDevicePixelRatio: true }) {
	const disconnect = new AbortController();
	const { signal } = disconnect;
	let current = getScreenResolution(options);
	const check = () => {
		const next = getScreenResolution(options);
		if (shallowEqual(current, next)) return;
		current = next;
		onChange(next);
	};
	onChange(current);
	watchDevicePixelRatio(check, signal);
	const screen = globalThis.screen;
	const orientation = screen?.orientation;
	if (globalThis.window) listen(globalThis.window, "resize", check, { signal });
	if (isEventTarget(screen)) listen(screen, "change", check, { signal });
	if (orientation) listen(orientation, "change", check, { signal });
	return () => disconnect.abort();
}
function isEventTarget(value) {
	return isFunction(value?.addEventListener);
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/track-screen-resolution.js
/**
* Mirror the screen's pixel dimensions into reactive state, so a rendition cap can narrow candidates to what the screen
* can actually show without reading the environment at pick time — which would make the picker impure, and would never
* re-pick when the screen changed.
*
* Populated at setup rather than on the first change: `watchScreenResolution` reports its starting value, so nothing
* downstream waits on a screen that may never move. `undefined` where there is no screen to read, which is the value a
* cap reads as "no cap" — see `getScreenResolution` on why that beats a zero.
*
* Reads no other slot, and has no source-identity reset: the screen is independent of the presentation, so a new `src`
* doesn't invalidate the reading.
*/
function trackScreenResolutionSetup({ state, config }) {
	const useDevicePixelRatio = config?.useDevicePixelRatio ?? true;
	return watchScreenResolution((resolution) => state.screenResolution.set(resolution), { useDevicePixelRatio });
}
const trackScreenResolution = defineBehavior({
	stateKeys: ["screenResolution"],
	contextKeys: [],
	setup: trackScreenResolutionSetup
});

//#endregion
//#region ../spf/dist/dev/features/background-video.js
const videoConstraints = [excludeUnplayableTracks, reportAbsentTrackType(SVTA_NO_SUPPORTED_VIDEO_TRACK)];
const videoRules = [screenResolutionCap, preferHighestResolution];
/** The behaviors the feature composes, in setup order. */
const behaviors$1 = [
	selectVideoTrack,
	resolveVideoTrack,
	setupVideoBufferActors,
	loadVideoSegments,
	trackScreenResolution
];
/** The config defaults the feature contributes. */
const defaultConfig$1 = {
	videoConstraints,
	videoRules,
	canPlayTrack,
	reportUnsupportedTrackConditions
};
/** The state values the feature seeds. */
const initialState$1 = {};
/**
* Plays one video rendition for the whole session: the largest that fits the screen, picked once rather than adapted to
* bandwidth. For ambient, hero, and GIF-replacement video. Reports when no rendition is playable.
*
* Requires, from this or other features:
*
* - A writer of `context.mediaSource`, such as `mediaSourceFeature`; nothing loads without one.
* - A writer of `state.currentTime`, such as `currentTimeFeature`; without one, loading stops after the first window.
* - A writer of `state.loadActivated`, such as `initialLoadFeature`, or a seeded `loadActivated: true`; without one, only
*   init segments load.
*/
const backgroundVideoFeature = defineFeature({
	behaviors: behaviors$1,
	defaultConfig: defaultConfig$1,
	initialState: initialState$1
});

//#endregion
//#region ../spf/dist/dev/engines/hls-background-video.js
/**
* The features the background-video playback engine composes, in order. A feature's behaviors compose in its position,
* and a later feature's `defaultConfig` and `initialState` values replace an earlier one's.
*/
const features = [
	hlsLoadingFeature,
	errorFeature,
	calculateDurationFeature,
	mediaSourceFeature,
	backgroundVideoFeature,
	currentTimeFeature
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
/**
* The state the engine starts with. `loadActivated: true` stands in for `initialLoadFeature`, which this engine doesn't
* compose, so it starts loading the moment a source is set.
*/
const initialState = {
	...composed.initialState,
	loadActivated: true
};
/**
* Create a background-video playback engine.
*
* Subtractive composition over the HLS engine baseline: audio-side, text-side, ABR-driven, preload-monitoring, and
* play/seek load-trigger behaviors are removed. `selectVideoTrack` (with a highest-resolution rule by default) replaces
* `switchVideoQuality`, pinning a single rendition for the session. The initial state seeds `loadActivated: true` so
* the composition behaves as if preload has already been activated — appropriate for ambient / hero / GIF-replacement
* surfaces that should start loading the moment a src is set.
*
* Error reporting is _not_ subtracted: `collectErrors` owns the sequence, `resolveVideoTrack` reports per-rendition
* causes, and `selectVideoTrack` reports the video verdict when nothing survives its constraints. Without them every
* unplayable source here is a silent stall — an unsupported container, encryption this engine can't decrypt, and an
* undecodable codec all leave `HTMLMediaElement.error` null on both Chromium and WebKit.
*
* Native `loop` / `muted` / `autoplay` are adapter concerns and live on `HlsBackgroundVideoAdapterCore` rather than the
* engine.
*
* @example
*   ```ts
*   const engine = createEngine();
*
*   engine.context.mediaElement.set(videoEl);
*   engine.state.presentation.set({ url: 'https://example.com/stream.m3u8' });
*
*   await engine.destroy();
*   ```;
*/
const createEngine = defineCompositionFactory(behaviors, {
	defaultConfig,
	initialState
});

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-background-video/mixin.js
/**
* Which reported conditions this composition treats as **fatal** — the ones that reach `error` and fire `'error'`.
* Severity isn't part of an SVTA code (§Approach: "impact varies with player implementation"), so it's decided at this
* boundary rather than by the reporter.
*
* **Causes are fatal here, unlike on the other two adapters.** There, a cause is context — one unplayable rendition
* doesn't fail a source whose others still play, and a verdict follows if the type empties. In the pinned variant a
* cause _is_ the verdict: only the pinned rendition's playlist is ever resolved, so a cause can only be about the pick
* itself, and dropping that pick is final — nothing here re-picks (that is what `switchVideoTrack` exists for, and this
* engine doesn't compose it). Measured on Chromium: an MPEG-TS source reports 1004 and an encrypted one 4008, each with
* no verdict behind it, and the element then sits at `readyState 0` with `error` null forever.
*
* The verdict is still listed, for the shapes that report nothing else: no video renditions at all, or a ladder pruned
* before anything resolves — both of which `reportAbsentTrackType` covers from the tail of the constraint chain.
*
* First-fatal-wins then surfaces the cause rather than the verdict when both are present, which is the more specific of
* the two.
*/
const FATAL_SVTA_CODES = /* @__PURE__ */ new Set([
	SVTA_NO_SUPPORTED_VIDEO_TRACK,
	SVTA_UNSUPPORTED_VIDEO_FORMAT,
	SVTA_UNSUPPORTED_DRM_SYSTEM
]);
/**
* Mixin that adds the background-video SPF playback engine to any base class, for an HLS URL.
*
* `src` is the whole input surface, and `error` is the one output: nothing about an unplayable source reaches the media
* element on its own here — an unsupported container, encryption with no EME, and an undecodable codec all leave
* `HTMLMediaElement.error` null with the element stalled at `readyState 0` (measured on Chromium and WebKit) — so a
* consumer that watched only the `<video>` would see a source that never appears and never says why. The engine reports
* each condition onto `engine.state.errors` and logs it; this adapter promotes the first fatal one, mapping it the same
* way the video and audio Medias map theirs. See `internal/design/spf/features/errors.md`.
*
* Selection pins the largest rendition that _fits the screen_, and holds it for the session. The manifest is still the
* better place to narrow further: a delivery param — `?max_resolution=720p` on a Mux stream URL, for one — keeps the
* renditions it excludes out of the manifest entirely, rather than fetched-then-unpicked.
*
* The pin is given up, never moved, if the pick turns out to be unplayable: the container is only known once a media
* playlist resolves, which is after the pick is made, so the selection clears rather than quietly appending bytes
* nothing can decode.
*
* `<mux-background-video>` in html and react is this same Media under a Mux-flavored name — an alias, not a variant.
* Nothing about the surface changes with the name.
*
* Everything else the use case fixes rather than exposes: video-only, looping, muted, autoplaying, loading as soon as
* there is a source. `attach` writes that onto the element and nothing here declares `loop` / `muted` / `autoplay` /
* `preload` of its own — a host-bound Media inherits all four from the host already, and shadowing them with fixed
* values would only make reads describe an intention rather than what the element is doing.
*
* A new src re-resolves the presentation, tearing down the state, SourceBuffers, and in-flight requests the previous
* one built before the next begins. The engine instance and the attached media element are both kept, so neither has to
* be rewired.
*
* @example
*   class HlsBackgroundVideoAdapter extends HlsBackgroundVideoMixin(BackgroundVideoHost) {}
*
*   const media = new HlsBackgroundVideoAdapter();
*   media.attach(document.querySelector('video'));
*   media.src = 'https://stream.mux.com/PLAYBACK_ID.m3u8?max_resolution=720p';
*   media.play();
*
* @fires error - Fired when a fatal condition is reported. Read `error` for it.
*/
function HlsBackgroundVideoMixin(BaseClass) {
	class HlsBackgroundVideoImpl extends BaseClass {
		static defaultProps = { src: "" };
		#engine;
		#config;
		#error = null;
		/**
		* The _reported_ condition currently surfaced, which is what the re-fire latch keys on. Not `#error.code`: that's
		* the code this adapter chose to surface, and the substitution below can make the two differ.
		*/
		#reportedCode = null;
		#stopErrorSync;
		/** Aborting a generation cancels all retries, including ones not yet registered. */
		#playGeneration = new AbortController();
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
		get engine() {
			return this.#engine;
		}
		/**
		* The current fatal condition, or `null`. Only _fatal_ ones appear here — the engine reports non-fatal ones too
		* (they stay in `engine.state.errors`), and promoting them would say playback had failed when it hadn't. Which ones
		* are fatal is wider here than on the video and audio Medias; see {@link FATAL_SVTA_CODES}. Resets per source.
		* Fires `'error'` when set.
		*
		* Mapped the same way theirs are: a sequence holding an unimplemented-capability cause surfaces as
		* {@link SVTA_UNSUPPORTED_PLAYBACK_FEATURE} (99001) with the specifics logged, because "this player can't play this
		* source" is what a consumer can act on, where a raw container or DRM code only says what to go and look up.
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
			console.error(UNPLAYABLE_SOURCE_MESSAGE, { conditions: errors });
			this.#error = {
				code: hasUnsupportedFeatureCause(errors) ? SVTA_UNSUPPORTED_PLAYBACK_FEATURE : reported.code,
				message: reported.message ?? "",
				...reported.data === void 0 ? {} : { data: reported.data }
			};
			this.dispatchEvent?.(new Event("error"));
		}
		attach(mediaElement) {
			if (mediaElement !== this.#engine.context.mediaElement.get()) this.#cancelPendingPlay();
			super.attach?.(mediaElement);
			mediaElement.loop = true;
			mediaElement.muted = true;
			mediaElement.autoplay = true;
			mediaElement.preload = "auto";
			this.#engine.context.mediaElement.set(mediaElement);
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
		get src() {
			return this.#engine.state.presentation.get()?.url ?? "";
		}
		set src(value) {
			if (value === this.src) return;
			this.#cancelPendingPlay();
			this.#engine.state.presentation.set(value ? { url: value } : void 0);
		}
		async play() {
			const mediaElement = this.#engine.context.mediaElement.get();
			if (!mediaElement) return Promise.reject(/* @__PURE__ */ new Error("HlsBackgroundVideoAdapterCore: no media element attached"));
			const { signal } = this.#playGeneration;
			try {
				return await mediaElement.play();
			} catch (err) {
				signal.throwIfAborted();
				if (this.src) return onEvent(mediaElement, "loadstart", { signal }).then(() => {
					signal.throwIfAborted();
					return mediaElement.play();
				});
				throw err;
			}
		}
		#createEngine() {
			return createEngine(this.#config);
		}
		#cancelPendingPlay() {
			this.#playGeneration.abort();
			this.#playGeneration = new AbortController();
		}
	}
	return HlsBackgroundVideoImpl;
}
/** Standalone SPF background-video adapter with no base class. */
var HlsBackgroundVideoAdapterCore = class extends HlsBackgroundVideoMixin(class {}) {};

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-background-video/host.js
/**
* The `<video>` binding a background video uses: somewhere to keep the attached element, and the four properties the
* Media fixes on it.
*
* That is the whole surface anything here reaches. The engine drives playback, the element exposes `src` and nothing
* else, and the background player subscribes to no store features, so nothing asks a background video for
* `currentTime`, `play()`, picture-in-picture, fullscreen, forwarded events, or media components. Holding the host to
* what is reachable is what keeps this entry free of `@videojs/media`, and small enough to suit a component whose whole
* pitch is its size.
*
* An `EventTarget`, because a Media is one: the store and the element layers take anything they attach as an event
* source, and inheriting the three methods satisfies that for free rather than by stubbing them.
*
* ⚠️ It still implements too little to carry the rest of the media surface, which bounds what may consume it: a store
* feature reading a property outside this set gets `undefined` rather than an error. A Media needing more of that
* surface belongs on a host that provides it.
*/
var BackgroundVideoHost = class extends EventTarget {
	#target = null;
	attach(target) {
		if (!target || this.#target === target) return;
		this.#target = target;
	}
	detach() {
		this.#target = null;
	}
	get loop() {
		return this.#target?.loop ?? false;
	}
	set loop(value) {
		if (this.#target) this.#target.loop = value;
	}
	get muted() {
		return this.#target?.muted ?? false;
	}
	set muted(value) {
		if (this.#target) this.#target.muted = value;
	}
	get autoplay() {
		return this.#target?.autoplay ?? false;
	}
	set autoplay(value) {
		if (this.#target) this.#target.autoplay = value;
	}
	get preload() {
		return this.#target?.preload ?? "metadata";
	}
	set preload(value) {
		if (this.#target) this.#target.preload = value;
	}
};

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-background-video/adapter.js
/**
* The background-video Media, bound to a `<video>` through {@link BackgroundVideoHost}.
*
* That host carries the attached element and the four properties `attach` fixes, which is all this Media's surface
* needs, and it is local — so this entry has no `@videojs/media` dependency.
*
* No `MediaTracksMixin`, unlike `HlsVideoAdapter`: the engine subtracts audio and text entirely and pins one video
* rendition for the session, so there are no track lists for a consumer to project or switch between.
*/
var HlsBackgroundVideoAdapter = class extends HlsBackgroundVideoMixin(BackgroundVideoHost) {};

//#endregion
//#region ../html/dist/dev/media/hls-background-video/adapter.js
const HTMLElementBase = globalThis.HTMLElement ?? class {};
const HlsBackgroundVideoBase = MediaAttachMixin(HTMLElementBase);
/**
* A muted, looping, chrome-less video over the SPF background-video engine.
*
* The SPF-backed counterpart to `<background-video>`, which plays its source natively. This one streams HLS through the
* engine, which pins a single rendition for the session rather than adapting, and drops audio and text handling
* entirely — the shape an ambient hero video actually wants.
*
* Nearer an image than a player, and `src` is the whole surface. Replaces the standalone `mux-background-video`
* package, whose `audio`, `debug`, `preload`, and `max-resolution` attributes are all deliberately absent. Capping
* which rendition is fetched is a delivery param on the URL — `?max_resolution=720p` on a Mux stream, for one — which
* keeps the renditions it excludes out of the manifest rather than merely unpicked; `preload` would have nothing to
* say, since the engine loads from the moment it has a source. And unlike `<background-video>` there are no `nomuted` /
* `noloop` / `noautoplay` opt-outs: those three are what this element is for, so the adapter fixes them on at attach.
*
* Takes no structured `source` — `src` is an HLS URL, as the package it replaces required. Mux playback-ID identity,
* poster, and storyboard belong to `<mux-video>`; none of them mean anything without controls to hang them on.
*
* Nothing about an unplayable source reaches the inner `<video>` on its own, so `error` on it stays null and the
* element sits at `readyState 0`. The engine reports each condition and logs it, the Media promotes the fatal one, and
* this element re-fires it as its own `error` / `'error'` — the one place a consumer holding the element can see a
* source that never appears.
*
* @example
*   ```html
*   <hls-background-video src="https://stream.mux.com/PLAYBACK_ID.m3u8?max_resolution=720p">
*   <img src="https://image.mux.com/PLAYBACK_ID/thumbnail.webp?time=0" alt="" />
*   </hls-background-video>
*   ```;
*
* @fires error - Fired when a fatal condition is reported. Read `error` for it.
*
*   `<mux-background-video>` is this element under the name the package it replaces used. Same class, so the tag is a
*   naming choice and nothing more.
*/
var HlsBackgroundVideo = class extends HlsBackgroundVideoBase {
	static {
		this.shadowRootOptions = { mode: "open" };
	}
	static {
		this.getTemplateHTML = getTemplateHTML;
	}
	static get observedAttributes() {
		return ["src"];
	}
	#media = new HlsBackgroundVideoAdapter();
	constructor() {
		super();
		if (!this.shadowRoot) {
			this.attachShadow(this.constructor.shadowRootOptions);
			const attrs = {
				...namedNodeMapToObject(this.attributes),
				muted: "",
				loop: "",
				autoplay: "",
				playsinline: "",
				disableremoteplayback: "",
				disablepictureinpicture: ""
			};
			this.shadowRoot.innerHTML = getTemplateHTML(attrs);
		}
		const video = this.video;
		if (video) this.#media.attach(video);
		this.#media.addEventListener("error", () => this.dispatchEvent(new Event("error")));
	}
	/** Register the Media (not the inner `<video>`) with the provider. */
	getMediaTarget() {
		return this.#media;
	}
	disconnectedCallback() {
		super.disconnectedCallback?.();
		if (this.hasAttribute("keep-alive")) return;
		queueMicrotask(() => {
			if (!this.isConnected) this.#media.destroy();
		});
	}
	attributeChangedCallback(name, oldValue, newValue) {
		if (oldValue === newValue) return;
		if (name === "src") this.src = newValue ?? "";
	}
	/** The inner `<video>` the engine renders into. */
	get video() {
		const video = this.shadowRoot?.querySelector("video");
		return video instanceof HTMLVideoElement ? video : null;
	}
	/**
	* What made the current source unplayable, or `null`. An SVTA code rather than a `MediaError` one — 99001 where this
	* player has no pipeline for what the source needs, with the specifics logged. Reset by a new source, and not on the
	* inner `<video>`, which never learns of it.
	*/
	get error() {
		return this.#media.error;
	}
	/** HLS manifest URL. Assigning a new one restarts playback from scratch. */
	get src() {
		return this.#media.src;
	}
	set src(value) {
		this.#media.src = value;
	}
};

//#endregion
export { HlsBackgroundVideo as t };
//# sourceMappingURL=adapter-BMUDxUdB.js.map