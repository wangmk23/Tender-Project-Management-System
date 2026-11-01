/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as listen } from "../listen-CO63BggB.js";
import { t as getDeepActiveElement } from "../focus-CkXNMiCg.js";
import { t as containsComposed } from "../tree-idPlGAlz.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext, t as containerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { r as selectControls } from "../selectors-B0umcXKn.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as popupGroupContext } from "../popup-group-context-DFsPDSN9.js";

//#region ../core/dist/dev/dom/ui/container.js
/** @internal */
const DEFAULT_CONTAINER_ROLE = "group";
/** @internal */
function applyContainerAttrs(element) {
	if (!element.hasAttribute("role")) element.setAttribute("role", DEFAULT_CONTAINER_ROLE);
	if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", String(0));
}
/** @internal */
function focusContainer(element) {
	const active = getDeepActiveElement(element.ownerDocument);
	if (!active || active === element.ownerDocument.body || !containsComposed(element, active)) element.focus({ preventScroll: true });
}

//#endregion
//#region ../core/dist/dev/dom/ui/popover/group.js
/** @internal */
function createPopupGroup() {
	let current = null;
	const listeners = /* @__PURE__ */ new Set();
	function notify() {
		for (const listener of listeners) listener();
	}
	return {
		open(member) {
			if (current === member) return;
			const previous = current;
			current = member;
			previous?.close("group-open");
			notify();
		},
		close(member) {
			if (current !== member) return;
			current = null;
			notify();
		},
		isOpenFor(trigger) {
			return trigger !== null && current?.triggerElement === trigger;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

//#endregion
//#region ../core/dist/dev/core/ui/container/core.js
/** @internal */
var ContainerCore = class {
	#media = null;
	setMedia(media) {
		this.#media = media;
	}
	getState() {
		return { controlsVisible: this.#media.controlsVisible };
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/container/data.js
/** @internal */
const ContainerDataAttrs = { 
/** Present when player controls are visible. */
controlsVisible: "data-controls-visible" };

//#endregion
//#region ../core/dist/dev/i18n/text/container.js
const labelText = {
	key: `container.label`,
	text: "Media player"
};

//#endregion
//#region ../html/dist/dev/ui/container/element.js
/**
* The visual, interactive player boundary.
*
* A container registers itself with its closest player and provides popup coordination to the controls it contains.
*/
var ContainerElement = class extends UIElement {
	static {
		this.tagName = "media-container";
	}
	#releaseContainer = null;
	#disconnect = null;
	#label = null;
	#core = new ContainerCore();
	#controls = new PlayerController(this, playerContext, selectControls);
	#i18n = new I18nController(this, i18nContext);
	#popupGroup = createPopupGroup();
	#popupGroupProvider = new ContextProvider(this, {
		context: popupGroupContext,
		initialValue: this.#popupGroup
	});
	#container = new ContextConsumer(this, {
		context: containerContext,
		callback: (value) => this.#register(value)
	});
	connectedCallback() {
		super.connectedCallback();
		this.#popupGroupProvider.setValue(this.#popupGroup);
		this.#register(this.#container.value);
		applyContainerAttrs(this);
		this.#applyLabel();
		this.#disconnect = new AbortController();
		listen(this, "pointerup", this.#onPointerUp, { signal: this.#disconnect.signal });
	}
	disconnectedCallback() {
		this.#releaseContainer?.();
		this.#releaseContainer = null;
		this.#disconnect?.abort();
		this.#disconnect = null;
		super.disconnectedCallback();
	}
	update(changed) {
		super.update(changed);
		this.#applyLabel();
		const controls = this.#controls.value;
		if (controls) {
			this.#core.setMedia(controls);
			applyStateDataAttrs(this, this.#core.getState(), ContainerDataAttrs);
		} else this.removeAttribute(ContainerDataAttrs.controlsVisible);
	}
	#register(value) {
		this.#releaseContainer?.();
		this.#releaseContainer = null;
		if (this.isConnected && value) this.#releaseContainer = value.registerContainer(this);
	}
	#applyLabel() {
		const current = this.getAttribute("aria-label");
		if (current && current !== this.#label) return;
		if (this.hasAttribute("aria-labelledby")) {
			if (current === this.#label) {
				this.removeAttribute("aria-label");
				this.#label = null;
			}
			return;
		}
		const label = this.#i18n.value(labelText);
		this.setAttribute("aria-label", label);
		this.#label = label;
	}
	#onPointerUp = () => {
		focusContainer(this);
	};
};

//#endregion
//#region ../html/dist/dev/define/ui/container.js
safeDefine(ContainerElement);

//#endregion
//# sourceMappingURL=container.dev.js.map