import { t as shallowEqual } from "./shallow-equal-C7S8rj2f.js";
import { t as listen } from "./listen-CO63BggB.js";
import { n as onEvent, t as anyAbortSignal } from "./abort-DsWgOZ8b.js";
import { r as observeRenderedSize, t as observeElementSize } from "./observe-elements-B5qhV5BC.js";
import { r as isCaptionOrSubtitleTrack, t as findTrackElement } from "./text-track-CnWDzah_.js";
import { A as canPlayTrackWithDrm, At as untrack, Bt as SVTA_NO_SUPPORTED_AUDIO_TRACK, Ct as defineBehavior, D as Task, Dt as defineCompositionFactory, E as SerialRunner, Et as flattenFeatures, Ft as SVTA_DRM_LICENSE_REQUEST_GENERATION_FAILED, G as keySystemCandidates, Gt as effect, H as declaredDrmKeys, Ht as SVTA_UNSUPPORTED_DRM_SYSTEM, It as SVTA_DRM_LICENSE_RESPONSE_REJECTED, J as resolveDrmHeaders, K as manifestInitData, L as excludeRefusedKeySystems, Lt as SVTA_DRM_SESSION_ERROR, Mt as SVTA_BAD_LICENSE_REQUEST, Nt as SVTA_DRM_CERTIFICATE_ERROR, O as runOnce, Ot as computed, Pt as SVTA_DRM_INITIALIZATION_ERROR, Rt as SVTA_INSUFFICIENT_OUTPUT_PROTECTION, St as createMachineCore, T as RecurringRunner, Tt as defineFeature, U as declaredEncryptionScheme, Ut as SVTA_UNSUPPORTED_PLAYBACK_FEATURE, V as NO_KEY_SYSTEM, Vt as SVTA_NO_SUPPORTED_VIDEO_TRACK, W as defaultFairPlayContentId, X as sourceDrmSystems, Y as resolveDrmUrl, Z as unsupportedEncryptionMethodCause, _t as getMediaPlaylistMetadata, a as LOW_LATENCY_UNSUPPORTED_MESSAGE, at as loadTextTrackSegments, bt as isResolvedTrack, c as mediaSourceFeature, ct as TEXT_TYPE_CONFIG, d as errorFeature, ft as getTracksByType, g as reportUnsupportedTrackConditionsWithDrm, gt as deriveStreamType, h as reportUnsupportedTrackConditions, ht as getSegmentsToLoad, i as DVR_EXPERIMENTAL_MESSAGE, j as emitError, jt as update, k as canPlayTrack, kt as peek, l as hlsLoadingFeature, m as calculateDurationFeature, mt as DEFAULT_FORWARD_BUFFER_CONFIG, n as hasUnsupportedFeatureCause, ot as loadVideoSegments, p as currentTimeFeature, pt as mimeCodecsByType, q as resolveDrmCredentials, r as withAlternativeMediaSuggestion, s as UNSUPPORTED_PLAYBACK_FEATURE_MESSAGE, t as firstFatal, ut as findTrackById, v as resolveTextTrack, w as createMachineActor, x as setupVideoBufferActors, xt as createMachineReactor, y as resolveVideoTrack, yt as isResolvedPresentation, zt as SVTA_LICENSE_EXPIRED } from "./error-surface-BdkX1wpk.js";
import { n as MediaStreamTypes, r as toMediaCrossOrigin } from "./types-D8a85nGw.js";
import { t as HTMLVideoAdapter } from "./html-video-adapter-ClZq4auT.js";
import { t as MediaTracksMixin } from "./mixin-BvQk9qei.js";
import { _ as airPlayFeature, a as DEFAULT_TEXT_MESSAGE_PIPELINES, c as multiCdnFeature, d as chaptersFeature, f as audioFeature, g as switchVideoTrack, h as switchTextTrack, i as relocatingTextPipelines, l as initialLoadFeature, m as DEFAULT_VIDEO_CONSTRAINTS, n as startPositionFeature, o as establishStartMediaTime, p as DEFAULT_AUDIO_CONSTRAINTS, r as shiftTimestampsFeature, s as gateFirstParseOnAnchor, t as crossOriginToRequestCredentials, u as endStallRecoveryFeature, v as defineExternalSignals } from "./request-credentials-Brxpq2bX.js";
import { t as scaleResolution } from "./resolution-B0j7Y6Nv.js";

//#region ../utils/dist/time/sleep.js
/**
* Resolve after `ms` milliseconds. Pass a `signal` to make it cancellable: the timer is cleared and the promise rejects
* with the signal's reason as soon as the signal aborts (including if it's already aborted).
*
* @internal
*/
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

//#endregion
//#region ../spf/dist/dev/media/dom/key-systems.js
/**
* Decode the init data a key declaration carries inline. Mux (and RFC 8216bis practice) delivers Widevine PSSH /
* PlayReady PRO as a base64 `data:` URI in the key's `URI` attribute. Non-`data:` URIs (FairPlay's `skd://`, an AES-128
* key file) carry no EME init data — those flows are event-driven or not EME at all.
*/
function initDataFromKeyUri(uri) {
	if (!uri.startsWith("data:")) return void 0;
	const comma = uri.indexOf(",");
	if (comma === -1 || !uri.slice(0, comma).endsWith(";base64")) return void 0;
	const binary = atob(uri.slice(comma + 1));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
/**
* Widevine. Declares itself by the DASH system-id URN, ships a complete PSSH box in its `data:` URI, and takes the raw
* license message as octet-stream.
*
* `HW_SECURE_ALL` is the L1 hardware tier; Mux Player prefers it over hls.js the same way.
*/
const widevineKeySystem = {
	keySystem: "com.widevine.alpha",
	keyFormats: ["urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"],
	videoRobustnessTiers: [
		"HW_SECURE_ALL",
		"SW_SECURE_DECODE",
		"SW_SECURE_CRYPTO"
	],
	audioRobustnessTiers: ["SW_SECURE_CRYPTO"],
	toInitData: (uri) => {
		const initData = initDataFromKeyUri(uri);
		return initData && {
			initDataType: "cenc",
			initData
		};
	}
};
/** PlayReady's CENC system id, 9a04f079-9840-4286-ab92-e65be0885f95, as bytes. */
const PLAYREADY_SYSTEM_ID = Uint8Array.from([
	154,
	4,
	240,
	121,
	152,
	64,
	66,
	134,
	171,
	146,
	230,
	91,
	224,
	136,
	95,
	149
]);
function isPsshBox(bytes) {
	return bytes.length >= 8 && bytes[4] === 112 && bytes[5] === 115 && bytes[6] === 115 && bytes[7] === 104;
}
/**
* Wrap a raw PlayReady Object (WRMHEADER) in a v0 PSSH box under PlayReady's system id, as hls.js and Shaka do —
* `generateRequest('cenc', …)` refuses the bare PRO. A payload that is already a PSSH box passes through.
*/
function toPlayReadyPssh(bytes) {
	if (isPsshBox(bytes)) return bytes;
	const box = new Uint8Array(32 + bytes.length);
	const view = new DataView(box.buffer);
	view.setUint32(0, box.length);
	box.set([
		112,
		115,
		115,
		104
	], 4);
	box.set(PLAYREADY_SYSTEM_ID, 12);
	view.setUint32(28, bytes.length);
	box.set(bytes, 32);
	return box;
}
/**
* PlayReady. The one system that differs on every axis the module contract exposes.
*
* The plain id comes first among the request variants. `.recommendation` selects the hardware security level, and a
* hardware CDM refuses a license issued against a software one — a successful `200` whose `session.update()` then
* throws. hls.js and Mux Player never request `.recommendation` at all and license Windows PlayReady successfully; the
* plain id is what is proven. It stays as a fallback for stacks that expose only the hardware variant.
*
* License messages are XML-shaped: classic CDMs wrap the challenge in a UTF-16 `PlayReadyKeyMessage` envelope whose
* `HttpHeaders` name the real request headers and whose `Challenge` is base64 — unwrap it; modern (`.recommendation`)
* CDMs emit the challenge directly, sent as XML.
*/
const playReadyKeySystem = {
	keySystem: "com.microsoft.playready",
	keyFormats: ["com.microsoft.playready"],
	requestVariants: ["com.microsoft.playready", "com.microsoft.playready.recommendation"],
	toInitData: (uri) => {
		const initData = initDataFromKeyUri(uri);
		return initData && {
			initDataType: "cenc",
			initData: toPlayReadyPssh(initData)
		};
	},
	licenseRequest: (request) => {
		const text = new TextDecoder("utf-16le").decode(request.body).replace(/^\uFEFF/, "");
		if (!text.includes("PlayReadyKeyMessage")) return {
			...request,
			headers: {
				...request.headers,
				"Content-Type": "text/xml; charset=utf-8"
			}
		};
		const document_ = new DOMParser().parseFromString(text, "application/xml");
		const headers = { ...request.headers };
		for (const header of document_.querySelectorAll("HttpHeader")) {
			const name = header.querySelector("name")?.textContent;
			const value = header.querySelector("value")?.textContent;
			if (name && value) headers[name] = value;
		}
		const binary = atob(document_.querySelector("Challenge")?.textContent ?? "");
		const body = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) body[i] = binary.charCodeAt(i);
		return {
			...request,
			headers,
			body
		};
	}
};
/**
* FairPlay. No `toInitData`: its `skd://` key URI carries no EME init data, so sessions come from the element's
* `encrypted` events, where the init data arrives as `sinf` on the MSE path. Safari rejects a cenc-only configuration,
* hence the explicit `initDataTypes`.
*/
const fairPlayKeySystem = {
	keySystem: "com.apple.fps",
	keyFormats: ["com.apple.streamingkeydelivery"],
	initDataTypes: ["sinf", "cenc"]
};
/**
* FairPlay as an AirPlay receiver asks for it. Same key system and KEYFORMAT as {@link fairPlayKeySystem}, so it reads
* the same `#EXT-X-KEY` and licenses against the same `com.apple.fps` config entry — only the init-data type differs,
* and that difference is the whole reason the handoff exists. During a session WebKit plays the native-HLS fallback
* `<source>` on the receiver, whose key requests arrive as `skd`; MediaKeys negotiated for MSE's `sinf`/`cenc` cannot
* serve them.
*
* Deliberately outside `DEFAULT_KEY_SYSTEMS`: it is reachable only through `setupAirPlayFairPlay`, so a composition
* that drops that behavior drops this with it.
*
* Apple's FPS sample additionally pins `distinctiveIdentifier` and `persistentState` to `not-allowed`, where
* `buildKeySystemConfigurations` leaves both at the spec's `optional`. Not matched, because it buys nothing measurable:
* that sample reproduces the AirPlay `generateRequest` refusal _with_ those set, so they are not what the CDM is
* objecting to, and expressing them would widen `KeySystemModule` for every system to serve one. Revisit only with a
* case where the negotiation itself is refused.
*/
const fairPlayAirPlayKeySystem = {
	keySystem: "com.apple.fps",
	keyFormats: ["com.apple.streamingkeydelivery"],
	initDataTypes: ["skd"]
};
/**
* All three systems, in hls.js's negotiation order: the platform-native system first (FairPlay exists only on Apple
* UAs, so it costs nothing elsewhere). Clear Key stays out — a composition that wants it says so.
*
* The convenience default, not a requirement — an engine that only ever sees Widevine composes `[widevineKeySystem]`
* and pays for nothing else.
*/
const DEFAULT_KEY_SYSTEMS = [
	fairPlayKeySystem,
	widevineKeySystem,
	playReadyKeySystem
];

//#endregion
//#region ../spf/dist/dev/media/hls/reload-policy.js
/** Reload cadence when a playlist carries no usable target duration. */
const FALLBACK_TARGET_DURATION = 6;
/**
* Default `HOLD-BACK` as a multiple of the target duration when the playlist declares none — the HLS spec default (RFC
* 8216bis `EXT-X-SERVER-CONTROL`).
*/
const HOLD_BACK_TARGET_MULTIPLIER = 3;
/** Identity of a reload snapshot — window position + length. Changes when the window slid or grew. */
function snapshotSignature(track) {
	return `${getMediaPlaylistMetadata(track)?.mediaSequence ?? 0}:${track.segments.length}`;
}
function targetDurationOf(track) {
	return getMediaPlaylistMetadata(track)?.targetDuration || FALLBACK_TARGET_DURATION;
}
/**
* Live media-playlist reload cadence, per RFC 8216bis §6.3.4 — a {@link RecurrencePolicy} for a `RecurringRunner`
* re-resolving the selected track. Structurally matches `RecurrencePolicy<ResolvedTrack>` without importing it (media
* stays core-free): `current` is the freshly resolved track, `previous` the prior resolved snapshot.
*
* - Complete playlist (VoD, or live that hit `#EXT-X-ENDLIST`) → `null`: stop. Keys off `Track.duration` (finite once
*   complete), the single completeness source of truth.
* - Unchanged window (same media sequence + segment count as `previous`) → poll at half the target duration; a
*   moved/grown window (or the first reload) → full target duration.
*
* A failed reload doesn't reach here — the rejection propagates through the `RecurringRunner`; transient-failure
* recovery belongs at the fetch layer.
*
* Returned delays are milliseconds.
*/
function mediaPlaylistReloadDelay(current, previous) {
	if (Number.isFinite(current.duration)) return null;
	const target = targetDurationOf(current);
	return (!previous || snapshotSignature(current) !== snapshotSignature(previous) ? target : target / 2) * 1e3;
}
/**
* Target live latency (seconds) for a resolved track — how far behind the live edge the playhead should sit. Prefers
* the server's declared `EXT-X-SERVER-CONTROL` `HOLD-BACK`, falling back to {@link HOLD_BACK_TARGET_MULTIPLIER}× the
* target duration when absent (the spec default). This is the HLS side of the format-neutral `resolveLiveLatency` seam
* consumed by `seek-to-live-edge`; a DASH engine supplies its own (`suggestedPresentationDelay`).
*
* Only `HOLD-BACK` — never `PART-HOLD-BACK`, which assumes partial-segment playback. See
* {@link MediaPlaylistMetadata.holdBack}.
*/
function liveLatencyFor(track) {
	return getMediaPlaylistMetadata(track)?.holdBack ?? HOLD_BACK_TARGET_MULTIPLIER * targetDurationOf(track);
}
/**
* Resolve the target live latency for a presentation's timeline-bearing track — the HLS engine injects this as
* `seekToLiveEdge`'s format-neutral `resolveLiveLatency` seam. `0` when there is no resolved track to read (the
* behavior then seeks straight to the edge).
*/
function resolveLiveLatency(presentation, trackId) {
	if (!isResolvedPresentation(presentation) || !trackId) return 0;
	const track = findTrackById(presentation, trackId);
	return track && isResolvedTrack(track) ? liveLatencyFor(track) : 0;
}

//#endregion
//#region ../spf/dist/dev/media/live-window.js
/**
* Derive the live window of the track with the given id — the single source of truth for "where is live," consumed (via
* `liveWindowFromState`) by the seek-to-live-edge and live-seekable-range behaviors so neither re-derives (or
* re-presumes) the window shape. Type-agnostic: the caller decides which track bears the timeline (video when present,
* else audio).
*
* The window is a **live read** over the current `segments` array — never stored on the track. The anchor triple is
* frozen per source; per-segment `startTime` values are re-derived against it on every reload, so the edge here slides
* while the origin stays fixed (see `internal/design/spf/live-presentation-timeline-model.md`).
*
* Returns `null` when there is no live edge to track: an unresolved presentation or track, a track with no segments, or
* a **complete** playlist (VoD, or live that has ended — a finite `Track.duration`).
*/
function liveWindowFor(presentation, trackId) {
	if (!isResolvedPresentation(presentation) || !trackId) return null;
	const track = findTrackById(presentation, trackId);
	if (!track || !isResolvedTrack(track) || track.segments.length === 0) return null;
	if (Number.isFinite(track.duration)) return null;
	const { segments } = track;
	const last = segments[segments.length - 1];
	return {
		start: segments[0].startTime,
		end: last.startTime + last.duration
	};
}

