import { c as isObject, f as isUndefined, i as isFunction } from "./predicate-3rF1m2uv.js";
import { t as defaults } from "./defaults-nT7MwJ_t.js";
import { t as listen } from "./listen-CO63BggB.js";
import { t as anyAbortSignal } from "./abort-DsWgOZ8b.js";
import { t as generateId } from "./generate-id-DHFQ63E5.js";
import { a as fetchResolvableText, c as matchTag, d as parseExtInfDuration, f as resolveKeyUri, i as fetchResolvable, l as parseByteRange, n as parseSessionData, o as fetchStream, p as resolveUrl, r as createTrackedFetch, s as getResponseText, u as parseCodecs } from "./session-data-6y7aXrmJ.js";

//#region ../utils/dist/function/to-value.js
/**
* Unwrap a {@link ValueOrFunction} to its value, calling the function if that is what was given.
*
* A function that throws answers `undefined`: callers may be inside a synchronous pass where one bad producer must not
* fail the whole pass, and a value that cannot be produced is unusable anyway.
*
* @example
*   ```ts
*   toValue('https://a.example'); // 'https://a.example'
*   toValue(() => current?.url); // whatever `current.url` is right now
*   toValue(undefined); // undefined
*   ```;
*
* @internal
*/
function toValue(value) {
	if (typeof value !== "function") return value;
	try {
		return value();
	} catch {
		return;
	}
}

//#endregion
//#region ../../node_modules/.pnpm/signal-polyfill@0.2.2/node_modules/signal-polyfill/dist/index.js
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, {
	enumerable: true,
	configurable: true,
	writable: true,
	value
}) : obj[key] = value;
var __publicField = (obj, key, value) => {
	__defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
	return value;
};
var __accessCheck = (obj, member, msg) => {
	if (!member.has(obj)) throw TypeError("Cannot " + msg);
};
var __privateIn = (member, obj) => {
	if (Object(obj) !== obj) throw TypeError("Cannot use the \"in\" operator on this value");
	return member.has(obj);
};
var __privateAdd = (obj, member, value) => {
	if (member.has(obj)) throw TypeError("Cannot add the same private member more than once");
	member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateMethod = (obj, member, method) => {
	__accessCheck(obj, member, "access private method");
	return method;
};
/**
* @license
* Copyright Google LLC All Rights Reserved.
*
* Use of this source code is governed by an MIT-style license that can be
* found in the LICENSE file at https://angular.io/license
*/
function defaultEquals(a, b) {
	return Object.is(a, b);
}
/**
* @license
* Copyright Google LLC All Rights Reserved.
*
* Use of this source code is governed by an MIT-style license that can be
* found in the LICENSE file at https://angular.io/license
*/
let activeConsumer = null;
let inNotificationPhase = false;
let epoch = 1;
const SIGNAL = /* @__PURE__ */ Symbol("SIGNAL");
function setActiveConsumer(consumer) {
	const prev = activeConsumer;
	activeConsumer = consumer;
	return prev;
}
function getActiveConsumer() {
	return activeConsumer;
}
function isInNotificationPhase() {
	return inNotificationPhase;
}
const REACTIVE_NODE = {
	version: 0,
	lastCleanEpoch: 0,
	dirty: false,
	producerNode: void 0,
	producerLastReadVersion: void 0,
	producerIndexOfThis: void 0,
	nextProducerIndex: 0,
	liveConsumerNode: void 0,
	liveConsumerIndexOfThis: void 0,
	consumerAllowSignalWrites: false,
	consumerIsAlwaysLive: false,
	producerMustRecompute: () => false,
	producerRecomputeValue: () => {},
	consumerMarkedDirty: () => {},
	consumerOnSignalRead: () => {}
};
function producerAccessed(node) {
	if (inNotificationPhase) throw new Error(typeof ngDevMode !== "undefined" && ngDevMode ? `Assertion error: signal read during notification phase` : "");
	if (activeConsumer === null) return;
	activeConsumer.consumerOnSignalRead(node);
	const idx = activeConsumer.nextProducerIndex++;
	assertConsumerNode(activeConsumer);
	if (idx < activeConsumer.producerNode.length && activeConsumer.producerNode[idx] !== node) {
		if (consumerIsLive(activeConsumer)) {
			const staleProducer = activeConsumer.producerNode[idx];
			producerRemoveLiveConsumerAtIndex(staleProducer, activeConsumer.producerIndexOfThis[idx]);
		}
	}
	if (activeConsumer.producerNode[idx] !== node) {
		activeConsumer.producerNode[idx] = node;
		activeConsumer.producerIndexOfThis[idx] = consumerIsLive(activeConsumer) ? producerAddLiveConsumer(node, activeConsumer, idx) : 0;
	}
	activeConsumer.producerLastReadVersion[idx] = node.version;
}
function producerIncrementEpoch() {
	epoch++;
}
function producerUpdateValueVersion(node) {
	if (!node.dirty && node.lastCleanEpoch === epoch) return;
	if (!node.producerMustRecompute(node) && !consumerPollProducersForChange(node)) {
		node.dirty = false;
		node.lastCleanEpoch = epoch;
		return;
	}
	node.producerRecomputeValue(node);
	node.dirty = false;
	node.lastCleanEpoch = epoch;
}
function producerNotifyConsumers(node) {
	if (node.liveConsumerNode === void 0) return;
	const prev = inNotificationPhase;
	inNotificationPhase = true;
	try {
		for (const consumer of node.liveConsumerNode) if (!consumer.dirty) consumerMarkDirty(consumer);
	} finally {
		inNotificationPhase = prev;
	}
}
function producerUpdatesAllowed() {
	return (activeConsumer == null ? void 0 : activeConsumer.consumerAllowSignalWrites) !== false;
}
function consumerMarkDirty(node) {
	var _a;
	node.dirty = true;
	producerNotifyConsumers(node);
	(_a = node.consumerMarkedDirty) == null || _a.call(node.wrapper ?? node);
}
function consumerBeforeComputation(node) {
	node && (node.nextProducerIndex = 0);
	return setActiveConsumer(node);
}
function consumerAfterComputation(node, prevConsumer) {
	setActiveConsumer(prevConsumer);
	if (!node || node.producerNode === void 0 || node.producerIndexOfThis === void 0 || node.producerLastReadVersion === void 0) return;
	if (consumerIsLive(node)) for (let i = node.nextProducerIndex; i < node.producerNode.length; i++) producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
	while (node.producerNode.length > node.nextProducerIndex) {
		node.producerNode.pop();
		node.producerLastReadVersion.pop();
		node.producerIndexOfThis.pop();
	}
}
function consumerPollProducersForChange(node) {
	assertConsumerNode(node);
	for (let i = 0; i < node.producerNode.length; i++) {
		const producer = node.producerNode[i];
		const seenVersion = node.producerLastReadVersion[i];
		if (seenVersion !== producer.version) return true;
		producerUpdateValueVersion(producer);
		if (seenVersion !== producer.version) return true;
	}
	return false;
}
function producerAddLiveConsumer(node, consumer, indexOfThis) {
	var _a;
	assertProducerNode(node);
	assertConsumerNode(node);
	if (node.liveConsumerNode.length === 0) {
		(_a = node.watched) == null || _a.call(node.wrapper);
		for (let i = 0; i < node.producerNode.length; i++) node.producerIndexOfThis[i] = producerAddLiveConsumer(node.producerNode[i], node, i);
	}
	node.liveConsumerIndexOfThis.push(indexOfThis);
	return node.liveConsumerNode.push(consumer) - 1;
}
function producerRemoveLiveConsumerAtIndex(node, idx) {
	var _a;
	assertProducerNode(node);
	assertConsumerNode(node);
	if (typeof ngDevMode !== "undefined" && ngDevMode && idx >= node.liveConsumerNode.length) throw new Error(`Assertion error: active consumer index ${idx} is out of bounds of ${node.liveConsumerNode.length} consumers)`);
	if (node.liveConsumerNode.length === 1) {
		(_a = node.unwatched) == null || _a.call(node.wrapper);
		for (let i = 0; i < node.producerNode.length; i++) producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
	}
	const lastIdx = node.liveConsumerNode.length - 1;
	node.liveConsumerNode[idx] = node.liveConsumerNode[lastIdx];
	node.liveConsumerIndexOfThis[idx] = node.liveConsumerIndexOfThis[lastIdx];
	node.liveConsumerNode.length--;
	node.liveConsumerIndexOfThis.length--;
	if (idx < node.liveConsumerNode.length) {
		const idxProducer = node.liveConsumerIndexOfThis[idx];
		const consumer = node.liveConsumerNode[idx];
		assertConsumerNode(consumer);
		consumer.producerIndexOfThis[idxProducer] = idx;
	}
}
function consumerIsLive(node) {
	var _a;
	return node.consumerIsAlwaysLive || (((_a = node == null ? void 0 : node.liveConsumerNode) == null ? void 0 : _a.length) ?? 0) > 0;
}
function assertConsumerNode(node) {
	node.producerNode ?? (node.producerNode = []);
	node.producerIndexOfThis ?? (node.producerIndexOfThis = []);
	node.producerLastReadVersion ?? (node.producerLastReadVersion = []);
}
function assertProducerNode(node) {
	node.liveConsumerNode ?? (node.liveConsumerNode = []);
	node.liveConsumerIndexOfThis ?? (node.liveConsumerIndexOfThis = []);
}
/**
* @license
* Copyright Google LLC All Rights Reserved.
*
* Use of this source code is governed by an MIT-style license that can be
* found in the LICENSE file at https://angular.io/license
*/
function computedGet(node) {
	producerUpdateValueVersion(node);
	producerAccessed(node);
	if (node.value === ERRORED) throw node.error;
	return node.value;
}
function createComputed(computation) {
	const node = Object.create(COMPUTED_NODE);
	node.computation = computation;
	const computed = () => computedGet(node);
	computed[SIGNAL] = node;
	return computed;
}
const UNSET = /* @__PURE__ */ Symbol("UNSET");
const COMPUTING = /* @__PURE__ */ Symbol("COMPUTING");
const ERRORED = /* @__PURE__ */ Symbol("ERRORED");
const COMPUTED_NODE = /* @__PURE__ */ (() => {
	return {
		...REACTIVE_NODE,
		value: UNSET,
		dirty: true,
		error: null,
		equal: defaultEquals,
		producerMustRecompute(node) {
			return node.value === UNSET || node.value === COMPUTING;
		},
		producerRecomputeValue(node) {
			if (node.value === COMPUTING) throw new Error("Detected cycle in computations.");
			const oldValue = node.value;
			node.value = COMPUTING;
			const prevConsumer = consumerBeforeComputation(node);
			let newValue;
			let wasEqual = false;
			try {
				newValue = node.computation.call(node.wrapper);
				wasEqual = oldValue !== UNSET && oldValue !== ERRORED && node.equal.call(node.wrapper, oldValue, newValue);
			} catch (err) {
				newValue = ERRORED;
				node.error = err;
			} finally {
				consumerAfterComputation(node, prevConsumer);
			}
			if (wasEqual) {
				node.value = oldValue;
				return;
			}
			node.value = newValue;
			node.version++;
		}
	};
})();
/**
* @license
* Copyright Google LLC All Rights Reserved.
*
* Use of this source code is governed by an MIT-style license that can be
* found in the LICENSE file at https://angular.io/license
*/
function defaultThrowError() {
	throw new Error();
}
let throwInvalidWriteToSignalErrorFn = defaultThrowError;
function throwInvalidWriteToSignalError() {
	throwInvalidWriteToSignalErrorFn();
}
/**
* @license
* Copyright Google LLC All Rights Reserved.
*
* Use of this source code is governed by an MIT-style license that can be
* found in the LICENSE file at https://angular.io/license
*/
function createSignal(initialValue) {
	const node = Object.create(SIGNAL_NODE);
	node.value = initialValue;
	const getter = () => {
		producerAccessed(node);
		return node.value;
	};
	getter[SIGNAL] = node;
	return getter;
}
function signalGetFn() {
	producerAccessed(this);
	return this.value;
}
function signalSetFn(node, newValue) {
	if (!producerUpdatesAllowed()) throwInvalidWriteToSignalError();
	if (!node.equal.call(node.wrapper, node.value, newValue)) {
		node.value = newValue;
		signalValueChanged(node);
	}
}
const SIGNAL_NODE = /* @__PURE__ */ (() => {
	return {
		...REACTIVE_NODE,
		equal: defaultEquals,
		value: void 0
	};
})();
function signalValueChanged(node) {
	node.version++;
	producerIncrementEpoch();
	producerNotifyConsumers(node);
}
/**
* @license
* Copyright 2024 Bloomberg Finance L.P.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
const NODE = Symbol("node");
var Signal;
((Signal2) => {
	var _a, _brand, _b, _brand2;
	class State {
		constructor(initialValue, options = {}) {
			__privateAdd(this, _brand);
			__publicField(this, _a);
			const node = createSignal(initialValue)[SIGNAL];
			this[NODE] = node;
			node.wrapper = this;
			if (options) {
				const equals = options.equals;
				if (equals) node.equal = equals;
				node.watched = options[Signal2.subtle.watched];
				node.unwatched = options[Signal2.subtle.unwatched];
			}
		}
		get() {
			if (!(0, Signal2.isState)(this)) throw new TypeError("Wrong receiver type for Signal.State.prototype.get");
			return signalGetFn.call(this[NODE]);
		}
		set(newValue) {
			if (!(0, Signal2.isState)(this)) throw new TypeError("Wrong receiver type for Signal.State.prototype.set");
			if (isInNotificationPhase()) throw new Error("Writes to signals not permitted during Watcher callback");
			const ref = this[NODE];
			signalSetFn(ref, newValue);
		}
	}
	_a = NODE;
	_brand = /* @__PURE__ */ new WeakSet();
	Signal2.isState = (s) => typeof s === "object" && __privateIn(_brand, s);
	Signal2.State = State;
	class Computed {
		constructor(computation, options) {
			__privateAdd(this, _brand2);
			__publicField(this, _b);
			const node = createComputed(computation)[SIGNAL];
			node.consumerAllowSignalWrites = true;
			this[NODE] = node;
			node.wrapper = this;
			if (options) {
				const equals = options.equals;
				if (equals) node.equal = equals;
				node.watched = options[Signal2.subtle.watched];
				node.unwatched = options[Signal2.subtle.unwatched];
			}
		}
		get() {
			if (!(0, Signal2.isComputed)(this)) throw new TypeError("Wrong receiver type for Signal.Computed.prototype.get");
			return computedGet(this[NODE]);
		}
	}
	_b = NODE;
	_brand2 = /* @__PURE__ */ new WeakSet();
	Signal2.isComputed = (c) => typeof c === "object" && __privateIn(_brand2, c);
	Signal2.Computed = Computed;
	((subtle2) => {
		var _a2, _brand3, _assertSignals, assertSignals_fn;
		function untrack(cb) {
			let output;
			let prevActiveConsumer = null;
			try {
				prevActiveConsumer = setActiveConsumer(null);
				output = cb();
			} finally {
				setActiveConsumer(prevActiveConsumer);
			}
			return output;
		}
		subtle2.untrack = untrack;
		function introspectSources(sink) {
			var _a3;
			if (!(0, Signal2.isComputed)(sink) && !(0, Signal2.isWatcher)(sink)) throw new TypeError("Called introspectSources without a Computed or Watcher argument");
			return ((_a3 = sink[NODE].producerNode) == null ? void 0 : _a3.map((n) => n.wrapper)) ?? [];
		}
		subtle2.introspectSources = introspectSources;
		function introspectSinks(signal) {
			var _a3;
			if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) throw new TypeError("Called introspectSinks without a Signal argument");
			return ((_a3 = signal[NODE].liveConsumerNode) == null ? void 0 : _a3.map((n) => n.wrapper)) ?? [];
		}
		subtle2.introspectSinks = introspectSinks;
		function hasSinks(signal) {
			if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) throw new TypeError("Called hasSinks without a Signal argument");
			const liveConsumerNode = signal[NODE].liveConsumerNode;
			if (!liveConsumerNode) return false;
			return liveConsumerNode.length > 0;
		}
		subtle2.hasSinks = hasSinks;
		function hasSources(signal) {
			if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isWatcher)(signal)) throw new TypeError("Called hasSources without a Computed or Watcher argument");
			const producerNode = signal[NODE].producerNode;
			if (!producerNode) return false;
			return producerNode.length > 0;
		}
		subtle2.hasSources = hasSources;
		class Watcher {
			constructor(notify) {
				__privateAdd(this, _brand3);
				__privateAdd(this, _assertSignals);
				__publicField(this, _a2);
				let node = Object.create(REACTIVE_NODE);
				node.wrapper = this;
				node.consumerMarkedDirty = notify;
				node.consumerIsAlwaysLive = true;
				node.consumerAllowSignalWrites = false;
				node.producerNode = [];
				this[NODE] = node;
			}
			watch(...signals) {
				if (!(0, Signal2.isWatcher)(this)) throw new TypeError("Called unwatch without Watcher receiver");
				__privateMethod(this, _assertSignals, assertSignals_fn).call(this, signals);
				const node = this[NODE];
				node.dirty = false;
				const prev = setActiveConsumer(node);
				for (const signal of signals) producerAccessed(signal[NODE]);
				setActiveConsumer(prev);
			}
			unwatch(...signals) {
				if (!(0, Signal2.isWatcher)(this)) throw new TypeError("Called unwatch without Watcher receiver");
				__privateMethod(this, _assertSignals, assertSignals_fn).call(this, signals);
				const node = this[NODE];
				assertConsumerNode(node);
				for (let i = node.producerNode.length - 1; i >= 0; i--) if (signals.includes(node.producerNode[i].wrapper)) {
					producerRemoveLiveConsumerAtIndex(node.producerNode[i], node.producerIndexOfThis[i]);
					const lastIdx = node.producerNode.length - 1;
					node.producerNode[i] = node.producerNode[lastIdx];
					node.producerIndexOfThis[i] = node.producerIndexOfThis[lastIdx];
					node.producerNode.length--;
					node.producerIndexOfThis.length--;
					node.nextProducerIndex--;
					if (i < node.producerNode.length) {
						const idxConsumer = node.producerIndexOfThis[i];
						const producer = node.producerNode[i];
						assertProducerNode(producer);
						producer.liveConsumerIndexOfThis[idxConsumer] = i;
					}
				}
			}
			getPending() {
				if (!(0, Signal2.isWatcher)(this)) throw new TypeError("Called getPending without Watcher receiver");
				return this[NODE].producerNode.filter((n) => n.dirty).map((n) => n.wrapper);
			}
		}
		_a2 = NODE;
		_brand3 = /* @__PURE__ */ new WeakSet();
		_assertSignals = /* @__PURE__ */ new WeakSet();
		assertSignals_fn = function(signals) {
			for (const signal of signals) if (!(0, Signal2.isComputed)(signal) && !(0, Signal2.isState)(signal)) throw new TypeError("Called watch/unwatch without a Computed or State argument");
		};
		Signal2.isWatcher = (w) => __privateIn(_brand3, w);
		subtle2.Watcher = Watcher;
		function currentComputed() {
			var _a3;
			return (_a3 = getActiveConsumer()) == null ? void 0 : _a3.wrapper;
		}
		subtle2.currentComputed = currentComputed;
		subtle2.watched = Symbol("watched");
		subtle2.unwatched = Symbol("unwatched");
	})(Signal2.subtle || (Signal2.subtle = {}));
})(Signal || (Signal = {}));

//#endregion
//#region ../spf/dist/dev/core/signals/effect.js
const pending = /* @__PURE__ */ new Set();
const watcher = new Signal.subtle.Watcher(() => {
	queueMicrotask(runPending);
});
function runPending() {
	for (const c of watcher.getPending()) pending.add(c);
	watcher.watch();
	for (const c of pending) {
		pending.delete(c);
		c.get();
		revalidateSources(c);
	}
}
/**
* Recover an effect that wrote a signal one of its own dependencies reads.
*
* When an effect body writes a signal that an intermediate computed in its own dependency graph consumes (e.g. a
* track-selection effect writing the selection slot a candidate-set computed consults), the graph can't tell the
* effect: the write marks the intermediate dirty, but the effect is the in-flight consumer, so no watcher notification
* fires — and the effect finishes the run _clean but stale_. Worse, every later external change routed through that
* intermediate is deduped against its standing dirty flag, so the effect never hears about those either (the
* lost-wakeup).
*
* Pulling each source once after the run closes the hole: a dirtied intermediate recomputes and its dirty flag clears,
* so the _next_ change through it propagates and wakes the effect normally. The guarantee is liveness, not immediacy —
* the effect is deliberately not re-run just because it wrote into its own graph (that would double-run every writing
* effect); it catches up on the next genuine change. Sources that are clean, or whose recomputation is equals-gated to
* the same value, cost a cached read and notify no one.
*/
function revalidateSources(c) {
	for (const source of Signal.subtle.introspectSources(c)) source.get();
}
/**
* Run a side effect whenever its signal dependencies change.
*
* Executes immediately (synchronous initial run), then re-runs on the next microtask after any dependency changes. If
* the callback returns a function, it is called before each re-run and when the effect is stopped — the same cleanup
* contract as Preact Signals, Maverick Signals, and Svelte 5 $effect.
*
* Returns a cleanup function that stops the effect.
*/
function effect(fn) {
	let cleanup;
	const c = new Signal.Computed(() => {
		if (typeof cleanup === "function") cleanup();
		cleanup = fn();
	});
	watcher.watch(c);
	c.get();
	revalidateSources(c);
	return () => {
		watcher.unwatch(c);
		if (typeof cleanup === "function") cleanup();
	};
}

//#endregion
//#region ../spf/dist/dev/media/errors.js
/** SVTA 1 [Media Content] 004 — the video is in a format we can't play (e.g. an MPEG-TS container). */
const SVTA_UNSUPPORTED_VIDEO_FORMAT = 1004;
/** SVTA 1 [Media Content] 005 — the audio counterpart of {@link SVTA_UNSUPPORTED_VIDEO_FORMAT}. */
const SVTA_UNSUPPORTED_AUDIO_FORMAT = 1005;
/**
* SVTA 4 [Content Protection] 008 — unsupported or unavailable DRM system. Used for "this source is encrypted and we
* have no decryption pipeline," which is detection, not a license failure.
*/
const SVTA_UNSUPPORTED_DRM_SYSTEM = 4008;
/**
* SVTA 4 [Content Protection] 004 — bad license request. Used when the license server could not be reached or refused
* the CDM's message: from the client there is one observable ("the exchange failed at the server"), and which side was
* at fault lives in `data`, not the code.
*/
const SVTA_BAD_LICENSE_REQUEST = 4004;
/**
* SVTA 4 [Content Protection] 010 — DRM initialization error. The key system negotiated but MediaKeys could not be
* created or attached, so decryption never became possible for this source.
*/
const SVTA_DRM_INITIALIZATION_ERROR = 4010;
/**
* SVTA 4 [Content Protection] 013 — DRM certificate error. The server (application) certificate could not be fetched or
* was rejected by the CDM; without it FairPlay can never produce a license request.
*/
const SVTA_DRM_CERTIFICATE_ERROR = 4013;
/**
* SVTA 4 [Content Protection] 016 — DRM license response rejected. The server answered **200 with a license body** and
* the CDM refused it (`MediaKeySession.update()` threw). Not a server-side rejection: a non-2xx license response throws
* inside `fetchDrm` and reports {@link SVTA_BAD_LICENSE_REQUEST} instead. So this code proves the license URL,
* credentials, and request shaping all worked, and narrows the fault to the license's own contents — a security-level
* mismatch between the challenge and the issued license, for one.
*/
const SVTA_DRM_LICENSE_RESPONSE_REJECTED = 4016;
/**
* SVTA 4 [Content Protection] 021 — failed to generate DRM license request. The CDM could not produce a license request
* from the init data (`MediaKeySession.generateRequest()` threw); nothing ever reached the server.
*/
const SVTA_DRM_LICENSE_REQUEST_GENERATION_FAILED = 4021;
/**
* SVTA 4 [Content Protection] 003 — license expired. A key's status transitioned to `expired` (short license windows,
* long sessions). Browsers queue decode on a missing key, so without this cause the expiry presents as a silent
* mid-playback stall; reported so the stall is diagnosable. Re-requesting is a policy decision that lives downstream.
*/
const SVTA_LICENSE_EXPIRED = 4003;
/**
* SVTA 4 [Content Protection] 007 — insufficient output protection. A key went `output-restricted`: the CDM refuses to
* decode onto the current output path (HDCP downgrade, an external display, screen mirroring). Presents as a black
* frame or stall with no media error — nothing else in the pipeline observes the restriction.
*/
const SVTA_INSUFFICIENT_OUTPUT_PROTECTION = 4007;
/**
* SVTA 4 [Content Protection] 014 — DRM session error. A key reported `internal-error`: the CDM failed in a way it does
* not attribute (its own defect, a corrupted key store). Reported for diagnosability; recovery is downstream.
*/
const SVTA_DRM_SESSION_ERROR = 4014;
/**
* SVTA 2 [Playback] 011 — no video track the environment can play.
*
* Covers both ways a composition can end up with nothing to select: renditions that existed and were all excluded as
* unplayable, and — where the composition composes `reportAbsentTrackType` to say it needs the type — a source carrying
* none to begin with. Deliberately one code for both, because they are the same answer to a viewer, and because the
* alternative is a code the SVTA spec doesn't define. Whether an absent type is a failure is the composition's to
* state, which is why it opts in rather than being read off the source.
*/
const SVTA_NO_SUPPORTED_VIDEO_TRACK = 2011;
/** SVTA 2 [Playback] 012 — the audio counterpart of {@link SVTA_NO_SUPPORTED_VIDEO_TRACK}. */
const SVTA_NO_SUPPORTED_AUDIO_TRACK = 2012;
/**
* SVTA 99 [Custom] 001 — this engine has no pipeline for something the source requires, so the source is unplayable
* _here_ rather than broken.
*
* Custom rather than standard because the standard codes available describe either narrower or wider things. The causes
* (1004/1005 unsupported format, 4008 unsupported DRM) say what one rendition hit; the verdicts (2011/2012 no supported
* track) say a type emptied without saying why it's unfixable. And 2039 "Manifest feature unsupported" covers features
* that are unsupported but still _playable_ — LL-HLS degrading to standard live is a 2039 — so overloading it for a
* fatal condition would make it useless for the notices it belongs on.
*
* Index `001`: the spec defines only `99000` (Unknown) for the custom category and leaves the rest to the publisher, so
* this is the first code we define. Later custom codes follow the `99CII` convention (see
* {@link SVTA_UNSUPPORTED_ENCRYPTION_METHOD}); this cross-category "can't play this" surface stays in the general
* `990XX` bucket.
*
* Five digits, and deliberately not special-cased anywhere: {@link svtaCategory} and {@link svtaIndex} decompose it
* correctly by arithmetic alone, because every standard category is below `8000` and custom starts at `99000`.
*/
const SVTA_UNSUPPORTED_PLAYBACK_FEATURE = 99001;
/**
* SVTA 99 [Custom] 408 — the source is encrypted with a scheme this engine has no decryptor for, and it is **not** a
* DRM key system: HLS `METHOD=AES-128` / `SAMPLE-AES` under the `identity` keyformat (clear-key over HTTP). The non-DRM
* counterpart of {@link SVTA_UNSUPPORTED_DRM_SYSTEM} — reported so the diagnosis names the real gap, an unsupported
* encryption method, rather than blaming a DRM system that was never involved. `data` carries the HLS `method` and
* `keyFormat`. Actually decrypting such content is a deferred feature — see
* `internal/design/spf/features/clear-key-aes.md`.
*
* **The `99CII` custom-code convention.** SVTA 2070 leaves the whole `99xxx` category to the publisher (defining only
* `99000` Unknown). Rather than number custom codes sequentially, they mirror the standard taxonomy in their index
* digits: `99` + `C` (the standard category this parallels) + `II` (the index within it). So a content-protection
* (category 4) custom cause is `994II`, and `99408` deliberately echoes standard `4008` as its non-DRM sibling.
* {@link svtaCategory} / {@link svtaIndex} still decompose it by arithmetic (category `99`, index `408`); the parallel
* is a reading convention, not something the math needs. General, cross-category custom codes stay in `990XX`.
*/
const SVTA_UNSUPPORTED_ENCRYPTION_METHOD = 99408;

