import { t as isWebKitAirPlayCapable } from "./webkit-DXmoZ2Wz.js";
import { t as MediaError } from "./media-error-zO-Hg4un.js";
import { n as MediaStreamTypes } from "./types-D8a85nGw.js";
import { t as HTMLVideoAdapter } from "./html-video-adapter-ClZq4auT.js";
import { t as findSessionDataUri } from "./session-data-6y7aXrmJ.js";
import { n as APPLE_HLS_CHAPTERS_DATA_ID, t as loadChaptersTracks } from "./load-chapters-tracks-ca_JiVd8.js";

//#region ../media/dist/dev/core/drm.js
/**
* EME key system identifiers. The value is what a CDM is asked for, and what `source.drm` — and each engine's own DRM
* configuration — is keyed by.
*
* @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMediaKeySystemAccess
*/
const KeySystems = {
	FAIRPLAY: "com.apple.fps",
	WIDEVINE: "com.widevine.alpha",
	PLAYREADY: "com.microsoft.playready",
	CLEARKEY: "org.w3.clearkey"
};

//#endregion
//#region ../adapters/native-hls-video/dist/dev/fairplay.js
/** Key system identifier the legacy `WebKitMediaKeys` API answers to. */
const FAIRPLAY_LEGACY_KEY_SYSTEM = "com.apple.fps.1_0";
/** What FairPlay negotiates capabilities against — the manifest, not a codec. */
const FAIRPLAY_CONTENT_TYPE = "application/vnd.apple.mpegurl";
/**
* `context` values carried by the `MediaError`s key exchange produces. The message is prose meant for a person; this is
* the part to branch on.
*
* @internal
*/
const NativeHlsDrmErrors = {
	/** The content is encrypted but `source.engine.nativeHls.drmSystems` is missing something required. */
	MISSING_CONFIGURATION: "drmMissingConfiguration",
	/** No FairPlay CDM here, or it refused the requested configuration. */
	UNSUPPORTED_KEY_SYSTEM: "drmUnsupportedKeySystem",
	/** The application certificate could not be fetched. */
	CERTIFICATE_REQUEST_FAILED: "drmCertificateRequestFailed",
	/** The CDM rejected the application certificate. */
	SERVER_CERTIFICATE_FAILED: "drmServerCertificateFailed",
	/** The CDM could not produce a license request (SPC). */
	GENERATE_REQUEST_FAILED: "drmGenerateRequestFailed",
	/** The license server could not be reached, or answered with an error. */
	LICENSE_REQUEST_FAILED: "drmLicenseRequestFailed",
	/** The CDM rejected the license (CKC). */
	UPDATE_LICENSE_FAILED: "drmUpdateLicenseFailed",
	/** The CDM failed internally and cannot decrypt. */
	CDM_ERROR: "drmCdmError",
	/** Non-fatal: this output is not secure enough for full-quality rendering. */
	OUTPUT_RESTRICTED: "drmOutputRestricted"
};
const NativeHlsDrmMessages = {
	MISSING_CONFIGURATION: "This media is DRM-protected, but no DRM license server was configured for it.",
	MISSING_CERTIFICATE_URL: "This media is DRM-protected, but no DRM application certificate was configured for it.",
	UNSUPPORTED_KEY_SYSTEM: "This browser cannot play DRM-protected content with its current security configuration. Try another browser.",
	CERTIFICATE_REQUEST_FAILED: "The DRM application certificate could not be loaded.",
	SERVER_CERTIFICATE_FAILED: "The DRM application certificate was rejected. It may no longer be valid.",
	GENERATE_REQUEST_FAILED: "A DRM license could not be requested for this media.",
	LICENSE_REQUEST_FAILED: "The DRM license could not be loaded.",
	UPDATE_LICENSE_FAILED: "The DRM license was rejected for this media.",
	CDM_ERROR: "The DRM Content Decryption Module failed. Try reloading the page, updating your browser, or another browser.",
	OUTPUT_RESTRICTED: "This output is not secure enough for DRM playback. The video may render as a black screen."
};
/** Build an encrypted-media `MediaError` tagged with a {@link NativeHlsDrmErrors} context. */
function createDrmError(message, context, fatal = true) {
	return new MediaError(message, MediaError.MEDIA_ERR_ENCRYPTED, fatal, context);
}
/**
* Coerce anything thrown during key exchange into a reportable error. An error raised further down already describes
* what failed, so it passes through rather than being flattened into the caller's more general message.
*/
function toDrmError(cause, message, context) {
	if (cause instanceof MediaError) return cause;
	const error = createDrmError(message, context);
	error.data = cause;
	return error;
}
/**
* Fetch the FairPlay application certificate. Resolves `null` when the source names no certificate URL — EME can still
* negotiate with a pre-provisioned CDM, so whether that is fatal is the caller's call.
*/
async function requestAppCertificate({ config, signal }) {
	const { serverCertificateUrl } = config;
	if (!serverCertificateUrl) return null;
	const response = await fetch(serverCertificateUrl, { signal }).catch((cause) => {
		throw toDrmError(cause, NativeHlsDrmMessages.CERTIFICATE_REQUEST_FAILED, NativeHlsDrmErrors.CERTIFICATE_REQUEST_FAILED);
	});
	if (!response.ok) throw createDrmError(NativeHlsDrmMessages.CERTIFICATE_REQUEST_FAILED, NativeHlsDrmErrors.CERTIFICATE_REQUEST_FAILED);
	return response.arrayBuffer();
}
/**
* Exchange a server playback context (SPC) for a content key context (CKC). FairPlay license servers take the raw SPC
* bytes as the request body.
*/
async function requestLicenseKey({ config, signal }, spc) {
	const response = await fetch(config.licenseUrl, {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream" },
		body: spc,
		signal
	}).catch((cause) => {
		throw toDrmError(cause, NativeHlsDrmMessages.LICENSE_REQUEST_FAILED, NativeHlsDrmErrors.LICENSE_REQUEST_FAILED);
	});
	if (!response.ok) throw createDrmError(NativeHlsDrmMessages.LICENSE_REQUEST_FAILED, NativeHlsDrmErrors.LICENSE_REQUEST_FAILED);
	return new Uint8Array(await response.arrayBuffer());
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/m3u8-utils.js
/**
* Returns `true` when `src` looks like an HLS playlist URL. Permissive: a path or query string containing `.m3u8` is
* enough.
*/
function looksLikeM3u8(src) {
	return src.toLowerCase().includes(".m3u8");
}
/**
* Returns `true` when the playlist text is a multivariant (master) playlist.
*
* The presence of `#EXT-X-STREAM-INF` is conclusive — media playlists only contain `#EXTINF` segment tags.
*/
function isMultivariantPlaylist(playlist) {
	return playlist.includes("#EXT-X-STREAM-INF");
}
/**
* Resolves the first media playlist URL referenced by a multivariant playlist, relative to `baseUrl`. Returns `null`
* when none is found or the URL cannot be parsed.
*/
function resolveFirstMediaPlaylistUrl(multivariant, baseUrl) {
	const lines = multivariant.split(/\r?\n/);
	const start = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF"));
	if (start === -1) return null;
	const uri = lines.slice(start + 1).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
	if (!uri) return null;
	try {
		return new URL(uri, baseUrl).toString();
	} catch {
		return null;
	}
}
/**
* Matches one attribute of a tag's comma-separated `key=value` list. The name is anchored to a delimiter so `HOLD-BACK`
* cannot read the value of `PART-HOLD-BACK`, and the value must run to a delimiter so a malformed one (`1e1`) reads as
* absent rather than silently truncating to its leading digits.
*/
function attributePattern(name) {
	return new RegExp(String.raw`(?:^|[:,\s])${name}\s*=\s*([0-9.]+)\s*(?=[,]|$)`, "i");
}
const PART_TARGET = attributePattern("PART-TARGET");
const HOLD_BACK = attributePattern("HOLD-BACK");
const PART_HOLD_BACK = attributePattern("PART-HOLD-BACK");
/** Reads a numeric attribute out of one tag line, or `undefined` when it is absent or not a plain number. */
function readAttribute(line, pattern) {
	const match = pattern.exec(line);
	if (!match) return void 0;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : void 0;
}
/**
* Parses the subset of media-playlist tags needed to derive live edge state: `#EXT-X-PLAYLIST-TYPE`, `#EXT-X-ENDLIST`,
* `#EXT-X-TARGETDURATION`, `#EXT-X-PART-INF`, `#EXT-X-SERVER-CONTROL`.
*
* See spec: - VOD or `#EXT-X-ENDLIST` present → on-demand, `targetLiveWindow = NaN`. - `EVENT` playlist → DVR,
* `targetLiveWindow = Infinity`. - Otherwise → standard live sliding window, `targetLiveWindow = 0`.
*
* The edge offset is the hold-back the server declares, falling back to `PART-TARGET * 2` for low-latency live and
* `TARGETDURATION * 3` otherwise. A client is not meant to play closer to the end than the declared hold-back, so a
* declared value always wins over the multiple.
*/
function parseStreamInfo(playlist) {
	const lines = playlist.split(/\r?\n/);
	let playlistType;
	let hasEndList = false;
	let targetDuration;
	let partTarget;
	let holdBack;
	let partHoldBack;
	for (const raw of lines) {
		const line = raw.trim();
		if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) playlistType = line.slice(21).trim().toUpperCase();
		else if (line === "#EXT-X-ENDLIST") hasEndList = true;
		else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
			const value = Number(line.slice(22));
			if (Number.isFinite(value)) targetDuration = value;
		} else if (line.startsWith("#EXT-X-PART-INF")) partTarget = readAttribute(line, PART_TARGET) ?? partTarget;
		else if (line.startsWith("#EXT-X-SERVER-CONTROL")) {
			partHoldBack = readAttribute(line, PART_HOLD_BACK) ?? partHoldBack;
			holdBack = readAttribute(line, HOLD_BACK) ?? holdBack;
		}
	}
	if (playlistType === "VOD" || hasEndList) return {
		targetLiveWindow: NaN,
		liveEdgeStartOffset: void 0
	};
	return {
		targetLiveWindow: playlistType === "EVENT" ? Number.POSITIVE_INFINITY : 0,
		liveEdgeStartOffset: partTarget !== void 0 ? partHoldBack || partTarget * 2 : holdBack || (targetDuration !== void 0 ? targetDuration * 3 : void 0)
	};
}
/** Fetch a playlist's text, along with the URL it was served from after any redirects. */
async function fetchPlaylist(url, init) {
	const response = await fetch(url, init);
	if (!response.ok) throw new Error(`Failed to fetch playlist (${response.status}): ${url}`);
	return {
		text: await response.text(),
		url: response.url || url
	};
}
/**
* Fetches the HLS playlist at `src`, following the first variant if it's a multivariant playlist, and parses it into a
* {@link StreamInfo}.
*
* @throws When the fetch fails or no media playlist URL can be resolved.
*/
async function getStreamInfoFromSrc(src, signal) {
	const init = signal ? { signal } : {};
	const { text, url } = await fetchPlaylist(src, init);
	if (!isMultivariantPlaylist(text)) return parseStreamInfo(text);
	const mediaUrl = resolveFirstMediaPlaylistUrl(text, url);
	if (!mediaUrl) throw new Error("No media playlist URL found in multivariant playlist");
	return parseStreamInfo((await fetchPlaylist(mediaUrl, init)).text);
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/chapters.js
/**
* Chapters for native HLS playback. The browser never exposes the multivariant playlist's session data, so the playlist
* is fetched here — once per source, on `loadstart` — and the chapters document it references is loaded with SPF's
* `loadChaptersTracks`, as SPF and hls.js playback do. One request signal spans both fetches, so the tracks leave with
* the source (`emptied`) and with the element (`detach`, `destroy`).
*/
function NativeHlsChaptersMixin(BaseClass) {
	class NativeHlsChapters extends BaseClass {
		#disconnect = null;
		#request = null;
		#currentSrc = "";
		attach(target) {
			super.attach(target);
			this.#init(target);
		}
		detach() {
			this.#destroy();
			super.detach?.();
		}
		destroy() {
			this.#destroy();
			super.destroy?.();
		}
		#destroy() {
			this.#disconnect?.abort();
			this.#disconnect = null;
			this.#reset();
		}
		#reset() {
			this.#request?.abort();
			this.#request = null;
			this.#currentSrc = "";
		}
		#init(target) {
			this.#destroy();
			this.#disconnect = new AbortController();
			const { signal } = this.#disconnect;
			target.addEventListener("loadstart", () => this.#refresh(target), { signal });
			target.addEventListener("emptied", () => this.#reset(), { signal });
			if (target.currentSrc || target.src) this.#refresh(target);
		}
		async #refresh(target) {
			const src = target.currentSrc || target.src;
			if (!src || !looksLikeM3u8(src) || src === this.#currentSrc) return;
			this.#reset();
			this.#currentSrc = src;
			const request = this.#request = new AbortController();
			try {
				const playlist = await fetchPlaylist(src, { signal: request.signal });
				if (request.signal.aborted || !isMultivariantPlaylist(playlist.text)) return;
				const url = findSessionDataUri(playlist.text, APPLE_HLS_CHAPTERS_DATA_ID, playlist.url);
				if (url) loadChaptersTracks(target, url, request.signal);
			} catch {}
		}
	}
	return NativeHlsChapters;
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/fairplay-eme.js
/**
* FairPlay negotiates against the manifest rather than a codec, holds no persistent state, and needs no device
* identifier — the narrowest configuration Safari will grant.
*/
const FAIRPLAY_CONFIGURATION = {
	initDataTypes: ["skd"],
	videoCapabilities: [{
		contentType: FAIRPLAY_CONTENT_TYPE,
		robustness: ""
	}],
	distinctiveIdentifier: "not-allowed",
	persistentState: "not-allowed",
	sessionTypes: ["temporary"]
};
/**
* Standard EME FairPlay, driven by the media element's `encrypted` event.
*
* Key exchange is the documented three-step dance: negotiate access to the key system and give the CDM its application
* certificate, open a session and let it generate an SPC, then trade that SPC for a CKC at the license server. Key
* system access and the certificate are shared by every session on the source, so they are resolved once and reused.
*/
function createFairPlayEme(context, options = {}) {
	const { media, signal, reportError } = context;
	const sessions = /* @__PURE__ */ new Set();
	let keys = null;
	let certificate = null;
	async function createKeys() {
		let access;
		try {
			access = await navigator.requestMediaKeySystemAccess(KeySystems.FAIRPLAY, [FAIRPLAY_CONFIGURATION]);
		} catch (cause) {
			throw toDrmError(cause, NativeHlsDrmMessages.UNSUPPORTED_KEY_SYSTEM, NativeHlsDrmErrors.UNSUPPORTED_KEY_SYSTEM);
		}
		const mediaKeys = await access.createMediaKeys();
		const appCertificate = await (certificate ??= requestAppCertificate(context));
		if (appCertificate) {
			if (!await mediaKeys.setServerCertificate(appCertificate).catch(() => false)) throw createDrmError(NativeHlsDrmMessages.SERVER_CERTIFICATE_FAILED, NativeHlsDrmErrors.SERVER_CERTIFICATE_FAILED);
		}
		if (signal.aborted) return mediaKeys;
		await media.setMediaKeys(mediaKeys);
		return mediaKeys;
	}
	async function onMessage(session, event) {
		try {
			const ckc = await requestLicenseKey(context, event.message);
			if (signal.aborted) return;
			await session.update(ckc).catch((cause) => {
				throw toDrmError(cause, NativeHlsDrmMessages.UPDATE_LICENSE_FAILED, NativeHlsDrmErrors.UPDATE_LICENSE_FAILED);
			});
		} catch (cause) {
			if (signal.aborted) return;
			reportError(toDrmError(cause, NativeHlsDrmMessages.CDM_ERROR, NativeHlsDrmErrors.CDM_ERROR));
		}
	}
	function onKeyStatusesChange(session) {
		session.keyStatuses.forEach((status) => {
			if (status === "internal-error") reportError(createDrmError(NativeHlsDrmMessages.CDM_ERROR, NativeHlsDrmErrors.CDM_ERROR));
			else if (status === "output-restricted" || status === "output-downscaled") reportError(createDrmError(NativeHlsDrmMessages.OUTPUT_RESTRICTED, NativeHlsDrmErrors.OUTPUT_RESTRICTED, false));
		});
	}
	async function createSession(mediaKeys, initDataType, initData) {
		const session = mediaKeys.createSession();
		sessions.add(session);
		session.addEventListener("message", (event) => void onMessage(session, event), { signal });
		session.addEventListener("keystatuseschange", () => onKeyStatusesChange(session), { signal });
		try {
			await session.generateRequest(initDataType, initData);
		} catch (cause) {
			sessions.delete(session);
			await session.close().catch(() => {});
			if (isAirPlayUnsupported(media, cause)) {
				options.onUnsupported?.();
				return;
			}
			throw toDrmError(cause, NativeHlsDrmMessages.GENERATE_REQUEST_FAILED, NativeHlsDrmErrors.GENERATE_REQUEST_FAILED);
		}
	}
	return {
		async request(event) {
			if (event.initDataType !== "skd") {
				console.warn(`[vjs-drm] Ignoring unexpected initialization data type "${event.initDataType}".`);
				return;
			}
			if (!event.initData) {
				console.warn("[vjs-drm] Ignoring an `encrypted` event carrying no initialization data.");
				return;
			}
			const mediaKeys = await (keys ??= createKeys());
			if (signal.aborted) return;
			await createSession(mediaKeys, event.initDataType, event.initData);
		},
		async close() {
			const closing = [...sessions].map((session) => session.close().catch(() => {}));
			sessions.clear();
			const pending = keys;
			keys = null;
			certificate = null;
			await Promise.all(closing);
			const mediaKeys = await pending?.catch(() => null);
			if (mediaKeys && media.mediaKeys === mediaKeys) await media.setMediaKeys(null).catch(() => {});
		}
	};
}
function isAirPlayUnsupported(media, cause) {
	return cause instanceof DOMException && cause.name === "NotSupportedError" && !!media.webkitCurrentPlaybackTargetIsWireless;
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/fairplay-webkit.js
/** Whether this realm still exposes the legacy WebKit key API for `media`. */
function supportsWebKitFairPlay(media) {
	return "WebKitMediaKeys" in globalThis && "webkitSetMediaKeys" in media;
}
/**
* Legacy WebKit FairPlay, driven by `webkitneedkey`.
*
* This exists for one reason: on some OS versions EME cannot generate a license request while the playback target is an
* AirPlay receiver, and the pre-EME API can. It mirrors the EME flow with the older calls, and differs in two ways —
* the application certificate is mandatory (it is packed into the session's initialization data rather than handed to
* the CDM), and `webkitSetMediaKeys` / `update` are synchronous.
*
* Remove this once the underlying WebKit issue is fixed.
*
* @see https://developer.apple.com/streaming/fps/
*/
function createFairPlayWebKit(context) {
	const { media, signal, reportError } = context;
	const element = media;
	const sessions = /* @__PURE__ */ new Set();
	let certificate = null;
	function setupKeys() {
		if (element.webkitKeys) return;
		const MediaKeysConstructor = globalThis.WebKitMediaKeys;
		if (!MediaKeysConstructor || !supportsWebKitFairPlay(media)) throw createDrmError(NativeHlsDrmMessages.UNSUPPORTED_KEY_SYSTEM, NativeHlsDrmErrors.UNSUPPORTED_KEY_SYSTEM);
		try {
			element.webkitSetMediaKeys(new MediaKeysConstructor(FAIRPLAY_LEGACY_KEY_SYSTEM));
		} catch (cause) {
			throw toDrmError(cause, NativeHlsDrmMessages.UNSUPPORTED_KEY_SYSTEM, NativeHlsDrmErrors.UNSUPPORTED_KEY_SYSTEM);
		}
	}
	async function onMessage(session, event) {
		try {
			const ckc = await requestLicenseKey(context, event.message);
			if (signal.aborted) return;
			session.update(ckc);
		} catch (cause) {
			if (signal.aborted) return;
			reportError(toDrmError(cause, NativeHlsDrmMessages.UPDATE_LICENSE_FAILED, NativeHlsDrmErrors.UPDATE_LICENSE_FAILED));
		}
	}
	function onKeyError(session) {
		const error = createDrmError(NativeHlsDrmMessages.CDM_ERROR, NativeHlsDrmErrors.CDM_ERROR);
		error.data = session.error;
		reportError(error);
	}
	return {
		async request(event) {
			if (!event.initData) {
				console.warn("[vjs-drm] Ignoring a `webkitneedkey` event carrying no initialization data.");
				return;
			}
			setupKeys();
			const appCertificate = await (certificate ??= requestAppCertificate(context));
			if (signal.aborted) return;
			if (!appCertificate) throw createDrmError(NativeHlsDrmMessages.MISSING_CERTIFICATE_URL, NativeHlsDrmErrors.MISSING_CONFIGURATION);
			const session = element.webkitKeys.createSession(FAIRPLAY_CONTENT_TYPE, packInitData(event.initData, appCertificate));
			sessions.add(session);
			session.addEventListener("webkitkeymessage", (message) => void onMessage(session, message), { signal });
			session.addEventListener("webkitkeyerror", () => onKeyError(session), { signal });
		},
		async close() {
			for (const session of sessions) try {
				session.close();
			} catch {}
			sessions.clear();
			certificate = null;
			try {
				element.webkitSetMediaKeys(null);
			} catch {}
		}
	};
}
/**
* Repack `webkitneedkey` initialization data into what `WebKitMediaKeys.createSession()` expects.
*
* In: the raw event data — a `skd://` URI as UTF-16LE, in newer WebKit builds behind a 4-byte little-endian byte count.
* Out: that data verbatim, then the content ID and the application certificate, each behind their own 4-byte
* little-endian byte count.
*/
function packInitData(initData, certificate) {
	const source = new Uint8Array(initData);
	const contentId = toUtf16LE(getContentId(initData));
	const appCertificate = new Uint8Array(certificate);
	const packed = new Uint8Array(source.byteLength + 4 + contentId.byteLength + 4 + appCertificate.byteLength);
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
	appendWithLength(appCertificate);
	return packed;
}
/**
* The content ID FairPlay keys the session on: everything after the scheme in the `skd://` URI. Locating the scheme
* rather than skipping a fixed prefix covers both the bare URI older WebKit sends and the length-prefixed form.
*/
function getContentId(initData) {
	const decoded = new TextDecoder("utf-16le").decode(initData);
	const start = decoded.indexOf("skd://");
	return start === -1 ? decoded : decoded.slice(start + 6);
}
function toUtf16LE(value) {
	const bytes = new Uint8Array(value.length * 2);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
	return bytes;
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/drm.js
/**
* Play DRM-protected HLS natively, configured by `source.drm` (or, where the native path needs licensing of its own,
* `source.engine.nativeHls.drmSystems`).
*
* Native HLS has no JS engine to hand key exchange to, so this mixin does it against the media element directly: it
* answers the element's key requests by fetching an application certificate and trading the CDM's SPC for a CKC at the
* license server. Only FairPlay is reachable this way — Widevine and PlayReady content needs the hls.js (MSE) engine.
*
* The configuration is read when a key request arrives rather than up front, so assigning `source` and letting the
* element load are independent, and a license server updated on a playing source is picked up without a reload; state
* is released on `emptied`, when the element starts on a new resource.
*
* Encrypted content with nothing configured fails loudly. Safari otherwise stalls without explanation, which is
* indistinguishable from a slow network.
*/
function NativeHlsDrmMixin(BaseClass) {
	class NativeHlsDrm extends BaseClass {
		#disconnect = null;
		#active = null;
		#useWebKit = false;
		attach(target) {
			super.attach(target);
			this.#init(target);
		}
		detach() {
			this.#destroy();
			super.detach?.();
		}
		destroy() {
			this.#destroy();
			super.destroy?.();
		}
		#destroy() {
			this.#disconnect?.abort();
			this.#disconnect = null;
			this.#useWebKit = false;
			this.#reset();
		}
		#init(target) {
			this.#destroy();
			this.#disconnect = new AbortController();
			const { signal } = this.#disconnect;
			target.addEventListener("encrypted", (event) => this.#serve(event, false), { signal });
			target.addEventListener("webkitneedkey", (event) => this.#serve(event, true), { signal });
			target.addEventListener("emptied", () => void this.#reset(), { signal });
			if (isWebKitAirPlayCapable(target)) target.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", () => {
				this.#useWebKit = false;
				this.#reset();
			}, { signal });
		}
		/**
		* The license servers in effect: `source.drm`, or the native engine's own `drmSystems` where one is named — an
		* escape hatch replaces what it is an escape from rather than merging with it.
		*/
		#drmSystems() {
			const { drm, engine } = this.source ?? {};
			return engine?.nativeHls?.drmSystems ?? drm ?? {};
		}
		#serve(event, fromWebKit) {
			if (fromWebKit !== this.#useWebKit) return;
			const media = this.target;
			const drmSystems = this.#drmSystems();
			const config = drmSystems[KeySystems.FAIRPLAY];
			if (!media) return;
			if (!config?.licenseUrl) {
				if (Object.keys(drmSystems).length > 0) console.warn(`[vjs-drm] Native HLS negotiates FairPlay only, and this source names no \`${KeySystems.FAIRPLAY}\` license server.`);
				this.setError(createDrmError(NativeHlsDrmMessages.MISSING_CONFIGURATION, NativeHlsDrmErrors.MISSING_CONFIGURATION));
				return;
			}
			const active = this.#active ??= this.#createKeySystem(media, config);
			active.keySystem.request(event).catch((cause) => {
				if (active.disconnect.signal.aborted) return;
				this.setError(cause instanceof MediaError ? cause : createDrmError(NativeHlsDrmMessages.CDM_ERROR, NativeHlsDrmErrors.CDM_ERROR));
			});
		}
		#createKeySystem(media, config) {
			const disconnect = new AbortController();
			const readConfig = () => this.#drmSystems()[KeySystems.FAIRPLAY] ?? config;
			const context = {
				media,
				get config() {
					return readConfig();
				},
				signal: disconnect.signal,
				reportError: (error) => this.setError(error)
			};
			return {
				keySystem: this.#useWebKit ? createFairPlayWebKit(context) : createFairPlayEme(context, { onUnsupported: () => void this.#fallBackToWebKit(media) }),
				disconnect
			};
		}
		#reset() {
			const active = this.#active;
			this.#active = null;
			active?.disconnect.abort();
			return active?.keySystem.close() ?? Promise.resolve();
		}
		async #fallBackToWebKit(media) {
			if (this.#useWebKit) return;
			this.#useWebKit = true;
			await this.#reset();
			if (!this.#disconnect || this.#disconnect.signal.aborted) return;
			media.load();
		}
	}
	return NativeHlsDrm;
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/errors.js
function NativeHlsErrorsMixin(BaseClass) {
	class NativeHlsErrors extends BaseClass {
		#disconnect = null;
		#error = null;
		get error() {
			return this.#error;
		}
		/**
		* Announce `error` as coming from this media, latching it as the current error when it is fatal. Non-fatal errors
		* are announced only — playback continues, so they must not stand in for whatever fails next.
		*
		* For siblings producing errors the media element never reports itself: DRM key exchange, notably, which fails
		* entirely outside the element.
		*
		* @internal
		*/
		setError(error) {
			if (error.fatal) this.#error = error;
			this.dispatchEvent(new ErrorEvent("error", {
				error,
				message: error.message
			}));
		}
		attach(target) {
			super.attach(target);
			this.#init(target);
		}
		detach() {
			this.#destroy();
			super.detach?.();
		}
		destroy() {
			this.#destroy();
			super.destroy?.();
		}
		#destroy() {
			this.#disconnect?.abort();
			this.#disconnect = null;
			this.#error = null;
		}
		#init(target) {
			this.#destroy();
			this.#disconnect = new AbortController();
			const signal = this.#disconnect.signal;
			target.addEventListener("error", (event) => {
				if (event.target !== target) return;
				event.stopImmediatePropagation();
				const native = target.error;
				if (!native) return;
				const code = native.code;
				const useCanonicalMessage = code >= MediaError.MEDIA_ERR_ABORTED && code <= MediaError.MEDIA_ERR_ENCRYPTED;
				this.setError(new MediaError(useCanonicalMessage ? void 0 : native.message, code, true));
			}, {
				signal,
				capture: true
			});
			target.addEventListener("emptied", () => {
				this.#error = null;
			}, { signal });
		}
	}
	return NativeHlsErrors;
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/live.js
/** @fires targetlivewindowchange - Fired when the target live window changes. Read `targetLiveWindow` for the new value. */
function NativeHlsLiveMixin(BaseClass) {
	class NativeHlsLive extends BaseClass {
		#targetLiveWindow = NaN;
		#liveEdgeStartOffset;
		#disconnect = null;
		#currentSrc = "";
		/**
		* Describes the kind of live window available. `0` for a sliding live window, `Infinity` for a live event with
		* playback history, and `NaN` for on-demand or unknown. This value is not a duration.
		*/
		get targetLiveWindow() {
			return this.#targetLiveWindow;
		}
		/**
		* Playback time where the live edge begins. Calculated from the newest available time and the playlist's live-edge
		* offset. `NaN` when the stream is not live or the offset is unavailable.
		*/
		get liveEdgeStart() {
			if (this.#liveEdgeStartOffset === void 0) return NaN;
			const target = this.target;
			if (!target) return NaN;
			const { seekable, buffered } = target;
			const ranges = seekable.length ? seekable : buffered;
			if (!ranges.length) return NaN;
			return ranges.end(ranges.length - 1) - this.#liveEdgeStartOffset;
		}
		attach(target) {
			super.attach(target);
			this.#init(target);
		}
		detach() {
			this.#destroy();
			super.detach?.();
		}
		destroy() {
			this.#destroy();
			super.destroy?.();
		}
		#destroy() {
			this.#disconnect?.abort();
			this.#disconnect = null;
			this.#currentSrc = "";
			this.#liveEdgeStartOffset = void 0;
			this.#setTargetLiveWindow(NaN);
		}
		#init(target) {
			this.#destroy();
			this.#disconnect = new AbortController();
			const { signal } = this.#disconnect;
			target.addEventListener("loadstart", () => this.#refresh(target), { signal });
			target.addEventListener("emptied", () => {
				this.#currentSrc = "";
				this.#liveEdgeStartOffset = void 0;
				this.#setTargetLiveWindow(NaN);
			}, { signal });
			if (target.currentSrc || target.src) this.#refresh(target);
		}
		async #refresh(target) {
			const src = target.currentSrc || target.src;
			if (!src || !looksLikeM3u8(src) || src === this.#currentSrc) return;
			this.#currentSrc = src;
			this.#liveEdgeStartOffset = void 0;
			this.#setTargetLiveWindow(NaN);
			const signal = this.#disconnect?.signal;
			try {
				const info = await getStreamInfoFromSrc(src, signal);
				if (signal?.aborted) return;
				if ((target.currentSrc || target.src) !== src) return;
				this.#liveEdgeStartOffset = info.liveEdgeStartOffset;
				this.#setTargetLiveWindow(info.targetLiveWindow);
			} catch {}
		}
		#setTargetLiveWindow(value) {
			if (Object.is(this.#targetLiveWindow, value)) return;
			this.#targetLiveWindow = value;
			this.dispatchEvent(new Event("targetlivewindowchange"));
		}
	}
	return NativeHlsLive;
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/stream-type.js
/** @fires streamtypechange - Fired when the detected stream type changes. Read `streamType` for the new value. */
function NativeHlsStreamTypeMixin(BaseClass) {
	class NativeHlsStreamType extends BaseClass {
		#streamType = MediaStreamTypes.UNKNOWN;
		#isUserStreamType = false;
		#disconnect = null;
		/** Current stream type (`'on-demand'` / `'live'` / `'unknown'`). */
		get streamType() {
			return this.#streamType;
		}
		set streamType(value) {
			if (value === MediaStreamTypes.UNKNOWN) {
				this.#isUserStreamType = false;
				this.#setDetected(this.#detect());
				return;
			}
			this.#isUserStreamType = true;
			this.#update(value);
		}
		attach(target) {
			super.attach(target);
			this.#init(target);
		}
		detach() {
			this.#destroy();
			this.#setDetected(MediaStreamTypes.UNKNOWN);
			super.detach?.();
		}
		destroy() {
			this.#destroy();
			super.destroy?.();
		}
		#destroy() {
			this.#disconnect?.abort();
			this.#disconnect = null;
		}
		#init(target) {
			this.#destroy();
			this.#disconnect = new AbortController();
			const { signal } = this.#disconnect;
			const detect = () => this.#setDetected(this.#detect(target));
			target.addEventListener("durationchange", detect, { signal });
			target.addEventListener("loadedmetadata", detect, { signal });
			target.addEventListener("emptied", () => this.#setDetected(MediaStreamTypes.UNKNOWN), { signal });
			detect();
		}
		#detect(target = this.target) {
			if (!target) return MediaStreamTypes.UNKNOWN;
			const { duration } = target;
			if (duration === Infinity) return MediaStreamTypes.LIVE;
			if (Number.isFinite(duration) && duration > 0) return MediaStreamTypes.ON_DEMAND;
			return MediaStreamTypes.UNKNOWN;
		}
		#setDetected(value) {
			if (this.#isUserStreamType) return;
			this.#update(value);
		}
		#update(value) {
			if (this.#streamType === value) return;
			this.#streamType = value;
			this.dispatchEvent(new Event("streamtypechange"));
		}
	}
	return NativeHlsStreamType;
}

