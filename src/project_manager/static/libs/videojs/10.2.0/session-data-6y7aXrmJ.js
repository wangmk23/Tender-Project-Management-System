//#region ../spf/dist/dev/network/ewma.js
/**
* Exponentially Weighted Moving Average (EWMA)
*
* Pure functional implementation of EWMA calculations. Based on Shaka Player's EWMA algorithm.
*/
/**
* Calculate alpha (decay factor) from half-life.
*
* Alpha determines how quickly old data "expires": - alpha close to 1 = slow decay (long memory) - alpha close to 0 =
* fast decay (short memory)
*
* @example
*   const alpha = calculateAlpha(2); // ≈ 0.7071 for 2-second half-life
*
* @param halfLife - The quantity of prior samples (by weight) that make up half of the new estimate. Must be positive.
* @returns Alpha value between 0 and 1
*/
function calculateAlpha(halfLife) {
	return Math.exp(Math.log(.5) / halfLife);
}
/**
* Calculate exponentially weighted moving average.
*
* Updates an estimate by blending a new value with the previous estimate, weighted by the sample duration. Longer
* samples have more influence.
*
* @example
*   let estimate = 0;
*   estimate = calculateEwma(estimate, 1_000_000, 1, 2); // First sample
*   estimate = calculateEwma(estimate, 2_000_000, 1, 2); // Second sample
*
* @param prevEstimate - Previous EWMA estimate
* @param value - New sample value to incorporate
* @param weight - Sample weight (typically duration in seconds)
* @param halfLife - Half-life for decay (typically 2-5 seconds)
* @returns Updated EWMA estimate
*/
function calculateEwma(prevEstimate, value, weight, halfLife) {
	const adjAlpha = calculateAlpha(halfLife) ** weight;
	return value * (1 - adjAlpha) + adjAlpha * prevEstimate;
}
/**
* Apply zero-factor correction to EWMA estimate.
*
* The zero-factor correction compensates for bias when starting from zero. Without this correction, early estimates
* would be artificially low.
*
* As totalWeight increases, the correction factor approaches 1, meaning the estimate becomes more reliable and needs
* less correction.
*
* @example
*   const raw = calculateEwma(0, 1_000_000, 1, 2);
*   const corrected = applyZeroFactor(raw, 1, 2); // ≈ 1_000_000
*
* @param estimate - Raw EWMA estimate (uncorrected)
* @param totalWeight - Accumulated weight from all samples
* @param halfLife - Half-life used in EWMA calculation
* @returns Corrected estimate, or 0 if totalWeight is 0
*/
function applyZeroFactor(estimate, totalWeight, halfLife) {
	if (totalWeight === 0) return 0;
	return estimate / (1 - calculateAlpha(halfLife) ** totalWeight);
}

