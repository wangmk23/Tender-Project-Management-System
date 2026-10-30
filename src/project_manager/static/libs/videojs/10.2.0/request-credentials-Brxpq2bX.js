import { f as isUndefined, i as isFunction } from "./predicate-3rF1m2uv.js";
import { t as listen } from "./listen-CO63BggB.js";
import { t as isWebKitAirPlayCapable } from "./webkit-DXmoZ2Wz.js";
import { $ as matchesPartialTrack, B as sameCandidateSet, Bt as SVTA_NO_SUPPORTED_AUDIO_TRACK, C as fetchStep, Ct as defineBehavior, F as applyConstraints, Gt as effect, I as applyRules, N as getCdnId, Ot as computed, P as getOrderedCdnIds, R as excludeUnplayableTracks, S as dispatchStep, Tt as defineFeature, Vt as SVTA_NO_SUPPORTED_VIDEO_TRACK, _ as resolveAudioTrack, b as setupAudioBufferActors, bt as isResolvedTrack, ct as TEXT_TYPE_CONFIG, dt as getCodecFamilies, f as getMinBufferedEnd, ft as getTracksByType, h as reportUnsupportedTrackConditions, it as loadAudioSegments, j as emitError, jt as update, k as canPlayTrack, kt as peek, lt as VIDEO_TYPE_CONFIG, nt as smallestCoveringPixelArea, rt as tracksUnderPixelArea, st as AUDIO_TYPE_CONFIG, tt as pickTextTrackFromTracks, u as isStandardPreload, ut as findTrackById, vt as getSessionData, wt as attachMediaSourceAsSourceElement, xt as createMachineReactor, yt as isResolvedPresentation, z as preferCodecFamilies } from "./error-surface-BdkX1wpk.js";
import { h as getBandwidthEstimate, m as DEFAULT_BANDWIDTH_CONFIG } from "./session-data-6y7aXrmJ.js";
import { n as APPLE_HLS_CHAPTERS_DATA_ID, t as loadChaptersTracks } from "./load-chapters-tracks-ca_JiVd8.js";

//#region ../spf/dist/dev/core/composition/define-external-signals.js
/**
* Behavior factory that defines a composition's **external signals**: state and context keys set and updated from
* outside the composition (typically by an adapter) that no composed behavior declares, because the behaviors that
* consult them only read them, and read them optionally.
*
* It creates no signals itself. The behavior it returns declares the keys, and `createComposition` creates their
* signals as it does for every other behavior's keys, so they also reach the composition's inferred state and context
* types. The setup does nothing.
*
* Curried so the two shapes are named explicitly while the key lists are inferred and checked against them: leaving out
* a key of `ExternalState` or `ExternalContext` is a compile error. Both shapes must name their keys and make every key
* optional, and both default to none.
*
* @example
*   ```ts
*   const externalSignals = defineExternalSignals<UserTrackSelectionState<'audio'>>()({ state: ['userAudioTrackSelection'] });
*   const behaviors = [resolvePresentation, switchAudioTrack, externalSignals] as const;
*   type State = ResolveBehaviorState<typeof behaviors>; // includes `userAudioTrackSelection`
*   ```;
*/
function defineExternalSignals() {
	return (keys) => ({
		stateKeys: keys.state ?? [],
		contextKeys: keys.context ?? [],
		setup: () => {}
	});
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/airplay.js
/**
* **Bridge MSE playback to AirPlay on WebKit.** MSE streams can't be handed to an AirPlay receiver directly. The
* WebKit-recommended workaround is to append a fallback `<source type="application/x-mpegURL">` carrying the original
* manifest URL: Safari exposes the AirPlay picker and, when a wireless target is selected, plays that native-HLS source
* on the receiver. The session state (WebKit's wireless flag, falling edge debounced — see `REMOTE_INACTIVE_SETTLE_MS`)
* is written straight to its policy consequences, declared here so the cause→policy mapping stays with the feature:
*
* - `state.loadingSuspended` — held while the session is live. Observed by the `loadXSegments` dispatchers (no fetching
*   alongside the receiver) and by `setupMediaSource` (its post-close rebuild waits — attaching runs `element.load()`
*   under the live receiver, which destroys a session still being established). The suspension this behavior holds
*   doubles as its own session fact — same writer, same edges.
* - `state.startPosition` — one-shot command: the position is captured from the element at the session's settled end
*   (still receiver-mirrored) and written once the rebuild's `load()` resets the element (its `'emptied'`), so
*   `applyStartPosition` applies it to the rebuilt source — never to the pre-rebuild element — and starts it where the
*   receiver left off. The playing state rides the same snapshot but stays behavior-local: this behavior itself calls
*   `play()` once the command has been _consumed_ — i.e. after the seek — when the receiver was playing at session end.
*   The whole restore is bound to the presentation the session owned and retracted if that changes.
*
* A source change during a live session releases the hold rather than deferring until the session ends, so the rebuild
* runs and WebKit switches the receiver to the newly-built AirPlay alternate. Measured, not contracted — see the effect
* below. https://webkit.org/blog/15036/how-to-use-media-source-extensions-with-airplay/
*
* Single-positive-state reactor (`'preconditions-unmet'` ↔ `'airplay-capable'`): gated on a WebKit-AirPlay-capable
* media element being in scope. The entry — gated on `context.mediaSource` — appends the fallback `<source>` (kept
* current from `state.presentation`) and enables the AirPlay picker once the MediaSource is open, removing the source
* the moment the MediaSource detaches so it never survives an MSE teardown. State-exit cleanup (author opt-out, detach,
* source reset, behavior destroy) removes the source and restores the element's `disableRemotePlayback` default. No-op
* on non-WebKit platforms (Chromium, Firefox) — `deriveState` never leaves `'preconditions-unmet'`.
*
* MMS and AirPlay want _opposite_ values of `disableRemotePlayback` on the same element, so it is **sequenced**:
*
* - **MMS needs `true` to open.** `setupMediaSource` sets `disableRemotePlayback = true` when it attaches a
*   ManagedMediaSource — Safari won't fire `sourceopen` (and MSE playback never starts) otherwise.
* - **AirPlay needs `false` to offer the picker.** Flipping to `false` _before_ the source opens would prevent
*   `sourceopen`, so the flip is gated on `context.mediaSource` — which `setupMediaSource` publishes exactly once the
*   MS is open. Re-fires per source (the slot clears + republishes on reset).
* - **Author opt-out wins.** `state.disableRemotePlayback` is the author's intent, written only by the media adapter's
*   IDL property; MMS/programmatic code touch the element's own `disableRemotePlayback` instead. A `true` there is
*   unambiguously the author's choice to disable remote playback, so it holds the machine in `'preconditions-unmet'`
*   and nothing is set up.
*/
/**
* How long WebKit's wireless flag must read _inactive_ before the session-driven `loadingSuspended` clears.
*
* Measured on Safari 26.4 (macOS): when an AirPlay session engages, Safari closes the ManagedMediaSource and — while
* its pipeline switches to the native-HLS fallback source — transiently reports `webkitCurrentPlaybackTargetIsWireless
* === false`, firing the changed event. Trusting an instantaneous inactive reading would release `setupMediaSource`'s
* rebuild hold mid-handoff; its recovery `load()` then destroys the very session being established. Rising edges apply
* immediately; only the falling edge waits out this settle window.
*/
const REMOTE_INACTIVE_SETTLE_MS = 1e3;
function deriveState$3(mediaElement, authorDisabledRemotePlayback) {
	if (!mediaElement || !isWebKitAirPlayCapable(mediaElement)) return "preconditions-unmet";
	if (authorDisabledRemotePlayback) return "preconditions-unmet";
	return "airplay-capable";
}
function setupAirPlaySetup({ state, context }) {
	const derivedStateSignal = computed(() => deriveState$3(context.mediaElement.get(), state.disableRemotePlayback.get()));
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			"airplay-capable": { entry: () => {
				const mediaElement = context.mediaElement.get();
				const isSessionActive = () => !!mediaElement.webkitCurrentPlaybackTargetIsWireless;
				let settleTimer;
				let sessionPresentationUrl;
				let pendingRestore;
				/** Presentation an already-written `state.startPosition` belongs to. */
				let restoreOwnerUrl;
				let resumeWhenRestored = false;
				const sync = () => {
					if (isSessionActive()) {
						clearTimeout(settleTimer);
						settleTimer = void 0;
						if (!peek(state.loadingSuspended)) sessionPresentationUrl = peek(state.presentation)?.url;
						state.loadingSuspended.set(true);
					} else if (peek(state.loadingSuspended)) settleTimer ??= setTimeout(() => {
						settleTimer = void 0;
						const stillActive = isSessionActive();
						if (!stillActive) {
							const ownerUrl = sessionPresentationUrl;
							sessionPresentationUrl = void 0;
							if (peek(state.presentation)?.url === ownerUrl) pendingRestore = {
								position: mediaElement.currentTime,
								wasPlaying: !mediaElement.paused,
								presentationUrl: ownerUrl
							};
						}
						state.loadingSuspended.set(stillActive);
					}, REMOTE_INACTIVE_SETTLE_MS);
					else state.loadingSuspended.set(false);
				};
				const listenerCleanup = new AbortController();
				listen(mediaElement, "webkitcurrentplaybacktargetiswirelesschanged", sync, { signal: listenerCleanup.signal });
				listen(mediaElement, "emptied", () => {
					if (!pendingRestore) return;
					const { position, wasPlaying, presentationUrl } = pendingRestore;
					pendingRestore = void 0;
					if (peek(state.presentation)?.url !== presentationUrl) return;
					state.startPosition.set(position);
					restoreOwnerUrl = presentationUrl;
					resumeWhenRestored = wasPlaying;
				}, { signal: listenerCleanup.signal });
				const disposeSourceChangeEnd = effect(() => {
					const url = state.presentation.get()?.url;
					if (!peek(state.loadingSuspended) || url === sessionPresentationUrl) return;
					sessionPresentationUrl = void 0;
					clearTimeout(settleTimer);
					settleTimer = void 0;
					state.loadingSuspended.set(false);
				});
				const disposeRestoreWatch = effect(() => {
					const url = state.presentation.get()?.url;
					const position = state.startPosition.get();
					if (!restoreOwnerUrl) return;
					if (url !== restoreOwnerUrl) {
						restoreOwnerUrl = void 0;
						resumeWhenRestored = false;
						if (position !== void 0) state.startPosition.set(void 0);
						return;
					}
					if (position !== void 0) return;
					restoreOwnerUrl = void 0;
					if (!resumeWhenRestored) return;
					resumeWhenRestored = false;
					mediaElement.play().catch((err) => {
						console.warn("[setupAirPlay] session-end resume play() rejected — staying paused:", err);
					});
				});
				let sourceEl = null;
				const disposeSource = effect(() => {
					const hasMediaSource = !!context.mediaSource.get();
					const sessionActive = !!state.loadingSuspended.get();
					const url = state.presentation.get()?.url ?? "";
					if (!hasMediaSource && !sessionActive) {
						sourceEl?.remove();
						sourceEl = null;
					} else if (hasMediaSource && (!sourceEl || sourceEl.parentNode !== mediaElement)) {
						sourceEl = document.createElement("source");
						sourceEl.type = "application/x-mpegURL";
						mediaElement.append(sourceEl);
						mediaElement.disableRemotePlayback = false;
					}
					if (sourceEl) sourceEl.src = url;
				});
				sync();
				return () => {
					disposeSource();
					disposeSourceChangeEnd();
					disposeRestoreWatch();
					listenerCleanup.abort();
					clearTimeout(settleTimer);
					sourceEl?.remove();
					sourceEl = null;
					mediaElement.disableRemotePlayback = true;
					state.loadingSuspended.set(false);
					if (restoreOwnerUrl) {
						restoreOwnerUrl = void 0;
						resumeWhenRestored = false;
						if (peek(state.startPosition) !== void 0) state.startPosition.set(void 0);
					}
				};
			} }
		}
	});
}
const setupAirPlay = defineBehavior({
	stateKeys: [
		"presentation",
		"disableRemotePlayback",
		"loadingSuspended",
		"startPosition"
	],
	contextKeys: ["mediaElement", "mediaSource"],
	setup: setupAirPlaySetup
});