//#endregion
//#region ../spf/dist/dev/core/signals/primitives.js
/** Read a signal value without tracking it as a dependency. */
const untrack = Signal.subtle.untrack;
/**
* Read a signal's current value without tracking it as a dependency. Sugar for `untrack(() => signal.get())` to reduce
* boilerplate at single-read sites. Structurally typed to accept any signal-like (Signal, Computed, ReadonlySignal).
*
* Accepts an optional `transform` to project the value in the same call; the default is the identity function so the
* single-arg form returns `T` unchanged.
*
* @example
*   const value = peek(someSignal);
*   const id = peek(presentationSignal, (p) => p?.id);
*/
function peek(source, transform = (v) => v) {
	return untrack(() => transform(source.get()));
}
/** Create a writable reactive value. */
function signal(initialValue, options) {
	return new Signal.State(initialValue, options);
}
/** Create a computed reactive value. */
function computed(fn, options) {
	return new Signal.Computed(fn, options);
}
function update(signal, updater) {
	const current = untrack(() => signal.get());
	if (typeof updater === "function") signal.set(updater(current));
	else signal.set({
		...current,
		...updater
	});
}

//#endregion
//#region ../spf/dist/dev/core/composition/create-composition.js
/**
* Create a composition from a set of behaviors.
*
* Composition unions the behaviors' declared `stateKeys` / `contextKeys` to know which signals to create. Each signal
* is seeded from `initialState` / `initialContext` when supplied, defaulting to `undefined`. Behaviors are responsible
* for writing their own slots once their preconditions are met.
*
* Cross-behavior type conflicts (e.g. two behaviors disagreeing on a field's type) surface as a compose-time type error
* via `ValidateComposition`.
*
* @example
*   ```ts
*   const composition = createComposition([resolvePresentation, switchVideoTrack], {
*   config: { parsePresentation: parseMultivariantPlaylist, initialBandwidth: 2_000_000 },
*   initialState: { bandwidthState: { fastEstimate: 0, ... } },
*   });
*   ```;
*/
/**
* Create a typed signal map for a given set of keys, seeded from an optional partial initial value.
*
* Pipeline: `Set` dedupes the iterable (insertion order preserved, so first occurrence wins) → `Object.fromEntries`
* materializes one `signal()` per unique key, seeded from `initial[key]` or `undefined`.
*
* Per-key value types live in TypeScript only — at runtime every signal is `Signal<unknown>`. The boundary cast at the
* return narrows the wide `Record<PropertyKey, Signal<unknown>>` shape to the caller's expected per-key types from
* `S`.
*
* Used by `createComposition` to derive engine state/context maps from the union of behaviors' declared `stateKeys` /
* `contextKeys`.
*
* @example
*   ```ts
*   interface State {
*     count?: number;
*     label?: string;
*   }
*   const state = buildSignalMap<State>(['count', 'label'], { count: 5 });
*   state.count.get(); // 5
*   state.label.get(); // undefined
*   ```;
*/
function buildSignalMap(keys, initial) {
	const init = initial;
	const uniqueKeys = new Set(keys);
	return Object.fromEntries([...uniqueKeys].map((key) => [key, signal(init[key])]));
}
/**
* `config` over `defaultConfig`: every key of `config`, plus each default whose key `config` leaves out or sets to
* `undefined`. Without defaults, `config` passes through as the same object.
*/
function mergeDefaultConfig(config, defaultConfig) {
	if (!defaultConfig) return config;
	return {
		...config,
		...defaults(config, defaultConfig)
	};
}
/**
* A create function for one fixed list of behaviors with its defaults: what an engine module exports as its
* `createEngine`. The returned function checks each call's config the way {@link createComposition} does, at its own
* call site, so a module needs no type plumbing of its own.
*
* @example
*   ```ts
*   export const createEngine = defineCompositionFactory(behaviors, { defaultConfig, initialState });
*   ```;
*/
function defineCompositionFactory(behaviors, options = {}) {
	const validBehaviors = validBehaviorList(behaviors);
	return (config) => compose(validBehaviors, {
		...options,
		config
	});
}
/**
* `ValidateComposition<Behaviors>` is `[...Behaviors]` on success and an error string on conflict. A caller only runs
* when its call typechecks (the success case), so treating the value as the behavior list is sound.
*/
function validBehaviorList(behaviors) {
	return behaviors;
}
/** The runtime half of {@link createComposition} and {@link defineCompositionFactory}, typed by its caller. */
function compose(behaviors, options) {
	const state = buildSignalMap(behaviors.flatMap((b) => b.stateKeys), options?.initialState ?? {});
	const context = buildSignalMap(behaviors.flatMap((b) => b.contextKeys), options?.initialContext ?? {});
	const deps = {
		state,
		context,
		config: mergeDefaultConfig(options?.config ?? {}, options?.defaultConfig)
	};
	const cleanups = behaviors.map((behavior) => behavior.setup(deps));
	return {
		state,
		context,
		async destroy() {
			const results = [];
			for (const cleanup of cleanups) {
				if (cleanup == null) continue;
				if (typeof cleanup === "function") results.push(cleanup());
				else if ("destroy" in cleanup) results.push(cleanup.destroy());
			}
			await Promise.all(results);
			for (const sig of Object.values(state)) sig.set(void 0);
			for (const sig of Object.values(context)) sig.set(void 0);
		}
	};
}

//#endregion
//#region ../spf/dist/dev/core/composition/define-feature.js
/**
* Define a feature. An identity function: it exists so the behavior list keeps its tuple type, which composition needs
* to derive the state, context, and config types.
*
* `defaultConfig` may cover config keys that another feature's behaviors read; the composition checks each
* `defaultConfig` value's type against the behavior that reads it.
*
* @example
*   ```ts
*   export const chaptersFeature = defineFeature({ behaviors: [loadChapters] });
*   ```;
*/
function defineFeature(feature) {
	return feature;
}
/**
* Flatten features into one behavior list, one `defaultConfig`, and one `initialState`, ready for `createComposition`
* or `defineCompositionFactory`. The feature list is the composition order.
*
* Features may share behaviors and keys. A behavior listed by several features is composed once, at its first position.
* A `defaultConfig` or `initialState` key given by several features takes the last feature's value, so a feature listed
* later can refine what an earlier one sets: DRM's playability probe replaces the plain one the video feature sets.
*
* The returned behavior type still lists a shared behavior once per feature. That's harmless: composition intersects
* the behaviors' types, and a type intersected with itself is unchanged.
*
* @example
*   ```ts
*   const { behaviors, defaultConfig, initialState } = flattenFeatures([hlsLoadingFeature, mediaSourceFeature, videoFeature]);
*   const composition = createComposition(behaviors, { defaultConfig, initialState, config });
*   ```;
*/
function flattenFeatures(features) {
	return {
		behaviors: [...new Set(features.flatMap((feature) => feature.behaviors))],
		defaultConfig: mergeFeatureValues(features, "defaultConfig"),
		initialState: mergeFeatureValues(features, "initialState")
	};
}
function mergeFeatureValues(features, key) {
	return Object.assign({}, ...features.map((feature) => feature[key] ?? {}));
}

//#endregion
//#region ../spf/dist/dev/media/dom/mse/mediasource-setup.js
/**
* MediaSource Setup
*
* Utilities for creating and configuring MediaSource/ManagedMediaSource for MSE (Media Source Extensions) playback.
*
* Global ManagedMediaSource types are defined in ./mediasource.d.ts
*/
/** Check if MediaSource API is supported. */
function supportsMediaSource() {
	return typeof MediaSource !== "undefined";
}
/**
* Check if ManagedMediaSource API is supported. ManagedMediaSource is a newer Safari API with better lifecycle
* management.
*/
function supportsManagedMediaSource() {
	return typeof ManagedMediaSource !== "undefined";
}
/**
* Create a MediaSource or ManagedMediaSource instance.
*
* @example
*   const mediaSource = createMediaSource();
*   const mediaElement = document.querySelector('video');
*   attachMediaSource(mediaSource, mediaElement);
*
* @param options - Creation options
* @returns A MediaSource or ManagedMediaSource instance
* @throws Error if no MediaSource API is available
*/
function createMediaSource(options = {}) {
	const { preferManaged = false } = options;
	if (preferManaged && supportsManagedMediaSource()) return new ManagedMediaSource();
	if (supportsMediaSource()) return new MediaSource();
	throw new Error("MediaSource API is not supported");
}
/**
* Attach a MediaSource to an HTMLMediaElement via the `src` attribute.
*
* The object URL on the `src` attribute is the industry-hardened MSE attach across the browser matrix, and works for
* ManagedMediaSource too (`srcObject` buys nothing over it and forfeits the uniform URL lifecycle).
*
* @example
*   const mediaSource = createMediaSource();
*   const { detach } = attachMediaSource(mediaSource, videoElement);
*   // Use mediaSource...
*   // Later, to clean up:
*   detach();
*
* @param mediaSource - The MediaSource to attach
* @param mediaElement - The media element to attach to
* @returns Object with URL and detach function
*/
function attachMediaSource(mediaSource, mediaElement) {
	if (supportsManagedMediaSource() && mediaSource instanceof ManagedMediaSource) mediaElement.disableRemotePlayback = true;
	const url = URL.createObjectURL(mediaSource);
	mediaElement.src = url;
	const detach = ({ deferReset } = {}) => {
		mediaElement.removeAttribute("src");
		scheduleReset(mediaSource, mediaElement, url, deferReset);
		URL.revokeObjectURL(url);
	};
	return {
		url,
		detach
	};
}
/**
* Attach a MediaSource as a `<source>` child element.
*
* The object URL rides a `<source type="video/mp4">` inserted as the element's FIRST child (any bare `src` attribute is
* dropped; `load()` re-runs resource selection). Unlike `srcObject`/`src` — which commit the element to the MSE
* resource and ignore every `<source>` child — this keeps sibling `<source>` alternatives part of resource selection,
* so a composition can offer the element a natively-playable alternative next to MSE. Canonical consumer:
* `setupAirPlay`'s native-HLS fallback source, wired through `setupMediaSource`'s `attachMediaSource` config
* (https://webkit.org/blog/15036/how-to-use-media-source-extensions-with-airplay/).
*/
function attachMediaSourceAsSourceElement(mediaSource, mediaElement) {
	if (supportsManagedMediaSource() && mediaSource instanceof ManagedMediaSource) mediaElement.disableRemotePlayback = true;
	const url = URL.createObjectURL(mediaSource);
	const sourceEl = document.createElement("source");
	sourceEl.type = "video/mp4";
	sourceEl.src = url;
	mediaElement.removeAttribute("src");
	mediaElement.prepend(sourceEl);
	mediaElement.load();
	const detach = ({ deferReset } = {}) => {
		sourceEl.remove();
		scheduleReset(mediaSource, mediaElement, url, deferReset);
		URL.revokeObjectURL(url);
	};
	return {
		url,
		detach
	};
}
/**
* Detach's `load()` reset, applied only when tearing down an **unclosed** attachment the element is still committed to:
*
* - **Closed MediaSource**: skip. The attachment is already dead, and the element deliberately keeps whatever playback
*   state it carries for whatever attaches next — that attach's own `load()` performs the reset.
* - **Element moved to another resource**: skip — resetting would rip that resource out from under its owner.
*/
function resetIfOwnedAndNotClosed(mediaSource, mediaElement, url) {
	if (mediaSource.readyState !== "closed" && mediaElement.currentSrc === url) mediaElement.load();
}
/**
* Run the reset now, or on the next microtask when the caller has sibling `<source>` owners that clear on an effect
* (see {@link DetachOptions.deferReset}).
*
* Deferring is safe because removing this attachment's own source does not by itself re-run resource selection: the
* element stays committed to the object URL until something calls `load()`, so nothing starts playing in the gap.
*/
function scheduleReset(mediaSource, mediaElement, url, deferReset) {
	if (deferReset) {
		queueMicrotask(() => resetIfOwnedAndNotClosed(mediaSource, mediaElement, url));
		return;
	}
	resetIfOwnedAndNotClosed(mediaSource, mediaElement, url);
}
/**
* Create a SourceBuffer on a MediaSource.
*
* @example
*   const buffer = createSourceBuffer(mediaSource, 'video/mp4; codecs="avc1.42E01E"');
*
* @param mediaSource - The MediaSource (must be in 'open' state)
* @param mimeCodec - MIME type with codecs (e.g., 'video/mp4; codecs="avc1.42E01E"')
* @returns The created SourceBuffer
* @throws Error if MediaSource is not open or codec is unsupported
*/
function createSourceBuffer(mediaSource, mimeCodec) {
	if (mediaSource.readyState !== "open") throw new Error("MediaSource is not open");
	if (!isCodecSupported(mimeCodec)) throw new Error(`Codec not supported: ${mimeCodec}`);
	return mediaSource.addSourceBuffer(mimeCodec);
}
/**
* Check if a codec is supported.
*
* @example
*   if (isCodecSupported('video/mp4; codecs="avc1.42E01E"')) {
*     // Create source buffer
*   }
*
* @param mimeCodec - MIME type with codecs string
* @returns True if the codec is supported
*/
function isCodecSupported(mimeCodec) {
	if (supportsMediaSource()) return MediaSource.isTypeSupported(mimeCodec);
	if (supportsManagedMediaSource()) return ManagedMediaSource.isTypeSupported(mimeCodec);
	return false;
}
/**
* Observe `mediaSource.readyState` changes via DOM events.
*
* Listens to `sourceopen`, `sourceended`, and `sourceclose` and invokes `onChange` with the current `readyState` after
* each event. Listeners are automatically removed when `abortSignal` is aborted.
*
* @example
*   const controller = new AbortController();
*   onMediaSourceReadyStateChange(mediaSource, controller.signal, (state) => {
*   if (state === 'open') { ... }
*   });
*   // Later: controller.abort();
*
* @param mediaSource - The MediaSource to observe
* @param abortSignal - AbortSignal that controls listener lifetime
* @param onChange - Called with the current readyState after each change
*/
function onMediaSourceReadyStateChange(mediaSource, abortSignal, onChange) {
	const update = () => onChange(mediaSource.readyState);
	const options = { signal: abortSignal };
	mediaSource.addEventListener("sourceopen", update, options);
	mediaSource.addEventListener("sourceended", update, options);
	mediaSource.addEventListener("sourceclose", update, options);
}
/**
* Wait until `mediaSource.readyState` transitions away from `'closed'` (the next
* `sourceopen`/`sourceended`/`sourceclose` event), or until `signal` aborts — whichever fires first.
*
* Resolves immediately when `readyState` is already `'open'` or `'ended'` (no further transition is coming, so there's
* nothing to wait for). The caller is expected to re-check `readyState` after the await to distinguish `'open'` from
* terminal states.
*
* Companion to `onMediaSourceReadyStateChange` for one-shot use in async sequences (e.g., a behavior's reactor entry
* that needs to wait for the MediaSource to attach before performing a spec-conforming mutation).
*
* @example
*   await waitForMediaSourceOpen(mediaSource, signal);
*   if (signal.aborted || mediaSource.readyState !== 'open') return;
*   // safe to perform 'open'-state-only work
*/
function waitForMediaSourceOpen(mediaSource, signal) {
	if (signal.aborted) return Promise.resolve();
	if (mediaSource.readyState !== "closed") return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => resolve();
		const options = {
			once: true,
			signal
		};
		mediaSource.addEventListener("sourceopen", done, options);
		mediaSource.addEventListener("sourceended", done, options);
		mediaSource.addEventListener("sourceclose", done, options);
		signal.addEventListener("abort", done, { once: true });
	});
}

//#endregion
//#region ../spf/dist/dev/core/composition/define-behavior.js
function defineBehavior(behavior) {
	return behavior;
}

//#endregion
//#region ../spf/dist/dev/core/machine.js
/**
* Provisions the shared mechanics for all machine-like primitives: a snapshot signal, an untracked state reader, and a
* transition function.
*
* Internal — consumed by `createMachineActor` and `createMachineReactor`. Not part of the public API.
*/
function createMachineCore(initialSnapshot) {
	const snapshotSignal = signal(initialSnapshot);
	const getState = () => untrack(() => snapshotSignal.get().value);
	const transition = (to) => update(snapshotSignal, (current) => ({
		...current,
		value: to
	}));
	return {
		snapshotSignal,
		getState,
		transition
	};
}

//#endregion
//#region ../spf/dist/dev/core/reactors/create-machine-reactor.js
const toArray = (x) => x === void 0 ? [] : Array.isArray(x) ? x : [x];
/**
* Creates a reactive Reactor from a declarative definition.
*
* A Reactor is driven by subscriptions to external signals rather than imperative messages. Each state holds an array
* of effect functions — every element becomes one independent `effect()` call gated on that state, with its own
* dependency tracking and cleanup lifecycle.
*
* `'destroying'` and `'destroyed'` are always implicit terminal states. `destroy()` transitions through both in
* sequence: `'destroying'` first (for potential async teardown in a future extension), then immediately `'destroyed'`
* for the synchronous base case. Active effect cleanups fire via disposal.
*
* @example
*   const reactor = createMachineReactor({
*     initial: 'waiting',
*     monitor: () => (srcSignal.get() ? 'active' : 'waiting'),
*     states: {
*       active: {
*         // entry: runs once on state entry; fn body is automatically untracked.
*         entry: () => listen(el, 'play', handler),
*         // effects: re-runs whenever tracked signals change.
*         effects: () => {
*           currentTimeSignal.get();
*           return cleanup;
*         },
*       },
*       waiting: {},
*     },
*   });
*/
function createMachineReactor(def) {
	const { snapshotSignal, getState, transition } = createMachineCore({ value: def.initial });
	const effectDisposals = [];
	const wrapResult = (result) => {
		if (!result) return void 0;
		if (typeof result === "function") return result;
		return () => result.abort();
	};
	const untracked = (baseCall) => () => untrack(baseCall);
	const isTerminal = (snapshot) => snapshot.value === "destroying" || snapshot.value === "destroyed";
	const descriptors = [...toArray(def.monitor).map((fn) => ({
		fn: () => {
			const target = fn();
			if (target !== getState()) transition(target);
		},
		shouldSkip: isTerminal
	})), ...Object.entries(def.states).flatMap(([state, stateDef]) => {
		const isNotState = (snapshot) => snapshot.value !== state;
		return [...toArray(stateDef.entry).map((fn) => ({
			fn,
			shouldSkip: isNotState,
			toFnCall: untracked
		})), ...toArray(stateDef.effects).map((fn) => ({
			fn,
			shouldSkip: isNotState
		}))];
	})];
	const toEffect = ({ fn, shouldSkip, toFnCall = (baseCall) => baseCall }) => effect(() => {
		if (shouldSkip(snapshotSignal.get())) return;
		const baseCall = () => fn();
		return wrapResult(toFnCall(baseCall)());
	});
	effectDisposals.push(...descriptors.map(toEffect));
	return {
		get snapshot() {
			return snapshotSignal;
		},
		destroy() {
			const state = getState();
			if (state === "destroying" || state === "destroyed") return;
			transition("destroying");
			transition("destroyed");
			for (const dispose of effectDisposals) dispose();
		}
	};
}

//#endregion
//#region ../spf/dist/dev/media/types/index.js
/**
* Floating-point tolerance for matching segments by `startTime`. Two segments are considered the same position when
* `Math.abs(a.startTime - b.startTime) < SEGMENT_TIME_EPSILON`. Used by the source-buffer dedup and segment-loader
* quality-aware filter to tolerate sub-millisecond drift in segment timestamps across multiple playlists / quality
* levels.
*/
const SEGMENT_TIME_EPSILON = 1e-4;
/** Key under `Ham.metadata` where {@link MediaPlaylistMetadata} is stored. */
const MEDIA_PLAYLIST_METADATA_KEY = "mediaPlaylist";
/** Typed read of the media-playlist metadata stashed in `ham.metadata`. */
function getMediaPlaylistMetadata(ham) {
	return ham.metadata?.[MEDIA_PLAYLIST_METADATA_KEY];
}
/** Key under `Ham.metadata` where {@link MultivariantPlaylistMetadata} is stored. */
const MULTIVARIANT_PLAYLIST_METADATA_KEY = "multivariantPlaylist";
/** Typed read of the multivariant-playlist metadata stashed in `ham.metadata`. */
function getMultivariantPlaylistMetadata(ham) {
	return ham.metadata?.[MULTIVARIANT_PLAYLIST_METADATA_KEY];
}
/**
* The presentation's `#EXT-X-SESSION-DATA` entries, optionally narrowed to one `DATA-ID`. Empty when the playlist
* carried none, so consumers need no presence check.
*/
function getSessionData(ham, dataId) {
	const entries = getMultivariantPlaylistMetadata(ham)?.sessionData ?? [];
	return dataId === void 0 ? entries : entries.filter((entry) => entry.dataId === dataId);
}
/**
* Derive {@link StreamType} from a media playlist's metadata. Per the model, only `#EXT-X-PLAYLIST-TYPE:VOD` marks
* on-demand; everything else (EVENT, or the tag absent) is live — completeness (`endList`) never factors in.
*/
function deriveStreamType(metadata) {
	return metadata?.playlistType === "VOD" ? "on-demand" : "live";
}
function isResolvedTrack(track) {
	return "segments" in track;
}
/** Check if a presentation has duration (at least one track resolved). Narrows type to include required duration. */
function hasPresentationDuration(presentation) {
	return presentation.duration !== void 0;
}
/**
* Narrows a `MaybeResolvedPresentation` to a fully resolved `Presentation`.
*
* A presentation is resolved once `resolvePresentation` has parsed the manifest and populated both `id` and
* `selectionSets`. Both must be present — a partial value with only one of them isn't usable, and letting it through
* would have downstream behaviors crash when they access `selectionSets`.
*/
function isResolvedPresentation(presentation) {
	return presentation !== void 0 && presentation.id !== void 0 && presentation.selectionSets !== void 0;
}

//#endregion
//#region ../spf/dist/dev/media/buffer/forward-buffer.js
/**
* Forward Buffer Strategy (Simple)
*
* Determines which segments to load for forward buffer management. V1 uses simple fixed-duration strategy (buffer N
* seconds ahead).
*/
/**
* Merge intervals into sorted, disjoint ranges; touching or overlapping ranges (gap ≤ `epsilon`) are joined.
* Empty/inverted ranges are dropped.
*/
function mergeTimeRanges(ranges, epsilon = SEGMENT_TIME_EPSILON) {
	const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
	const merged = [];
	for (const r of sorted) {
		const last = merged[merged.length - 1];
		if (last && r.start <= last.end + epsilon) last.end = Math.max(last.end, r.end);
		else merged.push({
			start: r.start,
			end: r.end
		});
	}
	return merged;
}
/**
* Whether `[start, end)` is fully covered by the union of `merged` ranges, tolerating `epsilon` of overhang at each
* edge. `merged` must be disjoint and sorted (as returned by `mergeTimeRanges`), so full coverage means a single merged
* range contains the interval.
*/
function isTimeRangeCovered(start, end, merged, epsilon = SEGMENT_TIME_EPSILON) {
	return merged.some((r) => r.start <= start + epsilon && r.end >= end - epsilon);
}
/** Default forward buffer configuration. */
const DEFAULT_FORWARD_BUFFER_CONFIG = { bufferDuration: 30 };
/**
* Get segments that need to be loaded for forward buffer.
*
* Determines which segments to load to maintain target buffer duration. Handles discontiguous buffering (gaps after
* seeks).
*
* Algorithm: 1. Calculate target time: currentTime + bufferDuration 2. Find all segments in range [currentTime,
* targetTime) 3. Filter out segments already buffered at that time position 4. Return segments to load (fills gaps +
* extends to target)
*
* @example
*   // After seek: buffered [0-12, 18-30], playing at 7s
*   const toLoad = getSegmentsToLoad(segments, buffered, 7, { bufferDuration: 24 });
*   // Returns [seg-12, seg-30] (fills gap, extends to target 31s)
*
* @param segments - All available segments from playlist
* @param bufferedSegments - Segments already buffered (ordered by startTime)
* @param currentTime - Current playback position in seconds
* @param config - Optional forward buffer configuration
* @returns Array of segments to load (empty if buffer is sufficient)
*/
/**
* Calculate the start time from which to flush forward buffer content.
*
* Content that starts at or beyond `currentTime + bufferDuration` is no longer needed for the current playback position
* and should be removed from the SourceBuffer. This prevents unbounded accumulation of scattered SourceBuffer content
* after seeks, which can cause QuotaExceededError on long-form content.
*
* Returns `Infinity` when nothing needs flushing (no buffered segments exist beyond the threshold).
*
* @example
*   // Playing at 0s, buffered [0,6,12,18,24,30,36], bufferDuration=30
*   const flushStart = calculateForwardFlushPoint(segments, 0);
*   // Returns 30 — flush [30, Infinity), keep [0, 30)
*
* @param bufferedSegments - Segments currently tracked in the buffer model
* @param currentTime - Current playback position in seconds
* @param config - Optional forward buffer configuration
* @returns Start time to flush from (flush range: [flushStart, Infinity)),
* or Infinity if no flush is needed
*/
function calculateForwardFlushPoint(bufferedSegments, currentTime, config = DEFAULT_FORWARD_BUFFER_CONFIG) {
	if (bufferedSegments.length === 0) return Infinity;
	const threshold = currentTime + config.bufferDuration;
	const beyond = bufferedSegments.filter((seg) => seg.startTime >= threshold);
	if (beyond.length === 0) return Infinity;
	return Math.min(...beyond.map((seg) => seg.startTime));
}
/**
* Find the start time of the segment containing `currentTime` (or the last segment if `currentTime` is past the end).
* Returns `undefined` when `currentTime` is undefined or when no segment matches.
*
* Used to detect "meaningful currentTime change" — two times that map to the same segment start aren't a load-trigger;
* crossing a segment boundary is.
*/
function segmentStartForTime(currentTime, segments) {
	if (currentTime == null) return void 0;
	return segments?.find(({ startTime, duration }, i, all) => currentTime >= startTime && (currentTime < startTime + duration || i === all.length - 1))?.startTime;
}
function getSegmentsToLoad(segments, bufferedSegments, currentTime, config = DEFAULT_FORWARD_BUFFER_CONFIG) {
	if (segments.length === 0) return [];
	const targetTime = currentTime + config.bufferDuration;
	const bufferedStartTimes = new Set(bufferedSegments.map((seg) => seg.startTime));
	return segments.filter((seg, i) => {
		const segmentEnd = seg.startTime + seg.duration;
		const overlapsPlayhead = i === segments.length - 1 || segmentEnd > currentTime;
		const isInRange = seg.startTime < targetTime && overlapsPlayhead;
		const isNotBuffered = !bufferedStartTimes.has(seg.startTime);
		return isInRange && isNotBuffered;
	});
}