//#endregion
//#region ../spf/dist/dev/network/bandwidth-estimator.js
/**
* Dual EWMA Bandwidth Estimator
*
* Estimates available bandwidth using two EWMA calculations with different half-lives, taking the minimum of both. This
* approach (from Shaka Player):
*
* - **Fast EWMA** (2s half-life): Reacts quickly to bandwidth drops
* - **Slow EWMA** (5s half-life): Provides stability during fluctuations
* - **min(fast, slow)**: Adapts down quickly, up slowly
*
* This naturally provides asymmetric behavior needed for good QoE: avoiding stalls (quick downgrade) while preventing
* oscillation (slow upgrade).
*/
/**
* Default bandwidth estimator configuration.
*
* Values match Shaka Player defaults based on experimentation.
*/
const DEFAULT_BANDWIDTH_CONFIG = {
	fastHalfLife: 2,
	slowHalfLife: 5,
	minTotalBytes: 128e3,
	minBytes: 16e3,
	minDuration: 5
};
/**
* Add a bandwidth sample from a segment download.
*
* Samples are filtered based on: - Minimum bytes (filters TTFB-dominated small segments) - Minimum duration (filters
* cached responses)
*
* Valid samples update both fast and slow EWMA estimates.
*
* @example
*   let state = { fastEstimate: 0, fastTotalWeight: 0, ... };
*   // Sample: 1MB in 1 second
*   state = sampleBandwidth(state, 1000, 1_000_000);
*
* @param state - Current estimator state
* @param durationMs - Download duration in milliseconds
* @param numBytes - Number of bytes downloaded
* @param config - Optional estimator configuration (uses defaults if not provided)
* @returns New estimator state with sample incorporated (or unchanged if filtered)
*/
function sampleBandwidth(state, durationMs, numBytes, config = DEFAULT_BANDWIDTH_CONFIG) {
	const updatedBytesSampled = state.bytesSampled + numBytes;
	if (numBytes < config.minBytes) return {
		...state,
		bytesSampled: updatedBytesSampled
	};
	if (durationMs < config.minDuration) return {
		...state,
		bytesSampled: updatedBytesSampled
	};
	const bandwidth = 8e3 * numBytes / durationMs;
	const weight = durationMs / 1e3;
	return {
		fastEstimate: calculateEwma(state.fastEstimate, bandwidth, weight, config.fastHalfLife),
		fastTotalWeight: state.fastTotalWeight + weight,
		slowEstimate: calculateEwma(state.slowEstimate, bandwidth, weight, config.slowHalfLife),
		slowTotalWeight: state.slowTotalWeight + weight,
		bytesSampled: updatedBytesSampled
	};
}
/**
* Get the current bandwidth estimate.
*
* Returns the **minimum** of the fast and slow EWMA estimates. This provides the key asymmetric behavior:
*
* - When bandwidth drops, fast EWMA reacts first and dominates (quick adaptation)
* - When bandwidth rises, slow EWMA lags behind and dominates (slow adaptation)
*
* Uses default estimate until enough data has been sampled — and when no estimator state exists at all (`state ===
* undefined`).
*
* @example
*   const estimate = getBandwidthEstimate(state, 5_000_000); // 5 Mbps default
*
* @param state - Current estimator state, or `undefined` before any samples have been collected
* @param defaultEstimate - Fallback estimate before sufficient samples (bps)
* @param config - Optional estimator configuration (uses defaults if not provided)
* @returns Bandwidth estimate in bits per second
*/
function getBandwidthEstimate(state, defaultEstimate, config = DEFAULT_BANDWIDTH_CONFIG) {
	if (!state || !(state.bytesSampled >= config.minTotalBytes && state.fastTotalWeight > 0 && state.slowTotalWeight > 0)) return defaultEstimate;
	const fastEstimate = applyZeroFactor(state.fastEstimate, state.fastTotalWeight, config.fastHalfLife);
	const slowEstimate = applyZeroFactor(state.slowEstimate, state.slowTotalWeight, config.slowHalfLife);
	return Math.min(fastEstimate, slowEstimate);
}

//#endregion
//#region ../spf/dist/dev/media/hls/resolve-url.js
/** Resolve a potentially relative URL against a base URL using native URL API. */
function resolveUrl(url, baseUrl) {
	return new URL(url, baseUrl).href;
}
/**
* Default {@link ResolveKeyUri}: resolve only what names a fetchable resource, and hand anything opaque back untouched.
*
* Only `METHOD=AES-128` / `SAMPLE-AES` with `KEYFORMAT="identity"` points at a key file that may be written relative to
* the playlist. Every DRM key system instead carries an _identifier_ — a `data:` PSSH/PlayReady payload, a FairPlay
* `skd://` — and resolving those is at best lossy. It is also unsafe: FairPlay's common `skd://<keyid>:<iv>` form makes
* `new URL` read the IV as a port, which is not numeric, so it throws and takes the whole playlist parse down with it.
*/
function resolveKeyUri(uri, baseUrl) {
	if (/^[a-z][a-z0-9+.-]*:/i.test(uri) && !/^https?:/i.test(uri)) return uri;
	try {
		return resolveUrl(uri, baseUrl);
	} catch {
		return uri;
	}
}