//#endregion
//#region ../spf/dist/dev/features/airplay.js
/** The behaviors the feature composes, in setup order. */
const behaviors$7 = [setupAirPlay, defineExternalSignals()({ state: ["disableRemotePlayback"] })];
/** The config defaults the feature contributes. */
const defaultConfig$7 = { attachMediaSource: attachMediaSourceAsSourceElement };
/** The state values the feature seeds. */
const initialState$7 = {};
/**
* Plays to AirPlay receivers (WebKit only; inert elsewhere), unless the user sets `disableRemotePlayback`. Attaches the
* MediaSource through a `<source>` element, which the native fallback the receiver plays requires.
*
* Requires a writer of `context.mediaSource`, such as `mediaSourceFeature`; without one, AirPlay is never offered.
*/
const airPlayFeature = defineFeature({
	behaviors: behaviors$7,
	defaultConfig: defaultConfig$7,
	initialState: initialState$7
});

//#endregion
//#region ../spf/dist/dev/media/abr/quality-selection.js
/** Default quality selection configuration. Values match Shaka Player upgrade threshold (0.85 = 15% headroom). */
const DEFAULT_QUALITY_CONFIG = {
	safetyMargin: .85,
	upgradeMargin: 1.15
};
/**
* Resolution as a total pixel count (`width × height`), the basis for comparing two tracks at the same bitrate. Missing
* dimensions count as 0, so tracks without resolution metadata (e.g. audio) area-compare equal.
*/
function resolutionArea(track) {
	return (track.width ?? 0) * (track.height ?? 0);
}

