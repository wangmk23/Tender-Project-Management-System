import { f as isUndefined } from "./predicate-3rF1m2uv.js";
import { D as isInteractiveActivation, E as isEditableTarget, y as getMediaInputActionValue } from "./volume-aFyxrX8a.js";
import { t as listen } from "./listen-CO63BggB.js";
import { t as isInteractionLocked } from "./interaction-lock-1oRjjx9B.js";

//#region ../utils/dist/dom/platform.js
/** @internal */
function isMacOS() {
	return typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
}

//#endregion
//#region ../core/dist/dev/dom/hotkey/aria.js
const ARIA_MODIFIER_MAP = {
	shift: "Shift",
	ctrl: "Control",
	alt: "Alt",
	meta: "Meta"
};
const DISPLAY_MODIFIER_MAP = {
	shift: "Shift",
	ctrl: "Ctrl",
	alt: "Alt",
	meta: "Meta"
};
const MODIFIER_ORDER = [
	"ctrl",
	"shift",
	"alt",
	"meta"
];
/**
* Convert parsed key bindings to a WAI-ARIA `aria-keyshortcuts` formatted string.
*
* @example
*   ```ts
*   toAriaKeyShortcut(parseHotkeyPattern('Ctrl+Shift+f'));
*   // "Control+Shift+f"
*
*   toAriaKeyShortcut([...parseHotkeyPattern('k'), ...parseHotkeyPattern('Space')]);
*   // "k Space"
*   ```;
*
* @internal
*/
function toAriaKeyShortcut(bindings) {
	return bindings.map((b) => {
		const parts = [];
		for (const mod of MODIFIER_ORDER) if (b.modifiers.has(mod)) parts.push(ARIA_MODIFIER_MAP[mod]);
		parts.push(b.originalKey);
		return parts.join("+");
	}).join(" ");
}
/**
* Convert a parsed key binding to a compact display shortcut.
*
* @internal
*/
function toDisplayKeyShortcut(binding) {
	const parts = [];
	for (const mod of MODIFIER_ORDER) if (binding.modifiers.has(mod)) parts.push(DISPLAY_MODIFIER_MAP[mod]);
	parts.push(toDisplayKey(binding.originalKey));
	return parts.join("+");
}
function toDisplayKey(key) {
	return key.length === 1 ? key.toUpperCase() : key;
}

//#endregion
//#region ../core/dist/dev/dom/hotkey/coordinator.js
/** @internal */
var HotkeyCoordinator = class {
	#target;
	#bindings = [];
	#nextId = 0;
	#disconnect = null;
	#docDisconnect = null;
	#activationSubscribers = /* @__PURE__ */ new Set();
	#shortcutSubscribers = /* @__PURE__ */ new Set();
	#destroyed = false;
	constructor(target) {
		this.#target = target;
	}
	subscribe(callback) {
		this.#activationSubscribers.add(callback);
		return () => this.#activationSubscribers.delete(callback);
	}
	subscribeShortcutChanges(callback) {
		this.#shortcutSubscribers.add(callback);
		return () => this.#shortcutSubscribers.delete(callback);
	}
	add(options) {
		const binding = {
			parsed: parseHotkeyPattern(options.keys),
			options,
			id: this.#nextId++
		};
		this.#bindings.push(binding);
		this.#sortBindings();
		if (options.target === "document") this.#connectDocument();
		else this.#connect();
		this.#notify();
		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			const idx = this.#bindings.indexOf(binding);
			if (idx !== -1) this.#bindings.splice(idx, 1);
			this.#maybeDisconnect();
			this.#notify();
		};
	}
	getAriaKeys(action) {
		return this.getShortcut(action).aria;
	}
	getShortcut(action, value) {
		const bindings = this.#getActionBindings(action, value);
		if (!bindings.length) return {};
		const parsed = bindings.flatMap((binding) => binding.parsed);
		const preferred = bindings[bindings.length - 1];
		return {
			aria: toAriaKeyShortcut(parsed),
			shortcut: this.#formatDisplayShortcut(preferred)
		};
	}
	destroy() {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#disconnect?.abort();
		this.#disconnect = null;
		this.#docDisconnect?.abort();
		this.#docDisconnect = null;
		this.#bindings = [];
		this.#notify();
		this.#activationSubscribers.clear();
		this.#shortcutSubscribers.clear();
	}
	#sortBindings() {
		this.#bindings.sort((a, b) => {
			const specDiff = b.parsed[0].modifiers.size - a.parsed[0].modifiers.size;
			if (specDiff !== 0) return specDiff;
			return a.id - b.id;
		});
	}
	#connect() {
		if (this.#disconnect) return;
		this.#disconnect = new AbortController();
		listen(this.#target, "keydown", this.#handleEvent, { signal: this.#disconnect.signal });
	}
	#connectDocument() {
		if (this.#docDisconnect) return;
		this.#docDisconnect = new AbortController();
		listen(document, "keydown", this.#handleEvent, { signal: this.#docDisconnect.signal });
	}
	#maybeDisconnect() {
		const hasPlayer = this.#bindings.some((b) => b.options.target !== "document");
		const hasDoc = this.#bindings.some((b) => b.options.target === "document");
		if (!hasPlayer) {
			this.#disconnect?.abort();
			this.#disconnect = null;
		}
		if (!hasDoc) {
			this.#docDisconnect?.abort();
			this.#docDisconnect = null;
		}
	}
	#handleEvent = (event) => {
		if (isInteractionLocked(this.#target)) return;
		if (event.key === "Unidentified") return;
		if (isInteractiveActivation(event)) return;
		if (event.defaultPrevented) return;
		const editable = isEditableTarget(event);
		for (const binding of this.#bindings) {
			const { options, parsed } = binding;
			if (options.disabled) continue;
			if (event.repeat && options.repeatable === false) continue;
			if (options.target === "document" !== (event.currentTarget === document)) continue;
			for (const p of parsed) {
				if (!matchesHotkeyEvent(p, event)) continue;
				if (editable && p.modifiers.size === 0) continue;
				if (this.#activationSubscribers.size > 0) {
					const activateEvent = {
						source: "hotkey",
						action: options.action,
						value: options.value,
						event
					};
					for (const cb of this.#activationSubscribers) try {
						cb(activateEvent);
					} catch (error) {
						console.warn("[vjs-hotkey] subscribe callback threw:", error);
					}
				}
				event.preventDefault();
				options.onActivate(event, p.originalKey);
				return;
			}
		}
	};
	#getActionBindings(action, value) {
		return this.#bindings.filter((binding) => {
			if (binding.options.disabled) return false;
			if (binding.options.action !== action) return false;
			if (isUndefined(value)) return true;
			return binding.options.value === value;
		}).sort((a, b) => a.id - b.id);
	}
	#formatDisplayShortcut(binding) {
		if (binding.options.keys === "0-9") return binding.options.keys;
		return toDisplayKeyShortcut(binding.parsed[0]);
	}
	#notify() {
		for (const subscriber of this.#shortcutSubscribers) subscriber();
	}
};