//#endregion
//#region ../spf/dist/dev/media/hls/parse-attributes.js
/** Parse HLS attribute list from a tag line. Handles both quoted and unquoted values. */
function parseAttributeList(line) {
	const attributes = /* @__PURE__ */ new Map();
	for (const match of line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)) {
		const key = match[1];
		const value = match[2] ?? match[3] ?? "";
		if (key) attributes.set(key, value);
	}
	return attributes;
}
/** Parse RESOLUTION attribute value (WIDTHxHEIGHT). */
function parseResolution(value) {
	const match = /^(\d+)x(\d+)$/.exec(value);
	if (!match) return null;
	return {
		width: Number.parseInt(match[1], 10),
		height: Number.parseInt(match[2], 10)
	};
}
/** Parse FRAME-RATE attribute to rational frame rate. */
function parseFrameRate(value) {
	const fps = Number.parseFloat(value);
	if (Number.isNaN(fps) || fps <= 0) return void 0;
	if (Math.abs(fps - 23.976) < .01) return {
		frameRateNumerator: 24e3,
		frameRateDenominator: 1001
	};
	if (Math.abs(fps - 29.97) < .01) return {
		frameRateNumerator: 3e4,
		frameRateDenominator: 1001
	};
	if (Math.abs(fps - 59.94) < .01) return {
		frameRateNumerator: 6e4,
		frameRateDenominator: 1001
	};
	if (fps % 1 === 0) return { frameRateNumerator: Math.round(fps) };
	return { frameRateNumerator: Math.round(fps) };
}
const AUDIO_CODEC_PREFIXES = [
	"mp4a.",
	"ac-3",
	"ec-3",
	"ac-4",
	"opus",
	"flac",
	"dts",
	"alac",
	"vorbis"
];
/** Parse CODECS attribute into separate video and audio codecs. */
function parseCodecs(codecs) {
	const parts = codecs.split(",").map((s) => s.trim());
	const result = {};
	for (const codec of parts) {
		const lower = codec.toLowerCase();
		if (codec.startsWith("avc1.") || codec.startsWith("hvc1.") || codec.startsWith("hev1.")) result.video = codec;
		else if (AUDIO_CODEC_PREFIXES.some((prefix) => lower.startsWith(prefix))) result.audio = codec;
	}
	return result;
}
/** Parse #EXTINF duration value. */
function parseExtInfDuration(value) {
	const durationPart = value.split(",")[0] ?? value;
	const duration = Number.parseFloat(durationPart);
	return Number.isNaN(duration) ? 0 : duration;
}
/**
* Parse BYTERANGE attribute value. Format: "length[@offset]" If offset is omitted, it continues from the previous byte
* range end.
*/
function parseByteRange(value, previousEnd) {
	const match = /^(\d+)(?:@(\d+))?$/.exec(value);
	if (!match) return null;
	const length = Number.parseInt(match[1], 10);
	if (Number.isNaN(length)) return null;
	let start;
	if (match[2] !== void 0) {
		start = Number.parseInt(match[2], 10);
		if (Number.isNaN(start)) return null;
	} else if (previousEnd !== void 0) start = previousEnd;
	else return null;
	return {
		start,
		end: start + length - 1
	};
}
/** Create AttributeList from raw attribute string. */
function createAttributeList(line) {
	const map = parseAttributeList(line);
	return {
		get(key) {
			return map.get(key);
		},
		getInt(key, defaultValue) {
			const value = map.get(key);
			if (value === void 0) return defaultValue;
			const parsed = Number.parseInt(value, 10);
			return Number.isNaN(parsed) ? defaultValue : parsed;
		},
		getFloat(key, defaultValue) {
			const value = map.get(key);
			if (value === void 0) return defaultValue;
			const parsed = Number.parseFloat(value);
			return Number.isNaN(parsed) ? defaultValue : parsed;
		},
		getBool(key) {
			return map.get(key) === "YES";
		},
		getResolution(key) {
			const value = map.get(key);
			if (!value) return void 0;
			return parseResolution(value) ?? void 0;
		},
		getFrameRate(key) {
			const value = map.get(key);
			if (!value) return void 0;
			return parseFrameRate(value);
		}
	};
}
/** Match a tag and extract its attributes. Returns null if the line doesn't match the tag. */
function matchTag(line, tag) {
	const prefix = `#${tag}:`;
	if (!line.startsWith(prefix)) return null;
	return createAttributeList(line.slice(prefix.length));
}