//#endregion
//#region ../spf/dist/dev/behaviors/track-switching.js
/**
* User intent — a soft filter. Narrows to tracks matching the partial-track selection in `user*TrackSelection`; an
* empty match falls through (the composer skips it) to the unfiltered set — e.g. a stale id from a previous source.
*/
function filterByUserSelection(tracks, { state, config }) {
	const key = config.userSelectionKey;
	if (!key) return tracks;
	const filter = state[key]?.get();
	return filter ? tracks.filter((track) => matchesPartialTrack(track, filter)) : tracks;
}
/**
* Audio preference — a soft filter. Prefer the configured language, then manifest-default tracks; an empty match falls
* through to bandwidth ranking. Keep every matching rendition so preference doesn't pin a bitrate.
*/
function preferAudioPolicy(tracks, { config }) {
	const preferredLanguage = config?.preferredAudioLanguage;
	if (preferredLanguage) {
		const matches = tracks.filter((track) => track.language === preferredLanguage);
		if (matches.length) return matches;
	}
	return tracks.filter((track) => track.default === true);
}
/**
* Player-resolution cap — a soft filter, video only. Narrows to the renditions worth delivering at the player element's
* rendered size, so a small embed doesn't pull segments nobody can perceive. The tighter sibling of
* `screenResolutionCap`: the element's box, not the screen behind it.
*
* The cap is the _smallest tier that still covers the player_, and everything at or below it survives — not "everything
* at or below the player's area," which under-serves a player falling between two tiers. Take an 800×450 player against
* a 360p/720p/1080p ladder: only 360p is below it, so capping at the player's area would hold an 800-px-wide box to a
* 640-px-wide picture. The honest answer is the tier above, 720p, with 360p left in for the ranker.
* `smallestCoveringPixelArea` picks that cap; `tracksUnderPixelArea` — the same filter `screenResolutionCap` narrows
* with — applies it.
*
* Renditions declaring no width or height compare as area `0` and are never capped out — they can't be judged against
* the player, and dropping them could strand a source whose renditions all omit it.
*
* Runs _after_ `preferActiveCdn`, so it narrows within the host already chosen. Ahead of it, a cap that pruned every
* rendition of the preferred CDN would leave the scope to fall to the next one with survivors — a size preference
* silently moving playback to another host. Redundant streams normally mirror the same ladder, which makes that a
* nonstandard-but-legal mismatch across CDNs rather than an everyday case; the ordering costs nothing either way.
*
* Reading `state.playerResolution` through its signal is what subscribes the chain to resizes; `undefined` — no signal
* composed, or nothing to measure — means "don't cap" rather than a cap of zero, so the chain proceeds unnarrowed.
*/
function playerResolutionCap(tracks, { state }) {
	const playerResolution = state.playerResolution?.get();
	if (!playerResolution) return tracks;
	const cap = smallestCoveringPixelArea(tracks, playerResolution.width * playerResolution.height);
	return tracksUnderPixelArea(tracks, cap);
}
/**
* Failed-CDN constraint — a _hard_ filter (constraints pre-pass), shared by video and audio. Removes tracks served from
* a CDN currently in failover cooldown (`failedCdns`, written by the failover monitor). Removed tracks are never
* attempted; the scope then narrows to the next surviving CDN in `cdnPriority`, and snaps back to the primary once it
* leaves cooldown.
*
* Passes everything through when there's no `failedCdns` signal/value. When it prunes _every_ track (all CDNs cooled
* down), the empty result is preserved (per `applyConstraints`) — "nothing playable," which clears the selection (no
* pick); a later CDN recovery refills the candidate set and re-picks.
*/
function excludeFailedCdns(tracks, { state, config }) {
	const failed = state.failedCdns?.get();
	if (!failed?.length) return tracks;
	const getCdnId$1 = config.getCdnId ?? getCdnId;
	const failedSet = new Set(failed);
	return tracks.filter((track) => !failedSet.has(getCdnId$1(track.url)));
}
/**
* Active-CDN scope — a soft filter, shared by video and audio. Narrows to the highest-priority CDN in `cdnPriority`
* (owned by `deriveCdnPriority`) that still has tracks, so every track type stays on one CDN. A redundant-streams
* source lists the same renditions on multiple hosts; this keeps the pick on one host rather than letting the ranker
* drift across them.
*
* "Active" is derived, not stored: constraints run before the rule chain, so a failed CDN's tracks are already pruned
* by the time this runs — "first CDN with survivors" _is_ the active CDN, and it falls through to the next on failover
* (and snaps back to the primary when it recovers). Content steering reorders `cdnPriority`; this rule just honors the
* order.
*
* Soft-filter semantics: passes through when there's no `cdnPriority` signal/value (no preference) or when nothing
* matches (`applyRules` skips an empty result). Non-redundant sources have one CDN, so the narrow is a no-op.
*
* The CDN-id derivation defaults to origin-based `getCdnId`, overridable via the `getCdnId` config — it must match the
* one `deriveCdnPriority` used to build `cdnPriority`, or no track's CDN would ever equal an entry.
*/
function preferActiveCdn(tracks, { state, config }) {
	const cdnPriority = state.cdnPriority?.get();
	if (!cdnPriority?.length) return tracks;
	const getCdnId$2 = config.getCdnId ?? getCdnId;
	for (const cdn of cdnPriority) {
		const tracksUsingCdn = tracks.filter((track) => getCdnId$2(track.url) === cdn);
		if (tracksUsingCdn.length) return tracksUsingCdn;
	}
	return tracks;
}
/**
* Codec-family sticky constraint — a _hard_ filter for the constraints pre-pass, shared by video and audio, and the
* reason the re-evaluating variants can run ABR over a mixed-codec source at all: SPF implements no
* `SourceBuffer.changeType()`, so once segments of the selected track's codec families are what a buffer was created
* for, a pick outside them could never play — constraint semantics ("can't play here"), not preference. Removes the
* candidates whose codec-family set doesn't _equal_ the selected track's (set-equality so a muxed `hvc1,mp4a` rendition
* can't pass as a match for `avc1,mp4a` on its audio half). Purely relational: the lock _is_ the current selection's
* families, no state of its own. Pruned pre-pass, a cross-family user selection mid-stream never reaches the user
* filter, which falls through unhonored instead of killing playback. Before any selection exists (the initial pick) it
* removes nothing, which is what leaves the initial family choice to the rule chain (user intent, then
* `preferCodecFamilies`).
*
* The selected track's families come from the _presentation's_ track list, not the already-pruned candidates: a CDN
* entering cooldown may prune the current track itself while same-family renditions survive on another host, and the
* lock must carry over to them. Removes nothing when: no selection yet, a selection the presentation no longer carries,
* or a selected track without codecs (then no candidate's compatibility is decidable — same inertness as
* `preferCodecFamilies` on a codec-less ladder).
*
* When the selected family genuinely vanishes from the playable set, the pre-pass empties: the behavior reports the
* type's no-supported-track code and clears the selection — an explicable stop instead of a cross-family append
* surfacing as an opaque decode error. Clearing also releases the lock (it keys on the live selection), so a following
* pick may land in the surviving family on freshly-created buffer actors; whether the append layer survives that
* rebuild is the changeType gap, out of this constraint's hands. If `changeType` support ever lands, this constraint is
* what relaxes.
*
* Reading the selection here — a slot the picking effect itself writes, from inside the candidate-set computed — is
* safe only because the effect scheduler revalidates an effect's sources after each run; see `core/signals/effect.ts`
* (`revalidateSources`) for the lost-wakeup it prevents.
*
* Composed only into the re-evaluating `switch*` variants: the pinned `selectVideoTrack` (background compositions)
* evaluates once and never re-picks, so it's immune by construction.
*/
function stickToSelectedCodecs(tracks, { state, config }) {
	const currentId = state[config.selectionKey].get();
	if (!currentId) return tracks;
	const presentation = state.presentation.get();
	if (!isResolvedPresentation(presentation)) return tracks;
	const current = config.getTracks(presentation).find((track) => track.id === currentId);
	const families = current && getCodecFamilies(current);
	if (!families) return tracks;
	return tracks.filter((track) => {
		const candidateFamilies = getCodecFamilies(track);
		return !!candidateFamilies && candidateFamilies.length === families.length && candidateFamilies.every((family) => families.includes(family));
	});
}
/**
* Bandwidth ranking — the terminal sort, shared by video and audio. Orders by the throughput estimate: tracks within
* the bandwidth threshold first (fitting), highest bitrate first; then over-threshold tracks, least-over first. The
* head is the best-quality track that fits, falling back to the smallest over-throughput track when nothing fits.
*
* Hysteresis without temporal state: the current track's effective bitrate is boosted by `upgradeMargin` in the fitting
* sort, so a higher track only outranks it once it clears `current.bitrate * upgradeMargin` (no flapping on marginal
* bandwidth gains). Downgrades fall out for free — a current track over the threshold isn't in the fitting set to be
* boosted, so the best fit (a downgrade) wins immediately. Equal-bitrate tracks break by resolution (higher `width ×
* height` first), so an equal-bitrate ladder never picks a lower- quality rendition by manifest order; audio tracks
* carry no dimensions, so they area-compare equal and a stable sort keeps their candidate order (e.g. same-bitrate
* language variants). Early-bail skips this rule when a prior one narrowed to a single track, so the estimate is
* neither read nor subscribed while that holds.
*/
function rankByBandwidth(tracks, { state, config }) {
	const safetyMargin = config.quality?.safetyMargin ?? DEFAULT_QUALITY_CONFIG.safetyMargin;
	const upgradeMargin = config.quality?.upgradeMargin ?? DEFAULT_QUALITY_CONFIG.upgradeMargin;
	const initialBandwidth = config.initialBandwidth ?? 5e6;
	const bandwidthConfig = {
		...DEFAULT_BANDWIDTH_CONFIG,
		...config.bandwidth
	};
	if (!state.bandwidthState) console.debug("[track-switching] rankByBandwidth: no bandwidthState signal in composition; ranking on initialBandwidth");
	const threshold = getBandwidthEstimate(state.bandwidthState?.get(), initialBandwidth, bandwidthConfig) * safetyMargin;
	const currentId = state[config.selectionKey].get();
	const bitrate = (track) => track.bandwidth ?? 0;
	const rank = (track) => track.id === currentId ? bitrate(track) * upgradeMargin : bitrate(track);
	const fitting = tracks.filter((track) => bitrate(track) <= threshold).sort((a, b) => rank(b) - rank(a) || resolutionArea(b) - resolutionArea(a));
	const over = tracks.filter((track) => bitrate(track) > threshold).sort((a, b) => bitrate(a) - bitrate(b) || resolutionArea(b) - resolutionArea(a));
	return [...fitting, ...over];
}
/**
* Default final pick: the chain head. `applyRules` never narrows to nothing and early-bails to a single survivor, so
* video and audio always converge to a track and the head is the pick.
*/
function selectChainHead(candidates) {
	return candidates[0].id;
}
/**
* Terminal pick for text — the `resolveSelection` the text variant supplies. Resolves the standing
* `userTextTrackSelection` intent against the chain's survivors (already CDN-failover-pruned and active-CDN-scoped):
*
* - `'off'` → no selection (clear the slot). Sticky through re-evaluation, so a live refresh or failover re-run can't
*   re-assert a default.
* - Explicit `Partial<TextTrack>` → narrow to the match (language-based). A stale pick whose match is gone (e.g. the
*   language dropped on a source change) falls through to the default policy.
* - Auto (`undefined`) → the opt-in default policy (`preferredSubtitleLanguage` → `DEFAULT=YES + AUTOSELECT=YES` → none),
*   via `pickTextTrackFromTracks`.
*
* Returning `undefined` is a real outcome (captions are opt-in), which is why the text variant relies on
* `setupTrackSwitching`'s no-selection seam.
*/
function pickResolvedTextTrack(candidates, { state, config }) {
	const intent = state.userTextTrackSelection?.get();
	if (intent === "off") return void 0;
	if (intent) {
		const matched = candidates.filter((track) => matchesPartialTrack(track, intent));
		if (matched.length) return matched[0].id;
	}
	return pickTextTrackFromTracks(candidates, config);
}
function setupTrackSwitching(deps) {
	const { state, config } = deps;
	const { selectionKey, getTracks, rules, resolveSelection = selectChainHead, noSupportedTrackCode } = config;
	const derivedStateSignal = computed(() => isResolvedPresentation(state.presentation.get()) ? "presentation-resolved" : "presentation-unresolved");
	const candidateSet = computed(() => {
		const presentation = state.presentation.get();
		if (!isResolvedPresentation(presentation)) return [];
		return applyConstraints(config.constraints ?? [], getTracks(presentation), deps);
	}, { equals: sameCandidateSet });
	return createMachineReactor({
		initial: "presentation-unresolved",
		monitor: () => derivedStateSignal.get(),
		states: {
			"presentation-unresolved": {},
			"presentation-resolved": {
				entry: () => () => state[selectionKey].set(void 0),
				effects: [() => {
					const tracks = candidateSet.get();
					if (!tracks.length) {
						const presentation = peek(state.presentation);
						if (isResolvedPresentation(presentation) && getTracks(presentation).length > 0) {
							if (noSupportedTrackCode !== void 0) emitError(state, {
								code: noSupportedTrackCode,
								data: { selectionKey }
							});
							state[selectionKey].set(void 0);
						}
						return;
					}
					const candidates = applyRules(rules, tracks, deps);
					if (!candidates.length) {
						console.error("[track-switching] applyRules returned no candidates");
						return;
					}
					state[selectionKey].set(resolveSelection(candidates, deps));
				}]
			}
		}
	});
}
/** Default video pre-pass: failed CDNs, capability, codec-family stickiness. */
const DEFAULT_VIDEO_CONSTRAINTS = [
	excludeFailedCdns,
	excludeUnplayableTracks,
	stickToSelectedCodecs
];
/** Default video chain: user intent, codec family, active CDN, player resolution, then the bandwidth ranker. */
const DEFAULT_VIDEO_RULES = [
	filterByUserSelection,
	preferCodecFamilies,
	preferActiveCdn,
	playerResolutionCap,
	rankByBandwidth
];
/** Default audio pre-pass: the video one over audio candidates. */
const DEFAULT_AUDIO_CONSTRAINTS = [
	excludeFailedCdns,
	excludeUnplayableTracks,
	stickToSelectedCodecs
];
/** Default audio chain: user intent, codec family, active CDN, language/default preference, then bandwidth ranking. */
const DEFAULT_AUDIO_RULES = [
	filterByUserSelection,
	preferCodecFamilies,
	preferActiveCdn,
	preferAudioPolicy,
	rankByBandwidth
];
/** Default text pre-pass: failed CDNs only — an MSE codec probe is the wrong question for WebVTT. */
const DEFAULT_TEXT_CONSTRAINTS = [excludeFailedCdns];
/** Default text chain: the active-CDN scope; the pick itself is the text terminal's (`pickResolvedTextTrack`). */
const DEFAULT_TEXT_RULES = [preferActiveCdn];
/**
* Manage `selectedVideoTrackId`: pick a default on src load, dynamically adjust based on bandwidth, clear on src
* unload. Honors `userVideoTrackSelection` as a partial-track constraint on candidates; short-circuits ABR when the
* constraint narrows to a single track.
*
* @example
*   const reactor = switchVideoTrack.setup({ state });
*/
const switchVideoTrack = defineBehavior({
	stateKeys: ["presentation", "selectedVideoTrackId"],
	contextKeys: [],
	setup: ({ state, config, ...otherProps }) => setupTrackSwitching({
		...otherProps,
		state,
		config: {
			...config,
			selectionKey: VIDEO_TYPE_CONFIG.selectedKey,
			userSelectionKey: VIDEO_TYPE_CONFIG.userSelectionKey,
			getTracks: (presentation) => getTracksByType(presentation, "video"),
			constraints: config?.[VIDEO_TYPE_CONFIG.constraintsKey] ?? DEFAULT_VIDEO_CONSTRAINTS,
			rules: config?.[VIDEO_TYPE_CONFIG.rulesKey] ?? DEFAULT_VIDEO_RULES,
			noSupportedTrackCode: SVTA_NO_SUPPORTED_VIDEO_TRACK
		}
	})
});
/**
* Manage `selectedAudioTrackId`: pick a default on src load, narrow by `userAudioTrackSelection` filter, re-pick on
* filter change, clear on src unload.
*
* Mid-stream flush on language switch is handled by the segment-loader's `planTasks` (see
* `playback/actors/dom/segment-loader.ts`) — not this behavior. Same split as the video pipeline: slot owner writes;
* loader orchestrates segment + flush plans.
*
* @example
*   const reactor = switchAudioTrack.setup({ state });
*/
const switchAudioTrack = defineBehavior({
	stateKeys: ["presentation", "selectedAudioTrackId"],
	contextKeys: [],
	setup: ({ state, config, ...otherProps }) => setupTrackSwitching({
		...otherProps,
		state,
		config: {
			...config,
			selectionKey: AUDIO_TYPE_CONFIG.selectedKey,
			userSelectionKey: AUDIO_TYPE_CONFIG.userSelectionKey,
			getTracks: (presentation) => getTracksByType(presentation, "audio"),
			constraints: config?.[AUDIO_TYPE_CONFIG.constraintsKey] ?? DEFAULT_AUDIO_CONSTRAINTS,
			rules: config?.[AUDIO_TYPE_CONFIG.rulesKey] ?? DEFAULT_AUDIO_RULES,
			noSupportedTrackCode: SVTA_NO_SUPPORTED_AUDIO_TRACK
		}
	})
});
/**
* Manage `selectedTextTrackId` as the single-writer **output** of standing user intent (`userTextTrackSelection`)
* resolved against the playable, CDN-scoped text renditions: clear on src unload; re-resolve when a CDN fails or
* recovers.
*
* Unlike video/audio, the selection is _optional_ — captions are opt-in and the user can turn them off — so the chain
* skips the bandwidth ranker and the shared user-selection filter, and supplies a text-specific terminal
* (`pickResolvedTextTrack`) that may resolve to no-selection via `setupTrackSwitching`'s `resolveSelection` seam.
* Constraints are failed-CDN only (`excludeUnplayableTracks`/`canPlayTrack` is MSE-based — the wrong probe for text,
* whose playability is SPF-parser support); the active-CDN scope co-locates captions with the surviving CDN on
* failover.
*
* @example
*   const reactor = switchTextTrack.setup({ state, config: { preferredSubtitleLanguage: 'en' } });
*/
const switchTextTrack = defineBehavior({
	stateKeys: ["presentation", "selectedTextTrackId"],
	contextKeys: [],
	setup: ({ state, config, ...otherProps }) => setupTrackSwitching({
		...otherProps,
		state,
		config: {
			...config,
			selectionKey: TEXT_TYPE_CONFIG.selectedKey,
			getTracks: (presentation) => getTracksByType(presentation, "text"),
			constraints: config?.[TEXT_TYPE_CONFIG.constraintsKey] ?? DEFAULT_TEXT_CONSTRAINTS,
			rules: config?.[TEXT_TYPE_CONFIG.rulesKey] ?? DEFAULT_TEXT_RULES,
			resolveSelection: pickResolvedTextTrack
		}
	})
});