//#endregion
//#region ../spf/dist/dev/playback/primitives/live-window.js
/**
* The id of the timeline-bearing track: the selected video track when present, else the selected audio track. The
* single pick both the window derivation and the live-latency resolution (`seek-to-live-edge`) share, so they can't
* drift.
*/
function liveTrackId(state) {
	return state.selectedVideoTrackId?.get() ?? state.selectedAudioTrackId?.get();
}
/**
* One type's window: the selected track's when it's resolved, else any resolved track of the type. The fallback keeps
* the window from blinking to `null` mid ABR / user switch — all renditions of a type are time-aligned and share the
* anchor, so a deselected track's window may trail live by up to one reload during the switch gap (acceptable; the
* selected track's fresh window resumes the moment it resolves). A null blink would flip `seekToLiveEdge` out of `live`
* and stall the seekable-range writer.
*/
function liveWindowForType(presentation, selectedId, type) {
	if (!presentation || selectedId === void 0) return null;
	const selected = liveWindowFor(presentation, selectedId);
	if (selected) return selected;
	for (const track of getTracksByType(presentation, type)) {
		const window = liveWindowFor(presentation, track.id);
		if (window) return window;
	}
	return null;
}
function liveWindowFromState(state) {
	const presentation = state.presentation.get();
	const video = liveWindowForType(presentation, state.selectedVideoTrackId?.get(), "video");
	const audio = liveWindowForType(presentation, state.selectedAudioTrackId?.get(), "audio");
	if (video && audio) {
		const start = Math.max(video.start, audio.start);
		const end = Math.min(video.end, audio.end);
		return start < end ? {
			start,
			end
		} : null;
	}
	return video ?? audio;
}
/**
* Resolve the live edge — the window bounds plus the target playhead position — from a behavior's setup arguments.
* Bundles the window geometry and the format-specific latency policy (`config.resolveLiveLatency`) so the consuming
* behavior never has to compose them; it just forwards its `{ state, config }`. `null` when there is no live edge (VOD
* / ended / unresolved).
*
* Reads signals lazily — call it inside a reactive context (an effect).
*/
function getLiveEdge({ state, config }) {
	const window = liveWindowFromState(state);
	if (!window) return null;
	const latency = config?.resolveLiveLatency?.(state.presentation.get(), liveTrackId(state)) ?? 0;
	return {
		...window,
		liveEdgeStart: Math.max(window.start, window.end - latency)
	};
}

//#endregion
//#region ../spf/dist/dev/network/retry.js
const DEFAULT_RETRY_POLICY = {
	maxRetries: 3,
	baseDelayMs: 1e3,
	firstByteTimeoutMs: 8e3
};
/** 5xx is transient; a 4xx (bad token, malformed request) is the client's to fix, so it is fatal — no retry. */
function isTransientStatus(status) {
	return status >= 500;
}
function abortError() {
	return new DOMException("Aborted", "AbortError");
}
/** A delay that rejects when the signal aborts, so a backoff wait never outlives a torn-down request. */
function backoffDelay(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(abortError());
		const timer = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(abortError());
		}, { once: true });
	});
}
/**
* Fetch `url` under the naive retry/timeout policy. Resolves with the first successful response, or a fatal 4xx the
* caller surfaces as-is; throws the last error once retries are exhausted on a network error or first-byte timeout. The
* caller's `signal` is honoured — an external abort propagates immediately and is never retried, so it stays
* distinguishable from the internal first-byte timeout.
*/
async function fetchWithRetry(url, init, signal, policy = DEFAULT_RETRY_POLICY) {
	let attempt = 0;
	for (;;) {
		if (signal.aborted) throw abortError();
		const combined = anyAbortSignal([signal, AbortSignal.timeout(policy.firstByteTimeoutMs)]);
		try {
			const response = await fetch(url, {
				...init,
				signal: combined
			});
			if (response.ok || !isTransientStatus(response.status)) return response;
			if (attempt >= policy.maxRetries) return response;
		} catch (error) {
			if (signal.aborted) throw error;
			if (attempt >= policy.maxRetries) throw error;
		}
		attempt++;
		await backoffDelay(policy.baseDelayMs * 2 ** (attempt - 1), signal);
	}
}