//#endregion
//#region ../spf/dist/dev/media/utils/tracks.js
/**
* Get the tracks of the given type from a presentation's first switching set.
*
* Returns `[]` when the presentation is unresolved, when no selection set of `type` exists, or when its first switching
* set is empty. Returned tracks may be partially resolved (URL only) or fully resolved (with segments) — callers narrow
* as needed.
*
* The "first switching set" assumption matches the rest of the codebase (HLS typically has one switching set per type);
* multi-group / multi-period support would generalize this.
*/
function getTracksByType(presentation, type) {
	return presentation.selectionSets?.find(({ type: t }) => t === type)?.switchingSets[0]?.tracks ?? [];
}
/**
* Every track across the given selection sets, every switching set included — unlike {@link getTracksByType}, which
* reads only the first switching set of one type. Takes the selection-set list rather than the presentation so a caller
* that orders the sets first (`getOrderedCdnIds`) walks them the same way. Tracks may be partially or fully resolved;
* callers narrow as needed.
*/
function getAllTracks(selectionSets) {
	const tracks = [];
	for (const selectionSet of selectionSets) for (const switchingSet of selectionSet.switchingSets) for (const track of switchingSet.tracks) tracks.push(track);
	return tracks;
}
/**
* Find a track of the given type and id within a presentation.
*
* Returns the matching track from the first switching set of the matching selection set, or `undefined` if either is
* missing. The returned track may be partially resolved (URL only) or fully resolved (with segments) — callers narrow
* as needed.
*/
function findTrack(presentation, type, trackId) {
	return getTracksByType(presentation, type).find(({ id }) => id === trackId);
}
/**
* Find a track by id across all selection sets in a presentation, without knowing its type up front. Used when the
* caller has a track id obtained from a downstream consumer (e.g. `SourceBufferActor.initTrackId`) and needs to locate
* the corresponding track in the presentation.
*
* Track ids are unique within a presentation per the HLS spec; the first match wins.
*/
function findTrackById(presentation, trackId) {
	for (const selectionSet of presentation.selectionSets ?? []) {
		const track = selectionSet.switchingSets[0]?.tracks.find(({ id }) => id === trackId);
		if (track) return track;
	}
}
/**
* Find a text track of the given id within a presentation and narrow it to the fully-resolved `TextTrack` shape
* (segments populated). Returns `undefined` if no track matches the id, the matching track isn't a text track, or it
* hasn't been resolved yet.
*
* The segments-non-empty check stays at the call site — a resolved track with zero segments is a valid state, distinct
* from "ready to load."
*/
function findResolvedTextTrack(presentation, trackId) {
	if (!presentation || !trackId) return void 0;
	const track = findTrack(presentation, "text", trackId);
	if (track?.type !== "text" || !isResolvedTrack(track)) return void 0;
	return track;
}
function findResolvedVideoTrack(presentation, trackId) {
	if (!presentation || !trackId) return void 0;
	const track = findTrack(presentation, "video", trackId);
	if (track?.type !== "video" || !isResolvedTrack(track)) return void 0;
	return track;
}
function findResolvedAudioTrack(presentation, trackId) {
	if (!presentation || !trackId) return void 0;
	const track = findTrack(presentation, "audio", trackId);
	if (track?.type !== "audio" || !isResolvedTrack(track)) return void 0;
	return track;
}
/**
* Whether a track carries a non-empty `codecs` array. Both partially- resolved and fully-resolved tracks may carry
* codecs — they come from the multivariant playlist's `EXT-X-STREAM-INF` line, not from the per-type media playlist —
* so this works at either resolution stage.
*
* `TextTrack` doesn't declare a `codecs` field; the `'codecs' in track` check narrows it out for the false branch.
*/
function hasCodecs(track) {
	return !!track && "codecs" in track && !!track.codecs?.length;
}
/**
* The family (RFC 6381 4CC) of one codec string: `'avc1.640028'` → `'avc1'`, `'mp4a.40.2'` → `'mp4a'`, dotless strings
* (`'ec-3'`) pass through whole. Lowercased so families compare regardless of manifest casing.
*
* The family is what a `SourceBuffer`'s bytestream is keyed on: renditions in one family swap via a new init segment,
* while crossing families needs `SourceBuffer.changeType()` (which SPF doesn't implement).
*/
function getCodecFamily(codec) {
	return codec.trim().split(".", 1)[0].toLowerCase();
}
/**
* The distinct codec families a track carries, or `undefined` when it carries no codecs (unknowable, per `hasCodecs` —
* not "none"). A demuxed rendition has one family; a muxed one (bipbop's `CODECS="hvc1…,mp4a…"`) has one per elementary
* stream.
*/
function getCodecFamilies(track) {
	if (!track.codecs?.length) return void 0;
	return [...new Set(track.codecs.map(getCodecFamily))];
}
/**
* A track's MIME codec string — `mimeType` plus its `codecs` — the form `MediaSource.isTypeSupported`,
* `addSourceBuffer` and EME's `contentType` all take. Works on partially-resolved tracks: both fields come from the
* multivariant playlist and are available before media-playlist resolution.
*
* The parameter is `Pick<Track, 'mimeType' | 'codecs'>` with `mimeType` required: a track without one has nothing to
* build from, and callers guard that before asking.
*
* @example
*   buildMimeCodec({ mimeType: 'video/mp4', codecs: ['avc1.42E01E'] });
*   // => 'video/mp4; codecs="avc1.42E01E"'
*/
function buildMimeCodec(track) {
	const codecString = track.codecs?.join(",") ?? "";
	return `${track.mimeType}; codecs="${codecString}"`;
}
/**
* The distinct MIME codec strings across a presentation's audio and video tracks, grouped by type. Includes unresolved
* tracks, since `CODECS` comes from the multivariant, and skips tracks with no `mimeType` or no codecs, which have
* nothing to build from. Text tracks carry no codecs and are excluded. An ABR ladder collapses to one entry per type.
*
* Today's consumer is key-system negotiation, which offers these as the capabilities a CDM is asked to support; nothing
* about the computation is specific to it.
*/
function mimeCodecsByType(presentation) {
	const video = /* @__PURE__ */ new Set();
	const audio = /* @__PURE__ */ new Set();
	for (const track of getAllTracks(presentation?.selectionSets ?? [])) {
		if (track.type !== "video" && track.type !== "audio") continue;
		if (!track.mimeType || !track.codecs?.length) continue;
		(track.type === "video" ? video : audio).add(buildMimeCodec({
			mimeType: track.mimeType,
			codecs: track.codecs
		}));
	}
	return {
		video: [...video],
		audio: [...audio]
	};
}
/**
* Set `mimeType` on every track of one `type` (immutably). Used to propagate a detected container across a type's
* renditions: an ABR ladder is the same content at different bitrates, so one rendition's container holds for all of
* them — capability probing + SourceBuffer setup then get the right MIME for the whole type from a single resolved
* media playlist, without fetching the rest.
*
* Scoped to one type on purpose: propagating _across_ audio/video would be wrong for mixed-container sources (e.g.
* muxed-TS video + raw-`.aac` audio) and races concurrent per-type resolution. Same-type writes are disjoint and safe.
* Idempotent — tracks already at `mimeType` are left as-is.
*
* **Assumes one container per type, which the HLS specs don't guarantee.** Apple's HLS Authoring Specification not only
* permits a mixed ladder, it produces one: §1.5 requires HEVC in fMP4, while §9.22 says a 192 kbit/s H.264 variant
* _packaged in a transport stream_ SHOULD be provided for cellular — so a conformant HEVC ladder with that fallback is
* necessarily mixed. RFC 8216 is silent too (§6.2.4 constrains variant _content_, not container).
*
* Where that happens, resolving the TS variant first relabels the whole type, capability probing prunes all of it, and
* a source whose fMP4 variants were fine reports as unplayable. Accepted because the current target is CMAF-compliant
* single-container delivery (plus Apple's official fMP4 example); revisit by narrowing the relabel to the resolved
* track, or gating propagation on config, if mixed ladders come into scope.
*/
function applyContainerMimeType(presentation, type, mimeType) {
	return {
		...presentation,
		selectionSets: presentation.selectionSets.map((selectionSet) => selectionSet.type === type ? {
			...selectionSet,
			switchingSets: selectionSet.switchingSets.map((switchingSet) => ({
				...switchingSet,
				tracks: switchingSet.tracks.map((track) => track.mimeType === mimeType ? track : {
					...track,
					mimeType
				})
			}))
		} : selectionSet)
	};
}
/** Updates a track within a presentation (immutably). Generic — works for video, audio, or text tracks. */
function updateTrackInPresentation(presentation, resolvedTrack) {
	const trackId = resolvedTrack.id;
	return {
		...presentation,
		selectionSets: presentation.selectionSets.map((selectionSet) => ({
			...selectionSet,
			switchingSets: selectionSet.switchingSets.map((switchingSet) => ({
				...switchingSet,
				tracks: switchingSet.tracks.map((track) => track.id === trackId ? resolvedTrack : track)
			}))
		}))
	};
}

//#endregion
//#region ../spf/dist/dev/playback/primitives/track-types.js
/**
* **Per-type config bundles for per-type behavior variants.**
*
* Each `*_TYPE_CONFIG` constant names the per-type slot keys that per-type-variant setup-shape helpers consume.
* Variants reference the shared constant at their `defineBehavior` setup body rather than constructing the config
* inline, so the per-type identity (which state slot, which context slot, which discriminant) lives in one place per
* type.
*
* Every entry is a generic-name-to-type-specific-name mapping, and the target object varies: `selectedKey` names a
* state slot, `actorKey` / `loaderKey` a context slot, and the `*Key` entries for config facets (`constraintsKey`,
* `rulesKey`, `messagePipelinesKey`) name the per-type **engine config** key a variant reads into its helper's generic
* one — `config[VIDEO_TYPE_CONFIG.constraintsKey]` feeds `constraints`, the way rules read `state[config.selectedKey]`.
* One engine config reaches every variant, so the per-type key is what keeps video's chain out of audio's. The bundle
* carries the key, never the default: `videoRules` and `audioRules` fall back differently, so `?? DEFAULT_…` stays
* beside each variant.
*
* Variants spread their composition-time `config` over the defaults so engines can layer composition-supplied additions
* on top (e.g. a custom fetch closure, a non-default segment resolver). Defaults first, engine config second.
*
* Helpers continue to consume their slice via the existing typed-key generics (`<K extends SelectedTrackKey>` etc.);
* the extra fields on the config object (carrying facets other helpers care about) are fine under structural typing.
*/
/**
* Type-identity bundle for video-track-typed behaviors.
*
* @see setupVideoBufferActors, loadVideoSegments
*/
const VIDEO_TYPE_CONFIG = {
	type: "video",
	selectedKey: "selectedVideoTrackId",
	userSelectionKey: "userVideoTrackSelection",
	actorKey: "videoBufferActor",
	loaderKey: "videoSegmentLoaderActor",
	constraintsKey: "videoConstraints",
	rulesKey: "videoRules",
	messagePipelinesKey: "videoMessagePipelines"
};
/**
* Type-identity bundle for audio-track-typed behaviors.
*
* @see setupAudioBufferActors, loadAudioSegments
*/
const AUDIO_TYPE_CONFIG = {
	type: "audio",
	selectedKey: "selectedAudioTrackId",
	userSelectionKey: "userAudioTrackSelection",
	actorKey: "audioBufferActor",
	loaderKey: "audioSegmentLoaderActor",
	constraintsKey: "audioConstraints",
	rulesKey: "audioRules",
	messagePipelinesKey: "audioMessagePipelines"
};
/**
* Type-identity bundle for text-track-typed behaviors. Text tracks have no `SourceBufferActor` (MSE doesn't apply), so
* this bundle omits `actorKey`, and no user-selection slot in the video/audio sense (`switchTextTrack` resolves
* standing intent through its own terminal), so it omits `userSelectionKey`. The `loaderKey` points at the
* text-track-segment-loader actor (a `MessageActor` with continue-vs-preempt semantics, parallel to v/a's
* `SegmentLoaderActor`).
*
* @see loadTextTrackSegments, setupTextTrackActors
*/
const TEXT_TYPE_CONFIG = {
	type: "text",
	selectedKey: "selectedTextTrackId",
	loaderKey: "textTrackSegmentLoaderActor",
	constraintsKey: "textConstraints",
	rulesKey: "textRules",
	messagePipelinesKey: "textMessagePipelines"
};

//#endregion
//#region ../spf/dist/dev/behaviors/dom/load-segments.js
/**
* **Per-type segment loading dispatch.** Per available track type (video / audio / text), reads the per-type
* segment-loader actor from context and sends typed `'load'` messages whenever a meaningful loading condition changes
* (selected track, current time crossing a segment boundary).
*
* Loader-actor lifecycle is owned upstream:
*
* - Video: `setupVideoBufferActors`
* - Audio: `setupAudioBufferActors`
* - Text: `setupTextTrackActors`
*
* This behavior is pure-consumer: it reads `context[loaderKey]` and dispatches typed messages via the variant's
* per-type `findResolvedTrack` resolver.
*
* # Load modes as reactor states
*
* Four states encode the load-gating policy directly:
*
* - `'preconditions-unmet'` — no loader actor in context, or the selected track hasn't resolved.
* - `'dormant'` — loading disabled by policy: an observed `loadingSuspended` or `segmentLoadingBlocked` (highest
*   precedence) or `preload === 'none' && !loadActivated`. Nothing fires; already-queued loader work drains.
*   Auto-resumes into the derived state when the policy lifts.
* - `'metadata-only'` — `!loadActivated && preload !== 'auto' && preload !== 'none'`. Fires an init-segment-only `load`
*   message **once on entry**. The variant's loader actor decides what to do — v/a's actor fetches the init segment;
*   text's actor no-ops (no init concept).
* - `'full-range'` — `loadActivated || preload === 'auto'`. Effect re-fires on selected-track change and on
*   segment-boundary crossing.
*
* # Per-type parameterization (inference-driven)
*
* The helper is generic over `Track` — the resolved-track type. Each variant supplies its own `findResolvedTrack`
* resolver via config; TS infers `Track` from the resolver's return type. The loader signal's value type is constrained
* to `SegmentLoaderLike<Track>` — anything with a `send` method accepting the `Track`-parameterized message. Concrete
* actor types (`SegmentLoaderActor`, `TextTrackSegmentLoaderActor`) satisfy this via function-parameter contravariance:
* an actor whose `.send` accepts a wider track type is assignable to a slot expecting a narrower track type.
*
* No widening of actor message types is needed; no casts inside the helper. Per-variant wiring (right loader paired
* with right resolver) is enforced at the variant call site.
*/
/**
* Specialization helper. Generic over `Track` (inferred from `findResolvedTrack`'s return type). The loader value type
* is constrained to `SegmentLoaderLike<Track>` — concrete actor types (whose `.send` accepts a wider track union)
* satisfy this via function-parameter contravariance.
*
* Tracks that the helper handles must have a `segments` field — used by `segmentBoundarySignal` to compute the
* load-anchor boundary. Each variant's resolver narrows to the right resolved-track shape.
*/
function setupSegmentLoading({ state, context, config }) {
	const { selectedKey, loaderKey, findResolvedTrack } = config;
	const bufferDuration = config.forwardBuffer?.bufferDuration ?? DEFAULT_FORWARD_BUFFER_CONFIG.bufferDuration;
	const isLoadingDormant = () => !!(state.loadingSuspended?.get() || state.segmentLoadingBlocked?.get());
	const selectedTrack = computed(() => findResolvedTrack(state.presentation.get(), state[selectedKey].get()));
	const segmentBoundarySignal = computed(() => {
		const track = selectedTrack.get();
		if (!track) return void 0;
		return segmentStartForTime(state.currentTime.get() ?? 0, track.segments);
	});
	const derivedStateSignal = computed(() => {
		if (isLoadingDormant()) return "dormant";
		if (!context[loaderKey].get() || !selectedTrack.get()) return "preconditions-unmet";
		if (state.loadActivated.get() || state.preload.get() === "auto") return "full-range";
		if (state.preload.get() === "none") return "dormant";
		return "metadata-only";
	});
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			dormant: {},
			"metadata-only": { entry: () => {
				const track = selectedTrack.get();
				const loader = context[loaderKey].get();
				if (!track || !loader) return;
				if (isLoadingDormant()) return;
				loader.send({
					type: "load",
					track
				});
			} },
			"full-range": { effects: () => {
				const track = selectedTrack.get();
				segmentBoundarySignal.get();
				const loader = peek(context[loaderKey]);
				if (!track || !loader) return;
				if (isLoadingDormant()) return;
				const currentTime = peek(state.currentTime) ?? 0;
				loader.send({
					type: "load",
					track,
					range: {
						start: currentTime,
						end: currentTime + bufferDuration
					}
				});
			} }
		}
	});
}
const VIDEO_SEGMENT_LOADING_CONFIG = {
	...VIDEO_TYPE_CONFIG,
	findResolvedTrack: findResolvedVideoTrack
};
const AUDIO_SEGMENT_LOADING_CONFIG = {
	...AUDIO_TYPE_CONFIG,
	findResolvedTrack: findResolvedAudioTrack
};
const TEXT_SEGMENT_LOADING_CONFIG = {
	...TEXT_TYPE_CONFIG,
	findResolvedTrack: findResolvedTextTrack
};
const loadVideoSegments = defineBehavior({
	stateKeys: [
		"presentation",
		"preload",
		"currentTime",
		"loadActivated",
		"selectedVideoTrackId"
	],
	contextKeys: ["videoSegmentLoaderActor"],
	setup: ({ state, context, config = {} }) => setupSegmentLoading({
		state,
		context,
		config: {
			...VIDEO_SEGMENT_LOADING_CONFIG,
			...config
		}
	})
});
const loadAudioSegments = defineBehavior({
	stateKeys: [
		"presentation",
		"preload",
		"currentTime",
		"loadActivated",
		"selectedAudioTrackId"
	],
	contextKeys: ["audioSegmentLoaderActor"],
	setup: ({ state, context, config = {} }) => setupSegmentLoading({
		state,
		context,
		config: {
			...AUDIO_SEGMENT_LOADING_CONFIG,
			...config
		}
	})
});
const loadTextTrackSegments = defineBehavior({
	stateKeys: [
		"presentation",
		"preload",
		"currentTime",
		"loadActivated",
		"selectedTextTrackId"
	],
	contextKeys: ["textTrackSegmentLoaderActor"],
	setup: ({ state, context, config = {} }) => setupSegmentLoading({
		state,
		context,
		config: {
			...TEXT_SEGMENT_LOADING_CONFIG,
			...config
		}
	})
});

//#endregion
//#region ../spf/dist/dev/media/primitives/select-tracks.js
/**
* Test whether a track matches a partial-track description: every present, defined field of `filter` equals the
* track's. Absent or `undefined` filter fields don't constrain. Used to narrow candidates by a user selection (`{ id
* }`, `{ language }`, `{ height }`, …).
*
* @param track - The track to test
* @param filter - Partial-track description; only present, defined fields constrain
* @returns `true` when the track matches every constraining field
*/
function matchesPartialTrack(track, filter) {
	for (const key in filter) {
		const filterValue = filter[key];
		if (filterValue !== void 0 && track[key] !== filterValue) return false;
	}
	return true;
}
/** Missing dimensions are treated as area `0`, so a track without them ranks last. */
function pixelArea(track) {
	return (track.width ?? 0) * (track.height ?? 0);
}
/**
* Narrow to the tracks at or below `maxPixelArea`, and nothing else: no ordering, no fallback. Survivors keep their
* incoming order, and an empty result is a real answer — "none of these fit".
*
* Deliberately only the filter, because as a selection rule this composes under `applyRules`, which already owns both
* halves a caller might expect here: an empty result is skipped, so a preference can never narrow the candidate set to
* nothing; and ordering the survivors is a separate rule's job ({@link byDescendingResolution}, bandwidth ABR). Doing
* either here would duplicate the composer and give one rule two responsibilities.
*/
function tracksUnderPixelArea(tracks, maxPixelArea = Number.POSITIVE_INFINITY) {
	return tracks.filter((track) => pixelArea(track) <= maxPixelArea);
}
/**
* The smallest track area that still covers `minPixelArea`, or `undefined` when no track reaches it.
*
* The cap a surface-size rule wants when it should round _up_ to the ladder: a surface between two tiers is covered by
* the upper one, and capping at the surface's own area instead would serve a picture smaller than the surface and
* upscale it.
*
* Tracks declaring no dimensions compare as area `0` and so never cover anything, which keeps them out of the cap
* rather than pinning it to zero.
*/
function smallestCoveringPixelArea(tracks, minPixelArea) {
	const covering = tracks.map(pixelArea).filter((area) => area >= minPixelArea);
	return covering.length ? Math.min(...covering) : void 0;
}
/**
* Compare two tracks by resolution, largest first, with bandwidth as the tiebreak for renditions of identical
* dimensions. Missing dimensions are treated as area `0`, so a track without them sorts last.
*
* A comparator rather than a "highest track" function: the selection-rule chain takes the head of the list it produces,
* so ranking never has to collapse to a single track. `preferHighestResolution` is `sort` over this and nothing more.
*/
function byDescendingResolution(a, b) {
	return pixelArea(b) - pixelArea(a) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0);
}
/**
* Default audio policy over a candidate list: the three-tier pick a selection-rule chain applies once it has narrowed
* the candidates.
*
* Priority: `preferredAudioLanguage` match → `DEFAULT=YES` → first track.
*/
function pickAudioTrackFromTracks(tracks, config) {
	if (config?.preferredAudioLanguage) {
		const languageMatch = tracks.find((track) => track.language === config.preferredAudioLanguage);
		if (languageMatch) return languageMatch.id;
	}
	const defaultTrack = tracks.find((track) => track.default === true);
	if (defaultTrack) return defaultTrack.id;
	return tracks[0]?.id;
}
/**
* Default text-track policy over a candidate list: the opt-in three-tier pick `switchTextTrack`'s terminal applies once
* it has narrowed the renditions to the constrained, CDN-scoped set.
*
* Priority: `preferredSubtitleLanguage` match → `DEFAULT=YES + AUTOSELECT=YES` (only when `enableDefaultTrack`) →
* `undefined` (opt-in). FORCED tracks are excluded unless `includeForcedTracks` (Apple-spec: a regular track must carry
* forced content when both exist, so a forced-only track is redundant).
*/
function pickTextTrackFromTracks(tracks, config) {
	const availableTracks = config?.includeForcedTracks ? tracks : tracks.filter((track) => !track.forced);
	if (availableTracks.length === 0) return void 0;
	const { preferredSubtitleLanguage, enableDefaultTrack = false } = config ?? {};
	if (preferredSubtitleLanguage) {
		const languageMatch = availableTracks.find((track) => track.language === preferredSubtitleLanguage);
		if (languageMatch) return languageMatch.id;
	}
	if (enableDefaultTrack) {
		const defaultTrack = availableTracks.find((track) => track.default === true);
		if (defaultTrack) return defaultTrack.id;
	}
}