//#endregion
//#region ../spf/dist/dev/features/audio.js
/** The behaviors the feature composes, in setup order. */
const behaviors$6 = [
	resolveAudioTrack,
	switchAudioTrack,
	setupAudioBufferActors,
	loadAudioSegments,
	defineExternalSignals()({ state: ["userAudioTrackSelection"] })
];
/** The config defaults the feature contributes. */
const defaultConfig$6 = {
	canPlayTrack,
	reportUnsupportedTrackConditions
};
/** The state values the feature seeds. */
const initialState$6 = {};
/**
* Plays audio: resolves the selected rendition's playlist, switches renditions, and buffers and loads its segments.
* Honors the user's `userAudioTrackSelection`, such as a language.
*
* Requires, from this or other features:
*
* - A writer of `context.mediaSource`, such as `mediaSourceFeature`; nothing loads without one.
* - A writer of `state.currentTime`, such as `currentTimeFeature`; without one, loading stops after the first window.
* - A writer of `state.loadActivated`, such as `initialLoadFeature`, or a seeded `loadActivated: true`; without one, only
*   init segments load.
*/
const audioFeature = defineFeature({
	behaviors: behaviors$6,
	defaultConfig: defaultConfig$6,
	initialState: initialState$6
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/load-chapters.js
/**
* **Project Apple JSON chapters onto the host media element.** When the resolved presentation carries an
* `#EXT-X-SESSION-DATA` entry for `com.apple.hls.chapters`, fetch the document it points at, parse it, and add one
* hidden `<track kind="chapters">` per title language — cues and all — to `mediaElement`. The element is the store:
* there is no chapters state signal, exactly as subtitle cues live on their DOM tracks and nowhere else. Consumers
* (video.js's textTrack feature, a host page) read the first chapters track's `cues` the way they would an authored
* `<track>`.
*
* Single-positive-state reactor (`'preconditions-unmet'` ↔ `'loading'`), gated on a media element, a resolved
* presentation, and a chapters entry with a URI. An element-bound effect fetches and projects; the returned cleanup
* aborts an in-flight fetch and removes the tracks on element replacement or state exit (source unload, destroy). The
* document leaves the last chapter open; it is written with `OPEN_CHAPTER_END` and never amended — a consumer that
* wants it to end where the media ends clamps to the media duration on read (video.js's textTrack feature does), so
* nothing here waits for, or chases, a duration.
*
* Failures are never fatal: a document that won't load or won't parse is warned about and projects nothing. An entry
* carrying its data inline as `VALUE` is skipped — chapters are a document, not a string. Exactly one document is
* assumed: Apple carries every language inside it, so the first entry with a URI is the one read.
*
* The tracks carry `data-src-chapters-track`, distinct from the subtitle tracks' tag, so neither cleanup removes the
* other's. A `<track kind="chapters">` the host page authored precedes these in `textTracks` (tree order), so a page
* that supplies its own chapters keeps them. On a Mux source this document is the same one the Mux adapter reads for
* the asset title; the request is cacheable, and each side stays ignorant of the other.
*/
function deriveState$2(presentation, mediaElement) {
	if (!mediaElement || !isResolvedPresentation(presentation)) return "preconditions-unmet";
	return findChaptersDocument(presentation) === void 0 ? "preconditions-unmet" : "loading";
}
/** The URI of the chapters document — the first `com.apple.hls.chapters` entry that points at one. */
function findChaptersDocument(presentation) {
	return getSessionData(presentation, APPLE_HLS_CHAPTERS_DATA_ID).find((entry) => entry.uri !== void 0)?.uri;
}
function loadChaptersSetup({ state, context, config }) {
	const derivedStateSignal = computed(() => deriveState$2(state.presentation.get(), context.mediaElement.get()));
	const { requestCredentials } = config;
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			loading: { effects: () => {
				const mediaElement = context.mediaElement.get();
				const presentation = peek(state.presentation);
				const uri = presentation && findChaptersDocument(presentation);
				if (!mediaElement || !uri) return;
				const controller = new AbortController();
				loadChaptersTracks(mediaElement, uri, controller.signal, {
					preferredLanguage: config.preferredSubtitleLanguage,
					credentials: isFunction(requestCredentials) ? requestCredentials({ url: uri }) : requestCredentials
				});
				return controller;
			} }
		}
	});
}
const loadChapters = defineBehavior({
	stateKeys: ["presentation"],
	contextKeys: ["mediaElement"],
	setup: loadChaptersSetup
});