//#endregion
//#region ../spf/dist/dev/network/chunked-stream-iterable.js
const DEFAULT_MIN_CHUNK_SIZE = 2 ** 17;
/**
* Adapts a `ReadableStream<Uint8Array>` (e.g. `response.body`) into an `AsyncIterable<Uint8Array>` that yields chunks
* no smaller than `minChunkSize` bytes. Smaller network chunks are accumulated and yielded together once the threshold
* is met. Any remainder is flushed on stream end.
*
* Errors from the underlying stream propagate naturally — the reader lock is always released via `finally`.
*/
var ChunkedStreamIterable = class {
	#minChunkSize;
	#readableStream;
	constructor(readableStream, { minChunkSize = DEFAULT_MIN_CHUNK_SIZE } = {}) {
		this.#readableStream = readableStream;
		this.#minChunkSize = minChunkSize;
	}
	async *[Symbol.asyncIterator]() {
		let pending;
		const reader = this.#readableStream.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					if (pending) yield pending;
					break;
				}
				pending = pending ? concat(pending, value) : value;
				if (pending.length >= this.#minChunkSize) {
					yield pending;
					pending = void 0;
				}
			}
		} finally {
			reader.releaseLock();
		}
	}
};
function concat(a, b) {
	const result = new Uint8Array(a.length + b.length);
	result.set(a);
	result.set(b, a.length);
	return result;
}

//#endregion
//#region ../spf/dist/dev/network/fetch.js
/**
* HTTP Fetch Wrapper
*
* Composable building blocks: - fetchResolvable() — fetch a Resource (handles byte ranges); returns Response -
* getResponseText() — extract text from Response - fetchStream() — two-stage: await connection establishment, then
* lazily iterate body chunks. Use when timing the connection start independently of body consumption matters (e.g.,
* observable fetch timing for ABR). - createTrackedFetch() — factory for a fetchStream-shape function that samples
* bandwidth (via EWMA) per chunk and notifies via callback.
*/
/**
* Fetch resolvable from a Resource.
*
* Handles byte range requests if byteRange is present. Returns native fetch Response for composability (can extract
* text, stream, etc.).
*
* @example
*   const response = await fetchResolvable({ url: 'https://example.com/segment.m4s' });
*   const text = await getResponseText(response);
*
* @example
*   // With byte range
*   const response = await fetchResolvable({
*     url: 'https://example.com/file.mp4',
*     byteRange: { start: 1000, end: 1999 },
*   });
*
* @param addressable - Resource to fetch (url + optional byteRange)
* @returns Promise resolving to Response
*/
async function fetchResolvable(addressable, options) {
	const headers = new Headers(options?.headers);
	if (addressable.byteRange) {
		const { start, end } = addressable.byteRange;
		headers.set("Range", `bytes=${start}-${end}`);
	}
	const request = new Request(addressable.url, {
		method: "GET",
		...options,
		headers
	});
	return fetch(request);
}
/**
* Extract text from Response.
*
* Accepts minimal Response-like object (just needs text() method). Returns promise from response.text().
*
* @example
*   const response = await fetchResolvable(addressable);
*   const text = await getResponseText(response);
*
* @param response - Response-like object with text() method
* @returns Promise resolving to text content
*/
function getResponseText(response) {
	return response.text();
}
/** Default {@link FetchText}: fetch the resource, reject on non-OK, return text. */
const fetchResolvableText = async (addressable, options) => {
	const response = await fetchResolvable(addressable, options);
	if (!response.ok) throw new Error(`fetchResolvableText: ${response.status} ${response.statusText} for ${addressable.url}`);
	return getResponseText(response);
};
async function fetchStream(addressable, options) {
	const { minChunkSize, ...fetchOptions } = options ?? {};
	const response = await fetchResolvable(addressable, fetchOptions);
	if (!response.ok) throw new Error(`fetchStream: ${response.status} ${response.statusText} for ${addressable.url}`);
	if (!response.body) throw new Error("Response has no body");
	return new ChunkedStreamIterable(response.body, ...minChunkSize !== void 0 ? [{ minChunkSize }] : []);
}
/**
* Returns a {@link FetchBytes} function that samples bandwidth via EWMA per body chunk. The factory captures the
* running bandwidth state internally; per chunk it computes the next state and notifies the supplied `onSample`
* callback.
*
* The factory's internal accumulator is seeded from `initial` and updated on every chunk; callers don't need to thread
* it back in. `onSample` receives the _new_ state after each chunk — typical use is to bridge samples back into engine
* state for ABR consumers.
*
* @param initial - Starting `BandwidthState` (commonly zeros or the engine's current accumulator).
* @param onSample - Called with the new `BandwidthState` after each chunk.
*/
function createTrackedFetch(initial, onSample) {
	let state = initial;
	return async (addressable, options) => {
		const body = await fetchStream(addressable, options);
		return { [Symbol.asyncIterator]: async function* () {
			let chunkStart = performance.now();
			for await (const chunk of body) {
				const elapsed = performance.now() - chunkStart;
				state = sampleBandwidth(state, elapsed, chunk.byteLength);
				onSample(state);
				yield chunk;
				chunkStart = performance.now();
			}
		} };
	};
}