//#endregion
//#region ../core/dist/dev/dom/hotkey/hotkey.js
const MODIFIER_KEYS = /* @__PURE__ */ new Set([
	"shift",
	"ctrl",
	"alt",
	"meta"
]);
/**
* Parse a key pattern string into one or more bindings.
*
* @example
*   ```ts
*   parseHotkeyPattern('>');
*   // [{ modifiers: Set(), key: '>', originalKey: '>' }]
*
*   parseHotkeyPattern('0-9');
*   // 10 bindings, one per digit
*   ```;
*
* @internal
*/
function parseHotkeyPattern(pattern) {
	if (pattern === "0-9") return Array.from({ length: 10 }, (_, i) => ({
		modifiers: /* @__PURE__ */ new Set(),
		key: String(i),
		originalKey: String(i)
	}));
	const segments = pattern.split("+");
	const rawKey = segments.pop();
	const modifiers = /* @__PURE__ */ new Set();
	for (const seg of segments) {
		const lower = seg.toLowerCase();
		if (lower === "mod") modifiers.add(isMacOS() ? "meta" : "ctrl");
		else if (MODIFIER_KEYS.has(lower)) modifiers.add(lower);
		else console.warn(`[vjs-hotkey] Unknown modifier: "${seg}" in pattern "${pattern}"`);
	}
	return [{
		modifiers,
		key: rawKey === "Space" ? " " : rawKey.toLowerCase(),
		originalKey: rawKey
	}];
}
/**
* Single non-letter character — layout-dependent modifiers (Shift, Alt/Option) were used to produce the character
* itself, not as deliberate modifiers (e.g. Shift+. → ">", Option+Shift → ">" on some Mac layouts). Letters excluded
* because Shift changes case intentionally (k vs K). Named keys excluded because event.key.length > 1 (ArrowLeft, Tab,
* etc.).
*/
function isImplicitModifierKey(key) {
	return key.length === 1 && !/[a-z]/i.test(key);
}
/**
* Whether a parsed binding matches a keyboard event.
*
* @internal
*/
function matchesHotkeyEvent(binding, event) {
	if (event.key === "Unidentified") return false;
	if (event.key.toLowerCase() !== binding.key) return false;
	const implicit = isImplicitModifierKey(event.key);
	const shiftKey = implicit ? event.shiftKey && binding.modifiers.has("shift") : event.shiftKey;
	const altKey = implicit ? event.altKey && binding.modifiers.has("alt") : event.altKey;
	if (shiftKey !== binding.modifiers.has("shift")) return false;
	if (event.ctrlKey !== binding.modifiers.has("ctrl")) return false;
	if (altKey !== binding.modifiers.has("alt")) return false;
	if (event.metaKey !== binding.modifiers.has("meta")) return false;
	return true;
}
const coordinators = /* @__PURE__ */ new WeakMap();
/**
* Look up or create the hotkey coordinator for a target element.
*
* @internal
*/
function getHotkeyCoordinator(target) {
	let coordinator = coordinators.get(target);
	if (!coordinator) {
		coordinator = new HotkeyCoordinator(target);
		coordinators.set(target, coordinator);
	}
	return coordinator;
}
/**
* Register a hotkey binding on a target element.
*
* @example
*   ```ts
*   const cleanup = createHotkey(container, {
*     keys: 'k',
*     onActivate: () => (store.paused ? store.play() : store.pause()),
*   });
*
*   // Later: remove the binding
*   cleanup();
*   ```;
*
* @returns A cleanup function that removes the binding.
* @internal
*/
function createHotkey(target, options) {
	const coordinator = getHotkeyCoordinator(target);
	const key = parseHotkeyPattern(options.keys)[0]?.originalKey;
	return coordinator.add({
		...options,
		value: getMediaInputActionValue(options.action ?? "", key, options.value)
	});
}

//#endregion
export { getHotkeyCoordinator as n, createHotkey as t };
//# sourceMappingURL=hotkey-T5EtQ6E0.js.map