//#endregion
//#region ../spf/dist/dev/media/drm.js
/**
* DOM-free DRM model helpers: the `source.drm`-shaped config contract, HLS `KEYFORMAT` → EME key-system identity
* mapping, manifest-declared key collection, and key-system candidate selection. The browser-touching EME half (access
* negotiation, MediaKeys attachment, init-data decoding, license POST) lives in `dom/eme.ts`, which re-exports these.
*/
/**
* `state.negotiatedKeySystem` when negotiation ran and every candidate was refused.
*
* A sentinel rather than `null` or a second slot, so the slot stays `string | undefined` and its three meanings read
* off one value: absent means negotiation hasn't settled, this means it settled on nothing, anything else is the chosen
* key system. Cannot collide with a real id — those are reverse-DNS (`com.widevine.alpha`).
*
* The distinction is load-bearing for pruning: "not yet" must leave encrypted renditions alone, while "refused" is the
* late fact that makes them unplayable (see `excludeRefusedKeySystems`).
*/
const NO_KEY_SYSTEM = "none";
/**
* Resolve a {@link DrmUrl}. Called from a selection constraint, so a resolver that throws answers `undefined` rather
* than failing the pruning pass — see {@link toValue}.
*/
function resolveDrmUrl(url) {
	return toValue(url);
}
/** Resolve configured license-request headers. See {@link resolveDrmUrl}. */
function resolveDrmHeaders(headers) {
	return toValue(headers);
}
/** Resolve a configured fetch credentials mode. See {@link resolveDrmUrl}. */
function resolveDrmCredentials(credentials) {
	return toValue(credentials);
}
/**
* What a FairPlay content id is when a source names no {@link FairPlayContentId}: everything after the scheme, which is
* Apple's own sample convention and what Mux's license server expects.
*/
function defaultFairPlayContentId(keyUri) {
	const start = keyUri.indexOf("skd://");
	return start === -1 ? keyUri : keyUri.slice(start + 6);
}
/**
* Every DRM key declaration across the presentation's resolved tracks, deduped by full attribute identity. Empty until
* at least one encrypted rendition's media playlist has resolved — `EXT-X-KEY` is a media-playlist tag, and Mux emits
* no `EXT-X-SESSION-KEY` in the multivariant.
*/
function declaredDrmKeys(presentation) {
	const keys = [];
	const seen = /* @__PURE__ */ new Set();
	for (const track of getAllTracks(presentation?.selectionSets ?? [])) {
		if (!isResolvedTrack(track)) continue;
		for (const key of getMediaPlaylistMetadata(track)?.keys ?? []) {
			const identity = [
				key.method,
				key.uri,
				key.keyFormat,
				key.keyId,
				key.iv
			].join(" ");
			if (seen.has(identity)) continue;
			seen.add(identity);
			keys.push(key);
		}
	}
	return keys;
}
/** Encryption scheme per HLS `METHOD`, for the MKSA encryption-scheme query. */
const ENCRYPTION_SCHEME_BY_METHOD = {
	"SAMPLE-AES": "cbcs",
	"SAMPLE-AES-CTR": "cenc",
	"SAMPLE-AES-CENC": "cenc"
};
/**
* The one encryption scheme the declared keys use, or `undefined` when they mix schemes or declare none we recognize.
* Stamped onto negotiation capabilities so scheme-aware CDMs refuse content they can't decrypt (Mux serves `SAMPLE-AES`
* — cbcs); UAs predating the encryption-scheme query ignore the member, so declaring it never costs support.
*/
function declaredEncryptionScheme(keys) {
	const schemes = new Set(keys.map((key) => ENCRYPTION_SCHEME_BY_METHOD[key.method]).filter((scheme) => scheme !== void 0));
	return schemes.size === 1 ? [...schemes][0] : void 0;
}
/**
* The init data a presentation's manifest carries for one key system: every declared key the module claims, projected
* through its `toInitData` (Widevine PSSH / PlayReady PRO as `data:` URIs). Empty when the module carries none
* (FairPlay `skd://` keys have no inline init data) or declares no projection at all — which is what routes
* `exchangeLicenses` to its event-driven fallback.
*/
function manifestInitData(presentation, module_) {
	if (!module_?.toInitData) return [];
	const projected = [];
	for (const key of declaredDrmKeys(presentation)) {
		if (key.keyFormat === void 0 || key.uri === void 0 || !module_.keyFormats.includes(key.keyFormat)) continue;
		const initData = module_.toInitData(key.uri);
		if (initData) projected.push(initData);
	}
	return projected;
}
/**
* The key-system modules worth asking the CDM for: declared by the presentation's keys _and_ resolving to a license
* server, in `keySystems` order. Keys without a `KEYFORMAT` any module claims (e.g. `identity` AES-128) contribute
* nothing.
*
* Negotiation preference is the caller's array order rather than a table here — hls.js's order (the platform-native
* system first, FairPlay existing only on Apple UAs so it costs nothing elsewhere) is what `DEFAULT_KEY_SYSTEMS`
* encodes, and a composition that wants another just orders its own list.
*
* A resolved license server rather than a named entry is what counts, so a config naming every system it could ever
* license still refuses the sources it holds no credentials for.
*/
function keySystemCandidates(keys, drm, keySystems) {
	const declared = new Set(keys.map((key) => key.keyFormat).filter((keyFormat) => keyFormat !== void 0));
	return keySystems.filter((module_) => module_.keyFormats.some((keyFormat) => declared.has(keyFormat)) && resolveDrmUrl(drm[module_.keySystem]?.licenseUrl) !== void 0);
}
/**
* The first declared key that is non-DRM (`identity`-keyformat) encryption, or `undefined` when every declared key
* names a DRM key system. Distinguishes "the source is clear-key encrypted, which this engine can't decrypt" from "a
* DRM system was declared and refused or is unlicensable" when negotiation yields no usable key system.
*/
function firstNonDrmEncryptionKey(keys) {
	return keys.find((key) => key.keyFormat === void 0 || key.keyFormat === "identity");
}
/**
* The cause to report when encryption the engine cannot decrypt is why a source or rendition will not play, given its
* declared keys — or `undefined` when a DRM system is the right thing to blame. An `identity`-keyformat key (AES-128 /
* SAMPLE-AES over HTTP) is not EME at all and this engine has no decryptor for it, so the cause names the unsupported
* _encryption method_ rather than a DRM system that was never involved. `data` rides on the condition beside the method
* and key format.
*
* Shared by `setupMediaKeys` (at negotiation) and the condition reporter (at resolve), so the two never disagree about
* which gap to name.
*/
function unsupportedEncryptionMethodCause(keys, data = {}) {
	const nonDrmKey = firstNonDrmEncryptionKey(keys);
	if (!nonDrmKey) return void 0;
	return {
		code: SVTA_UNSUPPORTED_ENCRYPTION_METHOD,
		data: {
			...data,
			method: nonDrmKey.method,
			keyFormat: nonDrmKey.keyFormat
		}
	};
}
/**
* Build the engine-facing DRM config a Media hands its engine once: one entry per key system whose every field reads
* the _current_ source (via `getDrm`) at call time, so switching source re-licenses without rebuilding the engine.
*
* URL and header fields resolve to a plain value the engine re-resolves harmlessly. The four transform fields are
* stable functions that apply the current source's transform, or pass the value through when it names none. Transforms
* cannot ride {@link DrmUrl}'s resolver union: {@link toValue} tells a function from a value by `typeof ===
* 'function'`, which a transform — itself a function — collides with. Wrapping here is what lets a source carry
* transforms without the engine ever holding, or structurally comparing, the source's own function objects.
*/
function sourceDrmSystems(getDrm, keySystems) {
	return Object.fromEntries(keySystems.map(({ keySystem }) => {
		const entry = () => getDrm()?.[keySystem];
		return [keySystem, {
			licenseUrl: () => resolveDrmUrl(entry()?.licenseUrl),
			serverCertificateUrl: () => resolveDrmUrl(entry()?.serverCertificateUrl),
			headers: () => resolveDrmHeaders(entry()?.headers),
			certificateHeaders: () => resolveDrmHeaders(entry()?.certificateHeaders),
			credentials: () => resolveDrmCredentials(entry()?.credentials),
			licenseRequest: (request) => entry()?.licenseRequest?.(request) ?? request,
			licenseResponse: (response) => entry()?.licenseResponse?.(response) ?? response,
			certificateRequest: (request) => entry()?.certificateRequest?.(request) ?? request,
			certificateResponse: (response) => entry()?.certificateResponse?.(response) ?? response,
			fairPlayContentId: (keyUri) => entry()?.fairPlayContentId?.(keyUri) ?? defaultFairPlayContentId(keyUri)
		}];
	}));
}

//#endregion
//#region ../spf/dist/dev/playback/primitives/selection-rules.js
/**
* Apply rules to a candidate list in order; the pick is the first survivor. Two responsibilities the rules don't carry:
* a rule that returns nothing is skipped (fall-through — a preference never empties the set), and once one survivor
* remains the chain stops (early-bail — later rules, including the bandwidth ranker, never run, so the effect doesn't
* subscribe to their signals while the choice is fixed).
*
* @param rules - Rules to apply, most authoritative first
* @param tracks - Candidate tracks
* @param deps - The behavior's `{ state, context, config }`, passed through to each rule
* @returns The surviving candidates, pick first
*/
function applyRules(rules, tracks, deps) {
	let current = tracks;
	for (const rule of rules) {
		const remaining = rule(current, deps);
		if (remaining.length === 0) continue;
		current = remaining;
		if (current.length === 1) break;
	}
	return current;
}
/**
* Apply hard constraints to a candidate list — the pre-pass that runs before the rule chain. A constraint shares a
* rule's signature but its exclusion is _hard_: it removes the unplayable (a codec the environment can't decode, a CDN
* in failover cooldown) and a removed track is never attempted. Unlike `applyRules`, this never skips an empty result
* and never early-bails — every constraint always applies, and an empty survivor set is a real outcome ("nothing
* playable here"), not a fall-through. Because each constraint only removes, the order they run in can't change which
* tracks survive — though one that also _reports_ reads the list at its own position, so placement matters.
*
* @param constraints - Constraints to apply, in order
* @param tracks - Candidate tracks
* @param deps - The behavior's `{ state, context, config }`, passed to each constraint
* @returns The playable survivors (possibly empty)
*/
function applyConstraints(constraints, tracks, deps) {
	let current = tracks;
	for (const constraint of constraints) current = constraint(current, deps);
	return current;
}
/**
* Whether two candidate sets hold the same tracks, by id.
*
* The `equals` both selection behaviors give their candidate-set `computed`. A live playlist refresh swaps in a new
* presentation object carrying the same variants, and a constraint's own inputs can churn without changing which tracks
* survive; in both cases the set is unchanged and the reaction must not re-fire. Compares by id rather than array
* identity for exactly that.
*/
function sameCandidateSet(a, b) {
	return a.length === b.length && a.every((track) => b.some((other) => other.id === track.id));
}
/**
* Capability constraint — a _hard_ filter for the {@link applyConstraints} pre-pass. Removes renditions this
* environment can't decode, probed via the injected `canPlayTrack` (codec → `MediaSource.isTypeSupported`, plus the
* container and encryption assertions that probe can't make). Constraining here — before selection — means an
* unplayable variant is pruned upstream and never picked, instead of surviving into the pipeline to fail late at
* `createSourceBuffer`. That late throw stays as a defensive structural guarantee; with this constraint it should
* rarely fire.
*
* Lives here rather than beside `switchVideoTrack` for the reason this module exists: both the re-evaluating variant
* and the pinned `selectVideoTrack` apply it, and reaching it through `behaviors/track-switching.ts` would drag the ABR
* path into a composition that deliberately omits it.
*
* The probe is handed the whole config alongside each track, so an extended probe reads the props it defines off it
* rather than closing over them — `canPlayTrackWithDrm` reads `drm` and `keySystems` that way.
*
* Passes everything through when there's no probe (a composition that didn't wire one, or DOM-free tests). When it
* prunes _every_ track, the empty result is preserved (per `applyConstraints`) — "nothing playable" — which each
* consuming behavior answers by clearing its selection; reporting the verdict is separate.
*/
function excludeUnplayableTracks(tracks, { config }) {
	const canPlayTrack = config?.canPlayTrack;
	if (!canPlayTrack) return tracks;
	return tracks.filter((track) => canPlayTrack(track, config));
}
/**
* Refused-key-system constraint — a _hard_ filter for the {@link applyConstraints} pre-pass. Removes encrypted
* renditions once negotiation has come back empty-handed.
*
* The late half of DRM pruning. `canPlayTrack`'s DRM variant already drops encrypted renditions no _configured_ key
* system serves, but it runs before the CDM has been asked, so a rendition naming a configured license server survives
* it and only negotiation reveals the CDM is absent. This constraint is that answer arriving: with `NO_KEY_SYSTEM`
* published, no encrypted rendition can decode, whatever it declares.
*
* Reporting is deliberately not here. Pruning to empty is what `track-switching` already reports as
* `SVTA_NO_SUPPORTED_{VIDEO,AUDIO}_TRACK`, so the verdict stays its owner's — a type keeping any clear rendition is
* unaffected and reports nothing, exactly as before. `setupMediaKeys` still reports the _cause_ (4008).
*
* `negotiatedKeySystem` is read through a cast for the same reason `screenResolutionCap` reads `screenResolution`: the
* slot exists only in DRM compositions, and constraining the rule's `State` generic would make every chain that doesn't
* carry it a weak-type mismatch. Read reactively, so publishing the sentinel re-fires the chain.
*/
function excludeRefusedKeySystems(tracks, { state }) {
	if (state.negotiatedKeySystem?.get() !== "none") return tracks;
	return tracks.filter((track) => !getMediaPlaylistMetadata(track)?.encrypted);
}
/**
* The codec families {@link preferCodecFamilies} narrows to when the config carries no `preferredCodecs`: AVC (both its
* 4CCs) and AAC. The default is deliberate rather than neutral — SPF implements no `SourceBuffer.changeType()`, so on a
* mixed-codec source the _initial_ family choice is the one ABR lives inside for the whole source (see
* `stickToSelectedCodecs` in `behaviors/track-switching.ts`), and AVC/AAC is the family pair with the broadest decode
* support. The cost, equally deliberate: on a ladder whose higher rungs are HEVC-only (a common 4K shape), the default
* caps quality at the top AVC rung — configure `preferredCodecs` (or pass `[]`) to trade the other way.
*/
const DEFAULT_PREFERRED_CODECS = [
	"avc1",
	"avc3",
	"mp4a"
];
/**
* Codec-family preference — a _soft_ filter (scope) for a selection-rule chain; the `hevc-variant-selection` concern
* from `internal/design/spf/track-switching-model.md`. Narrows to the tracks whose codec families are all in
* `preferredCodecs` (family-compared, so entries may be 4CCs or full codec strings). Soft-filter semantics: a source
* with no preferred-family rendition (an HEVC-only ladder under the AVC default) is left unnarrowed, and a track
* without codecs never matches — on a ladder with no codecs anywhere (DOM-free tests) the rule is inert.
*
* `preferredCodecs` defaults to {@link DEFAULT_PREFERRED_CODECS}; explicitly pass `[]` to disable the preference while
* keeping the rule composed.
*
* "All families" rather than "any" so a muxed rendition is judged as the unit it is: `hvc1,mp4a` must not count as
* preferred just because its audio half matches.
*
* Lives here rather than beside `switchVideoTrack` for the module's usual reason: the pinned `selectVideoTrack` variant
* can compose it without dragging the ABR path in.
*/
function preferCodecFamilies(tracks, { config }) {
	const preferred = config?.preferredCodecs ?? DEFAULT_PREFERRED_CODECS;
	if (!preferred.length) return tracks;
	const preferredFamilies = new Set(preferred.map(getCodecFamily));
	return tracks.filter((track) => {
		const families = getCodecFamilies(track);
		return !!families && families.every((family) => preferredFamilies.has(family));
	});
}