//#endregion
//#region ../spf/dist/dev/media/dom/eme.js
/**
* Browser EME helpers for DRM-composed engines: `MediaKeySystemAccess` negotiation, MediaKeys attachment, the DRM
* network exchange (`fetchDrm`), and the server-certificate fetch built on it. Stateless helpers — `setupMediaKeys`
* owns the negotiation lifecycle, and everything that lives for a session's lifetime (opening it, its license exchange,
* its key-status observation) is in `./license-sessions.ts`. `fetchLicense` sits there rather than here as the twin of
* `fetchServerCertificate` on purpose: the behavior tests mock `fetchDrm` at this module's boundary, which a caller in
* a sibling module routes through and a caller in this module would bypass.
*
* Everything system-specific lives in a {@link KeySystemModule} (`./key-systems.ts`); these helpers only read the
* contract, so adding a system touches no code here — and this module deliberately does not re-export the modules
* themselves, so importing these helpers never pulls a key system's code in. The DOM-free DRM model half (config
* contract, module contract, declared keys, candidate selection) lives in `../drm.ts` and is re-exported here.
*/
/**
* MediaKeySystemConfigurations for one key-system module over the given content types, most-preferred first.
*
* `requestMediaKeySystemAccess` takes the whole list and picks the first entry the CDM supports, so every preference
* here is expressed by offering an extra configuration rather than by retrying — and each one can only widen what
* negotiation accepts.
*
* Two module-declared preferences compose, encryption scheme outermost:
*
* - **Declared encryption scheme** (see `declaredEncryptionScheme`), stamped on every capability, then dropped when the
*   module keeps `schemeFallback`. CDMs that honour the member negotiate the exact scheme; CDMs that refuse it outright
*   still negotiate instead of failing the request.
* - **Robustness** (`videoRobustnessTiers` / `audioRobustnessTiers`), strongest rung first. One configuration per rung,
*   and nothing unstamped behind them: a device without the top tier descends the ladder, and the weakest rung is the
*   fallback. Chromium warns for any _requested_ configuration that omits `robustness` — including one it never accepts
*   — so the ladder ends at a tier every CDM has rather than at an unstamped entry.
*
* Scheme is the outer preference because a mismatched scheme risks failing decode outright, whereas a lower robustness
* tier only means weaker content protection.
*/
function buildKeySystemConfigurations(module_, contentTypes, encryptionScheme) {
	const tierAt = (tiers, rung) => tiers === void 0 || tiers.length === 0 ? void 0 : tiers[Math.min(rung, tiers.length - 1)];
	const configuration = (scheme, rung) => {
		const capability = (robustness) => (contentType) => ({
			contentType,
			...scheme !== void 0 && { encryptionScheme: scheme },
			...robustness !== void 0 && { robustness }
		});
		const video = rung === void 0 ? void 0 : tierAt(module_.videoRobustnessTiers, rung);
		const audio = rung === void 0 ? void 0 : tierAt(module_.audioRobustnessTiers, rung);
		return {
			initDataTypes: [...module_.initDataTypes ?? ["cenc"]],
			...contentTypes.video.length > 0 && { videoCapabilities: contentTypes.video.map(capability(video)) },
			...contentTypes.audio.length > 0 && { audioCapabilities: contentTypes.audio.map(capability(audio)) }
		};
	};
	const schemes = encryptionScheme === void 0 ? [void 0] : module_.schemeFallback === false ? [encryptionScheme] : [encryptionScheme, void 0];
	const rungCount = Math.max(contentTypes.video.length > 0 ? module_.videoRobustnessTiers?.length ?? 0 : 0, contentTypes.audio.length > 0 ? module_.audioRobustnessTiers?.length ?? 0 : 0);
	const rungs = rungCount > 0 ? Array.from({ length: rungCount }, (_, rung) => rung) : [void 0];
	return schemes.flatMap((scheme) => rungs.map((rung) => configuration(scheme, rung)));
}
/**
* Negotiate CDM access: ask for each candidate module (and each of its request-string variants) in order with a
* configuration built for that module, first success wins. Resolves `undefined` when every candidate is refused (or
* none were given).
*
* Reports the module rather than the request string that won: license-server lookup and message shaping key off the
* configured `keySystem`, not off the variant a CDM happened to accept.
*
* Two passes, and the order is the whole point. The first asks with the module's robustness ladder, which names a tier
* on every capability — Chromium warns about any _requested_ configuration that omits one, so a warning-free
* negotiation cannot carry an unstamped entry alongside the stamped ones. The second pass asks unstamped, and runs only
* when every candidate refused the first: a CDM that has none of the named tiers then still gets access. That trades
* the warning back for playback exactly where it is the price of playing at all, instead of everywhere.
*/
async function requestKeySystemAccess(keySystems, contentTypes, encryptionScheme) {
	const attempt = async (module_, configurations) => {
		for (const variant of module_.requestVariants ?? [module_.keySystem]) try {
			return await navigator.requestMediaKeySystemAccess(variant, configurations);
		} catch {}
	};
	for (const module_ of keySystems) {
		const access = await attempt(module_, buildKeySystemConfigurations(module_, contentTypes, encryptionScheme));
		if (access) return {
			module: module_,
			access
		};
	}
	for (const module_ of keySystems) {
		const access = await attempt(module_, buildKeySystemConfigurations(module_, contentTypes, encryptionScheme).map(unstampedRobustness));
		if (access) return {
			module: module_,
			access
		};
	}
}
/** The same configuration with every capability's robustness dropped. */
function unstampedRobustness(configuration) {
	const strip = (capabilities) => capabilities?.map(({ robustness: _robustness, ...rest }) => rest);
	const video = strip(configuration.videoCapabilities);
	const audio = strip(configuration.audioCapabilities);
	return {
		...configuration,
		...video && { videoCapabilities: video },
		...audio && { audioCapabilities: audio }
	};
}
/**
* Apply the negotiated module's license-request transform to a request already carrying the source's URL and headers.
* With no transform the default POSTs the raw message as octet-stream (Widevine and FairPlay want this; Mux's FairPlay
* server takes the bare SPC) — octet-stream wins over a configured `Content-Type`, matching the prior contract.
* PlayReady's module transform unwraps the challenge envelope instead.
*/
function applyLicenseRequest(module_, request) {
	return module_?.licenseRequest?.(request) ?? {
		...request,
		headers: {
			...request.headers,
			"Content-Type": "application/octet-stream"
		}
	};
}
/**
* Apply the negotiated module's license-response transform. With no transform the response passes through unchanged
* (Mux and EZDRM return the raw CDM license); a module whose server wraps the license overrides it to unwrap. The
* per-source override composes after this, in `exchangeLicenses`.
*/
function applyLicenseResponse(module_, response) {
	return module_?.licenseResponse?.(response) ?? response;
}
/**
* Apply the negotiated module's certificate-request transform. No shipped system needs one — the default is the plain
* GET FairPlay's certificate endpoints answer — so this is identity unless a module declares its own. The per-source
* override composes after it, in `setupMediaKeys`.
*/
function applyCertificateRequest(module_, request) {
	return module_?.certificateRequest?.(request) ?? request;
}
/** Apply the negotiated module's certificate-response transform. Identity unless a module unwraps its certificate. */
function applyCertificateResponse(module_, response) {
	return module_?.certificateResponse?.(response) ?? response;
}
/**
* Fetch and unwrap one key system's server (application) certificate — FairPlay cannot generate a license request
* without it. The same two-layer compose as the license exchange, module first: the module default (a plain GET today)
* then the per-source override — a provider that gates its certificate behind an auth header or its own URL shapes it
* here — around the fetch, and the response unwraps the same way. The configured `certificateHeaders` and `credentials`
* ride the request; the license `headers` deliberately do not. The caller applies the result with
* `setServerCertificate` before it publishes the negotiation.
*/
async function fetchServerCertificate(module_, entry, url, signal) {
	const shaped = await applyCertificateRequest(module_, {
		url,
		method: "GET",
		headers: { ...resolveDrmHeaders(entry.certificateHeaders) },
		body: null,
		credentials: resolveDrmCredentials(entry.credentials)
	});
	const unwrapped = await applyCertificateResponse(module_, await fetchDrm(entry.certificateRequest ? await entry.certificateRequest(shaped) : shaped, signal));
	return entry.certificateResponse ? await entry.certificateResponse(unwrapped) : unwrapped;
}
/** Attach (or with `null`, detach) MediaKeys on a media element. */
function attachMediaKeys(mediaElement, mediaKeys) {
	return mediaElement.setMediaKeys(mediaKeys);
}
/**
* Perform one DRM network exchange — a license POST, a certificate GET — and return the raw response bytes. Method,
* headers, and body all ride on the {@link DrmRequest} (already shaped by the module default and any per-source
* override), so this is the single fetch seam the license and certificate paths share and the shape a future network
* layer slots into. Wrapped in {@link fetchWithRetry}'s naive retry + first-byte timeout so a transient blip on the
* (routinely flaky, rate-limited) license server doesn't park the source on a single failure.
*/
async function fetchDrm(request, signal) {
	const response = await fetchWithRetry(request.url, {
		method: request.method,
		headers: request.headers,
		body: request.body,
		credentials: request.credentials
	}, signal);
	if (!response.ok) throw new Error(`DRM request failed with status ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

//#endregion
//#region ../spf/dist/dev/media/dom/license-transforms.js
/** BufferSource → its bytes, without copying. */
function bufferSourceBytes(source) {
	return source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

//#endregion
//#region ../spf/dist/dev/media/dom/license-sessions.js
/**
* MediaKeySession lifecycle for DRM-composed engines: open a session against attached MediaKeys, exchange its license
* with the configured server as the CDM asks, observe its key statuses, and close it when its lifetime ends.
*
* Everything here binds to one `AbortSignal` — the caller's lifetime — and reports through a callback, so it reads no
* signals and imports nothing from the behavior layer; `exchangeLicenses` decides which sessions to open and when. Kept
* apart from `eme.ts`, which is stateless: a session carries state (its listeners, its last-seen key statuses) for as
* long as it lives. `fetchLicense` is the license twin of `eme.ts`'s `fetchServerCertificate`; it lives here, beside
* its one caller, and because `exchangeLicenses`' tests mock `fetchDrm` at the `eme` boundary that this module
* crosses.
*/
/**
* Key statuses reported as diagnosable causes, on the SVTA codes matching each status. Only statuses that stop playback
* report: `output-downscaled` still plays, `released` is lifecycle-normal, `usable-in-future` may resolve on its own.
* Report-only — exclusion or renewal policy on these transitions is a downstream decision.
*/
const REPORTABLE_KEY_STATUS_CODES = {
	expired: SVTA_LICENSE_EXPIRED,
	"output-restricted": SVTA_INSUFFICIENT_OUTPUT_PROTECTION,
	"internal-error": SVTA_DRM_SESSION_ERROR
};
/** A key id as lowercase hex, so the reported `data` names which key failed. */
function keyIdHex(keyId) {
	return [...bufferSourceBytes(keyId)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/**
* POST one license request and return the raw license. Two layers, module first: the module default shapes the wire
* protocol (PlayReady's envelope unwrap, the octet-stream default) over the configured headers and credentials, then
* the per-source override decorates the result — an auth header, a minted token — without re-implementing that shaping.
* Rejects on any failure, shaping included, for the caller to report as a bad license request.
*/
async function fetchLicense(module_, entry, licenseUrl, message, signal) {
	const shaped = await applyLicenseRequest(module_, {
		url: licenseUrl,
		method: "POST",
		headers: { ...resolveDrmHeaders(entry.headers) },
		body: message,
		credentials: resolveDrmCredentials(entry.credentials)
	});
	const request = entry.licenseRequest ? await entry.licenseRequest(shaped) : shaped;
	return fetchDrm(request, signal);
}
/**
* Unwrap a raw license for the CDM, in the same order as the way out: the module default unwraps its protocol, then the
* per-source override unwraps any deployment envelope. Rejects for the caller to report as a rejected response.
*/
async function unwrapLicense(module_, entry, license) {
	const unwrapped = await applyLicenseResponse(module_, license);
	return entry.licenseResponse ? await entry.licenseResponse(unwrapped) : unwrapped;
}
/**
* Observe a session's key statuses after licensing, report-only. A key turning expired / output-restricted /
* internal-error otherwise presents as a black frame or stall with an empty errors sequence (HDCP downgrade,
* long-session expiry). Tracked per key id because the CDM re-fires `keystatuschange` for unrelated reasons: an
* unchanged status is not a new observation, while recovery then re-failure is.
*/
function observeKeyStatuses(session, keySystem, report, signal) {
	const lastStatuses = /* @__PURE__ */ new Map();
	listen(session, "keystatuschange", () => {
		session.keyStatuses.forEach((status, rawKeyId) => {
			const keyId = keyIdHex(rawKeyId);
			const previous = lastStatuses.get(keyId);
			lastStatuses.set(keyId, status);
			const code = REPORTABLE_KEY_STATUS_CODES[status];
			if (status === previous || code === void 0) return;
			report({
				code,
				data: {
					keySystem,
					status,
					keyId
				}
			});
		});
	}, { signal });
}
/**
* Open one MediaKeySession for `initData` and drive it for its lifetime: exchange its license on every `message` the
* CDM raises (4004 when the request fails, 4016 when the CDM rejects the response), observe its key statuses, and
* generate the initial request (4021 when the CDM cannot). The session closes when `signal` aborts — the abort first
* kills in-flight fetches and these listeners, then the close — so the caller holds no session list of its own.
*/
function openLicenseSession({ mediaKeys, keySystem, module: module_, entry, licenseUrl, initDataType, initData, signal, report, onGenerateRequestError }) {
	const session = mediaKeys.createSession();
	const exchange = async (message) => {
		let license;
		try {
			license = await fetchLicense(module_, entry, licenseUrl, message, signal);
		} catch (error) {
			if (signal.aborted) return;
			report({
				code: SVTA_BAD_LICENSE_REQUEST,
				data: {
					keySystem,
					reason: String(error)
				}
			});
			return;
		}
		if (signal.aborted) return;
		try {
			const unwrapped = await unwrapLicense(module_, entry, license);
			if (signal.aborted) return;
			await session.update(unwrapped);
		} catch (error) {
			if (signal.aborted) return;
			report({
				code: SVTA_DRM_LICENSE_RESPONSE_REJECTED,
				data: {
					keySystem,
					reason: String(error)
				}
			});
		}
	};
	listen(session, "message", (event) => void exchange(event.message), { signal });
	observeKeyStatuses(session, keySystem, report, signal);
	signal.addEventListener("abort", () => {
		session.close().catch(() => {});
	}, { once: true });
	session.generateRequest(initDataType, initData).catch((error) => {
		if (signal.aborted) return;
		if (onGenerateRequestError) {
			onGenerateRequestError(error);
			return;
		}
		report({
			code: SVTA_DRM_LICENSE_REQUEST_GENERATION_FAILED,
			data: {
				keySystem,
				reason: String(error)
			}
		});
	});
	return session;
}
/**
* The event-driven path for keys without inline init data (FairPlay `skd://`): protection surfaces only once an
* appended init segment fires `encrypted` (`sinf` on the MSE path, `skd` from an AirPlay receiver). Listens until
* `signal` aborts.
*/
function listenForEncryptedInitData(mediaElement, onInitData, signal, { dedupe = true, initDataTypes } = {}) {
	const seen = [];
	listen(mediaElement, "encrypted", (event) => {
		const { initDataType, initData } = event;
		if (!initData) return;
		if (initDataTypes && !initDataTypes.includes(initDataType)) return;
		const bytes = new Uint8Array(initData);
		if (dedupe) {
			if (seen.some((prior) => prior.length === bytes.length && prior.every((byte, i) => byte === bytes[i]))) return;
			seen.push(bytes);
		}
		onInitData(initDataType, bytes);
	}, { signal });
}

//#endregion
//#region ../spf/dist/dev/media/dom/fairplay-legacy.js
/**
* The pre-EME WebKit key API, for the one case EME cannot serve: Safari refuses `generateRequest` while the playback
* target is an AirPlay receiver, and the legacy API still works. Measured on macOS/Safari 26.6.2 — the CDM grants
* access for `initDataTypes: ['skd']` and then throws `NotSupportedError` from `generateRequest`, self-inconsistently.
*
* The legacy twin of `license-sessions.ts`, and shaped like it: everything binds to one `AbortSignal` and reports
* through a callback, so it reads no signals and imports nothing from the behavior layer. Two differences the caller
* has to care about — the application certificate is **mandatory** (it is packed into the session's initialization data
* rather than handed to the CDM), and `webkitSetMediaKeys` / `update` are synchronous.
*
* Ported from the shipped `adapters/native-hls-video/src/fairplay-webkit.ts`, which serves the same bug on the native
* engine. Delete both once WebKit fixes it.
*
* @see https://developer.apple.com/streaming/fps/
*/
/** Key system identifier the legacy `WebKitMediaKeys` API answers to. */
const FAIRPLAY_LEGACY_KEY_SYSTEM = "com.apple.fps.1_0";
/** What FairPlay negotiates capabilities against — the manifest, not a codec. */
const FAIRPLAY_CONTENT_TYPE = "application/vnd.apple.mpegurl";
/** Whether this realm still exposes the legacy WebKit key API for `mediaElement`. */
function supportsWebKitFairPlay(mediaElement) {
	return "WebKitMediaKeys" in globalThis && "webkitSetMediaKeys" in mediaElement;
}
/**
* Whether a `generateRequest` rejection is the AirPlay-session refusal this module exists for, rather than a real
* failure. Matched on the error and the live session only — no OS sniffing, so it stops applying by itself the moment
* WebKit starts serving EME during a session.
*/
function isAirPlayGenerateRequestRefusal(error, mediaElement) {
	return error instanceof DOMException && error.name === "NotSupportedError" && !!mediaElement.webkitCurrentPlaybackTargetIsWireless;
}
/** Install the legacy key system on the element, once. Throws when this realm cannot. */
function installKeys(mediaElement) {
	if (mediaElement.webkitKeys) return;
	const Constructor = globalThis.WebKitMediaKeys;
	if (!Constructor) throw new Error("WebKitMediaKeys is unavailable");
	mediaElement.webkitSetMediaKeys(new Constructor(FAIRPLAY_LEGACY_KEY_SYSTEM));
}
/**
* Open one legacy session for a `webkitneedkey` payload and drive it for its lifetime: exchange its license on every
* `webkitkeymessage` through the same fetch and transform layers as the EME path, and report what the CDM rejects. The
* session closes when `signal` aborts, which also releases the element's legacy keys.
*
* `certificate` is required: the legacy API packs it into the session's initialization data, so unlike EME there is no
* going without one.
*/
function openLegacyLicenseSession({ mediaElement, module: module_, entry, licenseUrl, certificate, initData, signal, report }) {
	const element = mediaElement;
	installKeys(element);
	const keyUri = keyUriFromInitData(initData);
	const contentId = (entry.fairPlayContentId ?? defaultFairPlayContentId)(keyUri);
	const session = element.webkitKeys.createSession(FAIRPLAY_CONTENT_TYPE, packInitData(initData, contentId, certificate));
	const exchange = async (message) => {
		let license;
		try {
			license = await fetchLicense(module_, entry, licenseUrl, message, signal);
		} catch (error) {
			if (signal.aborted) return;
			report({
				code: SVTA_BAD_LICENSE_REQUEST,
				data: {
					keySystem: FAIRPLAY_LEGACY_KEY_SYSTEM,
					reason: String(error)
				}
			});
			return;
		}
		if (signal.aborted) return;
		try {
			const unwrapped = await unwrapLicense(module_, entry, license);
			if (signal.aborted) return;
			session.update(unwrapped);
		} catch (error) {
			if (signal.aborted) return;
			report({
				code: SVTA_DRM_LICENSE_RESPONSE_REJECTED,
				data: {
					keySystem: FAIRPLAY_LEGACY_KEY_SYSTEM,
					reason: String(error)
				}
			});
		}
	};
	let requested = false;
	listen(session, "webkitkeymessage", (event) => {
		requested = true;
		exchange(event.message);
	}, { signal });
	listen(session, "webkitkeyerror", () => report({
		code: SVTA_DRM_SESSION_ERROR,
		data: {
			keySystem: FAIRPLAY_LEGACY_KEY_SYSTEM,
			errorCode: session.error?.code,
			systemCode: session.error?.systemCode,
			licenseRequested: requested
		}
	}), { signal });
	signal.addEventListener("abort", () => {
		try {
			session.close();
		} catch {}
		try {
			element.webkitSetMediaKeys(null);
		} catch {}
	}, { once: true });
}
/**
* Repack `webkitneedkey` initialization data into what `WebKitMediaKeys.createSession()` expects.
*
* In: the raw event data — a `skd://` URI as UTF-16LE, in newer WebKit builds behind a 4-byte little-endian byte count
* — plus the content id its provider derives from that URI. Out: that data verbatim, then the content ID and the
* application certificate, each behind their own 4-byte little-endian byte count.
*/
function packInitData(initData, contentIdText, certificate) {
	const source = new Uint8Array(initData);
	const contentId = toUtf16LE(contentIdText);
	const packed = new Uint8Array(source.byteLength + 4 + contentId.byteLength + 4 + certificate.byteLength);
	const view = new DataView(packed.buffer);
	let offset = 0;
	const append = (bytes) => {
		packed.set(bytes, offset);
		offset += bytes.byteLength;
	};
	const appendWithLength = (bytes) => {
		view.setUint32(offset, bytes.byteLength, true);
		offset += 4;
		append(bytes);
	};
	append(source);
	appendWithLength(contentId);
	appendWithLength(certificate);
	return packed;
}
/**
* The `skd://` URI out of `webkitneedkey`'s initialization data, whole — scheme included, so a provider's resolver sees
* exactly what its manifest declared. Locating the scheme rather than skipping a fixed prefix covers both the bare URI
* older WebKit sends and the length-prefixed form newer builds do.
*/
function keyUriFromInitData(initData) {
	const decoded = new TextDecoder("utf-16le").decode(initData);
	const start = decoded.indexOf("skd://");
	return start === -1 ? decoded : decoded.slice(start);
}
function toUtf16LE(value) {
	const bytes = new Uint8Array(value.length * 2);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
	return bytes;
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/setup-airplay-fairplay.js
/**
* **Serve an AirPlay receiver's FairPlay key requests.** During an AirPlay session WebKit takes playback off MSE and
* onto the native-HLS fallback `<source>` `setupAirPlay` appends, and the receiver raises its own key requests through
* the sender's CDM as `skd`. The MediaKeys `setupMediaKeys` negotiated are configured for `sinf`/`cenc` and cannot
* serve those, so it yields the element for the session's duration (an observed `loadingSuspended` is
* `preconditions-unmet` there) and this behavior negotiates a second time, for `skd`, in the gap it leaves.
*
* The handoff is needed regardless of any browser bug: it is the init-data type, not a workaround, that the MSE
* negotiation cannot satisfy.
*
* Negotiation is driven by the receiver's first request rather than by the session starting. A session on a FairPlay
* source does not by itself mean the receiver needs anything from this CDM, and the shipped native path
* (`adapters/native-hls-video/src/drm.ts`) resolves its key system the same lazy way. Every request awaits the one
* negotiation, so the certificate is always applied before any `generateRequest` — the same ordering `setupMediaKeys`
* carries across its publish, here carried by the promise.
*
* Deliberately **not** a writer of `context.mediaKeys`. That slot is `setupMediaKeys`' handoff to `exchangeLicenses`,
* and publishing receiver MediaKeys into it would wake `exchangeLicenses` to license an MSE pipeline that is not
* playing. These MediaKeys stay behavior-local, and a cleared `context.mediaKeys` is instead read as the gate proving
* `setupMediaKeys` has finished yielding.
*
* Nothing here dedupes. `listenForEncryptedInitData`'s byte-identity skip is right for MSE, where demuxed audio and
* video fire for the same key, and wrong here: the receiver proxies its own SPC on connect and again on disconnect, so
* a repeat is a second genuine request and dropping it strands the session.
*
* Single-positive-state reactor like `exchangeLicenses`, with one `AbortController` per entry — the state-exit cleanup
* is the abort, which closes every session, plus a detach of the MediaKeys this behavior attached. The detach is
* conditional: both this behavior and `setupMediaKeys` react to the same falling edge, so it releases the element only
* while it still holds it, exactly as the native path does.
*
* **EME first, then the legacy key system.** Measured on macOS/Safari 26.6.2 against a real receiver: the CDM grants
* access for `initDataTypes: ['skd']` and then throws `NotSupportedError` from `generateRequest` — self-inconsistent,
* and the reason the pre-EME `WebKitMediaKeys` path still exists. That refusal, and only that refusal while the target
* is wireless, hands the session over to `media/dom/fairplay-legacy.ts`; nothing sniffs an OS, so a fixed WebKit stops
* taking the path by itself. The handover then reloads the resource, as the shipped native path does.
*
* Serving the `webkitneedkey` payload already in hand was tried instead, to avoid the reload — `setupAirPlay` holds the
* MediaSource rebuild precisely because a `load()` under a live receiver can destroy a session still being established.
* Measured on macOS/Safari 26.6.2 against a receiver, the legacy CDM refused that session outright:
* `MEDIA_KEYERR_UNKNOWN`, no OSStatus, no license ever requested. Releasing EME's keys is evidently not enough to leave
* the element servable by the old API, so the load algorithm has to run again and the payload from before it is not
* reused. Resource selection re-runs over the `<source>` children, where the native-HLS fallback still sits, so the
* receiver keeps its stream; playback restarts, which the handoff already was.
*
* Droppable. A composition omitting it carries neither `fairPlayAirPlayKeySystem` nor this file nor the legacy module,
* and — since `loadingSuspended` is observed rather than declared — an engine without `setupAirPlay` never leaves
* `'preconditions-unmet'` anyway.
*/
/**
* What an AirPlay receiver's key requests arrive as. FairPlay's `skd://` key URI carries no EME init data, so the
* request comes from the element rather than the manifest — and it is this type, not MSE's `sinf`, that the MediaKeys
* negotiated for the MSE pipeline cannot serve.
*/
const AIRPLAY_INIT_DATA_TYPE = "skd";
/**
* What FairPlay negotiates capabilities against for the receiver: the manifest, not a codec. The receiver plays the
* native-HLS fallback source, so the renditions the MSE pipeline resolved say nothing about what it will decode.
* Matches the shipped native path's configuration.
*/
const AIRPLAY_CONTENT_TYPE = "application/vnd.apple.mpegurl";
function setupAirPlayFairPlaySetup({ state, context, config }) {
	const loadingSuspended = state.loadingSuspended;
	const report = (error) => emitError(state, error);
	const derivedStateSignal = computed(() => {
		if (!context.mediaElement.get() || !loadingSuspended?.get()) return "preconditions-unmet";
		if (context.mediaKeys.get()) return "preconditions-unmet";
		const presentation = state.presentation.get();
		if (!isResolvedPresentation(presentation)) return "preconditions-unmet";
		if (!config.keySystems.some(({ keySystem }) => keySystem === fairPlayAirPlayKeySystem.keySystem)) return "preconditions-unmet";
		return keySystemCandidates(declaredDrmKeys(presentation), config.drm, [fairPlayAirPlayKeySystem]).length > 0 ? "serving-receiver" : "preconditions-unmet";
	});
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			"serving-receiver": { entry: () => {
				const mediaElement = context.mediaElement.get();
				const entry = config.drm[fairPlayAirPlayKeySystem.keySystem];
				const controller = new AbortController();
				const { signal } = controller;
				/** The MediaKeys this behavior attached, for the conditional detach below. */
				let attached;
				/** Non-sticky, per session: nothing here sniffs an OS, so a fixed WebKit simply stops taking this path. */
				let useLegacy = false;
				/** Only requests from the reloaded resource can use the legacy CDM. */
				let legacyReady = false;
				let certificateRequest;
				const serverCertificate = () => certificateRequest ??= (async () => {
					const url = resolveDrmUrl(entry.serverCertificateUrl);
					if (url === void 0) return void 0;
					return fetchServerCertificate(fairPlayAirPlayKeySystem, entry, url, signal);
				})();
				/**
				* The current source's license server, or a report and `undefined`. Resolved per request, like the headers
				* and transforms the session reads: the gate proved a server once, but the receiver asks again on disconnect,
				* and a same-URL source swap that drops the entry never exits this state. Saying so beats POSTing to a
				* literal "undefined".
				*/
				const receiverLicenseUrl = () => {
					const licenseUrl = resolveDrmUrl(entry.licenseUrl);
					if (licenseUrl !== void 0) return licenseUrl;
					report({
						code: SVTA_UNSUPPORTED_DRM_SYSTEM,
						data: {
							keySystems: [fairPlayAirPlayKeySystem.keySystem],
							reason: "no license server for the receiver"
						}
					});
				};
				const negotiate = async () => {
					const negotiated = await requestKeySystemAccess([fairPlayAirPlayKeySystem], {
						video: [AIRPLAY_CONTENT_TYPE],
						audio: []
					}, void 0);
					if (!negotiated) {
						report({
							code: SVTA_UNSUPPORTED_DRM_SYSTEM,
							data: { keySystems: [fairPlayAirPlayKeySystem.keySystem] }
						});
						return;
					}
					let mediaKeys;
					try {
						mediaKeys = await negotiated.access.createMediaKeys();
					} catch (error) {
						report({
							code: SVTA_DRM_INITIALIZATION_ERROR,
							data: { reason: String(error) }
						});
						return;
					}
					try {
						const certificate = await serverCertificate();
						if (certificate) await mediaKeys.setServerCertificate(certificate);
					} catch (error) {
						if (signal.aborted) return void 0;
						report({
							code: SVTA_DRM_CERTIFICATE_ERROR,
							data: {
								keySystem: fairPlayAirPlayKeySystem.keySystem,
								reason: String(error)
							}
						});
						return;
					}
					if (signal.aborted) return void 0;
					await attachMediaKeys(mediaElement, mediaKeys);
					if (signal.aborted) {
						attachMediaKeys(mediaElement, null).catch(() => {});
						return;
					}
					attached = mediaKeys;
					return mediaKeys;
				};
				let negotiation;
				/** Settles once no revoked MediaSource blob is left among the element's `<source>` children. */
				const blobSourceDetached = () => new Promise((resolve) => {
					const blobSource = () => mediaElement.querySelector("source[src^=\"blob:\"]");
					if (!blobSource()) return resolve();
					const observer = new MutationObserver(() => {
						if (blobSource()) return;
						observer.disconnect();
						resolve();
					});
					observer.observe(mediaElement, { childList: true });
					signal.addEventListener("abort", () => {
						observer.disconnect();
						resolve();
					}, { once: true });
				});
				/**
				* The legacy path, for a sender whose EME refuses to generate a request during the session. Reached only from
				* that refusal, so an unaffected WebKit never installs the old key system at all.
				*/
				const serveLegacy = async (initData) => {
					if (signal.aborted) return;
					const licenseUrl = receiverLicenseUrl();
					if (licenseUrl === void 0) return;
					let certificate;
					try {
						certificate = await serverCertificate();
					} catch (error) {
						if (signal.aborted) return;
						report({
							code: SVTA_DRM_CERTIFICATE_ERROR,
							data: {
								keySystem: FAIRPLAY_LEGACY_KEY_SYSTEM,
								reason: String(error)
							}
						});
						return;
					}
					if (signal.aborted) return;
					if (!certificate) {
						report({
							code: SVTA_DRM_CERTIFICATE_ERROR,
							data: {
								keySystem: FAIRPLAY_LEGACY_KEY_SYSTEM,
								reason: "the legacy key system packs the certificate into the session, so one must be configured"
							}
						});
						return;
					}
					try {
						openLegacyLicenseSession({
							mediaElement,
							module: fairPlayAirPlayKeySystem,
							entry,
							licenseUrl,
							certificate,
							initData,
							signal,
							report
						});
					} catch (error) {
						report({
							code: SVTA_DRM_INITIALIZATION_ERROR,
							data: {
								keySystem: FAIRPLAY_LEGACY_KEY_SYSTEM,
								reason: String(error)
							}
						});
					}
				};
				/**
				* Hand the session over to the legacy API. EME has to release the element's keys before the old API can claim
				* them, and reloading the resource supplies the fresh `webkitneedkey` payload that resumes the exchange.
				*/
				const fallBackToLegacy = async (error) => {
					if (useLegacy) return;
					if (!isAirPlayGenerateRequestRefusal(error, mediaElement) || !supportsWebKitFairPlay(mediaElement)) {
						report({
							code: SVTA_DRM_LICENSE_REQUEST_GENERATION_FAILED,
							data: {
								keySystem: fairPlayAirPlayKeySystem.keySystem,
								reason: String(error)
							}
						});
						return;
					}
					useLegacy = true;
					if (attached) {
						attached = void 0;
						await attachMediaKeys(mediaElement, null).catch(() => {});
					}
					if (signal.aborted) return;
					await blobSourceDetached();
					if (signal.aborted) return;
					const position = mediaElement.currentTime;
					const wasPlaying = !mediaElement.paused;
					listen(mediaElement, "loadedmetadata", () => {
						if (signal.aborted) return;
						if (position > 0) mediaElement.currentTime = position;
						if (!wasPlaying) return;
						mediaElement.play().catch((error) => {
							console.warn("[setupAirPlayFairPlay] resume after handover rejected — staying paused:", error);
						});
					}, {
						signal,
						once: true
					});
					mediaElement.load();
					legacyReady = true;
				};
				const serve = async (initDataType, initData) => {
					if (useLegacy) return;
					const mediaKeys = await (negotiation ??= negotiate());
					if (!mediaKeys || signal.aborted || useLegacy) return;
					const licenseUrl = receiverLicenseUrl();
					if (licenseUrl === void 0) return;
					openLicenseSession({
						mediaKeys,
						keySystem: fairPlayAirPlayKeySystem.keySystem,
						module: fairPlayAirPlayKeySystem,
						entry,
						licenseUrl,
						initDataType,
						initData,
						signal,
						report,
						onGenerateRequestError: (error) => void fallBackToLegacy(error)
					});
				};
				listen(mediaElement, "webkitneedkey", (event) => {
					const { initData } = event;
					if (!initData || !legacyReady) return;
					serveLegacy(initData);
				}, { signal });
				listenForEncryptedInitData(mediaElement, (initDataType, initData) => void serve(initDataType, initData), signal, {
					dedupe: false,
					initDataTypes: [AIRPLAY_INIT_DATA_TYPE]
				});
				return () => {
					controller.abort();
					if (attached && mediaElement.mediaKeys === attached) attachMediaKeys(mediaElement, null).catch(() => {});
				};
			} }
		}
	});
}
const setupAirPlayFairPlay = defineBehavior({
	stateKeys: ["presentation"],
	contextKeys: ["mediaElement", "mediaKeys"],
	setup: ({ state, context, config }) => setupAirPlayFairPlaySetup({
		state,
		context,
		config
	})
});