//#endregion
//#region ../spf/dist/dev/features/chapters.js
/** The behaviors the feature composes, in setup order. */
const behaviors$5 = [loadChapters];
/** The config defaults the feature contributes. */
const defaultConfig$5 = {};
/** The state values the feature seeds. */
const initialState$5 = {};
/**
* Adds the source's Apple JSON chapters (`EXT-X-SESSION-DATA`, `com.apple.hls.chapters`) to the media element as a
* hidden `chapters` text track per language.
*/
const chaptersFeature = defineFeature({
	behaviors: behaviors$5,
	defaultConfig: defaultConfig$5,
	initialState: initialState$5
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/recover-end-stall.js
/**
* Whether a `waiting` should be forced to `ended`: the MediaSource is `ended`, the stream is finite (not live),
* playback is active (not paused/seeking/already-ended), and the playhead sits within `nudgeWindow` of the reachable
* buffered end (so it's the true end, not a mid-stream buffer hole). Pure — the behavior supplies the live values.
*/
function shouldForceEnded(input, nudgeWindow) {
	const { msEnded, durationFinite, paused, seeking, ended, currentTime, bufferedEnd } = input;
	if (!msEnded || !durationFinite || paused || seeking || ended || bufferedEnd === void 0) return false;
	const gap = bufferedEnd - currentTime;
	return bufferedEnd > 0 && gap >= 0 && gap < nudgeWindow;
}
function recoverEndStallSetup({ context, config }) {
	const nudgeWindow = config?.endStallNudgeWindow ?? .2;
	return effect(() => {
		const mediaElement = context.mediaElement.get();
		if (!mediaElement) return;
		const onWaiting = () => {
			const mediaSource = context.mediaSource.get();
			if (shouldForceEnded({
				msEnded: mediaSource?.readyState === "ended",
				durationFinite: Number.isFinite(mediaElement.duration),
				paused: mediaElement.paused,
				seeking: mediaElement.seeking,
				ended: mediaElement.ended,
				currentTime: mediaElement.currentTime,
				bufferedEnd: mediaSource ? getMinBufferedEnd(mediaSource.sourceBuffers) : void 0
			}, nudgeWindow)) mediaElement.currentTime = mediaElement.duration;
		};
		return listen(mediaElement, "waiting", onWaiting);
	});
}
const recoverEndStall = defineBehavior({
	stateKeys: [],
	contextKeys: ["mediaElement", "mediaSource"],
	setup: recoverEndStallSetup
});

//#endregion
//#region ../spf/dist/dev/features/end-stall-recovery.js
/** The behaviors the feature composes, in setup order. */
const behaviors$4 = [recoverEndStall];
/** The config defaults the feature contributes. */
const defaultConfig$4 = {};
/** The state values the feature seeds. */
const initialState$4 = {};
/**
* Fires the media element's `ended` when Chrome freezes the playhead a few frames short of the end of a stream whose
* audio and video end at slightly different times. Inert otherwise.
*/
const endStallRecoveryFeature = defineFeature({
	behaviors: behaviors$4,
	defaultConfig: defaultConfig$4,
	initialState: initialState$4
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/track-load-triggers.js
/**
* Slot-driven FSM. The slot `loadActivated` is the canonical externally- observable state; `deriveState` reads it (and
* the preconditions) to derive the local FSM state. The slot is _both_ the state and the data — no separate internal
* bookkeeping.
*
*     'preconditions-unmet' ⟷ 'monitoring' ⟷ 'load-active'
*
*     preconditions-unmet → monitoring        element + URL appear
*     monitoring          → load-active       slot flips true (listener fires
*                                             or external write)
*     load-active         → monitoring        within-state cleanup resets slot
*                                             (URL or element identity change)
*     any                 → preconditions-unmet  element or URL → undefined
*
*     any state → destroying → destroyed       on destroy()
*/
function deriveState$1(presentation, mediaElement, loadActivated) {
	if (!mediaElement || !presentation?.url) return "preconditions-unmet";
	if (loadActivated) return "load-active";
	return "monitoring";
}
/**
* Track preload-overriding events per source.
*
* Writes `state.loadActivated = true` the first time a `play` or `seeking` event fires on the attached media element
* for the current source — or immediately on entry if the element is already committed to loading (`el.autoplay`,
* `!el.paused`, or `el.seeking`), covering autoplay, native-controls, and direct-DOM-`play()` scenarios.
*
* Sticky-true _within a source identity_: subsequent play/pause/seek cycles don't flip back. Source identity =
* (mediaElement, presentation URL). Either changing — including direct in-place swap with no `undefined` intermediate —
* resets the slot to `false`.
*
* Multi-writer with `hls/adapter.ts:play()` (which writes `true` directly on programmatic play) is intentional —
* different domains. The adapter records programmatic intent; this behavior is the DOM-side observer. Pre-existing
* `true` writes are honored because `deriveState` reads the slot — a `true` value routes directly to `'load-active'`
* without entering `'monitoring'`.
*
* @example
*   const reactor = trackLoadTriggers.setup({ state, context });
*   // later:
*   reactor.destroy();
*/
function trackLoadTriggersSetup({ state, context }) {
	const derivedStateSignal = computed(() => deriveState$1(state.presentation.get(), context.mediaElement.get(), state.loadActivated.get()));
	const urlSignal = computed(() => state.presentation.get()?.url);
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			monitoring: { effects: () => {
				const el = context.mediaElement.get();
				const setLoadActivated = () => state.loadActivated.set(true);
				if (el.autoplay || !el.paused || el.seeking) {
					setLoadActivated();
					return;
				}
				const cleanupPlay = listen(el, "play", setLoadActivated);
				const cleanupSeeking = listen(el, "seeking", setLoadActivated);
				return () => {
					cleanupPlay();
					cleanupSeeking();
				};
			} },
			"load-active": { effects: () => {
				context.mediaElement.get();
				urlSignal.get();
				return () => state.loadActivated.set(false);
			} }
		}
	});
}
const trackLoadTriggers = defineBehavior({
	stateKeys: ["loadActivated", "presentation"],
	contextKeys: ["mediaElement"],
	setup: trackLoadTriggersSetup
});

//#endregion
//#region ../spf/dist/dev/behaviors/sync-preload.js
/**
* **Bidirectional sync between `state.preload` and `mediaElement.preload`.**
*
* Two effects:
*
* - **Read (DOM → state)** — on `context.mediaElement` swap or `state.presentation.url` change, copies the media
*   element's _authored_ preload into `state.preload` if it's a W3C value and `state.preload` isn't holding an extended
*   (non-W3C) value. Author intent only: on a DOM element the `preload` IDL property reports a browser-dependent UA
*   default even when no attribute was set (`'metadata'` Chromium, `'auto'` WebKit), so the property is consulted only
*   when the element carries a `preload` content attribute — a UA default is never a source. When the element has no
*   authored W3C opinion and `state.preload` is undefined, backfills from `config.defaultPreload` (default-default
*   `'metadata'`) so `state.preload` is never undefined in steady state.
* - **Write (state → DOM)** — on `state.preload` change or `context.mediaElement` swap, writes `state.preload` back to
*   `mediaElement.preload` if the value is W3C.
*
* Extended values (e.g. `'canplay'`) written externally to `state.preload` are sticky: read won't overwrite them, write
* won't push them to the DOM. All writes are deduped to break echo loops and avoid spurious re-triggers downstream
* (notably `resolvePresentation`, which reads `state.preload`).
*/
function syncPreloadSetup({ state, context, config }) {
	const defaultPreload = config?.defaultPreload ?? "metadata";
	const presentationUrl = computed(() => state.presentation.get()?.url);
	const cleanupRead = effect(() => {
		presentationUrl.get();
		const mediaElement = context.mediaElement.get();
		const current = peek(state.preload);
		if (current !== void 0 && !isStandardPreload(current)) return;
		const authoredPreload = mediaElement && (!mediaElement.hasAttribute || mediaElement.hasAttribute("preload")) ? mediaElement.preload : void 0;
		const target = isStandardPreload(authoredPreload) ? authoredPreload : current === void 0 ? defaultPreload : void 0;
		if (target === void 0 || target === current) return;
		state.preload.set(target);
	});
	const cleanupWrite = effect(() => {
		const next = state.preload.get();
		const mediaElement = context.mediaElement.get();
		if (!mediaElement) return;
		if (!isStandardPreload(next)) return;
		if (mediaElement.preload === next) return;
		mediaElement.preload = next;
	});
	return () => {
		cleanupRead();
		cleanupWrite();
	};
}
const syncPreload = defineBehavior({
	stateKeys: ["preload", "presentation"],
	contextKeys: ["mediaElement"],
	setup: syncPreloadSetup
});

//#endregion
//#region ../spf/dist/dev/features/initial-load.js
/** The behaviors the feature composes, in setup order. */
const behaviors$3 = [syncPreload, trackLoadTriggers];
/** The config defaults the feature contributes. */
const defaultConfig$3 = {};
/** The state values the feature seeds. */
const initialState$3 = {};
/**
* Defers loading until the media element's `preload` allows it or the user plays or seeks, mirroring native
* `HTMLMediaElement` preload behavior. Syncs `preload` between the element and state, and activates loading on the
* first `play` or `seeking` for each source.
*
* Without it, a composition loads the moment a source is set; seed `loadActivated: true` in its initial state, as the
* background-video engine does. The two behaviors compose together: syncing `preload` without the load triggers would
* leave `preload="none"` and `"metadata"` sources unable to load on play.
*/
const initialLoadFeature = defineFeature({
	behaviors: behaviors$3,
	defaultConfig: defaultConfig$3,
	initialState: initialState$3
});

//#endregion
//#region ../spf/dist/dev/behaviors/derive-cdn-priority.js
/**
* **Session-level CDN priority.** While a presentation is resolved, owns the `cdnPriority` signal: the distinct CDNs
* the source is served from (origin of each track's URL), in manifest priority order — most-preferred first. Cleared on
* src unload. The name mirrors HLS content steering's `PATHWAY-PRIORITY`.
*
* Redundant-stream sources (e.g. Mux's `?redundant_streams=true`) list the same content on multiple hosts, so the
* candidate tracks already include one variant per CDN. This behavior publishes _which_ CDNs exist and their priority;
* the `preferActiveCdn` scope rule in `track-switching` reads `cdnPriority` and narrows each type's candidates to the
* first CDN with surviving tracks — so video / audio / text all resolve from one host (the shared list is the
* per-presentation coherence guarantee).
*
* The "active" CDN is not stored — it's derived by the scope as the highest-priority entry in `cdnPriority` that still
* has tracks after the constraints pre-pass. That makes failover a pure consequence of the (future) failed-CDN
* constraint: when the primary's tracks are pruned during cooldown, the scope falls to the next CDN; when the primary
* recovers, it snaps back. Content steering, when it lands, reorders `cdnPriority` (pathway priority as a sort key).
*
* Lifecycle: `'presentation-unresolved'` ↔ `'presentation-resolved'`, mirroring `setupTrackSwitching`. The resolved
* state owns the signal; its entry-returned cleanup clears it on exit (canonical cleanup-binds-to-setup per
* `reactors.md`).
*/
const samePriority = (a, b) => !!a && a.length === b.length && a.every((cdn, i) => cdn === b[i]);
/**
* Manage `cdnPriority`: publish the manifest-ordered CDN list on src load, clear on src unload.
*
* @example
*   const reactor = deriveCdnPriority.setup({ state });
*/
const deriveCdnPriority = defineBehavior({
	stateKeys: ["presentation", "cdnPriority"],
	contextKeys: [],
	setup: ({ state, config = {} }) => {
		const getCdnId$1 = config.getCdnId ?? getCdnId;
		const derivedStateSignal = computed(() => isResolvedPresentation(state.presentation.get()) ? "presentation-resolved" : "presentation-unresolved");
		return createMachineReactor({
			initial: "presentation-unresolved",
			monitor: () => derivedStateSignal.get(),
			states: {
				"presentation-unresolved": {},
				"presentation-resolved": {
					entry: () => () => state.cdnPriority.set(void 0),
					effects: [() => {
						const presentation = state.presentation.get();
						if (!isResolvedPresentation(presentation)) return;
						const next = getOrderedCdnIds(presentation, getCdnId$1);
						if (!samePriority(peek(state.cdnPriority), next)) state.cdnPriority.set(next);
					}]
				}
			}
		});
	}
});

//#endregion
//#region ../spf/dist/dev/behaviors/setup-failover-monitor.js
/**
* **CDN failover cooldown.** The expiry half of multi-CDN failover. Fetch sites own the _trip_: on a failed fetch they
* add the failing CDN (origin) to the `failedCdns` state signal directly. This behavior owns the _expiry_: while a
* presentation is resolved, it watches `failedCdns` and, for each CDN that appears, schedules a timer to remove it once
* its cooldown lapses. `track-switching`'s `excludeFailedCdns` constraint prunes a failed CDN's tracks and the
* active-CDN scope falls to the next one — and back, once the cooldown removes it here.
*
* Lifecycle is per-source: timers + `failedCdns` are cleared on exit (a new source starts with a clean slate). Policy
* (cooldown) is engine config. This is the minimal `network-resilience` slice — a single failure trips a CDN, since
* transient blips are the retry layer's job (it sits below the fetch sites, so anything that reaches `failedCdns` is
* already terminal).
*/
const DEFAULT_FAILOVER_MONITOR_CONFIG = { cooldownMs: 3e5 };
/**
* Expire failed CDNs from `failedCdns` once their cooldown lapses, for the resolved source.
*
* @example
*   const reactor = setupFailoverMonitor.setup({ state });
*/
const setupFailoverMonitor = defineBehavior({
	stateKeys: ["presentation", "failedCdns"],
	contextKeys: [],
	setup: ({ state, config = {} }) => {
		const cooldownMs = config.failover?.cooldownMs ?? DEFAULT_FAILOVER_MONITOR_CONFIG.cooldownMs;
		const timers = /* @__PURE__ */ new Map();
		const derivedStateSignal = computed(() => isResolvedPresentation(state.presentation.get()) ? "presentation-resolved" : "presentation-unresolved");
		return createMachineReactor({
			initial: "presentation-unresolved",
			monitor: () => derivedStateSignal.get(),
			states: {
				"presentation-unresolved": {},
				"presentation-resolved": {
					entry: () => () => {
						timers.forEach((timer) => clearTimeout(timer));
						timers.clear();
						state.failedCdns.set(void 0);
					},
					effects: [() => {
						(state.failedCdns.get() ?? []).forEach((cdn) => {
							if (timers.has(cdn)) return;
							const timer = setTimeout(() => {
								timers.delete(cdn);
								update(state.failedCdns, (current) => current?.filter((c) => c !== cdn));
							}, cooldownMs);
							timers.set(cdn, timer);
						});
					}]
				}
			}
		});
	}
});

//#endregion
//#region ../spf/dist/dev/features/multi-cdn.js
/** The behaviors the feature composes, in setup order. */
const behaviors$2 = [deriveCdnPriority, setupFailoverMonitor];
/** The config defaults the feature contributes. */
const defaultConfig$2 = {};
/** The state values the feature seeds. */
const initialState$2 = {};
/**
* Plays sources served from several CDNs (redundant streams): keeps every track type on one CDN, and fails over to the
* next when a CDN fails, returning to it once its cooldown lapses. Single-CDN sources pass through unchanged.
*/
const multiCdnFeature = defineFeature({
	behaviors: behaviors$2,
	defaultConfig: defaultConfig$2,
	initialState: initialState$2
});

//#endregion
//#region ../spf/dist/dev/behaviors/establish-start-media-time.js
/**
* A single type's own media-timeline origin: `baseMediaDecodeTime/timescale − segmentStartTime` (the `segmentStartTime`
* term makes it the stream origin even when the first loaded segment isn't the 0th). `undefined` until timescale +
* baseMediaDecodeTime + segmentStartTime are all present.
*/
function ownOrigin(data) {
	const { timescale, baseMediaDecodeTime, segmentStartTime } = data ?? {};
	return timescale != null && baseMediaDecodeTime != null && segmentStartTime != null ? baseMediaDecodeTime / timescale - segmentStartTime : void 0;
}
/**
* Origins below this magnitude (seconds) are treated as `0` — the derive returns `0`, so the presentation is left on
* its native (~0-based) timeline and no `timestampOffset` is set (the loader stamp no-ops on a derived `0`). Ordinary
* VOD carries a small nonzero encode origin (audio priming, first-frame CTS, edit lists); relocating by a sub-second
* amount is pointless, and setting `timestampOffset` at all can ripple edge segments. Relocation targets streams with
* an intentional large origin (instant clips, bipbop @10s).
*
* Absolute basis, not proportional: the DTS-below-zero / ripple risk scales with the origin's absolute size, not with
* the presentation's duration. Also snaps negatives to `0` — a negative origin would relocate _forward_, which is never
* the intent.
*/
const NEAR_ZERO_ORIGIN_THRESHOLD = 1;
/** Snap a below-threshold (incl. negative) origin to `0` so it isn't relocated. */
function thresholdOrigin(origin) {
	return origin < NEAR_ZERO_ORIGIN_THRESHOLD ? 0 : origin;
}
/**
* The **default** — relocate the whole presentation by one shared origin: the `min` across the _selected_ A/V tracks'
* own origins, denormalized onto every type. This single reduce subsumes the "per-type" and "shared" tiers:
*
* - **aligned A/V** — `min` equals each origin (they're equal), so it matches per-type;
* - **skewed A/V** (e.g. Apple's 44ms audio-lead) — `min` keeps every track's earliest DTS ≥ 0 (relocating by ≤ each own
*   origin never drives one negative) _and_ preserves the real skew (per-type would flatten it, desyncing A/V);
* - **single type / muxed** — `min` of the one origin is that origin.
*
* Returns `undefined` for every type until all _selected_ types have a complete origin (the shared-`min` barrier).
* Which types must contribute is read from `ctx` (the selected v/a ids); with no selection context it coordinates
* across whatever types have data. A shared origin below {@link NEAR_ZERO_ORIGIN_THRESHOLD} is returned as `0` (native
* — ordinary ~0-PTS VOD isn't relocated).
*/
const deriveSharedMinStartMediaTime = (containerData, ctx) => {
	const contributingTypes = [];
	if (ctx.selectedVideoTrackId != null) contributingTypes.push("video");
	if (ctx.selectedAudioTrackId != null) contributingTypes.push("audio");
	const origins = (contributingTypes.length > 0 ? contributingTypes : Object.keys(containerData)).map((type) => ownOrigin(containerData[type]));
	if (origins.length === 0 || origins.some((origin) => origin === void 0)) return {};
	const shared = thresholdOrigin(Math.min(...origins));
	const out = {};
	for (const type of Object.keys(containerData)) out[type] = shared;
	return out;
};
/**
* The anchor-source track: the selected video track, falling back to audio (audio-only). Deterministic — never "first
* resolved", which is race-dependent under concurrent resolves.
*/
function referenceTrackId(ctx) {
	return ctx.selectedVideoTrackId ?? ctx.selectedAudioTrackId;
}
/**
* The live-anchor first-parse gate (the "parses align" step of the establishment order). Open for the reference track
* itself — its local-from-0 placement _is_ the presentation timeline (presentation-0 = the join point). Every other
* track holds until the reference's first parse settles the anchor question: no PDT → local placement is already
* correct, proceed; PDT anchor → hold until the establishment reactor stamps it onto this track, so the parse takes the
* `placeOnAnchor` path. Establishment is sticky-once, so an unanchored first parse would be permanently misaligned —
* that's the race this gate closes.
*
* Pairs with the {@link establishStartMediaTime} reactor (the stamp that opens the anchored branch); wire both or
* neither.
*/
const gateFirstParseOnAnchor = (presentation, ctx, trackId) => {
	const referenceId = referenceTrackId(ctx);
	if (referenceId === void 0 || referenceId === trackId) return true;
	if (!isResolvedPresentation(presentation)) return false;
	const reference = findTrackById(presentation, referenceId);
	if (!reference) return true;
	if (!isResolvedTrack(reference)) return false;
	if (reference.startDate === void 0) return true;
	return findTrackById(presentation, trackId)?.startDate !== void 0;
};
/**
* Stamp the frozen wall-clock anchor as `startDate` onto every track that lacks one (idempotent — same reference when
* nothing moved). Unresolved shells pick it up as the `placeOnAnchor` preset; covering _all_ tracks in one pass means
* any track selected later — an ABR rung, another audio language, late captions — resolves already anchored. The
* reference track's own parser-computed `startDate` reads back as the anchor, so it's naturally left untouched.
*/
function stampStartDates(presentation, anchor) {
	let changed = false;
	const selectionSets = presentation.selectionSets.map((selectionSet) => ({
		...selectionSet,
		switchingSets: selectionSet.switchingSets.map((switchingSet) => ({
			...switchingSet,
			tracks: switchingSet.tracks.map((track) => {
				if (track.startDate !== void 0) return track;
				changed = true;
				return {
					...track,
					startDate: anchor
				};
			})
		}))
	}));
	return changed ? {
		...presentation,
		selectionSets
	} : presentation;
}
/** Stamp the derived per-track `startMediaTime` onto the model (idempotent — same reference when nothing moved). */
function stampTracks(presentation, startMediaTimes) {
	let changed = false;
	const selectionSets = presentation.selectionSets.map((selectionSet) => ({
		...selectionSet,
		switchingSets: selectionSet.switchingSets.map((switchingSet) => ({
			...switchingSet,
			tracks: switchingSet.tracks.map((track) => {
				const startMediaTime = startMediaTimes[track.type];
				if (startMediaTime === void 0 || track.startMediaTime === startMediaTime) return track;
				changed = true;
				return {
					...track,
					startMediaTime
				};
			})
		}))
	}));
	return changed ? {
		...presentation,
		selectionSets
	} : presentation;
}
function establishStartMediaTimeSetup({ state, config = {} }) {
	const derive = config.deriveStartMediaTime ?? deriveSharedMinStartMediaTime;
	const selectionContext = () => ({
		selectedVideoTrackId: state.selectedVideoTrackId?.get(),
		selectedAudioTrackId: state.selectedAudioTrackId?.get()
	});
	/** Established once the selected A/V tracks (whichever exist) carry `startMediaTime`. */
	const established = () => {
		const presentation = state.presentation.get();
		if (!isResolvedPresentation(presentation)) return false;
		const ids = [state.selectedVideoTrackId?.get(), state.selectedAudioTrackId?.get()].filter((id) => id !== void 0);
		return ids.length > 0 && ids.every((id) => findTrackById(presentation, id)?.startMediaTime !== void 0);
	};
	return createMachineReactor({
		initial: "inactive",
		monitor: () => {
			if (!isResolvedPresentation(state.presentation.get())) return "inactive";
			return established() ? "established" : "monitoring";
		},
		states: {
			inactive: { entry: () => state.mediaContainerData.set(void 0) },
			monitoring: { effects: [() => {
				const presentation = state.presentation.get();
				if (!isResolvedPresentation(presentation)) return;
				const referenceId = referenceTrackId(selectionContext());
				const reference = referenceId === void 0 ? void 0 : findTrackById(presentation, referenceId);
				if (!reference || !isResolvedTrack(reference)) return;
				const anchor = reference.startDate;
				if (anchor === void 0) return;
				update(state.presentation, (current) => stampStartDates(current, anchor));
			}, () => {
				const containerData = state.mediaContainerData.get();
				if (!containerData) return;
				const startMediaTimes = derive(containerData, selectionContext());
				update(state.presentation, (current) => stampTracks(current, startMediaTimes));
			}] },
			established: {}
		}
	});
}
const establishStartMediaTime = {
	stateKeys: ["presentation", "mediaContainerData"],
	contextKeys: [],
	setup: establishStartMediaTimeSetup
};

//#endregion
//#region ../spf/dist/dev/playback/primitives/text-segment-load-pipeline.js
/**
* Base-step view of the loader's wiring, folded into `config` by `createTextTrackSegmentLoaderActor` so base steps read
* it from the uniform passthrough — present in both composition and standalone use. `config` is loose (`object`), so
* assert the shape here (mirrors the v/a loader's `stepWiring`). The sink is the structural {@link CueSink}, not the
* concrete actor.
*/
function textStepWiring(deps) {
	return deps.config;
}
/** Resolve the op's cues (via the injected host primitive) into the frame. The text analog of `fetchStep`. */
const resolveCuesStep = async (frame, signal, deps) => {
	const cues = await textStepWiring(deps).resolveSegment(frame.op.segment.url);
	if (signal.aborted) return;
	frame.cues = cues;
};
/** Dispatch the frame's cues to the TextTracksActor as `add-cues`. The text analog of `dispatchStep`. */
const dispatchCuesStep = (frame, _signal, deps) => {
	const { op } = frame;
	textStepWiring(deps).textTracksActor.send({
		type: "add-cues",
		meta: {
			trackId: op.trackId,
			id: op.segment.id,
			startTime: op.segment.startTime,
			duration: op.segment.duration
		},
		cues: frame.cues ?? []
	});
};
/** Tier 0 default: resolve then dispatch. No relocation vocabulary. */
const DEFAULT_TEXT_MESSAGE_PIPELINES = () => [resolveCuesStep, dispatchCuesStep];

//#endregion
//#region ../spf/dist/dev/media/mp4/box.js
function toDataView(data) {
	return data instanceof Uint8Array ? new DataView(data.buffer, data.byteOffset, data.byteLength) : new DataView(data);
}
/** Read a 4-character box type / FourCC at `offset`. */
function readFourCC(view, offset) {
	return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}
/** Iterate the boxes directly contained in `[start, end)`. */
function* iterateBoxes(view, start = 0, end = view.byteLength) {
	let offset = start;
	while (offset + 8 <= end) {
		let size = view.getUint32(offset);
		const type = readFourCC(view, offset + 4);
		let dataStart = offset + 8;
		if (size === 1) {
			size = Number(view.getBigUint64(offset + 8));
			dataStart = offset + 16;
		} else if (size === 0) size = end - offset;
		if (size < dataStart - offset) return;
		yield {
			type,
			start: offset,
			dataStart,
			end: offset + size
		};
		offset += size;
	}
}
/** Iterate the direct child boxes of a given `type` within `[start, end)`. */
function* iterateBoxesOfType(view, type, start = 0, end = view.byteLength) {
	for (const box of iterateBoxes(view, start, end)) if (box.type === type) yield box;
}
/**
* Depth-first descent to the first box matching a nested path, e.g. `['moov', 'trak', 'mdia', 'mdhd']`. Returns
* `undefined` if any level is absent.
*/
function findBox(view, path, start = 0, end = view.byteLength) {
	const [head, ...rest] = path;
	for (const box of iterateBoxes(view, start, end)) {
		if (box.type !== head) continue;
		if (rest.length === 0) return box;
		const found = findBox(view, rest, box.dataStart, box.end);
		if (found) return found;
	}
}
/**
* Read the version byte of a FullBox — the `version(1) + flags(3)` header at the start of the payload of `mdhd` /
* `tkhd` / `tfdt` / `hdlr` / `elst` / etc.
*/
function readFullBoxVersion(view, dataStart) {
	return view.getUint8(dataStart);
}

//#endregion
//#region ../spf/dist/dev/media/mp4/timestamp-origin.js
/**
* Decode-time origin extraction from fMP4/CMAF segments.
*
* Non-zero-PTS sources encode media at a non-zero start time (an instant clip starting at asset second 60, an Apple
* bipbop asset starting at 10s, …). To relocate such a source onto a 0-based presentation timeline via
* `SourceBuffer.timestampOffset`, the engine needs that start time — the **decode-time origin** — read straight from
* the container:
*
* - `tfdt.baseMediaDecodeTime` (from a media segment's `moof`) — the decode time of the segment's first sample, in the
*   track's media timescale. This is a DTS: relocating by `−(baseMediaDecodeTime / timescale)` lands the earliest DTS
*   at exactly 0, so a negative-DTS append failure on Chromium is impossible by construction.
* - `mdhd.timescale` (from the init segment's `moov`) — ticks per second for that track, needed to convert the raw tick
*   count to seconds.
*
* {@link findMediaTrack} returns the track ID and timescale for the matching media handler;
* {@link readBaseMediaDecodeTime} uses that ID to select the corresponding media fragment. The ID joins one track's
* timescale to the same track's decode time, even when a caption track precedes it in a muxed init or segment. Only
* buffered media handlers (`vide` / `soun`) are selected; caption rendering is outside this reader's scope.
*
* Both raw values are returned un-divided to leave room for an edit-list (`elst`) presentation-time correction term if
* a source ever carries one — the validated streams do not.
*/
/**
* The `track_ID` + timescale of the `trak` whose `mdhd` handler matches `handlerType`, skipping a muxed `clcp` caption
* track. `undefined` if no matching track exists.
*/
function findMediaTrack(initSegment, handlerType) {
	const view = toDataView(initSegment);
	const moov = findBox(view, ["moov"]);
	if (!moov) return void 0;
	for (const trak of iterateBoxesOfType(view, "trak", moov.dataStart, moov.end)) {
		if (readTrakHandler(view, trak) !== handlerType) continue;
		const tkhd = findBox(view, ["tkhd"], trak.dataStart, trak.end);
		const mdhd = findBox(view, ["mdia", "mdhd"], trak.dataStart, trak.end);
		if (!tkhd || !mdhd) return void 0;
		return {
			trackId: view.getUint32(tkhd.dataStart + 4 + (readFullBoxVersion(view, tkhd.dataStart) === 1 ? 16 : 8)),
			timescale: readMdhdTimescale(view, mdhd)
		};
	}
}
/**
* `baseMediaDecodeTime` (in the track's media timescale) from the `traf` matching `trackId` (via `tfhd.track_id`) —
* required for muxed multi-`traf` segments. `undefined` if no matching `tfdt` exists.
*/
function readBaseMediaDecodeTime(mediaSegment, trackId) {
	const view = toDataView(mediaSegment);
	const moof = findBox(view, ["moof"]);
	if (!moof) return void 0;
	for (const traf of iterateBoxesOfType(view, "traf", moof.dataStart, moof.end)) {
		if (readTrafTrackId(view, traf) !== trackId) continue;
		const tfdt = findBox(view, ["tfdt"], traf.dataStart, traf.end);
		return tfdt ? readTfdtBaseMediaDecodeTime(view, tfdt) : void 0;
	}
}
/** `mdhd.timescale`: FullBox version(1)+flags(3) + dates (v0: 4+4, v1: 8+8) + timescale. */
function readMdhdTimescale(view, mdhd) {
	return view.getUint32(mdhd.dataStart + 4 + (readFullBoxVersion(view, mdhd.dataStart) === 1 ? 16 : 8));
}
/** `tfdt.baseMediaDecodeTime`: FullBox, then the value — v0: (4), v1: (8). */
function readTfdtBaseMediaDecodeTime(view, tfdt) {
	const at = tfdt.dataStart + 4;
	return readFullBoxVersion(view, tfdt.dataStart) === 1 ? Number(view.getBigUint64(at)) : view.getUint32(at);
}
/** `hdlr.handler_type` for a `trak`: FullBox version(1)+flags(3) + pre_defined(4) + handler_type(4). */
function readTrakHandler(view, trak) {
	const hdlr = findBox(view, ["mdia", "hdlr"], trak.dataStart, trak.end);
	return hdlr ? readFourCC(view, hdlr.dataStart + 8) : void 0;
}
/** `tfhd.track_id` for a `traf`: FullBox version(1)+flags(3) + track_id(4). */
function readTrafTrackId(view, traf) {
	const tfhd = findBox(view, ["tfhd"], traf.dataStart, traf.end);
	return tfhd ? view.getUint32(tfhd.dataStart + 4) : void 0;
}

//#endregion
//#region ../spf/dist/dev/media/text/parse-vtt-timestamp-map.js
const TIMESTAMP_MAP_PREFIX = "X-TIMESTAMP-MAP=";
/**
* Scrape a WebVTT segment's `X-TIMESTAMP-MAP` header into a {@link TimestampMap} — the only header line we need to
* correlate LOCAL cue times with the media presentation timeline. Deliberately _not_ a WebVTT parser: cue parsing stays
* with the browser's native `<track>` parser (which drops this line); this reads just the one header field the native
* path discards.
*
* Returns `undefined` when the segment carries no map (e.g. cues already in absolute presentation time) — per the HLS
* spec that means LOCAL 0 maps to MPEGTS 0. Tolerant of attribute order and `[HH:]MM:SS.mmm` LOCAL forms.
*/
function parseVttTimestampMap(text) {
	const timestampMapLine = text.split(/\r\n|\r|\n/).find((line) => line.startsWith(TIMESTAMP_MAP_PREFIX));
	return timestampMapLine ? parseTimestampMapBody(timestampMapLine.slice(16)) : void 0;
}
const TimeStampMapParserMap = {
	LOCAL: parseWebVttTimestamp,
	MPEGTS: (v) => +v
};
function parseTimestampMapBody(body) {
	return Object.fromEntries(body.split(",").map((kvStr) => {
		const [k, v] = kvStr.split(/:(.*)/).map((kOrV) => kOrV.trim());
		return [k?.toLowerCase(), TimeStampMapParserMap[k](v)];
	}));
}
/** Seconds-per-unit for the `[HH:]MM:SS.mmm` parts, right-aligned so a missing HH just drops the leading weight. */
const VTT_TIMESTAMP_WEIGHTS = [
	3600,
	60,
	1,
	.001
];
function parseWebVttTimestamp(value) {
	const parts = value.split(/[:.]/);
	return parts.reduce((acc, val, i) => acc + +val * (VTT_TIMESTAMP_WEIGHTS[i + 4 - parts.length] ?? 0), 0);
}

//#endregion
//#region ../spf/dist/dev/media/text/resolve-vtt-metadata.js
/**
* Header-level text-segment metadata — the `X-TIMESTAMP-MAP` correlation scraped from a VTT segment's raw bytes.
* DOM-free (a plain fetch + regex parse): the native `<track>` parser in `media/dom/text` (`resolveVttSegment`)
* discards this header, so a caller that needs it (e.g. non-zero-PTS relocation) fetches the bytes itself.
*/
/**
* Fetch a VTT segment and scrape only its header metadata (no cue parsing).
*
* The native `<track>` parser (`media/dom/text`'s `resolveVttSegment`) discards `X-TIMESTAMP-MAP`, so reading it
* requires the raw bytes. This is a separate, caller-controlled fetch — the caller decides _when_ metadata is needed
* (e.g. once per source) rather than paying for it on every segment.
*/
async function resolveVttSegmentMetadata(url) {
	const text = await fetch(url).then((response) => response.text());
	return { timestampMap: parseVttTimestampMap(text) };
}

//#endregion
//#region ../spf/dist/dev/playback/primitives/head-peek.js
/**
* Eager head-of-stream peek. Pulls chunks from an async byte stream only until `tryParse` signals it has read what it
* needs (or the stream ends), then returns a stream that re-emits the pulled head followed by the untouched tail — so
* reading a head-of-stream mp4 box (`mdhd` / `tfdt`) doesn't break streaming of the append. Once the caller has what it
* wants, the rest streams as normal.
*/
function concat(chunks) {
	if (chunks.length === 1) return chunks[0];
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
/** Re-emit the eagerly-pulled head chunks, then stream the untouched tail. */
async function* reassemble(head, tail) {
	yield* head;
	for (let next = await tail.next(); !next.done; next = await tail.next()) yield next.value;
}
/**
* Pull chunks until `tryParse(accumulatedHead)` returns `true` — it found and read its box — or the stream ends, then
* return a stream re-emitting the pulled head followed by the untouched tail. `tryParse` is called with the growing
* head after each chunk; it performs the side effect (publishing the parsed value) and returns whether it's done.
*/
async function peekHead(data, tryParse) {
	const iterator = data[Symbol.asyncIterator]();
	const head = [];
	for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
		head.push(next.value);
		if (tryParse(concat(head))) break;
	}
	return reassemble(head, iterator);
}

//#endregion
//#region ../spf/dist/dev/playback/primitives/relocation-pipelines.js
/** Assert the relocation state view from the opaque step deps — this module knows the slots the composition provides. */
function relocationState(deps) {
	return deps.state;
}
function containerSlot(deps) {
	return relocationState(deps).mediaContainerData;
}
/** Synchronous RMW of the per-type entry — disjoint keys across producers, so no lost update. */
function writeContainer(slot, trackType, patch) {
	update(slot, (current) => ({
		...current,
		[trackType]: {
			...current?.[trackType],
			...patch
		}
	}));
}
/**
* Resolve once `read()` returns a number. Shared by the A/V stamp (waits for the `derive`d origin — immediate for
* per-type, the shared-`min` barrier for coordinated) and the text step (waits for the primary A/V origin). No bound:
* for fMP4 the origin always establishes.
*/
function awaitDefined(read) {
	return new Promise((resolve) => {
		let stop;
		stop = effect(() => {
			const value = read();
			if (value !== void 0) {
				stop?.();
				resolve(value);
			}
		});
	});
}
/**
* Relocation pipelines for one track type — a plain config `messagePipelines`. Keyed by **track type** (`'video'` /
* `'audio'`), so ABR rungs of a type share the origin (discover skips once the type's value is present). The steps
* read/write `state.mediaContainerData[trackType]` via their call-time `deps`; the stamp applies the same
* `deriveStartMediaTime` seam the reactor uses, read from the composition config at call time, so the buffer offset and
* the model's `startMediaTime` agree. A composition whose config carries no `deriveStartMediaTime` doesn't relocate:
* the stamp leaves appends native.
*/
function relocationPipelinesFor(trackType) {
	const handlerType = trackType === "video" ? "vide" : "soun";
	/**
	* Init step: head-peek the buffered media track's `track_id` + `mdhd` timescale into `mediaContainerData[trackType]`.
	* Matching by handler (`vide`/`soun`) skips a muxed `clcp` caption track, and the `track_id` lets `readSegmentOrigin`
	* read _this_ track's `tfdt` rather than the first `traf` in the segment.
	*/
	const readInitTrackInfo = async (frame, _signal, deps) => {
		const { op } = frame;
		if (op.type !== "append-init" || !frame.data) return;
		const slot = containerSlot(deps);
		if (peek(slot)?.[trackType]?.timescale !== void 0) return;
		frame.data = await peekHead(frame.data, (bytes) => {
			const track = findMediaTrack(bytes, handlerType);
			if (track === void 0) return false;
			writeContainer(slot, trackType, {
				trackId: track.trackId,
				timescale: track.timescale
			});
			return true;
		});
	};
	/**
	* Media-segment step: head-peek the `tfdt` baseMediaDecodeTime of the media track's `traf` (matched by the `track_id`
	* discovered from the init), recording the segment's 0-based `startTime` with it — the origin is `bmdt/ts −
	* segmentStartTime`, so the first _loaded_ segment need not be the 0th. Without a discovered `track_id` (non-fMP4 /
	* mock init) there's no media track to relocate, so the step no-ops and the append stays native.
	*/
	const readSegmentOrigin = async (frame, _signal, deps) => {
		const { op } = frame;
		if (op.type !== "append-segment" || !frame.data) return;
		const slot = containerSlot(deps);
		const container = peek(slot)?.[trackType];
		if (container?.baseMediaDecodeTime !== void 0) return;
		const { trackId } = container ?? {};
		if (trackId === void 0) return;
		const segmentStartTime = op.meta.startTime;
		frame.data = await peekHead(frame.data, (bytes) => {
			const baseMediaDecodeTime = readBaseMediaDecodeTime(bytes, trackId);
			if (baseMediaDecodeTime === void 0) return false;
			writeContainer(slot, trackType, {
				baseMediaDecodeTime,
				segmentStartTime
			});
			return true;
		});
	};
	/**
	* Stamp step — tier-agnostic apply. Relocate by the `derive`d `startMediaTime` for this type (`offset =
	* −startMediaTime`). Applies the **same** `derive` the reactor uses, over the shared `mediaContainerData` slot — so
	* the buffer offset matches the model's stamped `startMediaTime`, and it's robust to `established` + late tracks (the
	* slot persists; the model value may not be re-stamped after the reactor goes sticky). Awaited: per-type resolves at
	* once (own origin discovered earlier in this pipeline); shared-`min` waits until every selected A/V origin is in —
	* the barrier, filled by the other type's discover step. A derived `0` (0-PTS / below threshold) leaves the append
	* native — setting `timestampOffset` at all can ripple.
	*/
	const stampStartMediaTime = async (frame, signal, deps) => {
		if (frame.op.type !== "append-segment") return;
		const derive = deps.config.deriveStartMediaTime;
		if (!derive) return;
		const state = relocationState(deps);
		const own = peek(state.mediaContainerData)?.[trackType];
		if (own?.timescale === void 0 || own.baseMediaDecodeTime === void 0 || own.segmentStartTime === void 0) return;
		const startMediaTime = await awaitDefined(() => {
			const containerData = state.mediaContainerData.get();
			if (!containerData) return void 0;
			return derive(containerData, {
				selectedVideoTrackId: state.selectedVideoTrackId?.get(),
				selectedAudioTrackId: state.selectedAudioTrackId?.get()
			})[trackType];
		});
		if (signal.aborted || startMediaTime === 0) return;
		frame.meta = {
			...frame.meta ?? frame.op.meta,
			timestampOffset: -startMediaTime
		};
	};
	return () => ({
		remove: [dispatchStep],
		"append-init": [
			fetchStep,
			readInitTrackInfo,
			dispatchStep
		],
		"append-segment": [
			fetchStep,
			readSegmentOrigin,
			stampStartMediaTime,
			dispatchStep
		]
	});
}
/**
* Resolve step for the relocation text pipeline. Reuses the injected host resolver (the loader's folded
* `resolveSegment`, via `textStepWiring`) for cues and fetches the `X-TIMESTAMP-MAP` header in parallel, stashing it on
* `frame.metadata` for `relocateCuesStep`. Replaces the base `resolveCuesStep` (which fetches cues only) — text's
* native `<track>` parser discards the header, so the map needs its own raw-bytes fetch.
*/
const resolveWithMetadataStep = async (frame, signal, deps) => {
	const [cues, metadata] = await Promise.all([textStepWiring(deps).resolveSegment(frame.op.segment.url), resolveVttSegmentMetadata(frame.op.segment.url)]);
	if (signal.aborted) return;
	frame.cues = cues;
	frame.metadata = metadata;
};
/**
* Relocate step — shifts each cue onto the 0-based presentation timeline: `cueFinal = cueNative − startMediaTime`,
* where `startMediaTime` is the primary A/V track's origin (selected **video**, else **audio** — the single-anchor
* rule, and defensive like the reactor's optional selection) and `cueNative` folds in the `X-TIMESTAMP-MAP` correction
* (`mpegts/90000 − local`) for map-bearing VTT (Apple) or is the absolute cue time (no map, e.g. Mux). Text can resolve
* before A/V establishes, so the origin is awaited; fMP4 always establishes it (0-PTS → 0), and a text-only source (no
* A/V selected) simply gets offset 0.
*/
const relocateCuesStep = async (frame, signal, deps) => {
	if (!frame.cues?.length) return;
	const state = deps.state;
	const startMediaTime = await awaitDefined(() => {
		const presentation = state.presentation.get();
		if (!presentation) return void 0;
		const primaryId = state.selectedVideoTrackId?.get() ?? state.selectedAudioTrackId?.get();
		if (primaryId !== void 0) return findTrackById(presentation, primaryId)?.startMediaTime;
		return getTracksByType(presentation, "video").length > 0 || getTracksByType(presentation, "audio").length > 0 ? void 0 : 0;
	});
	if (signal.aborted) return;
	const { timestampMap } = frame.metadata ?? {};
	const delta = (timestampMap ? timestampMap.mpegts / 9e4 - timestampMap.local : 0) - startMediaTime;
	if (delta !== 0) for (const cue of frame.cues) {
		cue.startTime += delta;
		cue.endTime += delta;
	}
};
/**
* Relocation text pipeline — the text analog of `relocationPipelinesFor(type)`. `resolveWithMetadata` (cues +
* `X-TIMESTAMP-MAP`) → `relocateCues` (shift by the primary A/V origin) → `dispatchCues`.
*/
const relocatingTextPipelines = () => [
	resolveWithMetadataStep,
	relocateCuesStep,
	dispatchCuesStep
];

//#endregion
//#region ../spf/dist/dev/features/shift-timestamps.js
/** The behaviors the feature composes, in setup order. */
const behaviors$1 = [establishStartMediaTime];
/** The config defaults the feature contributes. */
const defaultConfig$1 = {
	deriveStartMediaTime: deriveSharedMinStartMediaTime,
	videoMessagePipelines: relocationPipelinesFor("video"),
	audioMessagePipelines: relocationPipelinesFor("audio")
};
/** The state values the feature seeds. */
const initialState$1 = {};
/**
* Plays HLS content whose segment timestamps don't start at zero, by shifting them onto the playlist's zero-based
* timeline. Without it, such content strands the playhead outside the buffered ranges; content that starts at zero
* doesn't need it. Text cues shift with `shiftTextTimestampsFeature`, composed alongside it and `textTracksFeature`.
*/
const shiftTimestampsFeature = defineFeature({
	behaviors: behaviors$1,
	defaultConfig: defaultConfig$1,
	initialState: initialState$1
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/apply-start-position.js
/**
* **Start playback of a source at a requested position.** `state.startPosition` is a one-shot command — "when the
* current source can seek, start there" — the SPF analogue of hls.js's `startPosition` (and the primitive
* `EXT-X-START`, resume-where-you-left-off, and MediaSource-recovery restore build on). Consumers (adapters,
* `setupAirPlay`'s session-end snapshot) write it; this behavior is its sole consumer and clears it after applying, so
* a stale position can never replay against a later source or rebuild.
*
* Single-positive-state reactor (`'preconditions-unmet'` ↔ `'position-pending'`): gated on `mediaElement + resolved
* presentation + startPosition` defined. The entry applies the command in two steps:
*
* 1. **Seed `state.currentTime` immediately.** The segment loaders anchor their load window on `state.currentTime`;
*    seeding points the _first_ fetches at the requested position instead of 0. Multi-writer with `trackCurrentTime`
*    (ongoing DOM mirror) — legitimate: different decision domains (element-derived mirror vs one-shot command), and
*    before HAVE_METADATA no `timeupdate`/`seeking` fires to overwrite the seed.
* 2. **Seek the element at metadata.** `element.currentTime = position` once `readyState >= HAVE_METADATA` (immediately if
*    already there, else on `loadedmetadata`), then clear `startPosition` (consume). The element clamps the seek to its
*    seekable range per spec, and the resulting `seeking` event flows back through `trackCurrentTime` — from here the
*    ordinary seek path owns the position.
*
* Position only — playing/paused is deliberately out of scope. The media element load algorithm forces `paused = true`,
* so a source that was playing before a rebuild comes back paused at the restored position; resume intent belongs to
* whoever commands the start (e.g. `setupAirPlay` restores its session-end playing state itself).
*
* Deliberately NOT relying on the pre-metadata "default playback start position" write (setting `currentTime` at
* HAVE_NOTHING): cross-browser MSE behavior there is inconsistent; the explicit `loadedmetadata` sequencing is
* deterministic everywhere.
*
* State-exit cleanup (source reset, element detach, destroy) drops the pending `loadedmetadata` listener. An
* _unapplied_ command survives a source reset — "start the source I'm loading at P" holds while the presentation routes
* through unresolved — but is consumed the moment it applies.
*/
function deriveState(presentation, mediaElement, startPosition) {
	if (!mediaElement || !isResolvedPresentation(presentation)) return "preconditions-unmet";
	if (isUndefined(startPosition)) return "preconditions-unmet";
	return "position-pending";
}
function applyStartPositionSetup({ state, context }) {
	const derivedStateSignal = computed(() => deriveState(state.presentation.get(), context.mediaElement.get(), state.startPosition.get()));
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			"position-pending": { entry: () => {
				const mediaElement = context.mediaElement.get();
				const position = state.startPosition.get();
				state.currentTime.set(position);
				const apply = () => {
					mediaElement.currentTime = position;
					state.startPosition.set(void 0);
				};
				if (mediaElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
					apply();
					return;
				}
				return listen(mediaElement, "loadedmetadata", apply, { once: true });
			} }
		}
	});
}
const applyStartPosition = defineBehavior({
	stateKeys: [
		"presentation",
		"startPosition",
		"currentTime"
	],
	contextKeys: ["mediaElement"],
	setup: applyStartPositionSetup
});