//#endregion
//#region ../adapters/native-hls-video/dist/dev/adapter.js
var NativeHlsAdapterCore = class NativeHlsAdapterCore extends HTMLVideoAdapter {
	static {
		this.defaultProps = {
			src: "",
			source: null,
			preload: "metadata",
			streamType: MediaStreamTypes.UNKNOWN
		};
	}
	#src = NativeHlsAdapterCore.defaultProps.src;
	#source = NativeHlsAdapterCore.defaultProps.source;
	#preload = NativeHlsAdapterCore.defaultProps.preload;
	/** Underlying playback engine — always `null`. Native HLS has no JS engine; the browser handles playback directly. */
	get engine() {
		return null;
	}
	/**
	* Media source URL. Assigning it replaces the identity half of `source` and leaves `engine` intact, so changing the
	* URL never disturbs key exchange.
	*
	* Like the element's own `src`, assigning it always loads — including the URL already playing.
	*/
	get src() {
		return this.#src;
	}
	set src(src) {
		const { drm, engine } = this.#source ?? {};
		const next = {
			...drm && { drm },
			...engine && { engine },
			...src && { src }
		};
		this.#source = Object.keys(next).length > 0 ? next : null;
		this.#src = src;
		if (this.target) this.target.src = src;
	}
	/**
	* Structured source: what to play (`src`) plus how to play it (`engine.nativeHls`). Assigning it derives `src`.
	*
	* Only a new URL reaches the element, so reassigning an equivalent source neither reloads nor disturbs key exchange.
	* Use `src` or `load()` to reload what is already playing.
	*
	* Changing this source does not emit `sourcechange`. When the hls.js media component uses native HLS playback, it
	* emits its own `sourcechange` and forwards the native playback events.
	*/
	get source() {
		return this.#source;
	}
	set source(value) {
		const source = value ?? null;
		if (source === this.#source) return;
		const src = source?.src ?? "";
		const srcChanged = this.#src !== src;
		this.#source = source;
		this.#src = src;
		if (srcChanged && this.target) this.target.src = src;
	}
	/** Preload type (`'none'` / `'metadata'` / `'auto'`). */
	get preload() {
		return this.#preload;
	}
	set preload(value) {
		this.#preload = value;
		if (this.target) this.target.preload = value;
	}
	attach(target) {
		super.attach(target);
		if (this.preload !== target.preload) target.preload = this.preload;
		if (this.src) target.src = this.src;
	}
};
var NativeHlsAdapter = class extends NativeHlsChaptersMixin(NativeHlsLiveMixin(NativeHlsStreamTypeMixin(NativeHlsDrmMixin(NativeHlsErrorsMixin(NativeHlsAdapterCore))))) {};

//#endregion
export { KeySystems as n, NativeHlsAdapter as t };
//# sourceMappingURL=adapter-l8sf1YpR.js.map