//#endregion
//#region ../spf/dist/dev/features/airplay-fairplay.js
/** The behaviors the feature composes, in setup order. */
const behaviors$7 = [setupAirPlayFairPlay];
/** The config defaults the feature contributes. */
const defaultConfig$7 = {};
/** The state values the feature seeds. */
const initialState$7 = {};
/**
* Plays FairPlay-protected content on an AirPlay receiver, negotiating the receiver's keys while a session holds.
*
* Requires the `drm` and `keySystems` config, such as `drmFeature` sets; without them it throws once a session starts.
* Does nothing without a writer of `state.loadingSuspended`, such as `airPlayFeature`, which signals the session.
*/
const airPlayFairPlayFeature = defineFeature({
	behaviors: behaviors$7,
	defaultConfig: defaultConfig$7,
	initialState: initialState$7
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/exchange-licenses.js
/**
* **Open MediaKeySessions for the negotiated key system and exchange their licenses.** Preconditions on the handoff
* `setupMediaKeys` publishes — attached `context.mediaKeys` plus `state.negotiatedKeySystem` — so entry implies the CDM
* is negotiated, its server certificate applied, and the MediaKeys attached; the "certificate before `generateRequest`"
* ordering rides that handoff rather than a position in a shared function body.
*
* Sessions open manifest-driven — one per inline init data the negotiated system's module can project out of a key URI
* (Widevine PSSH / PlayReady PRO as `data:` URIs) — or, when the manifest carries none (FairPlay `skd://`),
* event-driven off the element's `encrypted` events, deduped by init-data bytes. Each exchange composes two transform
* layers, module first: the negotiated system's module default (wire protocol) then the per-source override
* (`source.drm[ks]`, deployment decoration) — over the request outbound and the response inbound — around the fetch to
* that system's configured server.
*
* Failures report onto the errors sequence via `emitError` (SVTA 4004 license request, 4016 license rejected, 4021
* request generation). None of them raise the load gate: by the time this behavior runs the gate is already down —
* deliberately, since the appends that follow are what fire `encrypted` for the event-driven path — and browsers queue
* decode on missing keys, so an unlicensed source stalls rather than failing. Post-license, each session's
* `keystatuschange` is observed report-only: a key transitioning to expired / output-restricted / internal-error
* reports 4003 / 4007 / 4014, turning the HDCP and expiry silent-stall shapes diagnosable. Exclusion or renewal policy
* on those transitions stays downstream.
*
* Single-positive-state reactor, like `setupMediaKeys`. The session machinery lives in `media/dom/license-sessions.ts`
* — `openLicenseSession` drives one session for its lifetime, `listenForEncryptedInitData` is the fallback — bound to
* one `AbortController` per entry, so this behavior only decides which sessions to open and its state-exit cleanup is
* the abort. **Compose it ahead of `setupMediaKeys`**: `createComposition` calls cleanups in registration order, and
* the sessions opened here must be closed before `setupMediaKeys` detaches the MediaKeys they belong to. Setup order
* costs nothing in return — the precondition is reactive on `context.mediaKeys`, so this behavior parks until the
* negotiation it consumes has published.
*
* Writes no slots — it only reads the handoff and talks to the CDM and the license server. Rotation scope (tracked in
* drm-support.md): the manifest loop licenses every key declared at entry, so VOD key rotation (all keys present at
* load) is covered, and FairPlay rotation rides the `encrypted` fallback as segments append. The one gap is mid-stream
* rotation for Widevine / PlayReady on a live reload — the entry captures the presentation once, later reloads' keys
* are never re-scanned, and the `encrypted` fallback isn't armed for manifest-licensed content.
*/
function setupExchangeLicenses({ state, context, config }) {
	const derivedStateSignal = computed(() => {
		if (!context.mediaElement.get() || !context.mediaKeys.get()) return "preconditions-unmet";
		const keySystem = state.negotiatedKeySystem.get();
		if (keySystem === void 0 || keySystem === "none") return "preconditions-unmet";
		return isResolvedPresentation(state.presentation.get()) ? "licensing" : "preconditions-unmet";
	});
	const report = (error) => emitError(state, error);
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			licensing: { entry: () => {
				const mediaElement = context.mediaElement.get();
				const mediaKeys = context.mediaKeys.get();
				const keySystem = state.negotiatedKeySystem.get();
				const presentation = state.presentation.get();
				const controller = new AbortController();
				const entry = config.drm[keySystem];
				const module_ = config.keySystems.find((candidate) => candidate.keySystem === keySystem);
				const open = (initDataType, initData) => {
					const licenseUrl = resolveDrmUrl(entry.licenseUrl);
					if (licenseUrl === void 0) {
						report({
							code: SVTA_BAD_LICENSE_REQUEST,
							data: {
								keySystem,
								reason: "license server resolved to nothing after negotiation"
							}
						});
						return;
					}
					openLicenseSession({
						mediaKeys,
						keySystem,
						module: module_,
						entry,
						licenseUrl,
						initDataType,
						initData,
						signal: controller.signal,
						report
					});
				};
				const declared = manifestInitData(presentation, module_);
				for (const { initDataType, initData } of declared) open(initDataType, initData);
				if (declared.length === 0) listenForEncryptedInitData(mediaElement, open, controller.signal);
				return () => controller.abort();
			} }
		}
	});
}
const exchangeLicenses = defineBehavior({
	stateKeys: ["presentation", "negotiatedKeySystem"],
	contextKeys: ["mediaElement", "mediaKeys"],
	setup: ({ state, context, config }) => setupExchangeLicenses({
		state,
		context,
		config
	})
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/setup-media-keys.js
/**
* **Negotiate a key system and attach its MediaKeys for the current source.** Once an encrypted rendition has resolved
* against a media element, negotiate one composed key system over the configured license servers, apply its server
* certificate when it configures one, and attach the resulting MediaKeys — so licensing can begin. Encrypted segment
* loads are gated until the attach lands, and the outcome is published for pruning and licensing to react to: the
* chosen system, or {@link NO_KEY_SYSTEM} for a refusal.
*
* Licensing is `exchangeLicenses`' job, not this behavior's. The handoff is `context.mediaKeys` +
* `state.negotiatedKeySystem`, both published only once the certificate has been applied and the attach has resolved —
* which is what carries the "certificate before `generateRequest`" ordering across the boundary.
*
* The negotiation is the minimal key-system probe — capability-probing's full async probe supersedes it when that lands
* — over per-system init-data types and the declared encryption scheme. The `segmentLoadingBlocked` load gate is raised
* synchronously at setup and for each new source, and lowered once it's confirmed clear or MediaKeys attach: appending
* encrypted data with no MediaKeys attached misbehaves on Chromium, so the segment-load dispatchers park while the gate
* is up (see `load-segments.ts`), whatever order a composition lists them in — but lowered on _attach_, not on license:
* the appends that follow are what fire `encrypted` for the event-driven path, and browsers queue decode on missing
* keys. Failures report onto the errors sequence via `emitError` (SVTA 4008 no usable key system, 99408 the source is
* non-DRM clear-key encryption we can't decrypt, 4010 MediaKeys init, 4013 certificate); a refused negotiation or
* failed certificate leaves the gate up — playback stays parked rather than failing decode, and severity is the
* adapter's call. A refusal publishes {@link NO_KEY_SYSTEM}, which is what lets rendition pruning reach the verdict
* `track-switching` owns.
*
* Single-positive-state reactor riding the resolver's resolved/unresolved lifecycle, like `setupMediaSource`. The EME
* pipeline runs as one `Task` under a runner the reactor owns — the same shape as `setupTrackResolution` — so source
* replacement routes through `'preconditions-unmet'`, whose state-exit cleanup aborts the task structurally, clears the
* slots, and detaches MediaKeys (`setMediaKeys(null)`) before the next source's setup runs. Teardown-per-source is
* deliberate — MediaKeys re-use across sources is an optimization with prior art (see drm-support.md).
*
* A live AirPlay session routes through that same exit. Playback moves off MSE onto the native-HLS fallback `<source>`
* the receiver plays, and the MediaKeys negotiated here cannot serve the `skd` requests it raises — so an observed
* `loadingSuspended` yields the element, and `setupAirPlayFairPlay` negotiates for the receiver in the gap. The falling
* edge re-enters and re-negotiates with no extra machinery.
*
* Sole writer of `context.mediaKeys`, `state.negotiatedKeySystem`, and `state.segmentLoadingBlocked`. Composed into the
* HLS video engine's `createEngine` unconditionally today; on a clear source it never negotiates, just lowering the
* gate once it's clear. A composition that omits it — along with `exchangeLicenses` and the two DRM-aware config
* defaults — carries neither the machinery nor the slots, and none of this file's key-system code survives
* tree-shaking; the DRM-free engine variant that would do so is tracked in drm-support.md.
*
* Still out of scope (tracked in drm-support.md): mid-stream key rotation on live Widevine / PlayReady reloads (VOD
* rotation and FairPlay rotation are covered — see `exchangeLicenses`), and `keystatuschange` reactivity.
*/
/**
* The EME pipeline for one source, as a task body: negotiate → create MediaKeys → certificate → attach → publish.
*
* Runs under the task's `signal`. The certificate fetch takes it directly; the EME calls cannot, so each is followed by
* a check at the next commit point — an aborted run reports nothing, attaches nothing, and publishes nothing, and an
* attach that landed as the abort arrived is undone on the spot. A refusal or a certificate failure reports its cause
* and returns, leaving the gate up; anything else rejects for the caller to report as 4010.
*/
async function negotiateMediaKeys({ mediaElement, presentation, signal, state, config, publish }) {
	const keys = declaredDrmKeys(presentation);
	const candidates = keySystemCandidates(keys, config.drm, config.keySystems);
	const negotiated = await requestKeySystemAccess(candidates, mimeCodecsByType(presentation), declaredEncryptionScheme(keys));
	if (signal.aborted) return;
	if (!negotiated) {
		const nonDrmCause = candidates.length === 0 ? unsupportedEncryptionMethodCause(keys) : void 0;
		emitError(state, nonDrmCause ?? {
			code: 4008,
			data: { keySystems: candidates.map((module_) => module_.keySystem) }
		});
		state.negotiatedKeySystem.set(NO_KEY_SYSTEM);
		return;
	}
	const { keySystem } = negotiated.module;
	const entry = config.drm[keySystem];
	const mediaKeys = await negotiated.access.createMediaKeys();
	const certificateUrl = resolveDrmUrl(entry.serverCertificateUrl);
	if (certificateUrl !== void 0) try {
		await mediaKeys.setServerCertificate(await fetchServerCertificate(negotiated.module, entry, certificateUrl, signal));
	} catch (error) {
		if (signal.aborted) return;
		emitError(state, {
			code: SVTA_DRM_CERTIFICATE_ERROR,
			data: {
				keySystem,
				reason: String(error)
			}
		});
		return;
	}
	if (signal.aborted) return;
	await attachMediaKeys(mediaElement, mediaKeys);
	if (signal.aborted) {
		attachMediaKeys(mediaElement, null).catch(() => {});
		return;
	}
	publish({
		keySystem,
		mediaKeys
	});
}
function setupMediaKeysSetup({ state, context, config }) {
	const runner = new RecurringRunner(runOnce);
	const loadingSuspended = state.loadingSuspended;
	/**
	* Whether each selected track type has a resolved rendition, which is when that type's key declarations are known.
	* Any resolved rendition of the type counts, not only the selected one: a type's renditions are assumed to be all
	* clear or all encrypted, so the answer survives an ABR switch to a rendition that hasn't resolved yet.
	*/
	const selectedTypesResolved = (presentation) => {
		const composed = [{
			id: state.selectedVideoTrackId?.get(),
			type: "video"
		}, {
			id: state.selectedAudioTrackId?.get(),
			type: "audio"
		}].filter(({ id }) => id !== void 0);
		return composed.length > 0 && composed.every(({ type }) => getTracksByType(presentation, type).some(isResolvedTrack));
	};
	const derivedStateSignal = computed(() => {
		const presentation = state.presentation.get();
		if (!context.mediaElement.get() || !isResolvedPresentation(presentation)) return "preconditions-unmet";
		if (loadingSuspended?.get()) return "preconditions-unmet";
		if (declaredDrmKeys(presentation).length > 0) return "media-keys-required";
		if (selectedTypesResolved(presentation)) return "source-clear";
		return "preconditions-unmet";
	});
	const publishNegotiation = ({ keySystem, mediaKeys }) => {
		context.mediaKeys.set(mediaKeys);
		state.negotiatedKeySystem.set(keySystem);
		state.segmentLoadingBlocked.set(false);
	};
	const clearNegotiation = () => {
		context.mediaKeys.set(void 0);
		state.negotiatedKeySystem.set(void 0);
	};
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": { entry: () => {
				state.segmentLoadingBlocked.set(true);
			} },
			"source-clear": { entry: () => {
				state.segmentLoadingBlocked.set(false);
			} },
			"media-keys-required": { entry: () => {
				const mediaElement = context.mediaElement.get();
				const presentation = state.presentation.get();
				state.segmentLoadingBlocked.set(true);
				runner.schedule(new Task((signal) => negotiateMediaKeys({
					mediaElement,
					presentation,
					signal,
					state,
					config,
					publish: publishNegotiation
				}))).catch((error) => {
					emitError(state, {
						code: SVTA_DRM_INITIALIZATION_ERROR,
						data: { reason: String(error) }
					});
				});
				return () => {
					runner.abortAll();
					clearNegotiation();
					attachMediaKeys(mediaElement, null).catch(() => {});
				};
			} }
		}
	});
}
const setupMediaKeys = defineBehavior({
	stateKeys: [
		"presentation",
		"segmentLoadingBlocked",
		"negotiatedKeySystem"
	],
	contextKeys: ["mediaElement", "mediaKeys"],
	setup: ({ state, context, config }) => setupMediaKeysSetup({
		state,
		context,
		config
	})
});