//#endregion
//#region ../spf/dist/dev/features/start-position.js
/** The behaviors the feature composes, in setup order. */
const behaviors = [applyStartPosition];
/** The config defaults the feature contributes. */
const defaultConfig = {};
/** The state values the feature seeds. */
const initialState = {};
/**
* Starts playback at `state.startPosition` instead of zero. Also performs the seeks other features request through
* `state.startPosition`, such as the live edge and the AirPlay session-end restore.
*/
const startPositionFeature = defineFeature({
	behaviors,
	defaultConfig,
	initialState
});

//#endregion
//#region ../spf/dist/dev/network/request-credentials.js
/**
* Map a media element's CORS mode (its `crossOrigin` as reflected — see `toMediaCrossOrigin`) to the `credentials` mode
* the engine's own requests should carry.
*
* Only `use-credentials` asks for anything: it maps to `'include'`, the mode the browser itself fetches the element's
* resources with, so a cookie-gated cross-origin stream works the same whether the browser or the engine loads it.
* `anonymous` and no attribute yield `undefined`, leaving the platform default (`same-origin`).
*
* The attribute-absent case deliberately does not map to `'include'` even though the browser's own no-CORS media
* fetches send cookies: `fetch` cannot use no-CORS here (bodies must be readable), and a credentialed CORS request is
* refused by any server answering `Access-Control-Allow-Origin: *`, which would break every stream that works today.
*/
function crossOriginToRequestCredentials(crossOrigin) {
	return crossOrigin === "use-credentials" ? "include" : void 0;
}

//#endregion
export { airPlayFeature as _, DEFAULT_TEXT_MESSAGE_PIPELINES as a, multiCdnFeature as c, chaptersFeature as d, audioFeature as f, switchVideoTrack as g, switchTextTrack as h, relocatingTextPipelines as i, initialLoadFeature as l, DEFAULT_VIDEO_CONSTRAINTS as m, startPositionFeature as n, establishStartMediaTime as o, DEFAULT_AUDIO_CONSTRAINTS as p, shiftTimestampsFeature as r, gateFirstParseOnAnchor as s, crossOriginToRequestCredentials as t, endStallRecoveryFeature as u, defineExternalSignals as v };
//# sourceMappingURL=request-credentials-Brxpq2bX.js.map