//#endregion
//#region ../spf/dist/dev/media/hls/session-data.js
/**
* Read one `#EXT-X-SESSION-DATA` tag's attributes as a {@link SessionDataEntry}, its `URI` resolved against `baseUrl`.
* `undefined` for a tag missing `DATA-ID` or carrying neither `VALUE` nor `URI`.
*/
function parseSessionData(attributes, baseUrl) {
	const dataId = attributes.get("DATA-ID");
	const value = attributes.get("VALUE");
	const uri = attributes.get("URI");
	if (!dataId || value === void 0 && uri === void 0) return void 0;
	const language = attributes.get("LANGUAGE");
	const entry = { dataId };
	if (value !== void 0) entry.value = value;
	if (uri !== void 0) {
		entry.uri = resolveUrl(uri, baseUrl);
		entry.format = attributes.get("FORMAT") === "RAW" ? "RAW" : "JSON";
	}
	if (language) entry.language = language;
	return entry;
}
/**
* The `URI` of the first `#EXT-X-SESSION-DATA` tag carrying `dataId` by reference, resolved against `baseUrl` — the
* entry `getSessionData` callers pick from a parsed presentation, read straight from playlist text for a player that
* never parses the rest. An entry carrying its datum inline as `VALUE` is skipped. Throws when the URI cannot be
* resolved, as the multivariant parser does.
*/
function findSessionDataUri(playlist, dataId, baseUrl) {
	for (const line of playlist.split(/\r?\n/)) {
		const attributes = matchTag(line.trim(), "EXT-X-SESSION-DATA");
		const entry = attributes && parseSessionData(attributes, baseUrl);
		if (entry?.dataId === dataId && entry.uri) return entry.uri;
	}
}

//#endregion
export { fetchResolvableText as a, matchTag as c, parseExtInfDuration as d, resolveKeyUri as f, getBandwidthEstimate as h, fetchResolvable as i, parseByteRange as l, DEFAULT_BANDWIDTH_CONFIG as m, parseSessionData as n, fetchStream as o, resolveUrl as p, createTrackedFetch as r, getResponseText as s, findSessionDataUri as t, parseCodecs as u };
//# sourceMappingURL=session-data-6y7aXrmJ.js.map