//#endregion
//#region ../spf/dist/dev/features/drm.js
const noLicenseServers = {};
const defaultKeySystems = DEFAULT_KEY_SYSTEMS;
const drmAwareVideoConstraints = [...DEFAULT_VIDEO_CONSTRAINTS, excludeRefusedKeySystems];
const drmAwareAudioConstraints = [...DEFAULT_AUDIO_CONSTRAINTS, excludeRefusedKeySystems];
/** The behaviors the feature composes, in setup order. */
const behaviors$6 = [exchangeLicenses, setupMediaKeys];
/** The config defaults the feature contributes. */
const defaultConfig$6 = {
	drm: noLicenseServers,
	keySystems: defaultKeySystems,
	canPlayTrack: canPlayTrackWithDrm,
	videoConstraints: drmAwareVideoConstraints,
	audioConstraints: drmAwareAudioConstraints,
	reportUnsupportedTrackConditions: reportUnsupportedTrackConditionsWithDrm
};
/** The state values the feature seeds. */
const initialState$6 = {};
/**
* Plays DRM-protected content through Encrypted Media Extensions: negotiates a key system over the configured license
* servers, attaches its MediaKeys, and exchanges licenses. Segment loading waits until a source is confirmed clear or
* its MediaKeys attach.
*
* Requires writers of resolved, selected video or audio renditions, such as `videoFeature` and `audioFeature`; without
* them, no source is ever confirmed clear and loading stays blocked.
*
* Replaces `canPlayTrack` and `reportUnsupportedTrackConditions` with DRM-aware versions, and sets DRM-aware video and
* audio constraints. Compose it after the features that set the plain versions, such as `videoFeature` and
* `audioFeature`, or theirs win and encrypted renditions are refused.
*/
const drmFeature = defineFeature({
	behaviors: behaviors$6,
	defaultConfig: defaultConfig$6,
	initialState: initialState$6
});