//#endregion
//#region ../spf/dist/dev/media/utils/cdn.js
/**
* Default {@link GetCdnId}: the URL's origin (scheme + host + port); falls back to the raw string when the URL can't be
* parsed, so the return value is always a stable grouping key.
*/
function getCdnId(url) {
	try {
		return new URL(url).origin;
	} catch {
		return url;
	}
}
const CDN_TYPE_PRIORITY = {
	video: 0,
	audio: 1,
	text: 2
};
/**
* The distinct CDNs a presentation's tracks are served from, ordered video CDNs first, then audio, then text (manifest
* order within a type). The head is the primary CDN — the one a sticky pick defaults to — and is always video-derived
* when the source has video. Returns `[]` for an unresolved presentation with no tracks.
*
* Redundant-stream sources list the same content on multiple hosts (e.g. Mux's `?redundant_streams=true`), so each host
* contributes its own candidate tracks; this collapses them to the set of CDNs across every track type. The CDN-id
* derivation defaults to {@link getCdnId}; pass a consumer-configured `getId` to key on something other than origin.
*/
function getOrderedCdnIds(presentation, getId = getCdnId) {
	const seen = /* @__PURE__ */ new Set();
	const ids = [];
	const selectionSets = [...presentation.selectionSets ?? []].sort((a, b) => CDN_TYPE_PRIORITY[a.type] - CDN_TYPE_PRIORITY[b.type]);
	for (const track of getAllTracks(selectionSets)) {
		const id = getId(track.url);
		if (seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}
/**
* Add a CDN id to a failed-CDN list, preserving order and ignoring duplicates. Idempotent: re-adding an already-present
* id returns the same array reference (so a no-op trip doesn't churn the `failedCdns` signal). The failover trip in
* `resolve-track` and the segment loaders feed this into `failedCdns` via `update`.
*/
function addFailedCdn(failed, cdn) {
	return failed?.includes(cdn) ? failed : [...failed ?? [], cdn];
}

//#endregion
//#region ../spf/dist/dev/behaviors/collect-errors.js
/**
* **Owns the engine's error sequence.** Reporters append through {@link emitError}; this behavior owns the slot and its
* per-source lifecycle, clearing it on exit so a new source starts clean and the sequence can't grow unbounded across a
* session.
*
* Same split as `setupFailoverMonitor` and `failedCdns`: writes come from wherever the condition is detected, one
* behavior owns the slot. Deliberately has no `effects` — it holds no policy and derives nothing. Severity is decided
* at the adapter, not here (see `internal/design/spf/features/errors.md`), which is why this is a lifecycle owner
* rather than an error _handler_.
*
* Clearing binds to _exit_ of `presentation-resolved`, mirroring the sibling mixins' clear-on-teardown (`emptied` /
* `MEDIA_DETACHED`). A live reload swaps the presentation object without leaving the resolved state, so it doesn't
* clear — only an actual source change or destroy does. Known gap: a resolved→resolved source swap that never passes
* through unresolved carries the prior source's errors forward; `resolve-track` guards the same transition with a
* commit-time id check, and doing likewise here is a follow-up.
*
* The vocabulary itself ({@link SvtaError} and the codes) is DOM- and signal-free in `media/errors`; only the write
* seam lives here, with the slot it writes.
*/
/**
* Append `error` to the engine's error sequence. No-op when no owner is composed. Replaces the array rather than
* mutating it, so signal consumers notify; duplicates are kept, since a repeated condition is a real observation.
* Writes go through `update` so concurrent reporters can't lose each other's appends.
*
* Every emission is logged, deliberately _before_ the owner check. A condition emitted with no `collectErrors` composed
* is dropped on the floor — that's the case where a log is the only evidence it happened at all, so gating the log on
* the same check would hide exactly what's worth seeing. Emissions that _are_ collected still get logged, because
* reaching `state.errors` is no guarantee of reaching a person: only _verdicts_ are promoted to the media surface, so
* every cause (and any non-fatal notice) is otherwise invisible outside a debugger.
*
* Ungated rather than `__DEV__`-only, matching the other reporting paths in this package (`resolve-presentation`,
* `track-switching`, the segment actors).
*/
function emitError(state, error) {
	console.error("[spf] reported condition", error);
	if (!state.errors) return;
	update(state.errors, (errors) => [...errors ?? [], error]);
}
/**
* A "constraint" that reports a type the source carries **no** renditions of, for a composition that can't play without
* it.
*
* Strange on purpose, and the strangeness is the point: it never constrains anything, always returning its input
* untouched. It is shaped as a rule so a composition opts in by adding it to `constraints` — nothing to thread through
* config, and no cost at all to a composition that leaves it out.
*
* **Belongs last in the chain.** A constraint sees the list as it stands at its own position, so only at the tail does
* an empty input mean "nothing playable here" — none of this type offered, or the constraints ahead pruned them all.
*
* These are the failures no per-rendition cause can report: causes come from `reportUnsupportedTrackConditions` as each
* media playlist resolves, and a rendition pruned before selection never resolves. Container and encryption aren't
* knowable until one does; CODECS is, so an undecodable ladder isn't.
*
* Idempotent because the constraint chain runs inside a `computed` that re-derives on every `presentation` write —
* segment appends and live reloads included — and the sequence deliberately keeps duplicates. `peek` is what keeps that
* computed from subscribing to the slot this writes.
*
* @example
*   // features/background-video.ts — video-only, so a source with none can't play
*   constraints: [excludeUnplayableTracks, reportAbsentTrackType(SVTA_NO_SUPPORTED_VIDEO_TRACK)];
*/
function reportAbsentTrackType(code) {
	return (tracks, { state }) => {
		const reported = state.errors && peek(state.errors);
		if (!tracks.length && !reported?.some((error) => error.code === code)) emitError(state, { code });
		return tracks;
	};
}
/**
* Own `errors` for the resolved source's lifetime.
*
* @example
*   const reactor = collectErrors.setup({ state });
*/
const collectErrors = defineBehavior({
	stateKeys: ["presentation", "errors"],
	contextKeys: [],
	setup: ({ state }) => {
		const derivedStateSignal = computed(() => isResolvedPresentation(state.presentation.get()) ? "presentation-resolved" : "presentation-unresolved");
		return createMachineReactor({
			initial: "presentation-unresolved",
			monitor: () => derivedStateSignal.get(),
			states: {
				"presentation-unresolved": {},
				"presentation-resolved": { entry: () => () => state.errors.set(void 0) }
			}
		});
	}
});

//#endregion
//#region ../spf/dist/dev/media/hls/parse-media-playlist.js
/**
* MPEG-2 Transport Stream (IANA `video/MP2T`, lowercased for `isTypeSupported`). Video + audio TS — there is no
* `audio/mp2t`.
*/
const MPEG_TS_MIME = "video/mp2t";
/** Raw ADTS AAC packed-audio (HLS `.aac` segments; IANA `audio/aac`). */
const RAW_AAC_MIME = "audio/aac";
const CONTAINER_MIME_BY_EXTENSION = {
	".ts": MPEG_TS_MIME,
	".aac": RAW_AAC_MIME
};
/** The non-fMP4 container MIMEs the parser detects — all currently treated as unplayable. */
const NON_FMP4_CONTAINER_MIMES = new Set(Object.values(CONTAINER_MIME_BY_EXTENSION));
/**
* Non-fMP4 container MIME for a (resolved, absolute) segment URL, by file extension, ignoring the query string.
* `undefined` for fMP4 / unrecognized.
*/
function containerMimeFromSegment(url) {
	if (!url) return void 0;
	let path;
	try {
		path = new URL(url).pathname.toLowerCase();
	} catch {
		path = url.toLowerCase().split("?")[0] ?? "";
	}
	const dot = path.lastIndexOf(".");
	return dot === -1 ? void 0 : CONTAINER_MIME_BY_EXTENSION[path.slice(dot)];
}
/**
* Position a freshly-parsed window (whose segment `startTime`s are snapshot- local, i.e. from 0) onto the timeline
* established by the previous resolved snapshot. Carries the timeline forward using the media-sequence overlap and the
* previous window's _actual_ segment durations — see `internal/design/spf/live-presentation-timeline-model.md`.
*
* - **Overlap** (`0 <= offset < previous.segments.length`): the new window's first segment is the same segment as
*   `previous.segments[offset]`; anchor to its start (URLs checked — a mismatch warns).
* - **Sequence went backwards** (non-conformant): reset to the local base.
* - **Full turnover** (no overlap): estimate forward from the previous window's end across the unseen gap. This is the
*   _only_ place EXT-X-TARGETDURATION is used for timing — an upper-bound estimate, since the actual rolled-off
*   durations are gone (exact recovery is the deferred PDT decision).
*
* Returns the rebased segments (the window edge is `segments[0].startTime`, derived — never stored on the track).
*/
function placeOnPreviousTimeline(previous, segments, mediaSequence, targetDuration) {
	const prevSegments = previous.segments;
	const localBase = segments[0]?.startTime ?? 0;
	if (prevSegments.length === 0 || segments.length === 0) return segments;
	const offset = mediaSequence - (getMediaPlaylistMetadata(previous)?.mediaSequence ?? 0);
	let anchor;
	if (offset >= 0 && offset < prevSegments.length) {
		const overlap = prevSegments[offset];
		if (overlap.url !== segments[0].url) console.warn(`[parseMediaPlaylist] media-sequence aligns previous[${offset}] with the new window's first segment, but URLs differ (${overlap.url} vs ${segments[0].url}); sequence numbers may be unreliable.`);
		anchor = overlap.startTime;
	} else if (offset < 0) {
		console.warn(`[parseMediaPlaylist] media-sequence went backwards (offset ${offset}); resetting timeline.`);
		anchor = localBase;
	} else {
		const last = prevSegments[prevSegments.length - 1];
		const newFirst = segments[0];
		if (last.startDate !== void 0 && newFirst.startDate !== void 0) anchor = last.startTime + (newFirst.startDate - last.startDate);
		else {
			anchor = last.startTime + last.duration + (offset - prevSegments.length) * targetDuration;
			console.warn(`[parseMediaPlaylist] full window turnover (offset ${offset} >= ${prevSegments.length}); no PDT to bridge — estimating from previous end.`);
		}
	}
	const shift = anchor - localBase;
	return shift === 0 ? segments : segments.map((segment) => ({
		...segment,
		startTime: segment.startTime + shift
	}));
}
/**
* Place a window on the frozen wall-clock anchor — the track's `startDate` (wall clock at media-time 0). The anchoring
* PDT-bearing segment lands at `segment.startDate − anchor`, so the window sits on the shared presentation timeline
* rather than a local-from-zero one (the `startDate` recomputed afterwards then reads back as the anchor — idempotent).
* This is the **main live path on every parse**: first resolves place against the pre-stamped shell anchor, and reloads
* re-place from PDT so drift can't accumulate and a long-stall turnover re-places with no overlap bridging (the HLS
* authoring spec's §8.1 EXTINF-accuracy rule bounds the per-reload correction to ~one video frame). Falls back to the
* local base when no segment carries PDT — there's nothing to anchor against (callers guard this for reloads, where the
* local base would reset the timeline).
*/
function placeOnAnchor(segments, anchor) {
	const anchorSegment = segments.find((segment) => !isUndefined(segment.startDate));
	if (!anchorSegment || isUndefined(anchorSegment.startDate)) return segments;
	const shift = anchorSegment.startDate - anchor - anchorSegment.startTime;
	if (shift === 0) return segments;
	return segments.map((segment) => ({
		...segment,
		startTime: segment.startTime + shift
	}));
}
function parseMediaPlaylist(text, previous, config = {}) {
	const resolveKey = config.resolveKeyUri ?? resolveKeyUri;
	const lines = text.split(/\r?\n/);
	const baseUrl = previous.url;
	const segments = [];
	let initSegmentUrl;
	let initSegmentByteRange;
	let currentDuration = 0;
	let currentByteRange;
	let currentTime = 0;
	let segmentIndex = 0;
	let previousByteRangeEnd;
	let currentStartDate;
	let targetDuration = 0;
	let mediaSequence = 0;
	let playlistType;
	let endList = false;
	let holdBack;
	let lowLatency = false;
	const keys = [];
	const seenKeys = /* @__PURE__ */ new Set();
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") && !trimmed.startsWith("#EXT")) continue;
		if (trimmed.startsWith("#EXT-X-TARGETDURATION:")) {
			targetDuration = Number.parseInt(trimmed.slice(22), 10) || 0;
			continue;
		}
		if (trimmed.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
			mediaSequence = Number.parseInt(trimmed.slice(22), 10) || 0;
			continue;
		}
		if (trimmed.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
			const parsed = Date.parse(trimmed.slice(25).trim());
			currentStartDate = Number.isNaN(parsed) ? currentStartDate : parsed / 1e3;
			continue;
		}
		if (trimmed.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
			const value = trimmed.slice(21).trim();
			playlistType = value === "VOD" || value === "EVENT" ? value : void 0;
			continue;
		}
		const key = matchTag(trimmed, "EXT-X-KEY");
		if (key) {
			const method = key.get("METHOD");
			if (method !== void 0 && method !== "NONE") {
				const uri = key.get("URI");
				const keyFormat = key.get("KEYFORMAT");
				const keyId = key.get("KEYID");
				const iv = key.get("IV");
				const identity = [
					method,
					uri,
					keyFormat,
					keyId,
					iv
				].join("\0");
				if (!seenKeys.has(identity)) {
					seenKeys.add(identity);
					keys.push({
						method,
						...uri !== void 0 && { uri: resolveKey(uri, baseUrl) },
						...keyFormat !== void 0 && { keyFormat },
						...keyId !== void 0 && { keyId },
						...iv !== void 0 && { iv }
					});
				}
			}
			continue;
		}
		const serverControl = matchTag(trimmed, "EXT-X-SERVER-CONTROL");
		if (serverControl) {
			const value = serverControl.get("HOLD-BACK");
			if (value !== void 0) {
				const parsed = Number.parseFloat(value);
				if (Number.isFinite(parsed) && parsed > 0) holdBack = parsed;
			}
			if (serverControl.get("PART-HOLD-BACK") !== void 0) lowLatency = true;
			continue;
		}
		if (trimmed.startsWith("#EXT-X-PART-INF") || trimmed.startsWith("#EXT-X-PART:")) {
			lowLatency = true;
			continue;
		}
		if (trimmed === "#EXTM3U" || trimmed.startsWith("#EXT-X-VERSION:") || trimmed.startsWith("#EXT-X-INDEPENDENT-SEGMENTS")) continue;
		const mapAttrs = matchTag(trimmed, "EXT-X-MAP");
		if (mapAttrs) {
			const uri = mapAttrs.get("URI");
			if (uri) {
				initSegmentUrl = resolveUrl(uri, baseUrl);
				const byteRangeStr = mapAttrs.get("BYTERANGE");
				if (byteRangeStr) initSegmentByteRange = parseByteRange(byteRangeStr, 0) ?? void 0;
			}
			continue;
		}
		if (trimmed.startsWith("#EXTINF:")) {
			currentDuration = parseExtInfDuration(trimmed.slice(8));
			continue;
		}
		if (trimmed.startsWith("#EXT-X-BYTERANGE:")) {
			currentByteRange = parseByteRange(trimmed.slice(17), previousByteRangeEnd) ?? void 0;
			continue;
		}
		if (trimmed === "#EXT-X-ENDLIST") {
			endList = true;
			continue;
		}
		if (!trimmed.startsWith("#") && currentDuration > 0) {
			const segment = {
				id: `segment-${mediaSequence + segmentIndex}`,
				url: resolveUrl(trimmed, baseUrl),
				duration: currentDuration,
				startTime: currentTime
			};
			if (!isUndefined(currentStartDate)) {
				segment.startDate = currentStartDate;
				currentStartDate += currentDuration;
			}
			if (currentByteRange) {
				segment.byteRange = currentByteRange;
				previousByteRangeEnd = currentByteRange.end + 1;
			} else previousByteRangeEnd = void 0;
			segments.push(segment);
			currentTime += currentDuration;
			segmentIndex++;
			currentDuration = 0;
			currentByteRange = void 0;
		}
	}
	const complete = endList || playlistType === "VOD";
	const anchor = previous.startDate;
	const hasPdt = segments.some((segment) => !isUndefined(segment.startDate));
	const placed = !isUndefined(anchor) && hasPdt ? placeOnAnchor(segments, anchor) : isResolvedTrack(previous) ? placeOnPreviousTimeline(previous, segments, mediaSequence, targetDuration) : segments;
	const lastPlaced = placed[placed.length - 1];
	const placedEnd = lastPlaced ? lastPlaced.startTime + lastPlaced.duration : 0;
	const trackDuration = complete ? placedEnd : Number.POSITIVE_INFINITY;
	const anchorSegment = placed.find((segment) => !isUndefined(segment.startDate));
	const startDate = anchorSegment && !isUndefined(anchorSegment.startDate) ? anchorSegment.startDate - anchorSegment.startTime : void 0;
	const initialization = previous.type === "text" && !initSegmentUrl ? void 0 : initSegmentUrl ? {
		url: initSegmentUrl,
		...initSegmentByteRange ? { byteRange: initSegmentByteRange } : {}
	} : { url: "" };
	const detectedContainer = initSegmentUrl ? void 0 : containerMimeFromSegment(placed[0]?.url);
	const mimeType = previous.type !== "text" && detectedContainer ? detectedContainer : previous.mimeType;
	return {
		...previous,
		mimeType,
		startTime: 0,
		startDate,
		duration: trackDuration,
		segments: placed,
		initialization,
		metadata: {
			...previous.metadata,
			[MEDIA_PLAYLIST_METADATA_KEY]: {
				targetDuration,
				mediaSequence,
				playlistType,
				lowLatency,
				endList,
				holdBack,
				encrypted: keys.length > 0,
				...keys.length > 0 && { keys }
			}
		}
	};
}

//#endregion
//#region ../spf/dist/dev/media/dom/capabilities.js
/**
* Capability probing — the engine's foundation for asking the browser what it can actually decode before committing a
* rendition to the pipeline.
*
* Today this is the synchronous codec half: `canPlayTrack` answers "can this environment play this track?" by building
* the track's MIME codec string and passing it to `MediaSource.isTypeSupported` (via `isCodecSupported`). It's the DOM
* implementation of the DOM-free `CanPlayTrack` predicate the track-switching hard-constraint pre-pass consumes —
* injected through engine config so the (DOM-free) behavior never imports a DOM API directly.
*
* Results are memoized by built MIME string: codec support is a pure function of (codec, environment) and never changes
* after load, so probing is lazy (per candidate, at constraint-apply time) but each unique MIME is asked once.
*
* Future cluster-D phases (async `requestMediaKeySystemAccess` key-system probing, `SourceBuffer.changeType()`
* availability) extend this surface; the async ones land as a state-slot writer behavior rather than a config
* predicate, since their verdict resolves asynchronously.
*/
const codecSupportCache = /* @__PURE__ */ new Map();
/** The container + codec half shared by both probes below. */
const canDecodeTrack = (track) => {
	if (track.mimeType && NON_FMP4_CONTAINER_MIMES.has(track.mimeType)) return false;
	if (!track.mimeType || !track.codecs?.length) return true;
	const mimeCodec = buildMimeCodec({
		mimeType: track.mimeType,
		codecs: track.codecs
	});
	const cached = codecSupportCache.get(mimeCodec);
	if (cached !== void 0) return cached;
	const supported = isCodecSupported(mimeCodec);
	codecSupportCache.set(mimeCodec, supported);
	return supported;
};
/**
* Whether the environment can decode `track`, by codec. Builds the track's MIME codec string and checks
* `MediaSource.isTypeSupported`, memoized by MIME. A track without enough to probe — no `mimeType`, or no declared
* `codecs` (CODECS is optional per the HLS spec) — is unprobeable and passes through as playable (`true`) rather than
* being dropped; the late `createSourceBuffer` check stays as the backstop for those.
*
* Detected non-fMP4 containers (`video/mp2t`, `audio/aac`) are asserted unsupported regardless of the probe, so they're
* pruned before selection (the type makes no pick) instead of failing/stalling deep in the pipeline. Two different
* reasons, neither UA-based:
*
* - **MPEG-TS** can't be played at all here: `isTypeSupported('video/mp2t…')` is a genuine false positive on Chromium
*   (reports `true` but appends produce no buffered range), and this engine has no TS transmux pipeline.
* - **Raw ADTS AAC** is a _temporary_ limitation. The browser genuinely supports it (Chrome/Safari decode `audio/aac`;
*   Firefox doesn't), so it could be made playable — but our segment actors / loading behaviors / append pipeline
*   assume every rendition has an `EXT-X-MAP` init segment (e.g. an `append-init` task with an empty URL, fMP4-shaped
*   append handling). Until that init-segment assumption is removed, ADTS would fetch but never buffer (a silent
*   stall), so we assert it unplayable for now. FOLLOW-UP: drop the init-required assumption in the pipeline and switch
*   this to a bare-MIME probe (`buildMimeCodec` would project `audio/aac` with no codecs) so it plays where the browser
*   supports it.
*
* Override via the engine's `canPlayTrack` config when those pipelines land.
*/
const canPlayTrack = (track) => {
	if (getMediaPlaylistMetadata(track)?.encrypted) return false;
	return canDecodeTrack(track);
};
/**
* DRM-composed variant of {@link canPlayTrack}: an encrypted rendition is playable when its declared keys reach a key
* system with a configured license server (its container / codecs still have to probe as decodable); everything else
* matches the standard probe. Encrypted renditions no configured system serves stay pruned — MediaKeys could never be
* negotiated for them, so playing them would park forever behind the `segmentLoadingBlocked` gate. Reads the engine's
* `drm` and `keySystems` off the config it is handed (see `DrmConfig`); with either absent, nothing serves any key and
* it refuses encrypted renditions exactly as {@link canPlayTrack} does.
*/
const canPlayTrackWithDrm = (track, config) => {
	const metadata = getMediaPlaylistMetadata(track);
	if (metadata?.encrypted) {
		const { drm = {}, keySystems = [] } = config ?? {};
		if (keySystemCandidates(metadata.keys ?? [], drm, keySystems).length === 0) return false;
	}
	return canDecodeTrack(track);
};

//#endregion
//#region ../spf/dist/dev/media/utils/track-selection.js
/** Map track type to selected track ID property key in state. */
const SelectedTrackIdKeyByType = {
	video: "selectedVideoTrackId",
	audio: "selectedAudioTrackId",
	text: "selectedTextTrackId"
};
/**
* Get selected track from state by type. Returns properly typed track (partially or fully resolved) or undefined. Type
* parameter T is inferred from the type argument.
*
* @example
*   const videoTrack = getSelectedTrack(state, 'video');
*   if (videoTrack && isResolvedTrack(videoTrack)) {
*     // videoTrack is VideoTrack
*   }
*/
function getSelectedTrack(state, type) {
	const { presentation } = state;
	if (!presentation?.selectionSets) return void 0;
	const trackId = state[SelectedTrackIdKeyByType[type]];
	return presentation.selectionSets.find(({ type: selectionSetType }) => selectionSetType === type)?.switchingSets[0]?.tracks.find(({ id }) => id === trackId);
}
/**
* Returns the duration of the first resolved selected track, preferring video over audio. A track is "resolved" once
* its media playlist has been parsed (per {@link isResolvedTrack}). Returns `undefined` if neither selected track is
* resolved.
*/
function getResolvedSelectedTrackDuration(state) {
	if (state.selectedVideoTrackId) {
		const video = getSelectedTrack(state, "video");
		if (video && isResolvedTrack(video)) return video.duration;
	}
	if (state.selectedAudioTrackId) {
		const audio = getSelectedTrack(state, "audio");
		if (audio && isResolvedTrack(audio)) return audio.duration;
	}
}

//#endregion
//#region ../spf/dist/dev/network/credentials-fetch.js
/**
* Decorate a fetch so every request carries the mode the policy resolves to. The decorated fetch's type is preserved,
* so this wraps the manifest, playlist, and segment fetches alike.
*
* The policy runs per request rather than once at decoration: it mirrors the media element's `crossorigin` attribute,
* which an author can change after the fetch was built. An explicit per-call `credentials` still wins, and a policy
* yielding `undefined` leaves the request at the platform default — `Request` treats an `undefined` init member as
* absent.
*/
function credentialsFetch(baseFetch, policy) {
	if (policy === void 0) return baseFetch;
	const resolve = isFunction(policy) ? policy : () => policy;
	return ((addressable, options) => baseFetch(addressable, {
		credentials: resolve(addressable),
		...options
	}));
}

//#endregion
//#region ../spf/dist/dev/core/tasks/task.js
/**
* Generic reusable task that wraps an async run function.
*
* Owns its own AbortController so it can always be aborted independently. Optionally composes an external AbortSignal
* so that a parent's cancellation propagates into the task's work without requiring the caller to track the task
* separately.
*
* `run()` is memoized: the work runs at most once per instance, and every call returns the same promise (so observers
* can `await run()` to read the result without re-triggering the work). To re-run the _same_ work, take a `clone()` — a
* fresh instance with its own AbortController and a pending state.
*
* Ordering guarantee: `value` is written before `status` transitions to `'done'`; `error` is written before `status`
* transitions to `'error'`. Any reader observing `status === 'done'` is guaranteed `value` is already present.
*/
var Task = class Task {
	id;
	#runFn;
	#externalSignal;
	#abortController = new AbortController();
	#signal;
	#status = "pending";
	#value = void 0;
	#error = void 0;
	#previous = void 0;
	#promise = void 0;
	constructor(runFn, config) {
		this.#runFn = runFn;
		const rawId = config?.id;
		this.id = typeof rawId === "function" ? rawId() : rawId ?? generateId();
		this.#externalSignal = config?.signal;
		this.#signal = config?.signal ? anyAbortSignal([this.#abortController.signal, config.signal]) : this.#abortController.signal;
	}
	get status() {
		return this.#status;
	}
	get value() {
		return this.#value;
	}
	get error() {
		return this.#error;
	}
	get previous() {
		return this.#previous;
	}
	get signal() {
		return this.#signal;
	}
	run() {
		this.#promise ??= this.#execute();
		return this.#promise;
	}
	async #execute() {
		this.#status = "running";
		try {
			const result = await this.#runFn(this.#signal);
			this.#value = result;
			this.#status = "done";
			return result;
		} catch (e) {
			this.#error = e;
			this.#status = "error";
			throw e;
		}
	}
	abort() {
		this.#abortController.abort();
	}
	/**
	* A fresh task with the same work, id, and external signal, in a pending state (its own AbortController, no memoized
	* result) — so it can be run again. Used to re-run structurally identical work (e.g. `RecurringRunner` reloads).
	*
	* The clone inherits this run's value as its `previous` (or this run's own `previous` if it never produced one — e.g.
	* it errored), so a recurrence's `previous` always tracks the last _successful_ value across the lineage with no
	* bookkeeping in the runner.
	*/
	clone() {
		const cloned = new Task(this.#runFn, {
			id: this.id,
			signal: this.#externalSignal
		});
		cloned.#previous = this.#status === "done" ? this.#value : this.#previous;
		return cloned;
	}
};
/**
* Runs tasks one at a time in submission order.
*
* Each schedule() call returns a Promise that resolves or rejects with the task's result when it is eventually
* executed. Tasks wait in queue until the prior task completes.
*
* Serialization is achieved by chaining each task's run() onto the tail of a shared promise chain — no explicit queue
* or drain loop needed.
*
* AbortAll() aborts all pending (not yet started) tasks and the currently in-flight task. Pending tasks still run
* briefly but receive an aborted signal and are expected to exit early.
*/
var SerialRunner = class {
	#chain = Promise.resolve();
	#pending = /* @__PURE__ */ new Set();
	#current = null;
	#destroyed = false;
	schedule(task) {
		if (this.#destroyed) return Promise.resolve();
		const t = task;
		this.#pending.add(t);
		const result = this.#chain.then(() => {
			this.#pending.delete(t);
			this.#current = t;
			return task.run();
		}).finally(() => {
			this.#current = null;
		});
		this.#chain = result.then(() => {}, () => {});
		return result;
	}
	/**
	* A promise that resolves when all currently-scheduled tasks have settled. Use the reference as a generation token:
	* capture it after scheduling a batch, then check identity in the resolution callback to detect whether a subsequent
	* abortAll() + new batch has superseded this one.
	*/
	get settled() {
		return this.#chain;
	}
	/**
	* Registers a callback to fire when all currently-pending tasks settle. If the runner is already idle (no pending or
	* running tasks), the callback is never called. If new tasks are scheduled before the current batch settles, the
	* callback is superseded and silently dropped — no stale callbacks, no generation token required by the caller.
	*/
	whenSettled(callback) {
		if (this.#pending.size === 0 && this.#current === null) return;
		const currentChain = this.#chain;
		currentChain.then(() => {
			if (this.#chain !== currentChain) return;
			callback();
		}, () => {});
	}
	/** Aborts and clears queued tasks without touching the in-flight task. */
	abortPending() {
		for (const task of this.#pending) task.abort();
		this.#pending.clear();
	}
	abortAll() {
		this.abortPending();
		this.#current?.abort();
	}
	destroy() {
		this.#destroyed = true;
		this.abortAll();
	}
};
/**
* A {@link Reschedule} that never recurs — the task runs exactly once. Pass it to a {@link RecurringRunner} for
* non-recurring, run-once work (e.g. resolving a complete VoD playlist that can never go stale).
*/
const runOnce = () => Promise.resolve(false);
/**
* Runs a task, then re-runs it whenever a {@link Reschedule} function says to, until it says stop (or it's aborted) —
* the recurring sibling of {@link ConcurrentRunner} / {@link SerialRunner}, and like them it's handed a
* {@link TaskLike} to run.
*
* The runner has no notion of time: it just awaits whatever `reschedule` returns (resolves `true` → re-run; `false` →
* stop). A `reschedule` is required; pass {@link runOnce} for non-recurring, run-exactly-once work.
*
* Single-slot, keyed by task **id**: there is always at most one identified active task for re-running. Scheduling a
* task whose id matches the active one is a no-op — the existing recurrence keeps running (dedup by id). Scheduling a
* task with a _different_ id aborts the prior task's in-flight run and pending reschedule, then takes over the slot
* (abort-and-replace) — the right shape when there's one logical unit of recurring work (e.g. reloading the _selected_
* track's media playlist).
*
* Each re-run is a fresh `clone()` of the task (since `Task.run()` is memoized — the same instance won't re-execute),
* carrying the same id so the slot's identity is stable across cycles. The clone also carries the prior cycle's value
* forward as `task.previous`. The run function should read any inputs that change between cycles at call time rather
* than capturing them once.
*
* The task is the sole cancellation channel: `abortAll()` aborts the active task, which fires `task.signal` —
* cancelling both its in-flight run and any pending reschedule delay waiting on that signal. An aborted (or stopped)
* recurrence frees the slot, so a later schedule of the same id starts fresh.
*/
var RecurringRunner = class {
	#reschedule;
	#active = null;
	#destroyed = false;
	constructor(reschedule) {
		this.#reschedule = reschedule;
	}
	/**
	* Run `task` and recur per the `reschedule` verdict, as a single promise. Resolves with the _final_ cycle's value
	* when the recurrence stops; **rejects** if a run (or reschedule) genuinely fails — the rejection propagates to the
	* caller, who owns error handling; the runner only frees its slot (no swallowing). The runner's _own_ cancellation
	* (abort/supersede/destroy) is not a failure, so an aborted recurrence settles quietly rather than rejecting —
	* callers don't have to `.catch` routine teardown.
	*
	* Each cycle runs the task and consults `reschedule` concurrently (so the delay can be measured from the run's
	* start); when both settle and this cycle still owns the slot, a `true` verdict re-schedules a `clone()` whose
	* promise is _returned_ — so the recurrence is the method calling itself, threaded into one promise, no separate
	* loop. The clone shares the id, so the slot's identity is stable across cycles; it's released just before the
	* re-schedule so the call advances rather than dedup-returning.
	*
	* Note: because each cycle's promise adopts the next, the chain retains every prior cycle for the life of the
	* recurrence — bounded for finite recurrences, an unbounded (small per-cycle) cost for a long-lived one (e.g. live
	* reload).
	*/
	schedule(task) {
		if (this.#destroyed) return Promise.resolve();
		if (this.#active?.id === task.id) return this.#active.run();
		this.#cancel();
		this.#active = task;
		return Promise.all([task.run(), this.#reschedule(task)]).then(([value, again]) => {
			if (this.#active === task && again && !task.signal.aborted) {
				this.#active = null;
				return this.schedule(task.clone());
			}
			if (this.#active === task) this.#active = null;
			return value;
		}, (error) => {
			if (this.#active === task) this.#active = null;
			if (task.signal.aborted) return void 0;
			throw error;
		});
	}
	#cancel() {
		this.#active?.abort();
		this.#active = null;
	}
	abortAll() {
		this.#cancel();
	}
	destroy() {
		this.#destroyed = true;
		this.abortAll();
	}
};

//#endregion
//#region ../spf/dist/dev/core/actors/create-machine-actor.js
/**
* Creates a message-driven actor from a declarative definition.
*
* The actor owns a reactive snapshot signal (state + context), an optional runner, and dispatches incoming messages to
* per-state handlers. `'destroyed'` is always the implicit terminal state — `destroy()` transitions there
* unconditionally and all subsequent `send()` calls are no-ops.
*
* When a state declares `onSettled`, the framework calls `runner.whenSettled()` after the handler returns. The runner
* owns the generation-token logic — if new tasks are scheduled before the current batch settles, the callback is
* automatically superseded.
*
* @example
*   const actor = createMachineActor({
*   runner: () => new SerialRunner(),
*   initial: 'idle',
*   context: {},
*   states: {
*   idle: {
*   on: {
*   load: (msg, { transition, runner }) => {
*   segments.forEach(s => runner.schedule(new Task(...)));
*   transition('loading');
*   }
*   }
*   },
*   loading: {
*   onSettled: 'idle',
*   on: {
*   load: (msg, { runner }) => {
*   runner.abortAll();
*   segments.forEach(s => runner.schedule(new Task(...)));
*   }
*   }
*   }
*   }
*   });
*/
function createMachineActor(def) {
	const runner = def.runner?.();
	const { snapshotSignal, getState, transition } = createMachineCore({
		value: def.initial,
		context: def.context
	});
	const getContext = () => untrack(() => snapshotSignal.get().context);
	const setContext = (context) => {
		update(snapshotSignal, { context });
	};
	return {
		get snapshot() {
			return snapshotSignal;
		},
		send(message) {
			const state = getState();
			if (state === "destroyed") return;
			const handler = def.states[state]?.on?.[message.type];
			if (!handler) return;
			handler(message, {
				context: getContext(),
				getContext,
				transition: (to) => transition(to),
				setContext,
				...runner ? { runner } : {}
			});
			const newState = getState();
			if (newState !== "destroyed") {
				const newStateDef = def.states[newState];
				if (newStateDef?.onSettled && runner) {
					const targetState = newStateDef.onSettled;
					runner.whenSettled(() => {
						if (getState() !== newState) return;
						transition(targetState);
					});
				}
			}
		},
		destroy() {
			if (getState() === "destroyed") return;
			runner?.destroy();
			transition("destroyed");
		}
	};
}

//#endregion
//#region ../spf/dist/dev/media/buffer/back-buffer.js
/** Default back buffer configuration. */
const DEFAULT_BACK_BUFFER_CONFIG = { keepSegments: 2 };
/**
* Calculate back buffer flush point.
*
* Determines where to flush old segments from the back buffer. Keeps a fixed number of segments behind the current
* playback position.
*
* Algorithm: 1. Find segments before currentTime 2. Count back N segments (keepSegments) 3. Return startTime of segment
* N+1 back (flush everything before this)
*
* @example
*   const segments = [
*   { startTime: 0, duration: 6, ... },
*   { startTime: 6, duration: 6, ... },
*   { startTime: 12, duration: 6, ... },
*   { startTime: 18, duration: 6, ... },
*   ];
*
*   // Playing at 18s, keep 2 segments
*   const flushEnd = calculateBackBufferFlushPoint(segments, 18);
*   // Returns 6 (flush [0, 6), keep [6-18))
*
* @param segments - Available segments (should be sorted by startTime)
* @param currentTime - Current playback position in seconds
* @param config - Optional back buffer configuration
* @returns Time in seconds to flush up to (flush range: [0, flushEnd))
*/
function calculateBackBufferFlushPoint(segments, currentTime, config = DEFAULT_BACK_BUFFER_CONFIG) {
	if (segments.length === 0) return 0;
	const segmentsBefore = segments.filter((seg) => seg.startTime < currentTime);
	if (segmentsBefore.length === 0) return 0;
	const segmentsToFlush = segmentsBefore.length - config.keepSegments;
	if (segmentsToFlush <= 0) return 0;
	if (segmentsToFlush >= segmentsBefore.length) return currentTime;
	return segmentsBefore[segmentsToFlush].startTime;
}

//#endregion
//#region ../spf/dist/dev/playback/primitives/segment-load-pipeline.js
/**
* Base-step view of the loader's own wiring. `createSegmentLoaderActor` folds its `sourceBufferActor` + `fetch` into
* the threaded `config` so base steps read them from the uniform passthrough — present whether the loader runs inside a
* composition or standalone. `config` is loose (`object`), so assert the shape here (one cast, like relocation's
* `containerSlot`).
*/
function stepWiring(deps) {
	return deps.config;
}
/**
* Resolves when the SourceBufferActor snapshot reaches 'idle'. Rejects if the signal is aborted or the actor is
* destroyed.
*
* Used to sequence SourceBufferActor operations without awaiting send() directly — send() is fire-and-forget; callers
* observe completion via state transition.
*/
function waitForIdle(snapshot, signal) {
	return new Promise((resolve, reject) => {
		if (snapshot.get().value === "idle") {
			resolve();
			return;
		}
		if (snapshot.get().value === "destroyed") {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		let stop;
		const cleanup = (fn) => {
			stop?.();
			signal.removeEventListener("abort", onAbort);
			fn();
		};
		const onAbort = () => cleanup(() => reject(signal.reason));
		stop = effect(() => {
			const value = snapshot.get().value;
			if (value === "idle") cleanup(resolve);
			else if (value === "destroyed") cleanup(() => reject(new DOMException("Aborted", "AbortError")));
		});
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
/**
* Build the SourceBuffer message a completed frame dispatches. `fetchStep` always precedes `dispatchStep` in append
* pipelines, so `data` is set by now.
*/
function toMessage({ op, data, meta }) {
	switch (op.type) {
		case "remove": return op;
		case "append-init": return {
			type: "append-init",
			data,
			meta: op.meta
		};
		case "append-segment": return {
			type: "append-segment",
			data,
			meta: meta ?? op.meta
		};
	}
}
/**
* Fetch this op's bytes into the frame. Init segments need the full body (`minChunkSize: Infinity`) before appending;
* media segments stream so chunks append as they arrive. Awaiting headers eagerly also starts the HTTP connection (and
* records the fetch in observers like tests).
*/
const fetchStep = async (frame, signal, deps) => {
	const { op } = frame;
	if (op.type === "remove") return;
	const { fetch } = stepWiring(deps);
	frame.data = await fetch(op, op.type === "append-init" ? {
		signal,
		minChunkSize: Infinity
	} : { signal });
};
/** Dispatch the frame's message to the SourceBufferActor and await its return to idle. */
const dispatchStep = async (frame, signal, deps) => {
	const { sourceBufferActor } = stepWiring(deps);
	sourceBufferActor.send(toMessage(frame));
	await waitForIdle(sourceBufferActor.snapshot, signal);
};
/** Tier 0 default: fetch (for ops that carry bytes) then dispatch. No relocation vocabulary. */
const DEFAULT_MESSAGE_PIPELINES = () => ({
	remove: [dispatchStep],
	"append-init": [fetchStep, dispatchStep],
	"append-segment": [fetchStep, dispatchStep]
});

//#endregion
//#region ../spf/dist/dev/playback/actors/dom/segment-loader.js
/**
* Wraps a LoadTask descriptor into a Task that runs the op's message pipeline (fetch/discover/stamp/dispatch, per the
* composition's `messagePipelines`). Updates in-flight context around the async region so the loading handler can make
* accurate continue/preempt decisions at any point, and checks the abort signal before each step.
*/
function makeLoadTask(op, { getContext, setContext, pipelines, deps }) {
	return new Task(async (taskSignal) => {
		if (taskSignal.aborted) return;
		const frame = op.type === "append-segment" ? {
			op,
			meta: op.meta
		} : { op };
		try {
			if (op.type === "append-init") setContext({
				...getContext(),
				inFlightInitTrackId: op.meta.trackId
			});
			else if (op.type === "append-segment") setContext({
				...getContext(),
				inFlightSegment: {
					id: op.meta.id,
					trackId: op.meta.trackId
				}
			});
			for (const step of pipelines[op.type]) {
				if (taskSignal.aborted) return;
				await step(frame, taskSignal, deps);
			}
		} finally {
			if (op.type === "append-init") setContext({
				...getContext(),
				inFlightInitTrackId: null
			});
			else if (op.type === "append-segment") setContext({
				...getContext(),
				inFlightSegment: null
			});
		}
	});
}
/**
* Creates a SegmentLoaderActor for one track type (video or audio).
*
* Receives load assignments via `send()` and owns all execution: planning, removes, fetches, and appends. Coordinates
* with the SourceBufferActor for all physical SourceBuffer operations.
*
* Planning (Cases 1–3) happens in the `load` handler on every incoming message, producing an ordered LoadTask list. The
* runner drains that list sequentially via SerialRunner. When a new message arrives mid-run, the handler replans and
* either continues the in-flight operation (abortPending + schedule new remainder) or preempts it (abortAll + cancel
* SourceBuffer if needed + schedule new plan).
*
* @param sourceBufferActor - Shared SourceBufferActor reference (not owned)
* @param fetchBytes - Tracked fetch closure (owns throughput sampling for segments). Accepts an optional `minChunkSize`
*   in options; init segments pass `Infinity` so the entire body accumulates as one chunk before appending.
* @param compositionDeps - The composition's `state`/`context`/`config`, threaded opaquely into each step's
*   {@link StepDeps} (the loader never reads them). Lets injected steps (relocation) read composition signals at call
*   time. Defaults to empty for standalone / base-pipeline use.
*/
function createSegmentLoaderActor(sourceBufferActor, fetchBytes, config = {}, compositionDeps = {
	state: {},
	context: {},
	config: {}
}) {
	const forwardBufferConfig = {
		...DEFAULT_FORWARD_BUFFER_CONFIG,
		...config.forwardBuffer
	};
	const backBufferConfig = {
		...DEFAULT_BACK_BUFFER_CONFIG,
		...config.backBuffer
	};
	const deps = {
		state: compositionDeps.state,
		context: compositionDeps.context,
		config: {
			...compositionDeps.config,
			sourceBufferActor,
			fetch: fetchBytes
		}
	};
	const pipelines = (config.messagePipelines ?? DEFAULT_MESSAGE_PIPELINES)();
	const getBufferedSegments = (allSegments) => {
		const appended = peek(sourceBufferActor.snapshot).context.segments.filter((s) => !s.partial);
		const merged = mergeTimeRanges(appended.map((s) => ({
			start: s.startTime,
			end: s.startTime + s.duration
		})));
		return allSegments.filter((s) => isTimeRangeCovered(s.startTime, s.startTime + s.duration, merged));
	};
	/**
	* Translate a load message into an ordered LoadTask list based on committed actor state. In-flight awareness is
	* handled separately in the load handler.
	*
	* @todo Rename alongside LoadTask (e.g. planOps). Case 1 — Removes: forward and back buffer flush points,
	*   segment-aligned. ABR-style track switches (same content, different bitrate) do not flush: appending new content
	*   overwrites existing buffer ranges, and the actor's time-aligned deduplication keeps the segment model accurate as
	*   new segments arrive. Cross-rendition track switches (audio language change, text language change) do flush: the
	*   buffered content is semantically incompatible with the newly-selected track, so overwrite-on-append would leave
	*   stale content playing until each replacement segment lands. Today's predicate: `actorCtx.initTrackLanguage !==
	*   track.language` — fires for language changes, no-ops for video / same-language audio bitrate switches. Future
	*   stage: pluggable predicate / strategy at actor construction time for codec-change (5.1 surround) and other
	*   cross-rendition shapes. Case 2 — Init: schedule if not yet committed for this track. Case 3 — Segments: all
	*   segments in the load window not yet committed.
	*/
	const planTasks = (message) => {
		const { track, range } = message;
		const actorCtx = peek(sourceBufferActor.snapshot).context;
		const bufferedSegments = getBufferedSegments(track.segments);
		const currentTime = range?.start ?? 0;
		const tasks = [];
		const isCrossRenditionSwitch = actorCtx.initTrackId !== void 0 && actorCtx.initTrackId !== track.id && actorCtx.initTrackLanguage !== track.language;
		const removes = [];
		const staleRanges = [];
		if (range) {
			if (isCrossRenditionSwitch) {
				const staleStart = actorCtx.segments.find((s) => s.startTime <= currentTime && s.startTime + s.duration > currentTime)?.startTime ?? actorCtx.segments.find((s) => s.startTime > currentTime)?.startTime;
				if (staleStart !== void 0) staleRanges.push({
					start: staleStart,
					end: Infinity
				});
			}
			const forwardFlushStart = calculateForwardFlushPoint(bufferedSegments, currentTime, forwardBufferConfig);
			if (forwardFlushStart < Infinity) removes.push({
				start: forwardFlushStart,
				end: Infinity
			});
			const backFlushEnd = calculateBackBufferFlushPoint(bufferedSegments, currentTime, backBufferConfig);
			if (backFlushEnd > 0) removes.push({
				start: 0,
				end: backFlushEnd
			});
			for (const r of removes) tasks.push({
				type: "remove",
				start: r.start,
				end: r.end
			});
		}
		const overlapsStale = (seg) => {
			const segEnd = seg.startTime + seg.duration;
			return removes.some((r) => seg.startTime < r.end && segEnd > r.start) || staleRanges.some((r) => seg.startTime < r.end && segEnd > r.start);
		};
		const effectiveBuffered = removes.length + staleRanges.length > 0 ? bufferedSegments.filter((s) => !overlapsStale(s)) : bufferedSegments;
		if (actorCtx.initTrackId !== track.id) tasks.push({
			type: "append-init",
			meta: {
				trackId: track.id,
				language: track.language
			},
			url: track.initialization.url,
			...track.initialization.byteRange !== void 0 && { byteRange: track.initialization.byteRange }
		});
		if (range) {
			const segmentsToLoad = getSegmentsToLoad(track.segments, effectiveBuffered, currentTime, forwardBufferConfig).filter((seg) => {
				const existing = actorCtx.segments.find((s) => !overlapsStale(s) && Math.abs(s.startTime - seg.startTime) < 1e-4);
				if (existing?.partial) return true;
				if (!existing?.trackBandwidth || !track.bandwidth) return true;
				return track.bandwidth > existing.trackBandwidth;
			});
			for (const segment of segmentsToLoad) tasks.push({
				type: "append-segment",
				meta: {
					id: segment.id,
					startTime: segment.startTime,
					duration: segment.duration,
					trackId: track.id,
					trackBandwidth: track.bandwidth
				},
				url: segment.url,
				...segment.byteRange !== void 0 && { byteRange: segment.byteRange }
			});
		}
		return tasks;
	};
	const scheduleAll = (tasks, { getContext, setContext, runner }) => {
		tasks.forEach((op) => {
			runner.schedule(makeLoadTask(op, {
				getContext,
				setContext,
				pipelines,
				deps
			})).then(void 0, (e) => {
				if (e instanceof Error && e.name === "AbortError") return;
				console.error("Unexpected error in segment loader:", e);
				runner.abortPending();
			});
		});
	};
	return createMachineActor({
		runner: () => new SerialRunner(),
		initial: "idle",
		context: {
			inFlightInitTrackId: null,
			inFlightSegment: null
		},
		states: {
			idle: { on: { load: (msg, ctx) => {
				const allTasks = planTasks(msg);
				if (allTasks.length === 0) return;
				ctx.transition("loading");
				scheduleAll(allTasks, ctx);
			} } },
			loading: {
				onSettled: "idle",
				on: { load: (msg, ctx) => {
					const { context, runner } = ctx;
					const allTasks = planTasks(msg);
					const inFlight = context.inFlightSegment;
					const segmentInFlightStillNeeded = (t) => t.type === "append-segment" && inFlight !== null && t.meta.id === inFlight.id && t.meta.trackId === inFlight.trackId;
					if (inFlight !== null && allTasks.some(segmentInFlightStillNeeded) || context.inFlightInitTrackId !== null && allTasks.some((t) => t.type === "append-init" && t.meta.trackId === context.inFlightInitTrackId)) {
						runner.abortPending();
						scheduleAll(allTasks.filter((t) => !segmentInFlightStillNeeded(t) && !(t.type === "append-init" && t.meta.trackId === context.inFlightInitTrackId)), ctx);
					} else {
						runner.abortAll();
						if (context.inFlightSegment !== null || context.inFlightInitTrackId !== null && allTasks.some((t) => t.type === "append-init" && t.meta.trackId !== context.inFlightInitTrackId)) sourceBufferActor.send({ type: "cancel" });
						scheduleAll(allTasks, ctx);
					}
				} }
			}
		}
	});
}

//#endregion
//#region ../spf/dist/dev/media/dom/mse/append-segment.js
/**
* Append media data to a SourceBuffer.
*
* Accepts either a full ArrayBuffer (single append) or an AsyncIterable of Uint8Array chunks (one append per chunk, in
* order). Waits for `updateend` between each call so appends are serialized correctly.
*
* Errors from the SourceBuffer (`error` event) or from the iterable are propagated as rejections.
*/
async function appendSegment(sourceBuffer, data, signal) {
	if (data instanceof ArrayBuffer) await appendChunk(sourceBuffer, data);
	else try {
		for await (const chunk of data) {
			if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
			await appendChunk(sourceBuffer, chunk);
		}
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError" && !sourceBuffer.updating) try {
			sourceBuffer.abort();
		} catch {}
		throw e;
	}
}
async function appendChunk(sourceBuffer, data) {
	if (sourceBuffer.updating) await new Promise((resolve) => {
		const onUpdateEnd = () => {
			sourceBuffer.removeEventListener("updateend", onUpdateEnd);
			resolve();
		};
		sourceBuffer.addEventListener("updateend", onUpdateEnd);
	});
	return new Promise((resolve, reject) => {
		const onUpdateEnd = () => {
			cleanup();
			resolve();
		};
		const onError = (event) => {
			cleanup();
			reject(/* @__PURE__ */ new Error(`SourceBuffer append error: ${event.type}`));
		};
		const cleanup = () => {
			sourceBuffer.removeEventListener("updateend", onUpdateEnd);
			sourceBuffer.removeEventListener("error", onError);
		};
		sourceBuffer.addEventListener("updateend", onUpdateEnd);
		sourceBuffer.addEventListener("error", onError);
		try {
			sourceBuffer.appendBuffer(data);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}

//#endregion
//#region ../spf/dist/dev/media/dom/mse/buffer-flusher.js
/**
* Buffer flusher helper (P12)
*
* Removes a time range from a SourceBuffer to manage memory.
*/
/**
* Remove a time range from a SourceBuffer.
*
* Waits for the SourceBuffer to be ready (not updating), then removes the specified range. Returns a promise that
* resolves when removal completes.
*
* @example
*   await flushBuffer(videoSourceBuffer, 0, 30);
*
* @param sourceBuffer - The SourceBuffer to remove data from
* @param start - Start of the time range to remove (seconds)
* @param end - End of the time range to remove (seconds)
* @returns Promise that resolves when removal completes
*/
async function flushBuffer(sourceBuffer, start, end) {
	if (sourceBuffer.updating) await new Promise((resolve) => {
		const onUpdateEnd = () => {
			sourceBuffer.removeEventListener("updateend", onUpdateEnd);
			resolve();
		};
		sourceBuffer.addEventListener("updateend", onUpdateEnd);
	});
	return new Promise((resolve, reject) => {
		const onUpdateEnd = () => {
			cleanup();
			resolve();
		};
		const onError = (event) => {
			cleanup();
			reject(/* @__PURE__ */ new Error(`SourceBuffer remove error: ${event.type}`));
		};
		const cleanup = () => {
			sourceBuffer.removeEventListener("updateend", onUpdateEnd);
			sourceBuffer.removeEventListener("error", onError);
		};
		sourceBuffer.addEventListener("updateend", onUpdateEnd);
		sourceBuffer.addEventListener("error", onError);
		try {
			sourceBuffer.remove(start, end);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}

//#endregion
//#region ../spf/dist/dev/playback/actors/dom/source-buffer.js
function snapshotBuffered(buffered) {
	const ranges = [];
	for (let i = 0; i < buffered.length; i++) ranges.push({
		start: buffered.start(i),
		end: buffered.end(i)
	});
	return ranges;
}
function appendInitTask(message, { getContext, sourceBuffer }) {
	return new Task(async (taskSignal) => {
		const ctx = getContext();
		if (taskSignal.aborted) return ctx;
		await appendSegment(sourceBuffer, message.data);
		return {
			...ctx,
			initTrackId: message.meta.trackId,
			initTrackLanguage: message.meta.language
		};
	});
}
function appendSegmentTask(message, { getContext, sourceBuffer, setContext }) {
	return new Task(async (taskSignal) => {
		const ctx = getContext();
		if (taskSignal.aborted) return ctx;
		const { meta } = message;
		const filtered = ctx.segments.filter((s) => Math.abs(s.startTime - meta.startTime) >= SEGMENT_TIME_EPSILON);
		if (!(message.data instanceof ArrayBuffer)) setContext({
			...ctx,
			segments: [...filtered, {
				id: meta.id,
				startTime: meta.startTime,
				duration: meta.duration,
				trackId: meta.trackId,
				...meta.trackBandwidth !== void 0 && { trackBandwidth: meta.trackBandwidth },
				partial: true
			}],
			bufferedRanges: ctx.bufferedRanges
		});
		if (meta.timestampOffset != null && sourceBuffer.timestampOffset !== meta.timestampOffset) sourceBuffer.timestampOffset = meta.timestampOffset;
		await appendSegment(sourceBuffer, message.data, taskSignal);
		return {
			...ctx,
			segments: [...filtered, {
				id: meta.id,
				startTime: meta.startTime,
				duration: meta.duration,
				trackId: meta.trackId,
				...meta.trackBandwidth !== void 0 && { trackBandwidth: meta.trackBandwidth }
			}],
			bufferedRanges: snapshotBuffered(sourceBuffer.buffered)
		};
	});
}
function removeTask(message, { getContext, sourceBuffer }) {
	return new Task(async (taskSignal) => {
		const ctx = getContext();
		if (taskSignal.aborted) return ctx;
		await flushBuffer(sourceBuffer, message.start, message.end);
		const bufferedRanges = snapshotBuffered(sourceBuffer.buffered);
		const filtered = ctx.segments.filter((s) => {
			const midpoint = s.startTime + s.duration / 2;
			return bufferedRanges.some((r) => midpoint >= r.start && midpoint < r.end);
		});
		return {
			...ctx,
			segments: filtered,
			bufferedRanges
		};
	});
}
const messageTaskFactories = {
	"append-init": appendInitTask,
	"append-segment": appendSegmentTask,
	remove: removeTask
};
function messageToTask(message, options) {
	const factory = messageTaskFactories[message.type];
	return factory(message, options);
}
function createSourceBufferActor(sourceBuffer, initialContext) {
	const handleError = (e) => {
		if (!(e instanceof Error && e.name === "AbortError")) console.error("SourceBuffer operation failed:", e);
	};
	const onMessage = (msg, { transition, setContext, getContext, runner }) => {
		transition("updating");
		const task = messageToTask(msg, {
			getContext,
			sourceBuffer,
			setContext
		});
		runner.schedule(task).then(setContext, handleError);
	};
	return createMachineActor({
		runner: () => new SerialRunner(),
		initial: "idle",
		context: {
			segments: [],
			bufferedRanges: [],
			initTrackId: void 0,
			...initialContext
		},
		states: {
			idle: { on: {
				"append-init": onMessage,
				"append-segment": onMessage,
				remove: onMessage,
				batch: (msg, { transition, setContext, getContext, runner }) => {
					const { messages } = msg;
					if (messages.length === 0) return;
					transition("updating");
					messages.forEach((msg) => {
						const task = messageToTask(msg, {
							getContext,
							sourceBuffer,
							setContext
						});
						runner.schedule(task).then(setContext, handleError);
					});
				}
			} },
			updating: {
				onSettled: "idle",
				on: { cancel: (_, { runner }) => {
					runner.abortAll();
				} }
			}
		}
	});
}

//#endregion
//#region ../spf/dist/dev/playback/primitives/failover-fetch.js
/**
* Decorate a fetch so a failed request or body read trips the **selected track's** CDN into `failedCdns`. The decorated
* fetch's type is preserved, so this wraps both `resolve-track`'s playlist `FetchText` and the segment loaders'
* `FetchBytes`.
*
* The CDN id comes from the selected track's media-playlist URL, never the failed addressable: a segment URL resolves
* relative to its playlist and, per RFC 3986, drops the playlist's query string (`…/r.m3u8?cdn=fastly` → `…/0.ts`), so
* a query-keyed `getCdnId` (e.g. Mux's `cdn=`) keyed on it would derive an id that never matches the ones
* `deriveCdnPriority` / track-switching build from `track.url`. The in-flight fetch belongs to the selected track — a
* source or track switch aborts it, and aborts don't trip — so the selected track is the right CDN to fail over. For
* `resolve-track` the resolving track _is_ the selected track, so this is identical to keying on its addressable.
*
* No-op when no failover monitor is composed (it owns the signal) or the selected track can't be located.
*/
function failoverFetch(baseFetch, state, config) {
	const getCdnId$1 = config.getCdnId ?? getCdnId;
	const trackFailure = (options) => {
		if (options?.signal?.aborted || !state.failedCdns) return;
		const presentation = state.presentation.get();
		const trackId = state[config.selectedKey].get();
		const track = presentation && trackId ? findTrackById(presentation, trackId) : void 0;
		if (track) update(state.failedCdns, (cdns) => addFailedCdn(cdns, getCdnId$1(track.url)));
	};
	return (async (addressable, options) => {
		try {
			const result = await baseFetch(addressable, options);
			if (!isObject(result) || !(Symbol.asyncIterator in result) || !isFunction(result[Symbol.asyncIterator])) return result;
			const body = result;
			return { async *[Symbol.asyncIterator]() {
				try {
					yield* body;
				} catch (error) {
					trackFailure(options);
					throw error;
				}
			} };
		} catch (error) {
			trackFailure(options);
			throw error;
		}
	});
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/setup-buffer-actors.js
/**
* **Per-type buffer + segment-loader actor setup.** Per available track type (video / audio), when `mediaSource` is
* attached and the selected track of that type is present in the presentation with codecs (partial resolution from the
* multivariant playlist is enough — codecs live on the `EXT-X-STREAM-INF` line, not in the per-type media playlist),
* creates a `SourceBuffer`, a `SourceBufferActor`, and a `SegmentLoaderActor` bound to that buffer-actor; publishes the
* per-type actor slots. On `mediaSource` detach or behavior destroy, destroys both actors in reverse order and clears
* the per-type slots so the next source starts fresh.
*
* Each per-type variant (`setupVideoBufferActors` / `setupAudioBufferActors`) is a single-positive-state reactor
* (`'preconditions-unmet'` ↔ `'buffer-ready'`) gating only on its own type. No cross-type coupling in `stateKeys` —
* `setupVideoBufferActors` carries only `selectedVideoTrackId` (plus `bandwidthState`, written by its trackedFetch),
* and audio mirrors.
*
* # Firefox `mozHasAudio` invariant
*
* Appending to a video `SourceBuffer` before the audio `SourceBuffer` exists causes `mozHasAudio` to be permanently
* false in Firefox. With the two per-type variants decoupled, the invariant is no longer structural to a single `entry`
* body (as it was when both buffers were created in one synchronous block inside a merged behavior). It's now preserved
* by a chain of assumptions about how this behavior composes with its upstream and downstream siblings:
*
* 1. **Upstream — default selections land in one `runPending`.** `selectAudioTrack` (default audio) and `switchVideoTrack`
*    (default video) both subscribe to `state.presentation` flipping to resolved; their effects run in the same
*    `runPending` iteration and write `selectedAudioTrackId` + `selectedVideoTrackId` within it.
* 2. **Self — both per-type monitors flip in one `runPending`.** After (1), both monitors re-evaluate and flip to
*    `'buffer-ready'` in the next `runPending`. Both `entry` bodies run synchronously within that iteration — both
*    `addSourceBuffer` calls land before the iteration ends.
* 3. **Downstream — `appendBuffer` is async.** `loadVideoSegments` / `loadAudioSegments` read the per-type
*    `xSegmentLoaderActor` slots; their effects fire in the _next_ `runPending` and the actual `appendBuffer` requires
*    a network round-trip via the `SegmentLoaderActor` — many microtasks past both `addSourceBuffer` calls.
*
* The cross-tick failure mode — a user-initiated audio track switch _after_ video segments have begun appending — is
* out of scope for this behavior and would be addressed in the buffer/segment-loading path via `changeType`-aware
* logic.
*
* # Sole writer
*
* `setupVideoBufferActors` is sole writer of `videoBufferActor` + `videoSegmentLoaderActor` (and `bandwidthState` via
* its trackedFetch); `setupAudioBufferActors` is sole writer of `audioBufferActor` + `audioSegmentLoaderActor`. Both
* read `mediaSource` from `setupMediaSource`. Downstream MSE behaviors (`loadVideoSegments`, `loadAudioSegments`,
* `endOfStream`, `updateMediaSourceDuration`) only read these slots.
*/
function setupBufferActors({ state, context, config }) {
	const { type, selectedKey, actorKey, loaderKey, fetch, forwardBuffer, backBuffer, messagePipelines } = config;
	const derivedStateSignal = computed(() => {
		if (!context.mediaSource.get()) return "preconditions-unmet";
		const selection = {
			presentation: state.presentation.get(),
			[selectedKey]: state[selectedKey].get()
		};
		return hasCodecs(getSelectedTrack(selection, type)) ? "buffer-ready" : "preconditions-unmet";
	});
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			"buffer-ready": { entry: () => {
				const mediaSource = context.mediaSource.get();
				const selection = {
					presentation: state.presentation.get(),
					[selectedKey]: state[selectedKey].get()
				};
				const track = getSelectedTrack(selection, type);
				const buffer = createSourceBuffer(mediaSource, buildMimeCodec(track));
				const bufferActor = createSourceBufferActor(buffer);
				const segmentLoader = createSegmentLoaderActor(bufferActor, fetch, {
					forwardBuffer,
					backBuffer,
					messagePipelines
				}, {
					state,
					context,
					config
				});
				context[actorKey].set(bufferActor);
				context[loaderKey].set(segmentLoader);
				const disconnect = new AbortController();
				const teardownActors = () => {
					segmentLoader.destroy();
					bufferActor.destroy();
					context[loaderKey].set(void 0);
					context[actorKey].set(void 0);
					disconnect.abort();
				};
				listen(mediaSource, "sourceclose", teardownActors, { signal: disconnect.signal });
				return teardownActors;
			} }
		}
	});
}
/**
* Set up the video `SourceBufferActor` + `SegmentLoaderActor`. Fires when `mediaSource` is attached and the selected
* video track is present in the presentation with codecs. Gates only on video state — no cross-type coupling. Owns a
* bandwidth-sampling `trackedFetch` and is sole writer of `state.bandwidthState`.
*/
const setupVideoBufferActors = defineBehavior({
	stateKeys: [
		"presentation",
		"selectedVideoTrackId",
		"bandwidthState"
	],
	contextKeys: [
		"mediaSource",
		"videoBufferActor",
		"videoSegmentLoaderActor"
	],
	setup: ({ state, context, config = {} }) => {
		const trackedFetch = createTrackedFetch(state.bandwidthState.get() ?? {
			fastEstimate: 0,
			fastTotalWeight: 0,
			slowEstimate: 0,
			slowTotalWeight: 0,
			bytesSampled: 0
		}, (next) => state.bandwidthState.set(next));
		const typeConfig = {
			...VIDEO_TYPE_CONFIG,
			...config
		};
		return setupBufferActors({
			state,
			context,
			config: {
				...typeConfig,
				messagePipelines: config[VIDEO_TYPE_CONFIG.messagePipelinesKey],
				fetch: failoverFetch(credentialsFetch(trackedFetch, config.requestCredentials), state, typeConfig)
			}
		});
	}
});
/**
* Set up the audio `SourceBufferActor` + `SegmentLoaderActor`. Same shape as `setupVideoBufferActors`, narrowed to
* audio. Today supplies a non-sampling `fetchStream` (no audio ABR); adding audio ABR is a localized change to this
* setup body (swap `fetchStream` for a `createTrackedFetch` call + declare `bandwidthState` writable here) without
* touching the shared helper. See `internal/design/spf/features/audio-abr.md` for the design surface (bandwidth-state
* sharing, multi-writer coordination, EWMA mixed- source sampling).
*
* **Mid-stream audio track switching is NOT this behavior's concern.** Slot writes to `selectedAudioTrackId` (default
* selection, programmatic filter-driven, future ABR) are owned by `switchAudioTrack` / future `switchAudioQuality` in
* `track-switching.ts`. Flush orchestration on track change is dispatched from there via `audioBufferActor.send(...)` —
* keeping this setup behavior focused on per-source actor lifecycle.
*/
const setupAudioBufferActors = defineBehavior({
	stateKeys: ["presentation", "selectedAudioTrackId"],
	contextKeys: [
		"mediaSource",
		"audioBufferActor",
		"audioSegmentLoaderActor"
	],
	setup: ({ state, context, config = {} }) => {
		const typeConfig = {
			...AUDIO_TYPE_CONFIG,
			...config
		};
		return setupBufferActors({
			state,
			context,
			config: {
				...typeConfig,
				messagePipelines: config[AUDIO_TYPE_CONFIG.messagePipelinesKey],
				fetch: failoverFetch(credentialsFetch(fetchStream, config.requestCredentials), state, typeConfig)
			}
		});
	}
});

//#endregion
//#region ../spf/dist/dev/core/signals/when.js
/**
* Resolve once `condition` returns true. The condition is a tracked read — it re-evaluates whenever a signal it read
* changes — so this is the promise bridge from signal space into async task bodies (await a state condition mid-task
* without polling).
*
* Settles synchronously when the condition already holds. Rejects with the abort reason when `signal` aborts first (an
* already-aborted signal rejects without evaluating the condition), so a task awaiting a condition dies with its runner
* instead of leaking the subscription.
*/
function when(condition, options = {}) {
	const { signal } = options;
	if (signal?.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (complete) => {
			if (settled) return;
			settled = true;
			complete();
			queueMicrotask(() => {
				signal?.removeEventListener("abort", onAbort);
				stop();
			});
		};
		const onAbort = () => settle(() => reject(signal?.reason));
		signal?.addEventListener("abort", onAbort, { once: true });
		const stop = effect(() => {
			if (!settled && condition()) settle(resolve);
		});
	});
}

//#endregion
//#region ../spf/dist/dev/behaviors/resolve-track.js
/**
* The playlist fetch each `resolve*` behavior installs: the default text fetch carrying the engine's request
* credentials, failover-decorated over that so a failed credentialed request still trips the selected track's CDN.
*/
function playlistFetch(state, config) {
	return failoverFetch(credentialsFetch(fetchResolvableText, config.requestCredentials), state, config);
}
function setupTrackResolution({ state, config }) {
	const { selectedKey, findTrackToResolve, fetchResolvableText: fetchResolvableText$1 = fetchResolvableText, gateFirstParse, reschedule, reportUnsupportedTrackConditions, resolveKeyUri } = config;
	const runner = new RecurringRunner(reschedule ?? runOnce);
	const derivedStateSignal = computed(() => isResolvedPresentation(state.presentation.get()) ? "presentation-resolved" : "presentation-unresolved");
	return createMachineReactor({
		initial: "presentation-unresolved",
		monitor: () => derivedStateSignal.get(),
		states: {
			"presentation-unresolved": {},
			"presentation-resolved": {
				entry: () => () => runner.abortAll(),
				effects: [() => {
					const presentation = peek(state.presentation);
					const trackId = state[selectedKey].get();
					if (!presentation || !trackId) return;
					const track = findTrackToResolve(presentation, trackId);
					if (!track || isResolvedTrack(track) && Number.isFinite(track.duration)) return;
					runner.schedule(new Task(async (signal) => {
						const snapshot = peek(state.presentation);
						const current = snapshot ? findTrackToResolve(snapshot, trackId) : void 0;
						if (!current) throw new Error("resolve-track: selected track not found");
						const text = await fetchResolvableText$1(current, { signal });
						if (gateFirstParse && !isResolvedTrack(current)) {
							const { selectedVideoTrackId, selectedAudioTrackId } = state;
							await when(() => gateFirstParse(state.presentation.get(), {
								selectedVideoTrackId: selectedVideoTrackId?.get(),
								selectedAudioTrackId: selectedAudioTrackId?.get()
							}, trackId), { signal });
						}
						const live = peek(state.presentation);
						const previous = live ? findTrackToResolve(live, trackId) : void 0;
						if (!previous) throw new Error("resolve-track: selected track not found");
						const mediaTrack = parseMediaPlaylist(text, previous, { resolveKeyUri });
						if (reportUnsupportedTrackConditions) for (const condition of reportUnsupportedTrackConditions(mediaTrack, config)) emitError(state, condition);
						update(state.presentation, (current) => {
							if (!isResolvedPresentation(current)) return current;
							const patched = updateTrackInPresentation(current, mediaTrack);
							return {
								...NON_FMP4_CONTAINER_MIMES.has(mediaTrack.mimeType) ? applyContainerMimeType(patched, mediaTrack.type, mediaTrack.mimeType) : patched,
								streamType: deriveStreamType(getMediaPlaylistMetadata(mediaTrack))
							};
						});
						return mediaTrack;
					}, { id: track.id })).catch(() => {});
				}]
			}
		}
	});
}
const VIDEO_TRACK_RESOLUTION_CONFIG = {
	...VIDEO_TYPE_CONFIG,
	findTrackToResolve: (presentation, trackId) => findTrack(presentation, "video", trackId)
};
const AUDIO_TRACK_RESOLUTION_CONFIG = {
	...AUDIO_TYPE_CONFIG,
	findTrackToResolve: (presentation, trackId) => findTrack(presentation, "audio", trackId)
};
const TEXT_TRACK_RESOLUTION_CONFIG = {
	...TEXT_TYPE_CONFIG,
	findTrackToResolve: (presentation, trackId) => findTrack(presentation, "text", trackId)
};
/**
* Resolve unresolved video tracks. Schedules a fetch task whenever the selected video track is partially resolved,
* parses the manifest, and writes the resolved track back into `state.presentation`.
*/
const resolveVideoTrack = defineBehavior({
	stateKeys: ["presentation", "selectedVideoTrackId"],
	contextKeys: [],
	setup: ({ state, config = {} }) => {
		const trackConfig = {
			...VIDEO_TRACK_RESOLUTION_CONFIG,
			...config
		};
		return setupTrackResolution({
			state,
			config: {
				...trackConfig,
				fetchResolvableText: playlistFetch(state, trackConfig)
			}
		});
	}
});
/** Resolve unresolved audio tracks. Same shape as `resolveVideoTrack`, narrowed to audio. */
const resolveAudioTrack = defineBehavior({
	stateKeys: ["presentation", "selectedAudioTrackId"],
	contextKeys: [],
	setup: ({ state, config = {} }) => {
		const trackConfig = {
			...AUDIO_TRACK_RESOLUTION_CONFIG,
			...config
		};
		return setupTrackResolution({
			state,
			config: {
				...trackConfig,
				fetchResolvableText: playlistFetch(state, trackConfig)
			}
		});
	}
});
/** Resolve unresolved text tracks. Same shape as `resolveVideoTrack`, narrowed to text. */
const resolveTextTrack = defineBehavior({
	stateKeys: ["presentation", "selectedTextTrackId"],
	contextKeys: [],
	setup: ({ state, config = {} }) => {
		const trackConfig = {
			...TEXT_TRACK_RESOLUTION_CONFIG,
			...config
		};
		return setupTrackResolution({
			state,
			config: {
				...trackConfig,
				fetchResolvableText: playlistFetch(state, trackConfig)
			}
		});
	}
});

//#endregion
//#region ../spf/dist/dev/playback/primitives/report-track-conditions.js
/**
* The seam `resolve-track` uses to report conditions discovered in a freshly parsed media playlist.
*
* Injected rather than baked in so `resolve-track` stays free of format and policy knowledge: it parses and commits,
* and whatever the composition wants noticed about the result is this function's business. Which conditions matter, and
* which codes they carry, therefore vary per composition — a provider that never ships MPEG-TS can drop that check, and
* future playlist-derived notices (LL-HLS or DVR support that's partial rather than absent) attach here without
* touching the resolver.
*
* Reported **per rendition, as it resolves**, which is why these are causes and not verdicts: one rendition being
* unplayable doesn't make the source unplayable. The verdict is `track-switching`'s, which reports
* `SVTA_NO_SUPPORTED_{VIDEO,AUDIO}_TRACK` when a type's candidates actually empty. Keeping the two apart is what lets a
* mixed source — some renditions encrypted or MPEG-TS, others playable — log its causes and still play.
*/
/** Unsupported-format code per type; text has none — absent captions aren't a failure. */
const UNSUPPORTED_FORMAT_CODE = {
	video: SVTA_UNSUPPORTED_VIDEO_FORMAT,
	audio: SVTA_UNSUPPORTED_AUDIO_FORMAT
};
/**
* The types a reported cause can legitimately describe: the ones whose candidates `canPlayTrack` actually prunes, via
* `track-switching`'s `excludeUnplayableTracks` pre-pass.
*
* Text is outside it by design — its switching chain runs failed-CDN constraints alone, because an MSE codec probe is
* the wrong question for a WebVTT rendition (see `track-switching.ts`). So nothing prunes a text rendition, no verdict
* can follow from one, and a cause reported against it would be an orphan: the adapter's unsupported-feature
* substitution scans the sequence as a whole, so a lone encrypted subtitle would otherwise recode an unrelated verdict
* — an all-CDN cooldown among them — as "this engine can't play the source".
*/
const CAPABILITY_PRUNED_TYPES = /* @__PURE__ */ new Set(["video", "audio"]);
/**
* The default: report what makes a rendition unplayable _to this engine_ — a container MSE can't accept, or encryption
* with no decryption pipeline. Both mirror what `canPlayTrack` prunes on, so a reported cause always has a
* corresponding exclusion.
*
* A condition carries its code and its context, not copy. `data.mimeType` is what preserves the specificity — the
* format codes cover every non-fMP4 container, so "which one" lives there for a consumer that wants to say, rather than
* being flattened into an English sentence here.
*
* Both carry `trackType`, redundantly for the format codes (1004/1005 are already per type) but not for 4008, which
* isn't per type — SVTA has one content-protection code for both. Nothing branches on the tag: it's diagnostic context,
* reaching a developer through the logged sequence and `error.data`, which is why it goes on every condition rather
* than only where the code can't carry it. `trackId` alongside it is what distinguishes two renditions of the same
* type.
*/
function reportUnsupportedTrackConditions(track) {
	return unsupportedTrackConditions(track, Boolean(getMediaPlaylistMetadata(track)?.encrypted));
}
/**
* DRM-composed variant of {@link reportUnsupportedTrackConditions}: encryption is only a cause when no configured key
* system serves the rendition's declared keys — mirroring what `canPlayTrackWithDrm` prunes on, so a reported cause
* still always has a corresponding exclusion. Reads the engine's `drm` and `keySystems` off the config it is handed
* (see `DrmConfig`); with either absent, nothing serves any key and encryption is a cause exactly as in the default.
*/
const reportUnsupportedTrackConditionsWithDrm = (track, config) => {
	const metadata = getMediaPlaylistMetadata(track);
	const { drm = {}, keySystems = [] } = config ?? {};
	return unsupportedTrackConditions(track, Boolean(metadata?.encrypted) && keySystemCandidates(metadata?.keys ?? [], drm, keySystems).length === 0);
};
function unsupportedTrackConditions(track, encryptionUnsupported) {
	if (!CAPABILITY_PRUNED_TYPES.has(track.type)) return [];
	const conditions = [];
	const data = {
		trackType: track.type,
		trackId: track.id
	};
	const formatCode = UNSUPPORTED_FORMAT_CODE[track.type];
	if (formatCode !== void 0 && NON_FMP4_CONTAINER_MIMES.has(track.mimeType)) conditions.push({
		code: formatCode,
		data: {
			...data,
			mimeType: track.mimeType
		}
	});
	if (encryptionUnsupported) conditions.push(unsupportedEncryptionMethodCause(getMediaPlaylistMetadata(track)?.keys ?? [], data) ?? {
		code: 4008,
		data
	});
	return conditions;
}

//#endregion
//#region ../spf/dist/dev/behaviors/calculate-presentation-duration.js
function calculatePresentationDurationSetup({ state, config }) {
	return effect(() => {
		const presentation = state.presentation.get();
		if (!presentation || presentation.duration !== void 0) return;
		const resolverInput = untrack(() => ({
			presentation,
			selectedVideoTrackId: state.selectedVideoTrackId?.get(),
			selectedAudioTrackId: state.selectedAudioTrackId?.get()
		}));
		const duration = config.resolveDuration(resolverInput);
		if (duration === void 0 || Number.isNaN(duration) || duration <= 0) return;
		update(state.presentation, { duration });
	});
}
/**
* `calculatePresentationDuration` uses a manual `Behavior<>` literal (rather than `defineBehavior`) so it can declare
* just `presentation` in its stateKeys while the typed setup-param shape includes the optional `selectedVideoTrackId` /
* `selectedAudioTrackId` reads used at runtime. Mirrors the pattern in `endOfStream` for the same reason: the behavior
* is uniform-across-tracks and reads slots contributed by other behaviors, so it shouldn't leak those slot declarations
* into variants that don't compose the contributors.
*/
const calculatePresentationDuration = {
	stateKeys: ["presentation"],
	contextKeys: [],
	setup: calculatePresentationDurationSetup
};

//#endregion
//#region ../spf/dist/dev/features/calculate-duration.js
/** The behaviors the feature composes, in setup order. */
const behaviors$4 = [calculatePresentationDuration];
/** The config defaults the feature contributes. */
const defaultConfig$4 = { resolveDuration: getResolvedSelectedTrackDuration };
/** The state values the feature seeds. */
const initialState$4 = {};
/**
* Calculates the presentation's duration from its selected tracks once they've loaded.
*
* Requires a writer of resolved, selected video or audio tracks, such as `videoFeature` or `audioFeature`; without one,
* no duration is set.
*/
const calculateDurationFeature = defineFeature({
	behaviors: behaviors$4,
	defaultConfig: defaultConfig$4,
	initialState: initialState$4
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/track-current-time.js
/**
* Mirror `mediaElement.currentTime` into reactive state. Listens for:
*
* - `timeupdate` — fires during playback (~4 Hz)
* - `seeking` — fires when a seek begins; per spec, `currentTime` is already at the new position when this event
*   dispatches, so buffer management can react immediately rather than waiting for `timeupdate`, which does not fire
*   while paused.
* - `emptied` — fires when the resource selection algorithm tears down the current media (e.g. a new `src` is set on the
*   same element). Re-syncs so downstream state doesn't retain the stale playback position from the previous source
*   when the engine is reused across src changes.
*
* Also syncs immediately when a media element becomes available.
*
* When no media element is attached, writes `config.defaultCurrentTime` (default-default `0`, matching the
* HTMLMediaElement spec) so consumers always see a defined position. Read-only mirror; does not push
* `state.currentTime` back to the element.
*/
function trackCurrentTimeSetup({ state, context, config }) {
	const defaultCurrentTime = config?.defaultCurrentTime ?? 0;
	return effect(() => {
		const mediaElement = context.mediaElement.get();
		if (!mediaElement) {
			state.currentTime.set(defaultCurrentTime);
			return;
		}
		const sync = () => state.currentTime.set(mediaElement.currentTime);
		sync();
		const removeEmptied = listen(mediaElement, "emptied", sync);
		const removeTimeupdate = listen(mediaElement, "timeupdate", sync);
		const removeSeeking = listen(mediaElement, "seeking", sync);
		return () => {
			removeEmptied();
			removeTimeupdate();
			removeSeeking();
		};
	});
}
const trackCurrentTime = defineBehavior({
	stateKeys: ["currentTime"],
	contextKeys: ["mediaElement"],
	setup: trackCurrentTimeSetup
});

//#endregion
//#region ../spf/dist/dev/features/current-time.js
/** The behaviors the feature composes, in setup order. */
const behaviors$3 = [trackCurrentTime];
/** The config defaults the feature contributes. */
const defaultConfig$3 = {};
/** The state values the feature seeds. */
const initialState$3 = {};
/** Mirrors the media element's `currentTime` into state, which segment loading reads to plan what to load next. */
const currentTimeFeature = defineFeature({
	behaviors: behaviors$3,
	defaultConfig: defaultConfig$3,
	initialState: initialState$3
});

//#endregion
//#region ../spf/dist/dev/media/dom/mse/duration.js
/**
* Check if we have the basics to update MediaSource duration: a `mediaSource` and a `presentation` with a numeric
* duration.
*/
function canUpdateDuration(presentation, mediaSource) {
	return !!(mediaSource && presentation && hasPresentationDuration(presentation));
}
function getBufferedEnd(buffers, isEndMatch) {
	return [...buffers].reduce((endMatch, buffer) => {
		const { buffered } = buffer;
		if (!buffered.length) return endMatch;
		const end = buffered.end(buffered.length - 1);
		if (!endMatch) return end;
		return isEndMatch(end, endMatch) ? end : endMatch;
	}, void 0) ?? 0;
}
const isGreaterThan = (x, y) => x > y;
const isLessThan = (x, y) => x < y;
/**
* Get the maximum buffered end time across an iterable of SourceBuffers (typically `mediaSource.sourceBuffers`).
* Returns `0` when the collection is empty or no buffer has any buffered ranges.
*/
function getMaxBufferedEnd(buffers) {
	return getBufferedEnd(buffers, isGreaterThan);
}
/**
* Get the reachable buffered end across an iterable of SourceBuffers (typically `mediaSource.sourceBuffers`): the `min`
* of each buffer's last buffered-range end — the furthest point every track can play to (the intersection end). Buffers
* with no buffered ranges are skipped. Returns `0` when the collection is empty or no buffer has any buffered ranges.
*
* Counterpart to {@link getMaxBufferedEnd}: `max` bounds the overall presentation end (e.g. for setting `duration`),
* `min` bounds where playback can actually reach when tracks end at slightly different times (e.g. skewed A/V near
* end-of-stream).
*/
function getMinBufferedEnd(buffers) {
	return getBufferedEnd(buffers, isLessThan);
}
/**
* Check if the preconditions are met to _attempt_ a `mediaSource.duration` write: a `mediaSource` is in scope and the
* presentation has a valid positive duration (or `Infinity` for live).
*
* Does **not** check `mediaSource.readyState` or `mediaSource.duration` — those are DOM properties the caller resolves
* at write time (e.g., by `await`ing `waitForMediaSourceOpen` and re-checking `readyState` after, and guarding on the
* existing `mediaSource.duration` for idempotency). Keeping these off the signal-driven predicate lets callers use this
* inside reactor state derivation without smuggling non-reactive DOM reads into `computed(...)`.
*
* `Infinity` is allowed — per the MSE spec, `mediaSource.duration = +Infinity` is how live playback signals an
* indefinite duration.
*/
function shouldUpdateDuration(presentation, mediaSource) {
	if (!canUpdateDuration(presentation, mediaSource)) return false;
	const duration = presentation.duration;
	if (Number.isNaN(duration) || duration <= 0) return false;
	return true;
}
/**
* Wait for all currently-updating SourceBuffers in `buffers` to finish, or until `signal` aborts — whichever fires
* first.
*
* The MSE spec forbids setting `MediaSource.duration` while any attached SourceBuffer has `updating === true`. This
* defers until all are idle. Listeners are registered with `{ signal }` so an abort tears them down up-front rather
* than leaving them dangling until the next `updateend`.
*/
function waitForSourceBuffersReady(buffers, signal) {
	if (signal.aborted) return Promise.resolve();
	const updating = [];
	for (const buf of buffers) if (buf.updating) updating.push(buf);
	if (updating.length === 0) return Promise.resolve();
	return new Promise((resolve) => {
		let remaining = updating.length;
		const onUpdateEnd = () => {
			remaining--;
			if (remaining === 0) resolve();
		};
		for (const buf of updating) buf.addEventListener("updateend", onUpdateEnd, {
			once: true,
			signal
		});
		signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

//#endregion
//#region ../spf/dist/dev/features/error.js
/** The behaviors the feature composes, in setup order. */
const behaviors$2 = [collectErrors];
/** The config defaults the feature contributes. */
const defaultConfig$2 = {};
/** The state values the feature seeds. */
const initialState$2 = {};
/** Collects the errors the other features report into `state.errors`, per source. Without it, reporting is a no-op. */
const errorFeature = defineFeature({
	behaviors: behaviors$2,
	defaultConfig: defaultConfig$2,
	initialState: initialState$2
});

//#endregion
//#region ../spf/dist/dev/media/hls/parse-multivariant.js
/**
* Parse HLS multivariant playlist into a Presentation.
*
* Returns Presentation with partially resolved tracks (no segment information). Tracks contain metadata from
* multivariant playlist (bandwidth, resolution, codecs) but segment information is added when media playlists are
* fetched.
*
* @param text - Raw playlist text content
* @param unresolved - Unresolved presentation (contains URL for base URL resolution)
* @returns Presentation with partially resolved tracks (duration is undefined)
*/
function parseMultivariantPlaylist(text, unresolved) {
	const baseUrl = unresolved.url;
	const lines = text.split(/\r?\n/);
	const streams = [];
	const audioRenditions = [];
	const subtitleRenditions = [];
	const sessionData = [];
	let pendingStreamInfo = null;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") && !trimmed.startsWith("#EXT")) continue;
		if (trimmed === "#EXTM3U" || trimmed.startsWith("#EXT-X-VERSION:") || trimmed.startsWith("#EXT-X-INDEPENDENT-SEGMENTS")) continue;
		const sessionDataAttrs = matchTag(trimmed, "EXT-X-SESSION-DATA");
		if (sessionDataAttrs) {
			const entry = parseSessionData(sessionDataAttrs, baseUrl);
			if (entry) sessionData.push(entry);
			continue;
		}
		const mediaAttrs = matchTag(trimmed, "EXT-X-MEDIA");
		if (mediaAttrs) {
			const type = mediaAttrs.get("TYPE");
			const groupId = mediaAttrs.get("GROUP-ID");
			const name = mediaAttrs.get("NAME");
			if (type === "AUDIO" && groupId && name) {
				const uri = mediaAttrs.get("URI");
				audioRenditions.push({
					groupId,
					name,
					language: mediaAttrs.get("LANGUAGE"),
					uri: uri ? resolveUrl(uri, baseUrl) : void 0,
					default: mediaAttrs.getBool("DEFAULT"),
					autoselect: mediaAttrs.getBool("AUTOSELECT"),
					channels: mediaAttrs.getInt("CHANNELS")
				});
			}
			if (type === "SUBTITLES" && groupId && name) {
				const uri = mediaAttrs.get("URI");
				if (uri) subtitleRenditions.push({
					groupId,
					name,
					language: mediaAttrs.get("LANGUAGE"),
					uri: resolveUrl(uri, baseUrl),
					default: mediaAttrs.getBool("DEFAULT"),
					autoselect: mediaAttrs.getBool("AUTOSELECT"),
					forced: mediaAttrs.getBool("FORCED")
				});
			}
			continue;
		}
		const streamInfAttrs = matchTag(trimmed, "EXT-X-STREAM-INF");
		if (streamInfAttrs) {
			pendingStreamInfo = {
				bandwidth: streamInfAttrs.getInt("BANDWIDTH", 0),
				resolution: streamInfAttrs.getResolution("RESOLUTION"),
				codecs: streamInfAttrs.get("CODECS"),
				frameRate: streamInfAttrs.getFrameRate("FRAME-RATE"),
				audioGroupId: streamInfAttrs.get("AUDIO")
			};
			continue;
		}
		if (!trimmed.startsWith("#") && pendingStreamInfo) {
			streams.push({
				...pendingStreamInfo,
				uri: resolveUrl(trimmed, baseUrl)
			});
			pendingStreamInfo = null;
		}
	}
	const videoStreams = [];
	const audioOnlyStreams = [];
	for (const stream of streams) {
		if (!stream.codecs) {
			videoStreams.push(stream);
			continue;
		}
		const parsedCodecs = parseCodecs(stream.codecs);
		if (stream.codecs.split(",").length === 1) {
			if (parsedCodecs.audio && !parsedCodecs.video) audioOnlyStreams.push(stream);
			else videoStreams.push(stream);
		} else videoStreams.push(stream);
	}
	const videoTracksByUrl = /* @__PURE__ */ new Map();
	for (const stream of videoStreams) {
		const existing = videoTracksByUrl.get(stream.uri);
		if (existing) {
			if (stream.audioGroupId && !existing.audioGroupIds?.includes(stream.audioGroupId)) existing.audioGroupIds = [...existing.audioGroupIds ?? [], stream.audioGroupId];
			if (stream.bandwidth < existing.bandwidth) existing.bandwidth = stream.bandwidth;
			continue;
		}
		const codecs = stream.codecs ? parseCodecs(stream.codecs) : void 0;
		const track = {
			type: "video",
			id: generateId(),
			url: stream.uri,
			bandwidth: stream.bandwidth,
			mimeType: "video/mp4",
			codecs: []
		};
		if (stream.resolution?.width !== void 0) track.width = stream.resolution.width;
		if (stream.resolution?.height !== void 0) track.height = stream.resolution.height;
		if (codecs?.video) track.codecs = codecs.audio && !stream.audioGroupId ? [codecs.video, codecs.audio] : [codecs.video];
		if (stream.frameRate) track.frameRate = stream.frameRate;
		if (stream.audioGroupId) track.audioGroupIds = [stream.audioGroupId];
		videoTracksByUrl.set(stream.uri, track);
	}
	const videoTracks = [...videoTracksByUrl.values()];
	const audioOnlyTracks = audioOnlyStreams.map((stream) => {
		const codecs = stream.codecs ? parseCodecs(stream.codecs) : void 0;
		return {
			type: "audio",
			id: generateId(),
			url: stream.uri,
			bandwidth: stream.bandwidth,
			mimeType: "audio/mp4",
			codecs: codecs?.audio ? [codecs.audio] : [],
			groupId: stream.audioGroupId || "default",
			name: "Default",
			sampleRate: 48e3,
			channels: 2
		};
	});
	const audioTracks = [...audioRenditions.flatMap((rendition) => {
		let audioCodecs;
		for (const stream of streams) if (stream.audioGroupId === rendition.groupId && stream.codecs) {
			const codecs = parseCodecs(stream.codecs);
			if (codecs.audio) {
				audioCodecs = [codecs.audio];
				break;
			}
		}
		if (!rendition.uri) {
			const carrier = audioOnlyTracks.find((track) => track.groupId === rendition.groupId);
			if (carrier) {
				carrier.name = rendition.name;
				if (rendition.language) carrier.language = rendition.language;
				if (rendition.channels) carrier.channels = rendition.channels;
				if (rendition.default) carrier.default = rendition.default;
				if (rendition.autoselect) carrier.autoselect = rendition.autoselect;
				return [];
			}
		}
		const track = {
			type: "audio",
			id: generateId(),
			url: rendition.uri ?? "",
			groupId: rendition.groupId,
			name: rendition.name,
			mimeType: "audio/mp4",
			bandwidth: 0,
			sampleRate: 48e3,
			channels: rendition.channels ?? 2,
			codecs: []
		};
		if (rendition.language) track.language = rendition.language;
		if (audioCodecs) track.codecs = audioCodecs;
		if (rendition.default) track.default = rendition.default;
		if (rendition.autoselect) track.autoselect = rendition.autoselect;
		return [track];
	}), ...audioOnlyTracks];
	const textTracks = subtitleRenditions.map((rendition) => {
		const track = {
			type: "text",
			id: generateId(),
			url: rendition.uri,
			groupId: rendition.groupId,
			label: rendition.name,
			kind: "subtitles",
			mimeType: "text/vtt",
			bandwidth: 0
		};
		if (rendition.language) track.language = rendition.language;
		if (rendition.default && rendition.autoselect) track.default = true;
		if (rendition.autoselect) track.autoselect = rendition.autoselect;
		if (rendition.forced) track.forced = rendition.forced;
		return track;
	});
	const selectionSets = [];
	if (videoTracks.length > 0) {
		const videoSwitchingSet = {
			id: generateId(),
			type: "video",
			tracks: videoTracks
		};
		const videoSelectionSet = {
			id: generateId(),
			type: "video",
			switchingSets: [videoSwitchingSet]
		};
		selectionSets.push(videoSelectionSet);
	}
	if (audioTracks.length > 0) {
		const audioSwitchingSet = {
			id: generateId(),
			type: "audio",
			tracks: audioTracks
		};
		const audioSelectionSet = {
			id: generateId(),
			type: "audio",
			switchingSets: [audioSwitchingSet]
		};
		selectionSets.push(audioSelectionSet);
	}
	if (textTracks.length > 0) {
		const textSwitchingSet = {
			id: generateId(),
			type: "text",
			tracks: textTracks
		};
		const textSelectionSet = {
			id: generateId(),
			type: "text",
			switchingSets: [textSwitchingSet]
		};
		selectionSets.push(textSelectionSet);
	}
	const presentation = {
		id: generateId(),
		url: unresolved.url,
		startTime: 0,
		selectionSets
	};
	if (sessionData.length > 0) {
		const metadata = { sessionData };
		presentation.metadata = { [MULTIVARIANT_PLAYLIST_METADATA_KEY]: metadata };
	}
	return presentation;
}

//#endregion
//#region ../spf/dist/dev/media/utils/preload.js
function isStandardPreload(value) {
	return value === "auto" || value === "metadata" || value === "none";
}
/**
* Default `preload` value used as the fallback across behaviors (`syncPreload`, `resolvePresentation`,
* `isBlockingPreload`). SPF's own default, deliberately independent of the `<video>`/`<audio>` element's implicit
* default — that one is UA policy and browser-dependent (`'metadata'` Chromium, `'auto'` WebKit), never a source.
*/
const DEFAULT_PRELOAD = "metadata";
/**
* True when the preload value blocks initial resolution / loading. Falsy values (undefined, empty) fall back to
* `defaultPreload` (default `DEFAULT_PRELOAD`); the resolved value blocks iff it is `'none'`.
*/
function isBlockingPreload(preload, defaultPreload = DEFAULT_PRELOAD) {
	return (preload || defaultPreload) === "none";
}

//#endregion
//#region ../spf/dist/dev/behaviors/resolve-presentation.js
/**
* **Resolve an unresolved presentation by fetching and parsing its manifest.**
*
* Reads `state.presentation`; when it holds `{ url }` (unresolved) and the preload / load-activation gate is met,
* fetches the manifest, parses it via the **required** `config.parsePresentation`, and writes the resolved
* `Presentation` back to the same slot. The behavior is format-neutral: the composing engine wires in its parser (e.g.
* the HLS engine supplies the multivariant-playlist parser).
*
* Source-identity-driven, expressed as a 4-state machine:
*
*     'preconditions-unmet' → 'idle' → 'resolving' → 'resolved'
*
* - `'preconditions-unmet'`: no presentation, or presentation has no URL.
* - `'idle'`: URL present, unresolved, gate unmet (blocking preload + no load-activation). Waits for the gate to open.
* - `'resolving'`: URL present, unresolved, gate met. A presentation-tracking effect starts the fetch and returns the
*   AbortController — the reactor calls `.abort()` on presentation replacement or state exit, so source change /
*   gate-close / destroy all cancel cleanly. Late results commit only while the input presentation is still current.
* - `'resolved'`: `state.presentation` holds a resolved `Presentation`.
*
* Gate semantics: `state.preload` (or `config.defaultPreload`, default `'metadata'`, when state.preload is unset)
* blocks resolution when its value is `'none'` (see `isBlockingPreload` in `media/utils/preload`).
* `state.loadActivated` is an override — true bypasses the preload gate entirely.
*
* Multi-writer with the engine adapter, which writes the initial unresolved `{ url }` to `state.presentation` from src
* input. Different domains (config-input vs. derived state via fetch) — legitimate multi-writer.
*/
function deriveState$3(presentation, preload, loadActivated, defaultPreload) {
	if (!presentation?.url) return "preconditions-unmet";
	if (isResolvedPresentation(presentation)) return "resolved";
	return !!loadActivated || !isBlockingPreload(preload, defaultPreload) ? "resolving" : "idle";
}
function resolvePresentationSetup({ state, config }) {
	const { parsePresentation } = config;
	const defaultPreload = config.defaultPreload ?? "metadata";
	const fetchResolvable$1 = credentialsFetch(fetchResolvable, config.requestCredentials);
	const derivedStateSignal = computed(() => deriveState$3(state.presentation.get(), state.preload.get(), state.loadActivated.get(), defaultPreload));
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			idle: {},
			resolving: { effects: () => {
				const presentation = state.presentation.get();
				if (!presentation?.url || isResolvedPresentation(presentation)) return;
				const ac = new AbortController();
				fetchResolvable$1(presentation, { signal: ac.signal }).then((response) => getResponseText(response)).then((text) => {
					if (ac.signal.aborted || state.presentation.get() !== presentation) return;
					const parsed = parsePresentation(text, presentation);
					state.presentation.set(parsed);
				}).catch((error) => {
					if (error instanceof Error && error.name === "AbortError") return;
					console.error("[resolvePresentation] manifest fetch/parse failed:", error);
				});
				return ac;
			} },
			resolved: {}
		}
	});
}
const resolvePresentation = defineBehavior({
	stateKeys: [
		"presentation",
		"preload",
		"loadActivated"
	],
	contextKeys: [],
	setup: resolvePresentationSetup
});

//#endregion
//#region ../spf/dist/dev/features/hls-loading.js
/** The behaviors the feature composes, in setup order. */
const behaviors$1 = [resolvePresentation];
/** The config defaults the feature contributes. */
const defaultConfig$1 = { parsePresentation: parseMultivariantPlaylist };
/** The state values the feature seeds. */
const initialState$1 = {};
/** Fetches and parses the source's HLS multivariant playlist into the presentation the other features read. */
const hlsLoadingFeature = defineFeature({
	behaviors: behaviors$1,
	defaultConfig: defaultConfig$1,
	initialState: initialState$1
});

//#endregion
//#region ../spf/dist/dev/media/dom/mse/end-of-stream.js
/**
* Check if the temporally last segment of `expectedSegments` is present in `appendedSegments` and not marked partial.
*
* Compares by segment ID rather than by a pipeline flag, so the result stays correct across quality switches (different
* tracks have different segment IDs) and back-buffer flushes (flushed segment IDs are removed from the appended list).
*/
function isLastSegmentAppended(expectedSegments, appendedSegments) {
	if (expectedSegments.length === 0) return true;
	const lastSeg = expectedSegments[expectedSegments.length - 1];
	if (!lastSeg) return false;
	return appendedSegments?.some((s) => s.id === lastSeg.id && !s.partial) ?? false;
}

//#endregion
//#region ../spf/dist/dev/behaviors/dom/end-of-stream.js
/**
* Slack (seconds) on the "playhead has reached the last segment" gate. A tiny final segment (e.g. Apple's ~44ms last
* segment) starts right at the buffered end, and the browser freezes the playhead ~50–70ms short of that end (its
* render horizon), so a strict `currentTime >= lastSegStart` would never open — deadlocking `endOfStream` (the
* MediaSource stays `'open'`, so the browser keeps the playhead frozen waiting for data/EOS that never comes). This
* slack lets a playhead stalled just short of the final segment still finalize. Firing slightly early is harmless: the
* last segment is already appended (the gate above), so no more data is expected.
*/
const LAST_SEGMENT_REACHED_SLACK = .5;
function deriveState$2(presentation, mediaSource, msIsOpen, videoBufferActor, audioBufferActor, currentTime) {
	if (!mediaSource || !presentation || !msIsOpen) return "preconditions-unmet";
	const actors = [videoBufferActor, audioBufferActor].filter((a) => a !== void 0);
	if (actors.length === 0) return "preconditions-unmet";
	let lastSegStart;
	for (const actor of actors) {
		const snapshot = actor.snapshot.get();
		if (snapshot.value !== "idle") return "preconditions-unmet";
		const { initTrackId, segments: appended } = snapshot.context;
		if (!initTrackId) return "preconditions-unmet";
		const track = findTrackById(presentation, initTrackId);
		if (!track || !isResolvedTrack(track)) return "preconditions-unmet";
		if (!Number.isFinite(track.duration)) return "preconditions-unmet";
		if (!isLastSegmentAppended(track.segments, appended)) return "preconditions-unmet";
		if (track.segments.length > 0) {
			const start = track.segments[track.segments.length - 1].startTime;
			if (lastSegStart === void 0 || start > lastSegStart) lastSegStart = start;
		}
	}
	if (lastSegStart !== void 0 && (currentTime ?? 0) < lastSegStart - LAST_SEGMENT_REACHED_SLACK) return "preconditions-unmet";
	return "eos-ready";
}
function endOfStreamSetup({ state, context }) {
	const msIsOpen = signal(false);
	const cleanupMsListener = effect(() => {
		const mediaSource = context.mediaSource.get();
		if (!mediaSource) {
			msIsOpen.set(false);
			return;
		}
		msIsOpen.set(mediaSource.readyState === "open");
		const controller = new AbortController();
		onMediaSourceReadyStateChange(mediaSource, controller.signal, (rs) => {
			msIsOpen.set(rs === "open");
		});
		return () => controller.abort();
	});
	const derivedStateSignal = computed(() => deriveState$2(state.presentation.get(), context.mediaSource.get(), msIsOpen.get(), context.videoBufferActor?.get(), context.audioBufferActor?.get(), state.currentTime.get()));
	const reactor = createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			"eos-ready": { entry: () => {
				const mediaSource = context.mediaSource.get();
				const controller = new AbortController();
				const endStreamWhenReady = async () => {
					await waitForSourceBuffersReady(mediaSource.sourceBuffers, controller.signal);
					if (controller.signal.aborted) return;
					const bufferedEnd = getMaxBufferedEnd(mediaSource.sourceBuffers);
					if (bufferedEnd > 0) mediaSource.duration = bufferedEnd;
					mediaSource.endOfStream();
				};
				endStreamWhenReady().catch((err) => console.error("Failed to call endOfStream:", err));
				return () => controller.abort();
			} }
		}
	});
	return () => {
		cleanupMsListener();
		reactor.destroy();
	};
}
/**
* `endOfStream` uses a manual `Behavior<>` literal (rather than `defineBehavior`) because it reads `videoBufferActor` /
* `audioBufferActor` defensively without declaring them in its contextKeys — those slots are contributed by other
* behaviors and compose conditionally per engine variant. The `Behavior<>` literal opts out of the exhaustiveness check
* so the typed context shape can include the optional fields used at runtime. See the comment on `endOfStreamSetup`'s
* context param for the discipline.
*/
const endOfStream = {
	stateKeys: ["presentation", "currentTime"],
	contextKeys: ["mediaSource"],
	setup: endOfStreamSetup
};

//#endregion
//#region ../spf/dist/dev/behaviors/dom/setup-mediasource.js
/**
* **Own the MediaSource lifecycle for the current source.** When a resolved presentation and a mediaElement are both in
* scope, creates a MediaSource, attaches it to the element, waits for `'open'`, and publishes it on
* `context.mediaSource`. On source change or behavior destroy, detaches the MediaSource and clears the slot so the next
* source starts fresh.
*
* Single-positive-state reactor (`'preconditions-unmet'` ↔ `'mediasource-attached'`): state derivation gates on
* `mediaElement + isResolvedPresentation`. Riding the resolver's resolved/unresolved lifecycle makes direct URL
* replacement structural — `resolvePresentation` routes the presentation back through unresolved on URL change, which
* drives this reactor through `'preconditions-unmet'` so the entry's state-exit cleanup detaches the old MediaSource
* before the new one is built.
*
* The entry resolves preconditions in sequence before publishing:
*
* 1. **Create + attach** — `createMediaSource` + `attachMediaSource` run synchronously on entry. The `detach` closure
*    returned by `attachMediaSource` is captured for state-exit cleanup, so the cleanup is always bound to its setup
*    even if the wait below is aborted.
* 2. **Wait for `'open'`** — `waitForMediaSourceOpen` defers until the first `sourceopen` event (or any readyState
*    transition out of `'closed'`).
* 3. **Publish on `'open'`** — re-check `readyState === 'open'` after the await (covers `'ended'` / `'closed'` race)
*    before writing to `context.mediaSource`. Downstream `setupVideoBufferActors` / `setupAudioBufferActors` call
*    `addSourceBuffer` directly, which throws on non-open, so publish-only-when-open is the load-bearing contract.
*
* State-exit cleanup aborts the in-flight wait, detaches the MediaSource, and clears `context.mediaSource`. Order:
* abort first (prevents a late publish racing the slot clear), then detach, then clear.
*
* # Sourceclose recovery
*
* The behavior owns one **unclosed** MediaSource per source identity. The UA can close the attached MediaSource out
* from under the engine (Safari on an AirPlay handoff — see `setupAirPlay` — or a ManagedMediaSource evicted under
* memory pressure), and a closed MediaSource can never reopen. The `sourceclose` listener tears the attachment down
* synchronously; every teardown records a local close-fact, which holds the machine out until the fact is consumed —
* then the re-derive comes back in with a fresh MediaSource for the _same_ source. Cause-agnostic. Consumption honors
* an observed `loadingSuspended` (attaching runs `element.load()` — new loading work, e.g. resource selection under an
* active AirPlay receiver), and happens only while the machine is out, so a suspension can never tear down an existing
* attachment.
*
* Sole writer of `context.mediaSource`; other MSE behaviors (`setupVideoBufferActors`, `setupAudioBufferActors`,
* `updateMediaSourceDuration`, `endOfStream`, `loadVideoSegments`) only read.
*/
function deriveState$1(presentation, mediaElement, mediaSourceClosed) {
	if (!mediaElement || !isResolvedPresentation(presentation)) return "preconditions-unmet";
	if (mediaSourceClosed) return "preconditions-unmet";
	return "mediasource-attached";
}
function setupMediaSourceSetup({ state, context, config = {} }) {
	const attach = config.attachMediaSource ?? attachMediaSource;
	const loadingSuspended = state.loadingSuspended;
	const mediaSourceClosed = signal(false);
	const derivedStateSignal = computed(() => deriveState$1(state.presentation.get(), context.mediaElement.get(), mediaSourceClosed.get()));
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": { effects: () => {
				if (mediaSourceClosed.get() && !loadingSuspended?.get()) mediaSourceClosed.set(false);
			} },
			"mediasource-attached": { entry: () => {
				const mediaElement = context.mediaElement.get();
				const controller = new AbortController();
				const mediaSource = createMediaSource({ preferManaged: true });
				const { detach } = attach(mediaSource, mediaElement);
				const teardown = () => {
					mediaSourceClosed.set(true);
					controller.abort();
					context.mediaSource.set(void 0);
					detach({ deferReset: true });
				};
				listen(mediaSource, "sourceclose", teardown, { signal: controller.signal });
				const publishWhenOpen = async () => {
					await waitForMediaSourceOpen(mediaSource, controller.signal);
					if (controller.signal.aborted) return;
					if (mediaSource.readyState !== "open") {
						console.warn(`[setupMediaSource] MediaSource transitioned to '${mediaSource.readyState}' before first 'sourceopen' — slot left unpublished; recoverable on next source reset.`);
						return;
					}
					context.mediaSource.set(mediaSource);
				};
				publishWhenOpen().catch((err) => console.error("[setupMediaSource] failed to publish MediaSource:", err));
				return teardown;
			} }
		}
	});
}
const setupMediaSource = defineBehavior({
	stateKeys: ["presentation"],
	contextKeys: ["mediaElement", "mediaSource"],
	setup: setupMediaSourceSetup
});

//#endregion
//#region ../spf/dist/dev/behaviors/dom/update-mediasource-duration.js
/**
* **Propagate `presentation.duration` to `mediaSource.duration` — exactly once per MediaSource.**
*
* Two paths, by whether the presentation is live:
*
* - **Live** (`presentation.duration === Infinity`): write `Infinity` once the MediaSource is open and no SourceBuffer is
*   mid-append. No buffered clamp is needed (`Infinity` ≥ any range) and — unlike the finite case — it needn't precede
*   the first append: `Infinity` overrides whatever finite live-edge value an append may have pinned (a finite duration
*   would otherwise stall the stream once the window slides past it). The wait-for-idle is required because the MSE
*   spec forbids setting `duration` while a buffer is `updating`; both waits resolve immediately when already open /
*   idle.
* - **VoD** (finite): the value is written once, after `mediaSource` is open and all SourceBuffers are idle, clamped to
*   be ≥ the highest buffered range (MSE spec). Written only while `mediaSource.duration` is still `NaN`; once any
*   non-NaN value is present (us on a prior entry, or `endOfStream` from the buffered end), the property is left alone
*   — re-syncing would race concurrent `appendBuffer()` calls.
*
* The entry resolves three async preconditions in order before writing:
*
* 1. **MediaSource open** — `waitForMediaSourceOpen` defers until the first `sourceopen` event (or any readyState
*    transition, since `'ended'` / `'closed'` mean we've missed the window and should bail).
* 2. **All SourceBuffers idle** — `waitForSourceBuffersReady` defers per the MSE-spec rule that `duration` cannot be set
*    while any buffer has `updating === true`.
* 3. **Buffered-range clamp** — `getMaxBufferedEnd` ensures the written duration is at least the highest buffered end (MSE
*    spec disallows a smaller `duration` than any buffered range).
*
* The buffer-set helpers operate across `mediaSource.sourceBuffers` (the canonical aggregate), so the behavior composes
* uniformly across audio-only, video-only, and mixed configurations.
*
* Single-positive-state reactor (`'preconditions-unmet'` ↔ `'duration-writable'`): state derivation is purely
* signal-driven (presentation validity + mediaSource existence). MediaSource lifecycle state (`readyState`) and the
* `duration` itself are non-signal DOM properties resolved inside the entry's async sequence. The state-exit cleanup
* aborts the in-flight wait, so source resets and behavior destroy structurally cancel the pending write. A post-await
* re-check of `mediaSource.readyState === 'open'` covers the narrow race where `endOfStream()` synchronously
* transitions readyState to `'ended'` between our `waitForMediaSourceOpen` resolution and the `mediaSource.duration`
* write.
*
* Downstream of `calculatePresentationDuration` (which writes `presentation.duration`); concurrent with `endOfStream`
* (which may later write `mediaSource.duration` — the "exactly once" contract keeps us out of that path).
*/
function deriveState(presentation, mediaSource) {
	return shouldUpdateDuration(presentation, mediaSource) ? "duration-writable" : "preconditions-unmet";
}
function updateMediaSourceDurationSetup({ state, context }) {
	const derivedStateSignal = computed(() => deriveState(state.presentation.get(), context.mediaSource.get()));
	return createMachineReactor({
		initial: "preconditions-unmet",
		monitor: () => derivedStateSignal.get(),
		states: {
			"preconditions-unmet": {},
			"duration-writable": { entry: () => {
				const presentation = state.presentation.get();
				const mediaSource = context.mediaSource.get();
				if (presentation.duration === Number.POSITIVE_INFINITY) {
					if (mediaSource.duration === Number.POSITIVE_INFINITY) return;
					const controller = new AbortController();
					(async () => {
						await waitForMediaSourceOpen(mediaSource, controller.signal);
						if (controller.signal.aborted || mediaSource.readyState !== "open") return;
						await waitForSourceBuffersReady(mediaSource.sourceBuffers, controller.signal);
						if (controller.signal.aborted || mediaSource.readyState !== "open") return;
						if (mediaSource.duration !== Number.POSITIVE_INFINITY) mediaSource.duration = Number.POSITIVE_INFINITY;
					})();
					return () => controller.abort();
				}
				if (!Number.isNaN(mediaSource.duration)) return;
				const controller = new AbortController();
				const writeWhenReady = async () => {
					await waitForMediaSourceOpen(mediaSource, controller.signal);
					if (controller.signal.aborted) return;
					if (mediaSource.readyState !== "open") return;
					await waitForSourceBuffersReady(mediaSource.sourceBuffers, controller.signal);
					if (controller.signal.aborted) return;
					if (mediaSource.readyState !== "open") return;
					const maxBufferedEnd = getMaxBufferedEnd(mediaSource.sourceBuffers);
					const duration = maxBufferedEnd > presentation.duration ? maxBufferedEnd : presentation.duration;
					if (Number.isNaN(mediaSource.duration)) mediaSource.duration = duration;
				};
				writeWhenReady();
				return () => controller.abort();
			} }
		}
	});
}
const updateMediaSourceDuration = defineBehavior({
	stateKeys: ["presentation"],
	contextKeys: ["mediaSource"],
	setup: updateMediaSourceDurationSetup
});

//#endregion
//#region ../spf/dist/dev/features/media-source.js
/** The behaviors the feature composes, in setup order. */
const behaviors = [
	setupMediaSource,
	updateMediaSourceDuration,
	endOfStream
];
/** The config defaults the feature contributes. */
const defaultConfig = {};
/** The state values the feature seeds. */
const initialState = {};
/**
* Plays through Media Source Extensions: attaches a MediaSource to the media element, keeps its duration current, and
* ends the stream once every composed track type has loaded its last segment.
*
* Requires:
*
* - A writer of `presentation.duration`, such as `calculateDurationFeature`; without one, the MediaSource keeps its
*   default duration, and a live stream never gets its infinite duration and stalls.
* - A writer of `state.currentTime`, such as `currentTimeFeature`; without one, the stream never ends.
*/
const mediaSourceFeature = defineFeature({
	behaviors,
	defaultConfig,
	initialState
});

//#endregion
//#region ../spf/dist/dev/playback/primitives/error-messages.js
/**
* Developer-facing copy for what this engine reports.
*
* Everything here reaches a **console**, never a viewer. Viewer-facing copy for a fatal condition is the presentation
* layer's to compose: the engine reports a code, and a consumer maps that code to localized text it owns.
*
* Plain string constants, one export each. Nothing is parameterized — a message that names the engine has to be built
* at the call site from state the engine carries around solely to say it, which is a lot of plumbing for a console
* prefix. Separate exports rather than one object so a composition that logs neither notice doesn't carry their bytes.
*/
/**
* Logged when a fatal `SVTA_UNSUPPORTED_PLAYBACK_FEATURE` is surfaced.
*
* The developer's half of that event; the viewer gets the localized copy the code maps to. One sentence is enough
* because the specifics — which container, which rendition, whether it was DRM — stay structured on the reported
* conditions logged beside it.
*/
const UNSUPPORTED_PLAYBACK_FEATURE_MESSAGE = "Can't play this source: it requires an unsupported playback feature.";
/**
* Logged for **any** fatal condition, by a composition whose failures don't all reduce to a missing feature.
*
* The background variant is the case: it treats a per-rendition cause as fatal on its own, so what reaches its surface
* can be an unsupported container, DRM it can't decrypt, or a source carrying no video at all. Naming one feature would
* be wrong for the last of those, so all three are named broadly. Deferring the _why_ to the conditions instead would
* promise prose they don't carry — an `SvtaError` is a code and its context, and nothing on this path sets `message`.
*/
const UNPLAYABLE_SOURCE_MESSAGE = "Can't play this source — unsupported container, encryption, or no usable video track.";
/**
* LL-HLS delivery, played as standard live. The parser ignores partial segments and the loader fetches whole ones, so
* latency lands wherever `HOLD-BACK` puts it — the stream plays, just not at the latency it was published for.
*/
const LOW_LATENCY_UNSUPPORTED_MESSAGE = "Low-Latency HLS is unsupported; playing as standard live at higher latency.";
/**
* `#EXT-X-PLAYLIST-TYPE:EVENT` — a growing window, which is how DVR is delivered. It plays, but the seekable-range and
* live-edge handling for it is newer and less exercised than sliding-window live.
*/
const DVR_EXPERIMENTAL_MESSAGE = "DVR support for EVENT playlists is experimental.";

//#endregion
//#region ../spf/dist/dev/playback/adapters/hls-video/error-surface.js
/**
* `message`, plus the alternative-Media sentence when `media`'s class names one.
*
* Read off the class rather than passed in so a subclass can point at a better-equipped sibling — the SPF Mux Medias
* name the hls.js-backed one, which plays the MPEG-TS and DRM sources SPF doesn't — without either adapter knowing that
* sibling exists.
*/
function withAlternativeMediaSuggestion(message, media) {
	const { alternativeMediaSuggestion } = media.constructor;
	const suggestion = alternativeMediaSuggestion?.trim();
	return suggestion ? `${message} ${suggestion}` : message;
}
/** The first condition `fatalCodes` covers — the root cause, not its consequences. */
function firstFatal(errors, fatalCodes) {
	return errors?.find((error) => fatalCodes.has(error.code));
}
/**
* The causes that mean the engine has no pipeline for what the source delivers — a container it can't append, or
* encryption it can't decrypt.
*
* What these have in common is that no retry, no other CDN, and no other rendition of the same source fixes them: the
* source needs a capability this engine doesn't have. That's the distinction the surfaced code exists to draw, and it's
* why the set is these rather than "every cause": an undecodable container (1004/1005), a DRM system with no CDM
* (4008), or a non-DRM encryption scheme with no decryptor (99408).
*/
const UNSUPPORTED_FEATURE_CAUSES = /* @__PURE__ */ new Set([
	SVTA_UNSUPPORTED_VIDEO_FORMAT,
	SVTA_UNSUPPORTED_AUDIO_FORMAT,
	SVTA_UNSUPPORTED_DRM_SYSTEM,
	SVTA_UNSUPPORTED_ENCRYPTION_METHOD
]);
/**
* Whether anything in the sequence is a cause of the "we don't implement this" kind.
*
* Deliberately `some` over the whole sequence rather than a per-type match against the verdict. A verdict means one
* type's candidates emptied, but the _reason_ the source is unplayable can sit on another type — an audio-only source
* whose sole rendition is encrypted empties the audio candidates, and a video source with encrypted video empties the
* video ones. Both are the same answer to the viewer, so both get the same code.
*/
function hasUnsupportedFeatureCause(errors) {
	return errors?.some((error) => UNSUPPORTED_FEATURE_CAUSES.has(error.code)) ?? false;
}

//#endregion
export { matchesPartialTrack as $, canPlayTrackWithDrm as A, untrack as At, sameCandidateSet as B, SVTA_NO_SUPPORTED_AUDIO_TRACK as Bt, fetchStep as C, defineBehavior as Ct, Task as D, defineCompositionFactory as Dt, SerialRunner as E, flattenFeatures as Et, applyConstraints as F, SVTA_DRM_LICENSE_REQUEST_GENERATION_FAILED as Ft, keySystemCandidates as G, effect as Gt, declaredDrmKeys as H, SVTA_UNSUPPORTED_DRM_SYSTEM as Ht, applyRules as I, SVTA_DRM_LICENSE_RESPONSE_REJECTED as It, resolveDrmHeaders as J, manifestInitData as K, excludeRefusedKeySystems as L, SVTA_DRM_SESSION_ERROR as Lt, reportAbsentTrackType as M, SVTA_BAD_LICENSE_REQUEST as Mt, getCdnId as N, SVTA_DRM_CERTIFICATE_ERROR as Nt, runOnce as O, computed as Ot, getOrderedCdnIds as P, SVTA_DRM_INITIALIZATION_ERROR as Pt, byDescendingResolution as Q, excludeUnplayableTracks as R, SVTA_INSUFFICIENT_OUTPUT_PROTECTION as Rt, dispatchStep as S, createMachineCore as St, RecurringRunner as T, defineFeature as Tt, declaredEncryptionScheme as U, SVTA_UNSUPPORTED_PLAYBACK_FEATURE as Ut, NO_KEY_SYSTEM as V, SVTA_NO_SUPPORTED_VIDEO_TRACK as Vt, defaultFairPlayContentId as W, SVTA_UNSUPPORTED_VIDEO_FORMAT as Wt, sourceDrmSystems as X, resolveDrmUrl as Y, unsupportedEncryptionMethodCause as Z, resolveAudioTrack as _, getMediaPlaylistMetadata as _t, LOW_LATENCY_UNSUPPORTED_MESSAGE as a, loadTextTrackSegments as at, setupAudioBufferActors as b, isResolvedTrack as bt, mediaSourceFeature as c, TEXT_TYPE_CONFIG as ct, errorFeature as d, getCodecFamilies as dt, pickAudioTrackFromTracks as et, getMinBufferedEnd as f, getTracksByType as ft, reportUnsupportedTrackConditionsWithDrm as g, deriveStreamType as gt, reportUnsupportedTrackConditions as h, getSegmentsToLoad as ht, DVR_EXPERIMENTAL_MESSAGE as i, loadAudioSegments as it, emitError as j, update as jt, canPlayTrack as k, peek as kt, hlsLoadingFeature as l, VIDEO_TYPE_CONFIG as lt, calculateDurationFeature as m, DEFAULT_FORWARD_BUFFER_CONFIG as mt, hasUnsupportedFeatureCause as n, smallestCoveringPixelArea as nt, UNPLAYABLE_SOURCE_MESSAGE as o, loadVideoSegments as ot, currentTimeFeature as p, mimeCodecsByType as pt, resolveDrmCredentials as q, withAlternativeMediaSuggestion as r, tracksUnderPixelArea as rt, UNSUPPORTED_PLAYBACK_FEATURE_MESSAGE as s, AUDIO_TYPE_CONFIG as st, firstFatal as t, pickTextTrackFromTracks as tt, isStandardPreload as u, findTrackById as ut, resolveTextTrack as v, getSessionData as vt, createMachineActor as w, attachMediaSourceAsSourceElement as wt, setupVideoBufferActors as x, createMachineReactor as xt, resolveVideoTrack as y, isResolvedPresentation as yt, preferCodecFamilies as z, SVTA_LICENSE_EXPIRED as zt };
//# sourceMappingURL=error-surface-BdkX1wpk.js.map