//#endregion
//#region ../spf/dist/dev/core/tasks/delayed-reschedule.js
/**
* Build a {@link Reschedule} from a pure cadence function — the common timer-based, _start-anchored_ implementation.
*
* Invoked concurrently with the run, it observes the result, then waits `cadence(current, previous)` milliseconds
* **measured from when it was invoked** (≈ the run's start): it subtracts the run's own elapsed time, so consecutive
* runs begin one cadence apart regardless of how long each run takes (per RFC 8216 §6.3.4's "measured from the last
* time the client began loading"). If the run takes longer than the cadence, the next run starts immediately.
*
* A `null` cadence stops the recurrence. A rejected run rejects this reschedule, which the `RecurringRunner` propagates
* as the recurrence's failure — error recovery (e.g. retrying transient fetch failures) belongs below, at the fetch
* layer, not in the cadence.
*/
function delayedReschedule(cadence) {
	return async (task) => {
		const startedAt = Date.now();
		const ms = cadence(await task.run(), task.previous);
		if (ms === null) return false;
		await sleep(Math.max(0, ms - (Date.now() - startedAt)), task.signal);
		return true;
	};
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/seek-to-live-edge.js
/**
* Keep the playhead in the live window, via a two-state reactor gated on the preconditions for "we know where live is":
*
* - **`inactive`** — no media element, or no live edge (`getLiveEdge` is `null`: VOD, ended, or unresolved). Idle.
* - **`live`** — preconditions met. `entry` commands `state.startPosition` once to the target live latency behind the
*   edge (clamped to the window start) so playback begins near the edge and the loader dispatches an in-window range;
*   `effects` runs the window-exit guard.
*
* A derivable live edge is itself the establishment gate: segment placement is settled at parse time — the reference
* track's local placement _is_ the presentation timeline, and every other track's first parse is held until the anchor
* is stamped (`resolve-track`'s gate + `establishStartMediaTime`) — so any window derived from resolved segments is
* already final, with no separate anchor signal to wait on (see
* `internal/design/spf/live-presentation-timeline-model.md`).
*
* The two pieces split along the axis a future DVR / EVENT mode will care about: the **one-time start position**
* (`entry`) is the _live-specific_ behavior — start near the edge on load; a DVR mode makes it conditional (start in
* place). The **window-exit guard** (`effects`) is the _general windowed-live_ behavior — applies to sliding-window
* live, DVR, and EVENT alike. Because the command is an `entry`, it fires once per entry into `live`; a source change
* exits to `inactive`, so the next source re-commands (no closure latch to reset). The guard stays a direct seek — it
* is recurring, while `startPosition` is a self-clearing one-shot.
*
* Window-exit guard: while playing (not paused), reposition to the live edge when the playhead has fallen behind the
* window start — including when a seek to a now-evicted position has stranded the playhead (such a seek can never
* settle, so we rescue rather than wait on it). Two triggers: the **window-update re-fire** (the guard reads the live
* edge, so each reload / slide re-runs it — this catches a stall, where `timeupdate` stops but the playlist keeps
* reloading) and a **`play` listener** for immediate reactivity on resume, since the reload interval can be seconds.
* `play`, not `playing`: after a long pause the playhead sits behind the window at an unseekable position, where the
* browser stalls and `playing` never fires; `play` fires on the paused→false transition regardless, so we snap before
* the stall. In-window pause / DVR scrub-back are left untouched.
*
* The latency comes from the injected `resolveLiveLatency` seam (HLS: `HOLD-BACK`), so this behavior carries no
* delivery-format specifics. `applyStartPosition` performs the seek, gated on `loadedmetadata` — which implies an open
* MediaSource and hence a declared seekable range (a seek outside `seekable` is clamped) — so this behavior needs no
* MediaSource precondition of its own.
*/
/**
* Tolerance (seconds) around the window edges before the guard repositions, so boundary / floating-point noise doesn't
* trigger a spurious seek.
*/
const REPOSITION_TOLERANCE = .1;
/**
* `'live'` once the preconditions hold: a media element and a derivable live edge (whose placement is final by
* construction — see the module docstring). `'inactive'` otherwise.
*
* Deliberately narrow: every signal here can flip the reactor out of and back into `live`, re-firing `entry`. Neither
* blinks mid-source — the edge can't, because `liveWindowForType` falls back to any resolved track of the type — so
* `entry` fires once per source without a latch, and a live reload (same source, slid window) correctly doesn't
* re-command.
*
* The flip side: the presentation _url_ is not part of this state, so replacing one already-resolved live presentation
* with another would stay in `live` and never command a start position for the new source. Unreachable today — every
* writer sets `{ url }` (unresolved) or `undefined` first, so a source change always transits `inactive`. Supporting a
* seeded pre-resolved presentation (via `initialState`) that later changes would mean folding the url in here.
*/
function deriveState$1(mediaElement, edge) {
	return mediaElement && edge ? "live" : "inactive";
}
function seekToLiveEdgeSetup({ state, context, config }) {
	const derivedStateSignal = computed(() => deriveState$1(context.mediaElement.get(), getLiveEdge({
		state,
		config
	})));
	return createMachineReactor({
		initial: "inactive",
		monitor: () => derivedStateSignal.get(),
		states: {
			inactive: {},
			live: {
				entry: () => {
					const mediaElement = context.mediaElement.get();
					const { liveEdgeStart } = getLiveEdge({
						state,
						config
					});
					if (mediaElement.currentTime >= liveEdgeStart) return;
					state.startPosition.set(liveEdgeStart);
				},
				effects: () => {
					const { start: windowStart, liveEdgeStart } = getLiveEdge({
						state,
						config
					});
					const mediaElement = peek(context.mediaElement);
					const reposition = () => {
						if (mediaElement.paused) return;
						if (mediaElement.currentTime < windowStart - REPOSITION_TOLERANCE) mediaElement.currentTime = liveEdgeStart;
					};
					reposition();
					return listen(mediaElement, "play", reposition);
				}
			}
		}
	});
}
/**
* Manual `Behavior<>` literal (like `calculatePresentationDuration`): declares only `presentation` + `startPosition` in
* stateKeys while reading `selectedVideoTrackId` / `selectedAudioTrackId` defensively (contributed by the switch*
* behaviors), so it composes without a stateKeys/type conflict.
*/
const seekToLiveEdge = {
	stateKeys: ["presentation", "startPosition"],
	contextKeys: ["mediaElement"],
	setup: seekToLiveEdgeSetup
};

//#endregion
//#region ../spf/dist/dev/behaviors/dom/sync-live-seekable-range.js
function syncLiveSeekableRangeSetup({ state, context }) {
	return effect(() => {
		const mediaSource = context.mediaSource.get();
		const liveWindow = liveWindowFromState(state);
		if (!mediaSource || !liveWindow) return;
		const start = Math.max(0, liveWindow.start);
		if (start >= liveWindow.end) return;
		mediaSource.setLiveSeekableRange(start, liveWindow.end);
	});
}
/**
* Manual `Behavior<>` literal (like `seekToLiveEdge`): declares only `presentation` in stateKeys while reading
* `selectedVideoTrackId` / `selectedAudioTrackId` defensively (contributed by the switch* behaviors), so it composes
* without a stateKeys/type conflict.
*/
const syncLiveSeekableRange = {
	stateKeys: ["presentation"],
	contextKeys: ["mediaSource"],
	setup: syncLiveSeekableRangeSetup
};

//#endregion
//#region ../spf/dist/dev/features/live.js
/** The behaviors the feature composes, in setup order. */
const behaviors$5 = [
	syncLiveSeekableRange,
	seekToLiveEdge,
	establishStartMediaTime
];
/** The config defaults the feature contributes. */
const defaultConfig$5 = {
	resolveLiveLatency,
	reschedule: delayedReschedule(mediaPlaylistReloadDelay),
	gateFirstParse: gateFirstParseOnAnchor
};
/** The state values the feature seeds. */
const initialState$5 = {};
/**
* Plays live streams: reloads their playlists, keeps the seekable window current, starts at the live edge, and keeps
* the playhead inside the window. Aligns separately delivered tracks on the stream's program date-times when joining
* mid-stream. Inert for on-demand content.
*
* Requires:
*
* - A consumer of `state.startPosition`, such as `startPositionFeature`; without one, playback starts at the window's
*   start instead of the live edge.
* - A writer of `presentation.duration` and of the MediaSource's duration, such as `calculateDurationFeature` with
*   `mediaSourceFeature`; without them, the stream never gets its infinite duration and stalls.
*/
const liveFeature = defineFeature({
	behaviors: behaviors$5,
	defaultConfig: defaultConfig$5,
	initialState: initialState$5
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/track-player-resolution.js
/**
* Mirror the player element's rendered pixel dimensions into reactive state, so a rendition cap can narrow candidates
* to what the element can actually show without reading the DOM at pick time — which would make the picker impure, and
* would never re-pick when the element resized.
*
* The player-element half of the caps in `internal/design/spf/features/rendition-selection-caps.md`, and the tighter
* half: a small embed on a large display is capped by its own box rather than by the screen behind it
* (`trackScreenResolution`).
*
* Reported as a width and a height in device pixels — the same units, and for the same reason, as `media/dom/screen`'s
* reading: the cap compares against real track dimensions, and a `"720p"`-style tier only describes a track once you
* assume its aspect ratio.
*
* `undefined` where there is nothing to measure — no element attached, or one that isn't being rendered (detached,
* `display: none`, not yet laid out) — which is the value the cap reads as "don't cap".
*/
function trackPlayerResolutionSetup({ state, context, config = {} }) {
	const { capRenditionToPlayerSize = true, useDevicePixelRatio = true } = config;
	return effect(() => {
		const mediaElement = context.mediaElement.get();
		let current;
		state.playerResolution.set(current);
		if (!capRenditionToPlayerSize || !mediaElement) return;
		const write = (size) => {
			const next = scaleResolution(size, size.scale);
			if (shallowEqual(current, next)) return;
			current = next;
			state.playerResolution.set(next);
		};
		return useDevicePixelRatio ? observeRenderedSize(mediaElement, write) : observeElementSize(mediaElement, write);
	});
}
/**
* Track the player element's rendered resolution in `state.playerResolution`.
*
* @example
*   const cleanup = trackPlayerResolution.setup({ state, context });
*/
const trackPlayerResolution = defineBehavior({
	stateKeys: ["playerResolution"],
	contextKeys: ["mediaElement"],
	setup: trackPlayerResolutionSetup
});

//#endregion
//#region ../spf/dist/dev/features/monitor-player-size.js
/** The behaviors the feature composes, in setup order. */
const behaviors$4 = [trackPlayerResolution];
/** The config defaults the feature contributes. */
const defaultConfig$4 = {};
/** The state values the feature seeds. */
const initialState$4 = {};
/**
* Monitors the player's rendered size, which enables capping video quality to it: the video selection rules' player
* resolution cap reads the size and does nothing without it.
*/
const monitorPlayerSizeFeature = defineFeature({
	behaviors: behaviors$4,
	defaultConfig: defaultConfig$4,
	initialState: initialState$4
});

//#endregion
//#region ../spf/dist/dev/features/shift-text-timestamps.js
/** The behaviors the feature composes, in setup order. */
const behaviors$3 = [];
/** The config defaults the feature contributes. */
const defaultConfig$3 = { textMessagePipelines: relocatingTextPipelines };
/** The state values the feature seeds. */
const initialState$3 = {};
/**
* Shifts text cues onto the playlist's zero-based timeline along with the audio and video, rebasing each cue by the
* shift `shiftTimestampsFeature` establishes. Does nothing without a text feature, such as `textTracksFeature`.
*
* Requires a writer of each track's `startMediaTime` from its container timestamps, such as `shiftTimestampsFeature`;
* without one, cues wait for an origin nothing establishes and never appear.
*/
const shiftTextTimestampsFeature = defineFeature({
	behaviors: behaviors$3,
	defaultConfig: defaultConfig$3,
	initialState: initialState$3
});

//#endregion
//#region ../spf/dist/dev/media/dom/text/resolve-vtt-segment.js
/**
* Parse a VTT segment using browser's native parser.
*
* Creates a dummy video element with a track element to leverage the browser's optimized VTT parsing. Returns parsed
* VTTCue objects.
*/
let dummyVideo = null;
function ensureDummyVideo() {
	if (!dummyVideo) {
		dummyVideo = document.createElement("video");
		dummyVideo.muted = true;
		dummyVideo.preload = "none";
		dummyVideo.style.display = "none";
		dummyVideo.crossOrigin = "anonymous";
	}
	return dummyVideo;
}
function resolveVttSegment(url) {
	const video = ensureDummyVideo();
	const track = document.createElement("track");
	track.kind = "subtitles";
	return new Promise((resolve, reject) => {
		const onLoad = () => {
			const cues = [];
			const textTrack = track.track;
			if (textTrack.cues) for (let i = 0; i < textTrack.cues.length; i++) {
				const cue = textTrack.cues[i];
				if (cue) cues.push(cue);
			}
			cleanup();
			resolve(cues);
		};
		const onError = () => {
			cleanup();
			reject(/* @__PURE__ */ new Error(`Failed to load VTT segment: ${url}`));
		};
		const cleanup = () => {
			track.removeEventListener("load", onLoad);
			track.removeEventListener("error", onError);
			video.removeChild(track);
		};
		track.addEventListener("load", onLoad);
		track.addEventListener("error", onError);
		video.appendChild(track);
		track.track.mode = "hidden";
		track.src = url;
	});
}

//#endregion
//#region ../spf/dist/dev/core/actors/create-transition-actor.js
/**
* Creates a reducer-shaped actor from an initial context and a reducer function.
*
* The reducer receives the current context and a message and returns the next context. Returning the same reference (by
* identity) skips the signal update — so early-returning `context` unchanged is both the no-op and the optimization.
*
* Side effects (e.g. DOM mutations) may be performed inside the reducer. They run synchronously before the signal is
* updated.
*
* @example
*   const actor = createTransitionActor({ count: 0 }, (context, message: { type: 'increment' }) => ({
*     count: context.count + 1,
*   }));
*/
function createTransitionActor(initialContext, reducer) {
	const { snapshotSignal, getState, transition } = createMachineCore({
		value: "active",
		context: initialContext
	});
	const getContext = () => untrack(() => snapshotSignal.get().context);
	const setContext = (context) => update(snapshotSignal, { context });
	return {
		get snapshot() {
			return snapshotSignal;
		},
		send(message) {
			if (getState() === "destroyed") return;
			const context = getContext();
			const newContext = reducer(context, message);
			if (newContext !== context) setContext(newContext);
		},
		destroy() {
			if (getState() === "destroyed") return;
			transition("destroyed");
		}
	};
}

//#endregion
//#region ../spf/dist/dev/playback/actors/dom/text-tracks.js
function isDuplicateCue(cue, existing) {
	return existing.some((r) => r.startTime === cue.startTime && r.endTime === cue.endTime && r.text === cue.text);
}
/** TextTrack actor: wraps all text tracks on a media element, owns cue operations. */
function createTextTracksActor(mediaElement) {
	const pending = /* @__PURE__ */ new Set();
	const clearPending = () => {
		for (const cleanup of pending) cleanup();
	};
	const actor = createTransitionActor({
		loaded: {},
		segments: {}
	}, (context, message) => {
		if (message.type === "clear") {
			clearPending();
			return {
				loaded: {},
				segments: {}
			};
		}
		const { meta, cues } = message;
		const { trackId, id: segmentId, startTime, duration } = meta;
		const textTrack = Array.from(mediaElement.textTracks).find((t) => t.id === trackId);
		if (!textTrack) return context;
		const el = findTrackElement(mediaElement, textTrack);
		if (el && el.readyState < HTMLTrackElement.LOADED) {
			const settle = () => {
				cleanup();
				if (el.parentNode !== mediaElement) return;
				actor.send(message);
			};
			const unlistenLoad = listen(el, "load", settle);
			const unlistenError = listen(el, "error", settle);
			const cleanup = () => {
				unlistenLoad();
				unlistenError();
				pending.delete(cleanup);
			};
			pending.add(cleanup);
			return context;
		}
		const existingCues = context.loaded[trackId] ?? [];
		const existingSegments = context.segments[trackId] ?? [];
		const prunedCues = cues.filter((cue) => !isDuplicateCue(cue, existingCues));
		const segmentAlreadyLoaded = existingSegments.some((s) => s.id === segmentId);
		if (prunedCues.length === 0 && segmentAlreadyLoaded) return context;
		for (const cue of prunedCues) textTrack.addCue(cue);
		return {
			...context,
			loaded: {
				...context.loaded,
				[trackId]: [...existingCues, ...prunedCues]
			},
			segments: segmentAlreadyLoaded ? context.segments : {
				...context.segments,
				[trackId]: [...existingSegments, {
					id: segmentId,
					startTime,
					duration
				}]
			}
		};
	});
	return {
		...actor,
		destroy() {
			clearPending();
			actor.destroy();
		}
	};
}

//#endregion
//#region ../spf/dist/dev/playback/actors/text-track-segment-loader.js
/**
* Loads text-track segments for a track and delegates cue management to a TextTracksActor. Mirrors the v/a
* `SegmentLoaderActor` shape (FSM with `idle` / `loading` and `inFlight*` context for continue-vs-preempt), adapted to
* text:
*
* - No init segment, no flush ops (text cues don't need eviction — they're small and the playhead-relative window is
*   enforced by the runtime).
* - Single in-flight identity (`inFlightSegmentId`) — text has only the media-segment path, no init-segment path.
*
* Planning is done in the load handler on every incoming message: `getSegmentsToLoad` filters to the forward window,
* then the segments not already in `TextTracksActor`'s context are scheduled. When a new `load` arrives mid-run, the
* handler replans and either:
*
* - **Continues**: the in-flight segment is still in the new plan → `abortPending` only, schedule the rest of the plan
*   (minus the in-flight item, which covers its slot).
* - **Preempts**: in-flight segment is no longer wanted (track switch, large seek out of window) → `abortAll`, schedule
*   the new plan from scratch.
*
* The cue parser is injected so this factory is host-agnostic. A DOM host supplies a VTT parser backed by
* `<track>`/`TextTrack` APIs; a non-DOM host (worker, test fake, alternate runtime) supplies its own.
*/
function createTextTrackSegmentLoaderActor(textTracksActor, resolveSegment, config = {}, compositionDeps = {
	state: {},
	context: {},
	config: {}
}) {
	const forwardBufferConfig = {
		...DEFAULT_FORWARD_BUFFER_CONFIG,
		...config.forwardBuffer
	};
	const deps = {
		state: compositionDeps.state,
		context: compositionDeps.context,
		config: {
			...compositionDeps.config,
			textTracksActor,
			resolveSegment
		}
	};
	const pipeline = (config.messagePipelines ?? DEFAULT_TEXT_MESSAGE_PIPELINES)();
	/**
	* Translate a load message into an ordered TextLoadTask list based on committed actor state. In-flight awareness is
	* handled separately in the `loading` state's load handler.
	*
	* Metadata mode (no `range`) is a no-op for text — text tracks have no init-segment concept, so there's nothing to
	* load until a range arrives via `'full-range'` dispatch.
	*/
	const planTasks = (message) => {
		const { track, range } = message;
		if (!range) return [];
		const trackId = track.id;
		const bufferedSegments = peek(textTracksActor.snapshot).context.segments[trackId] ?? [];
		return getSegmentsToLoad(track.segments, bufferedSegments, range.start, forwardBufferConfig).map((segment) => ({
			segment,
			trackId
		}));
	};
	/**
	* Wraps a TextLoadTask into a Task that runs the op's step pipeline (resolve/relocate/dispatch, per the composition's
	* `messagePipelines`). Updates `inFlightSegmentId` around the async region so the load handler can make accurate
	* continue/preempt decisions, and checks the abort signal before each step.
	*
	* Text degrades gracefully: a step throwing (e.g. a failed segment fetch) is logged and swallowed so the runner
	* continues to the next segment — unlike the v/a loader, where a failed init must abort the remaining tasks.
	*/
	const makeLoadTask = (op, { getContext, setContext }) => {
		return new Task(async (signal) => {
			if (signal.aborted) return;
			const frame = { op };
			setContext({
				...getContext(),
				inFlightTrackId: op.trackId,
				inFlightSegmentId: op.segment.id
			});
			try {
				for (const step of pipeline) {
					if (signal.aborted) return;
					await step(frame, signal, deps);
				}
			} catch (error) {
				console.error("Failed to load text-track segment:", error);
			} finally {
				setContext({
					...getContext(),
					inFlightTrackId: null,
					inFlightSegmentId: null
				});
			}
		});
	};
	const scheduleAll = (tasks, ctx) => {
		for (const op of tasks) ctx.runner.schedule(makeLoadTask(op, ctx)).then(void 0, (e) => {
			if (e instanceof Error && e.name === "AbortError") return;
			console.error("Unexpected error in text-track segment loader:", e);
			ctx.runner.abortPending();
		});
	};
	return createMachineActor({
		runner: () => new SerialRunner(),
		initial: "idle",
		context: {
			inFlightTrackId: null,
			inFlightSegmentId: null
		},
		states: {
			idle: { on: { load: (msg, ctx) => {
				const tasks = planTasks(msg);
				if (tasks.length === 0) return;
				ctx.transition("loading");
				scheduleAll(tasks, ctx);
			} } },
			loading: {
				onSettled: "idle",
				on: { load: (msg, ctx) => {
					const { context, runner } = ctx;
					const tasks = planTasks(msg);
					if (context.inFlightTrackId !== null && context.inFlightSegmentId !== null && tasks.some((t) => t.trackId === context.inFlightTrackId && t.segment.id === context.inFlightSegmentId)) {
						runner.abortPending();
						scheduleAll(tasks.filter((t) => !(t.trackId === context.inFlightTrackId && t.segment.id === context.inFlightSegmentId)), ctx);
					} else {
						runner.abortAll();
						scheduleAll(tasks, ctx);
					}
				} }
			}
		}
	});
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/setup-text-track-actors.js
function setupTextTrackActorsSetup({ state, context, config }) {
	return effect(() => {
		const mediaElement = context.mediaElement.get();
		if (!mediaElement) return;
		const textTracksActor = createTextTracksActor(mediaElement);
		const textTrackSegmentLoaderActor = createTextTrackSegmentLoaderActor(textTracksActor, config.resolveTextTrackSegment, {
			forwardBuffer: config.forwardBuffer,
			messagePipelines: config[TEXT_TYPE_CONFIG.messagePipelinesKey]
		}, {
			state,
			context,
			config
		});
		context.textTracksActor.set(textTracksActor);
		context.textTrackSegmentLoaderActor.set(textTrackSegmentLoaderActor);
		return () => {
			textTracksActor.destroy();
			textTrackSegmentLoaderActor.destroy();
			context.textTracksActor.set(void 0);
			context.textTrackSegmentLoaderActor.set(void 0);
		};
	});
}
const setupTextTrackActors = {
	stateKeys: [],
	contextKeys: [
		"mediaElement",
		"textTracksActor",
		"textTrackSegmentLoaderActor"
	],
	setup: setupTextTrackActorsSetup
};

//#endregion
//#region ../spf/dist/dev/media/dom/text/text-track-slots.js
/**
* SPF-owned `<track>` selector. Each slot created by `addSubtitlesTracksToMedia` carries this attribute so reads and
* removals can filter SPF-owned tracks from host-page-owned ones.
*/
const SPF_TRACK_SELECTOR = "track[data-src-track]";
/**
* Allocate text-track slots on `mediaElement` for each model track by creating and appending `<track>` children. Marks
* each element with `data-src-track` so it can be distinguished from `<track>` children the host page added directly —
* used by `getShowingSubtitlesTrackFromMedia` and `removeAllSubtitlesTracksFromMedia` to scope their reads/removals to
* SPF-owned slots. The spec has no `removeTextTrack` API, so creating `<track>` elements is the only mechanism for
* adding _and_ removing entries to `mediaElement.textTracks`.
*/
function addSubtitlesTracksToMedia(mediaElement, modelTextTracks) {
	for (const modelTrack of modelTextTracks) {
		const el = document.createElement("track");
		el.id = modelTrack.id;
		el.kind = modelTrack.kind;
		el.label = modelTrack.label;
		el.toggleAttribute("data-src-track", true);
		if (modelTrack.language) el.srclang = modelTrack.language;
		mediaElement.appendChild(el);
	}
}
/**
* Return the SPF-owned subtitle/caption `TextTrack` currently in `'showing'` mode, or `undefined` if none. Restricts
* the search to slots created by `addSubtitlesTracksToMedia` (via the `data-src-track` selector) so a showing track
* that the host page added directly is ignored — SPF selection only mirrors tracks it owns.
*/
function getShowingSubtitlesTrackFromMedia(mediaElement) {
	const elements = mediaElement.querySelectorAll(SPF_TRACK_SELECTOR);
	for (const el of elements) {
		const track = el.track;
		if (track.mode === "showing" && isCaptionOrSubtitleTrack(track)) return track;
	}
}
/**
* Remove every SPF-owned `<track>` child from `mediaElement` (those tagged with `data-src-track` by
* `addSubtitlesTracksToMedia`). `<track>` elements the host page added directly are left in place.
*/
function removeAllSubtitlesTracksFromMedia(mediaElement) {
	const elements = mediaElement.querySelectorAll(SPF_TRACK_SELECTOR);
	for (const el of elements) el.remove();
}
/**
* Apply a selection to a `TextTrackList` by setting each subtitle/caption track's `mode` to `'showing'` if its `id`
* matches `selectedId` and `'disabled'` otherwise. Tracks of other kinds (chapters, metadata, descriptions) are left
* untouched — they may be owned by the host page.
*/
function syncTextTrackModes(textTracks, selectedId) {
	for (let i = 0; i < textTracks.length; i++) {
		const track = textTracks[i];
		if (!isCaptionOrSubtitleTrack(track)) continue;
		track.mode = track.id === selectedId ? "showing" : "disabled";
	}
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/sync-text-tracks.js
/**
* **Own the text-track slots on the host media element, mirroring the SPF model.** When a presentation is resolved and
* a media element is available, allocate one slot in `mediaElement.textTracks` per model text track — via creating
* `<track>` children, since that's the only spec mechanism for adding _and_ removing entries to `textTracks` (no
* `removeTextTrack` API exists). Once slots are provisioned, mirror the resolved `selectedTextTrackId` into their
* `mode`s (one-way: state → DOM), and propagate user-initiated DOM `change` events back to `userTextTrackSelection` —
* the standing _intent_ (a language-based partial, or `'off'`) that `switchTextTrack` resolves into
* `selectedTextTrackId`. So non-SPF consumers (host-page captions buttons, browser native UI, video.js store) drive
* selection by expressing intent, not by writing the resolved id.
*
* Single-positive-state reactor (`'preconditions-unmet'` ↔ `'sync-active'`): an element-bound effect allocates the
* slots, applies the initial selection, attaches the `change` listener, and opens a brief Chromium settling-window
* guard, with paired cleanup on element replacement or state exit. A separate effect mirrors subsequent
* `selectedTextTrackId` changes into `mode`s without reallocating the slots.
*
* State-exit cleanup also sends a `'clear'` message to the `TextTracksActor` so its cue+segment cache (keyed by
* trackId) is dropped alongside the DOM `<track>` slots. The actor itself is owned by `setupTextTrackActors` and bound
* to mediaElement, not presentation, so it survives source resets; clearing its context here keeps the cache consistent
* with the DOM. Without this, a subsequent presentation reusing a trackId would have `getSegmentsToLoad` treat its
* segments as already-buffered and skip loading them.
*
* Single-writer separation: `selectedTextTrackId` is the resolved _output_ owned solely by `switchTextTrack`; this
* behavior only reads it (to mirror modes). The write path here is `userTextTrackSelection` — the user-intent _input_ —
* so DOM action and the resolver never contend for one slot. The intent isn't cleared on source unload (it's a standing
* preference, like `userAudioTrackSelection`); `'off'` is written when the user disables all tracks via native UI.
*
* Echo guard: `selectedTextTrackId` is exactly the id this behavior last drove into the DOM, so a `change` event still
* showing it is our own echo (or a resolver-driven correction — e.g. the picked track's CDN failed and the resolver
* disabled it) and is ignored, never written back as a spurious user action. Only a showing id that _differs_ from the
* resolved id is a real user pick. The settling-window guard additionally swallows Chromium's init-time auto-selection
* before the resolved selection has settled.
*/
function deriveState(presentation, mediaElement) {
	if (!mediaElement || !presentation) return "preconditions-unmet";
	return getTracksByType(presentation, "text").length > 0 ? "sync-active" : "preconditions-unmet";
}
/**
* Map the DOM-showing track back to standing user intent. No showing track is an explicit `'off'`. Otherwise prefer a
* language-based partial (so the pick persists across source changes); fall back to `{ id }` for a track without a
* language (precise within a source, just not portable).
*/
function deriveTextTrackIntent(showingId, modelTextTracks) {
	if (!showingId) return "off";
	const language = modelTextTracks.find((track) => track.id === showingId)?.language;
	return language ? { language } : { id: showingId };
}
function syncTextTracksSetup({ state, context, config }) {
	const { addSubtitlesTracksToMedia, getShowingSubtitlesTrackFromMedia, removeAllSubtitlesTracksFromMedia } = config;
	const derivedStateSignal = computed(() => deriveState(state.presentation.get(), context.mediaElement.get()));
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			"sync-active": { effects: [() => {
				const mediaElement = context.mediaElement.get();
				const presentation = peek(state.presentation);
				if (!mediaElement || !presentation) return;
				const modelTextTracks = getTracksByType(presentation, "text");
				addSubtitlesTracksToMedia(mediaElement, modelTextTracks);
				syncTextTrackModes(mediaElement.textTracks, peek(state.selectedTextTrackId));
				let inSettlingWindow = true;
				const settlingTimeout = setTimeout(() => {
					inSettlingWindow = false;
				}, 0);
				const onChange = () => {
					if (inSettlingWindow) {
						syncTextTrackModes(mediaElement.textTracks, state.selectedTextTrackId.get());
						return;
					}
					const showingId = getShowingSubtitlesTrackFromMedia(mediaElement)?.id || void 0;
					if (showingId === state.selectedTextTrackId.get()) return;
					state.userTextTrackSelection.set(deriveTextTrackIntent(showingId, modelTextTracks));
				};
				const unlisten = listen(mediaElement.textTracks, "change", onChange);
				return () => {
					unlisten();
					clearTimeout(settlingTimeout);
					removeAllSubtitlesTracksFromMedia(mediaElement);
					peek(context.textTracksActor)?.send({ type: "clear" });
				};
			}, () => {
				const mediaElement = peek(context.mediaElement);
				syncTextTrackModes(mediaElement.textTracks, state.selectedTextTrackId.get());
			}] }
		}
	});
}
const syncTextTracks = defineBehavior({
	stateKeys: [
		"presentation",
		"selectedTextTrackId",
		"userTextTrackSelection"
	],
	contextKeys: ["mediaElement", "textTracksActor"],
	setup: syncTextTracksSetup
});

//#endregion
//#region ../spf/dist/dev/features/text-tracks.js
/** The behaviors the feature composes, in setup order. */
const behaviors$2 = [
	resolveTextTrack,
	switchTextTrack,
	syncTextTracks,
	setupTextTrackActors,
	loadTextTrackSegments,
	defineExternalSignals()({ state: ["userTextTrackSelection"] })
];
/** The config defaults the feature contributes. */
const defaultConfig$2 = {
	resolveTextTrackSegment: resolveVttSegment,
	addSubtitlesTracksToMedia,
	getShowingSubtitlesTrackFromMedia,
	removeAllSubtitlesTracksFromMedia
};
/** The state values the feature seeds. */
const initialState$2 = {};
/**
* Adds the source's subtitle and caption renditions to the media element as text tracks and loads the WebVTT cues of
* the showing one. Honors the user's `userTextTrackSelection`, including `'off'`.
*
* Requires, from other features:
*
* - A writer of `state.currentTime`, such as `currentTimeFeature`; without one, cue loading stops after the first window.
* - A writer of `state.loadActivated`, such as `initialLoadFeature`, or a seeded `loadActivated: true`.
*
* Content whose timestamps don't start at zero also needs `shiftTextTimestampsFeature`, or its cues are misaligned.
*/
const textTracksFeature = defineFeature({
	behaviors: behaviors$2,
	defaultConfig: defaultConfig$2,
	initialState: initialState$2
});

//#endregion
//#region ../spf/dist/dev/features/video.js
/** The behaviors the feature composes, in setup order. */
const behaviors$1 = [
	resolveVideoTrack,
	switchVideoTrack,
	setupVideoBufferActors,
	loadVideoSegments,
	defineExternalSignals()({ state: ["userVideoTrackSelection"] })
];
/** The config defaults the feature contributes. */
const defaultConfig$1 = {
	canPlayTrack,
	reportUnsupportedTrackConditions
};
/** The state values the feature seeds. */
const initialState$1 = { bandwidthState: {
	fastEstimate: 0,
	fastTotalWeight: 0,
	slowEstimate: 0,
	slowTotalWeight: 0,
	bytesSampled: 0
} };
/**
* Plays video with adaptive bitrate: resolves the selected rendition's playlist, switches renditions as bandwidth
* changes, and buffers and loads its segments. Honors the user's `userVideoTrackSelection`.
*
* Requires, from this or other features:
*
* - A writer of `context.mediaSource`, such as `mediaSourceFeature`; nothing loads without one.
* - A writer of `state.currentTime`, such as `currentTimeFeature`; without one, loading stops after the first window.
* - A writer of `state.loadActivated`, such as `initialLoadFeature`, or a seeded `loadActivated: true`; without one, only
*   init segments load.
*/
const videoFeature = defineFeature({
	behaviors: behaviors$1,
	defaultConfig: defaultConfig$1,
	initialState: initialState$1
});

//#endregion
//#region ../spf/dist/dev/engines/hls-video.js
/**
* The features the HLS playback engine composes, in order. A feature's behaviors compose in its position, and a later
* feature's `defaultConfig` and `initialState` values replace an earlier one's.
*/
const features = [
	initialLoadFeature,
	hlsLoadingFeature,
	multiCdnFeature,
	errorFeature,
	calculateDurationFeature,
	mediaSourceFeature,
	videoFeature,
	audioFeature,
	textTracksFeature,
	airPlayFairPlayFeature,
	drmFeature,
	shiftTimestampsFeature,
	shiftTextTimestampsFeature,
	airPlayFeature,
	currentTimeFeature,
	startPositionFeature,
	monitorPlayerSizeFeature,
	liveFeature,
	endStallRecoveryFeature,
	chaptersFeature
];
const composed = flattenFeatures(features);
/**
* The behaviors the HLS playback engine composes, in setup order: its features' behaviors, each composed once. The
* engine's state and context types are derived from this list, so adding or removing a feature changes them with no
* separate type to update.
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
* Create an HLS playback engine.
*
* Composes SPF behaviors into a reactive pipeline for HLS playback over MSE: manifest resolution, track selection, ABR,
* segment loading, and end-of-stream coordination.
*
* @example
*   ```ts
*   const engine = createEngine({
*     initialBandwidth: 2_000_000,
*   });
*
*   engine.context.mediaElement.set(videoEl);
*   engine.state.presentation.set({ url: 'https://example.com/stream.m3u8' });
*
*   videoEl.play();
*
*   await engine.destroy();
*   ```;
*/
const createEngine = defineCompositionFactory(behaviors, {
	defaultConfig,
	initialState
});

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-video/mixin.js
/**
* `targetLiveWindow` per the media-ui-extensions live-edge proposal: `NaN` for on-demand (or nothing resolved yet), `0`
* for standard sliding-window live, `Infinity` for DVR (`#EXT-X-PLAYLIST-TYPE:EVENT` — the window grows from the
* start). Read from the timeline-bearing track's playlist metadata.
*/
function deriveTargetLiveWindow(presentation, trackId) {
	if (!isResolvedPresentation(presentation) || !trackId) return NaN;
	const track = findTrackById(presentation, trackId);
	if (!track || !isResolvedTrack(track)) return NaN;
	const metadata = getMediaPlaylistMetadata(track);
	if (!metadata) return NaN;
	if (metadata.playlistType === "EVENT") return Number.POSITIVE_INFINITY;
	return deriveStreamType(metadata) === "live" ? 0 : NaN;
}
/**
* Which reported conditions this composition treats as **fatal** — the ones that reach `error` and fire `'error'`.
* Severity isn't part of an SVTA code (§Approach: "impact varies with player implementation"), and here it also varies
* by composition, so it's decided at this boundary rather than by the reporter.
*
* An allow-list, deliberately: only _verdicts_ are here. The per-rendition causes `resolve-track` reports (unsupported
* format, unsupported DRM) stay in the sequence as context — one unplayable rendition doesn't fail the source, and
* promoting a cause would put a dialog over a mixed source that goes on to play.
*/
const FATAL_SVTA_CODES = /* @__PURE__ */ new Set([SVTA_NO_SUPPORTED_VIDEO_TRACK, SVTA_NO_SUPPORTED_AUDIO_TRACK]);
/**
* Mixin that adds SPF playback engine behavior to any base class.
*
* Implements the src/play() contract per the WHATWG HTML spec so that SPF can be used anywhere a media element API is
* expected.
*
* A single engine instance is created at construction and recycled across src changes.
*
* @example
*   class HlsVideoAdapter extends HlsVideoMixin(HTMLVideoAdapter) {}
*
*   const media = new HlsVideoAdapter();
*   media.attach(document.querySelector('video'));
*   media.src = 'https://stream.mux.com/abc123.m3u8';
*
* @fires streamtypechange - Fired when the detected stream type changes. Read `streamType` for the new value.
* @fires targetlivewindowchange - Fired when the target live window changes. Read `targetLiveWindow` for the new value.
* @fires error - Fired when a fatal condition is reported. Read `error` for it.
*/
function HlsVideoMixin(BaseClass) {
	class HlsVideoImpl extends BaseClass {
		static defaultProps = {
			src: "",
			source: null,
			preload: "",
			crossOrigin: null,
			disableRemotePlayback: false,
			streamType: MediaStreamTypes.UNKNOWN
		};
		/**
		* A complete sentence naming the Media to reach for when this one can't play a source — `Try the hls.js-backed Mux
		* media instead: import the hls-js flavor in place of the spf one.` Appended to the copy this adapter surfaces, and
		* to the notices it logs. Name the flavor, not an import path: a Media is reached through several packages, each
		* with its own counterpart.
		*
		* Empty here: `hls-video` has no better-equipped sibling to point at. A Media that does (a Mux Video built on this
		* engine, whose hls.js-backed counterpart plays MPEG-TS and DRM) overrides this static, and its copy gains the
		* second sentence with no other change.
		*/
		static get alternativeMediaSuggestion() {}
		#engine;
		#config;
		#preload = HlsVideoImpl.defaultProps.preload;
		#crossOrigin = toMediaCrossOrigin(HlsVideoImpl.defaultProps.crossOrigin);
		#disableRemotePlayback = HlsVideoImpl.defaultProps.disableRemotePlayback;
		#streamType = HlsVideoImpl.defaultProps.streamType;
		#isUserStreamType = false;
		#targetLiveWindow = NaN;
		#error = null;
		/**
		* The _reported_ condition currently surfaced, which is what the re-fire latch keys on. Not `#error.code`: that's
		* the code this adapter chose to surface, and a later cause can change the choice for a condition already
		* announced.
		*/
		#reportedCode = null;
		/** Notices already logged for the current source; cleared when it unloads. */
		#noticed = /* @__PURE__ */ new Set();
		#stopLiveSync;
		#stopErrorSync;
		/** Aborting a generation cancels all retries, including ones not yet registered. */
		#playGeneration = new AbortController();
		#source = HlsVideoImpl.defaultProps.source;
		constructor(...args) {
			super(...args);
			const { config } = args[0] ?? {};
			const keySystems = config?.keySystems ?? DEFAULT_KEY_SYSTEMS;
			const drm = sourceDrmSystems(() => this.#source?.drm, keySystems);
			this.#config = {
				...config,
				drm: {
					...drm,
					...config?.drm
				}
			};
			this.#engine = this.#createEngine();
			this.#stopLiveSync = effect(() => {
				const presentation = this.#engine.state.presentation.get();
				this.#setDetectedStreamType(presentation?.streamType ?? MediaStreamTypes.UNKNOWN);
				this.#setTargetLiveWindow(deriveTargetLiveWindow(presentation, liveTrackId(this.#engine.state)));
				this.#reportDeliveryNotices(presentation);
			});
			this.#stopErrorSync = effect(() => {
				const errors = this.#engine.state.errors.get();
				this.#setError(firstFatal(errors, FATAL_SVTA_CODES), errors);
			});
		}
		/**
		* Underlying playback engine — the low-level SPF reactive composition that drives playback. An advanced escape
		* hatch for direct engine access; normal playback is driven through this element's own properties and methods.
		*/
		get engine() {
			return this.#engine;
		}
		/**
		* The current fatal error, or `null`. Only _fatal_ conditions appear here — the engine reports non-fatal ones too
		* (they stay in `engine.state.errors`), and promoting them would tell a consumer playback had failed when it
		* hadn't. Resets per source. Fires `'error'` when set.
		*/
		get error() {
			return this.#error;
		}
		/**
		* The source's stream type — `'live'`, `'on-demand'`, or `'unknown'` until a media playlist has been parsed.
		* Setting a non-`'unknown'` value pins a user override (detection stops updating it); setting `'unknown'` reverts
		* to the engine's detected value.
		*/
		get streamType() {
			return this.#streamType;
		}
		set streamType(value) {
			if (value === MediaStreamTypes.UNKNOWN) {
				this.#isUserStreamType = false;
				this.#updateStreamType(this.#engine.state.presentation.get()?.streamType ?? MediaStreamTypes.UNKNOWN);
				return;
			}
			this.#isUserStreamType = true;
			this.#updateStreamType(value);
		}
		/**
		* Presentation time marking the start of the live-edge window — playback at `currentTime >= liveEdgeStart` counts
		* as "at the live edge" (the same target the engine's `seekToLiveEdge` seeks to: window end − HOLD-BACK). `NaN`
		* when the stream isn't live or nothing is resolved yet. Derived at read time from the engine's live window — no
		* change event; re-read on `timeupdate`/`progress` (as the store's live feature does).
		*/
		get liveEdgeStart() {
			return getLiveEdge({
				state: this.#engine.state,
				config: { resolveLiveLatency }
			})?.liveEdgeStart ?? NaN;
		}
		/**
		* The target live window: `NaN` for on-demand (or unknown), `0` for standard sliding-window live, `Infinity` for
		* DVR (`#EXT-X-PLAYLIST-TYPE:EVENT`). Fires `targetlivewindowchange` on change.
		*/
		get targetLiveWindow() {
			return this.#targetLiveWindow;
		}
		#setDetectedStreamType(value) {
			if (this.#isUserStreamType) return;
			this.#updateStreamType(value);
		}
		#updateStreamType(value) {
			if (this.#streamType === value) return;
			this.#streamType = value;
			this.dispatchEvent?.(new Event("streamtypechange"));
		}
		#setTargetLiveWindow(value) {
			if (Object.is(this.#targetLiveWindow, value)) return;
			this.#targetLiveWindow = value;
			this.dispatchEvent?.(new Event("targetlivewindowchange"));
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
			this.#stopLiveSync();
			this.#stopErrorSync();
			this.#engine.destroy();
		}
		/** Preload type (`'none'` / `'metadata'` / `'auto'`). */
		get preload() {
			return this.#preload;
		}
		set preload(value) {
			this.#preload = value;
			if (value) this.#engine.state.preload.set(value);
		}
		get crossOrigin() {
			return this.#crossOrigin;
		}
		set crossOrigin(value) {
			this.#crossOrigin = toMediaCrossOrigin(value);
			const mediaElement = this.#engine.context.mediaElement.get();
			if (mediaElement) mediaElement.crossOrigin = value;
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
		* Structured source: the manifest URL plus what a URL cannot carry, which today is the license servers for
		* protected content. Setting it derives `src`. Assigning the same object back costs nothing — changing anything
		* takes a new one.
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
		/**
		* Point the engine at a URL. Assigning the one already playing is not a request to reload it: the presentation is
		* set from a fresh object every time, so re-resolving an unchanged URL would restart playback — which is what
		* changing only the licensing half of a source would otherwise cause.
		*/
		#applySrc(value) {
			if (value === this.src) return;
			this.#cancelPendingPlay();
			this.#engine.state.presentation.set(value ? { url: value } : void 0);
		}
		play() {
			const mediaElement = this.#engine.context.mediaElement.get();
			if (!mediaElement) return Promise.reject(/* @__PURE__ */ new Error("HlsVideoAdapterCore: no media element attached"));
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
		/**
		* Log what this engine is delivering differently from what the playlist asked for. Neither condition stops
		* playback, so neither is an error — they go to the console rather than the error surface.
		*
		* Once per source, not per parse: a live playlist reloads every target duration, and the timeline track re-parses
		* on each one. Keyed on the notice rather than latched with a boolean so the two are independent, and cleared when
		* the presentation unresolves so the next source starts quiet.
		*/
		#reportDeliveryNotices(presentation) {
			if (!isResolvedPresentation(presentation)) {
				this.#noticed.clear();
				return;
			}
			const trackId = liveTrackId(this.#engine.state);
			const track = trackId ? findTrackById(presentation, trackId) : void 0;
			if (!track || !isResolvedTrack(track)) return;
			const metadata = getMediaPlaylistMetadata(track);
			if (!metadata) return;
			if (metadata.lowLatency && !this.#noticed.has("lowLatency")) {
				this.#noticed.add("lowLatency");
				console.warn(this.#withSuggestion(LOW_LATENCY_UNSUPPORTED_MESSAGE));
			}
			if (metadata.playlistType === "EVENT" && !this.#noticed.has("dvr")) {
				this.#noticed.add("dvr");
				console.warn(this.#withSuggestion(DVR_EXPERIMENTAL_MESSAGE));
			}
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
	return HlsVideoImpl;
}
/** Standalone SPF media adapter with no base class. */
var HlsVideoAdapterCore = class extends HlsVideoMixin(class {}) {};

//#endregion
//#region ../spf/dist/dev/media/media-tracks/media-tracks.js
/**
* The distinct video tracks of a presentation, deduped by {@link VideoDedupeKey} (first occurrence wins).
*
* Returns `[]` when the presentation is unresolved or has no video tracks.
*/
function dedupedVideoTracks(presentation) {
	if (!presentation) return [];
	return dedupe({
		tracks: getTracksByType(presentation, "video"),
		keyFn: toUserVideoTrackSelection
	});
}
/**
* The distinct audio tracks of a presentation, deduped by `language` + `name` (first occurrence wins). Returns `[]`
* when the presentation is unresolved or has no audio tracks.
*/
function dedupedAudioTracks(presentation) {
	if (!presentation) return [];
	return dedupe({
		tracks: getTracksByType(presentation, "audio"),
		keyFn: toUserAudioTrackSelection
	});
}
/**
* Find a video track by id, searching the same candidate set the engine resolves against ({@link dedupedVideoTracks}'s
* pre-dedupe source). Returns `undefined` when absent. Maps the engine's resolved `selectedVideoTrackId` back to its
* properties for `active` reflection — the resolved id may be a per-CDN copy that isn't the representative
* {@link dedupedVideoTracks} kept.
*/
function findVideoTrackById(presentation, id) {
	if (!presentation || !id) return void 0;
	const track = findTrackById(presentation, id);
	return track?.type === "video" ? track : void 0;
}
/** Audio counterpart of {@link findVideoTrackById}, for `enabled` reflection. */
function findAudioTrackById(presentation, id) {
	if (!presentation || !id) return void 0;
	const track = findTrackById(presentation, id);
	return track?.type === "audio" ? track : void 0;
}
/**
* Shallow-equal two key objects by their own properties. Both come from the same key builder, so they carry the same
* keys — a one-directional scan suffices.
*/
function sameKey(a, b) {
	for (const attr in a) if (a[attr] !== b[attr]) return false;
	return true;
}
/**
* Dedupe tracks by a key function, keeping the first occurrence of each key. Keys are compared field-by-field ({@link
* sameKey}).
*/
function dedupe({ tracks, keyFn }) {
	const seen = [];
	const kept = [];
	for (const track of tracks) {
		const key = keyFn(track);
		if (!key || seen.some((other) => sameKey(other, key))) continue;
		seen.push(key);
		kept.push(track);
	}
	return kept;
}
/** Build a partial video track that can be used as `userVideoTrackSelection`. */
function toUserVideoTrackSelection(rendition) {
	return rendition ? {
		width: rendition.width,
		height: rendition.height,
		bandwidth: rendition.bandwidth
	} : void 0;
}
/** Build a partial audio track that can be used as a `userAudioTrackSelection`. */
function toUserAudioTrackSelection(track) {
	return track ? {
		language: track.language,
		name: track.name
	} : void 0;
}
/** Whether two video tracks are the same by dedupe key */
function isSameVideoTrack(a, b) {
	return !!b && a.width === b.width && a.height === b.height && a.bandwidth === b.bandwidth;
}
/** Whether two audio tracks are the same by dedupe key */
function isSameAudioTrack(a, b) {
	return !!b && (a.language ?? "") === (b.language ?? "") && a.name === b.name;
}
/** Collapse a rational frame rate (numerator/denominator) to frames per second. */
const frameRateToNumber = (frameRate) => {
	return frameRate.frameRateNumerator / (frameRate.frameRateDenominator ?? 1);
};

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-video/media-tracks.js
const toVideoKey = (rendition) => ({
	width: rendition.width,
	height: rendition.height,
	bandwidth: rendition.bitrate
});
const toAudioKey = (track) => ({
	language: track.language,
	name: track.label
});
/** Two track lists carry the same set when their id sequences match. */
const sameIds = (a, b) => a.length === b.length && a.every((item, i) => item.id === b[i].id);
/**
* Projects the SPF engine's presentation onto the media element's `videoRenditions` / `audioTracks` lists, and wires
* user selection back to the engine's `userVideoTrackSelection` / `userAudioTrackSelection` signals.
*
* Requires the media-tracks mixin (track-list infrastructure) earlier in the chain so the host exposes `addVideoTrack`,
* `videoRenditions`, and friends.
*/
function HlsVideoMediaTracksMixin(BaseClass) {
	class HlsVideoMediaTracks extends BaseClass {
		#abort = new AbortController();
		#destroyed = false;
		#renditions = [];
		#audioTracks = [];
		constructor(...args) {
			super(...args);
			const { state } = this.engine;
			const { signal } = this.#abort;
			const renditionsSignal = computed(() => dedupedVideoTracks(state.presentation.get()), { equals: sameIds });
			const audioTracksSignal = computed(() => dedupedAudioTracks(state.presentation.get()), { equals: sameIds });
			const reflectRenditions = () => {
				const renditions = renditionsSignal.get();
				this.#renditions = renditions;
				this.#removeVideoTracks();
				if (!renditions.length) return;
				const videoTrack = this.addVideoTrack("main");
				videoTrack.selected = true;
				const resolved = untrack(() => findVideoTrackById(state.presentation.get(), state.selectedVideoTrackId.get()));
				for (const rendition of renditions) {
					const domRendition = videoTrack.addRendition("", rendition.width, rendition.height, rendition.codecs.join(","), rendition.bandwidth, rendition.frameRate ? frameRateToNumber(rendition.frameRate) : void 0);
					domRendition.id = rendition.id;
					domRendition.active = isSameVideoTrack(toVideoKey(domRendition), resolved);
				}
			};
			const reflectSelectedVideo = () => {
				const resolved = findVideoTrackById(state.presentation.get(), state.selectedVideoTrackId.get());
				for (const rendition of this.videoRenditions) rendition.active = isSameVideoTrack(toVideoKey(rendition), resolved);
			};
			const reflectAudioTracks = () => {
				const tracks = audioTracksSignal.get();
				this.#audioTracks = tracks;
				this.#removeAudioTracks();
				if (!tracks.length) return;
				const resolved = untrack(() => findAudioTrackById(state.presentation.get(), state.selectedAudioTrackId.get()));
				for (const track of tracks) {
					const domTrack = this.addAudioTrack(track.default ? "main" : "alternative", track.name, track.language ?? "");
					domTrack.id = track.id;
					domTrack.enabled = isSameAudioTrack(toAudioKey(domTrack), resolved);
				}
			};
			const reflectSelectedAudio = () => {
				const resolved = findAudioTrackById(state.presentation.get(), state.selectedAudioTrackId.get());
				for (const track of this.audioTracks) track.enabled = isSameAudioTrack(toAudioKey(track), resolved);
			};
			const sourceUrl = computed(() => state.presentation.get()?.url);
			const resetSelectionOnSourceChange = () => {
				sourceUrl.get();
				state.userVideoTrackSelection.set(void 0);
				state.userAudioTrackSelection.set(void 0);
			};
			const effectCleanups = [
				effect(reflectRenditions),
				effect(reflectSelectedVideo),
				effect(reflectAudioTracks),
				effect(reflectSelectedAudio),
				effect(resetSelectionOnSourceChange)
			];
			this.videoRenditions.addEventListener("change", this.#selectRendition, { signal });
			this.audioTracks.addEventListener("change", this.#selectAudio, { signal });
			signal.addEventListener("abort", () => effectCleanups.forEach((cleanup) => cleanup()), { once: true });
		}
		destroy() {
			if (this.#destroyed) return;
			this.#destroyed = true;
			this.#abort.abort();
			this.#removeVideoTracks();
			this.#removeAudioTracks();
			super.destroy?.();
		}
		#selectRendition = () => {
			const { userVideoTrackSelection } = this.engine.state;
			const index = this.videoRenditions.selectedIndex;
			const domRendition = index < 0 ? void 0 : this.videoRenditions[index];
			const rendition = this.#renditions.find((candidate) => candidate.id === domRendition?.id);
			userVideoTrackSelection.set(toUserVideoTrackSelection(rendition));
		};
		#selectAudio = () => {
			const { presentation, selectedAudioTrackId, userAudioTrackSelection } = this.engine.state;
			const resolved = findAudioTrackById(presentation.get(), selectedAudioTrackId.get());
			const current = [...this.audioTracks].find((track) => isSameAudioTrack(toAudioKey(track), resolved));
			const enabled = [...this.audioTracks].filter((track) => track.enabled);
			const target = enabled.find((track) => track !== current) ?? enabled[0];
			if (!target) return;
			for (const track of enabled) if (track !== target) track.enabled = false;
			if (target === current) return;
			const audioTrack = this.#audioTracks.find((candidate) => candidate.id === target.id);
			userAudioTrackSelection.set(toUserAudioTrackSelection(audioTrack));
		};
		#removeVideoTracks() {
			for (const videoTrack of [...this.videoTracks]) this.removeVideoTrack(videoTrack);
		}
		#removeAudioTracks() {
			for (const audioTrack of [...this.audioTracks]) this.removeAudioTrack(audioTrack);
		}
	}
	return HlsVideoMediaTracks;
}

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-video/adapter.js
const HlsVideoAdapterBase = HlsVideoMediaTracksMixin(MediaTracksMixin(HlsVideoMixin(HTMLVideoAdapter)));
var HlsVideoAdapter = class extends HlsVideoAdapterBase {};

//#endregion
export { HlsVideoAdapter as t };
//# sourceMappingURL=adapter-RIXFeJHQ.js.map