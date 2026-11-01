import { t as listen } from "./listen-CO63BggB.js";
import { n as getTabbableElements, r as walkAncestors, t as getDeepActiveElement } from "./focus-CkXNMiCg.js";
import { t as containsComposed } from "./tree-idPlGAlz.js";
import { t as createState } from "./state-DLDF0q4U.js";
import { n as lockInteractions } from "./interaction-lock-1oRjjx9B.js";
import { t as createDismissLayer } from "./dismiss-layer-Y52xS22o.js";
import { n as getTransitionFlags } from "./transition-CzuKD0-9.js";

//#region ../core/dist/dev/dom/ui/dialog.js
/**
* Manages modal dialog transitions, dismissal, initial focus, focus trapping, and focus restoration.
*
* @internal
*/
function createDialog(options) {
	let popupElement = null;
	let triggerElement = null;
	let previousFocus = null;
	let requestedInteractionRoot = null;
	let activeInteractionRoot = null;
	let releaseInteractionLock = null;
	let focusFrame = 0;
	const isolatedElements = /* @__PURE__ */ new Map();
	const modality = createState({ documentModal: true });
	const layer = createDismissLayer({
		transition: options.transition,
		closeOnEscape: options.closeOnEscape,
		onEscapeDismiss(event) {
			if (!shouldHandleScopedEvent(event)) return;
			event.preventDefault();
			event.stopPropagation();
			applyClose();
		},
		onDocumentActive(signal) {
			listen(document, "keydown", handleDocumentKeydown, {
				capture: true,
				signal
			});
			listen(document, "focusin", handleDocumentFocusin, { signal });
		}
	});
	const state = layer.input;
	function applyOpen() {
		previousFocus = getDeepActiveElement();
		const opening = layer.open(() => popupElement);
		if (!opening) return;
		resolveInteractionRoot();
		isolateBackground();
		options.onOpenChange(true);
		scheduleInitialFocus();
		opening.then(() => {
			if (layer.signal.aborted || !state.current.active || state.current.status !== "idle") return;
			options.onOpenChangeComplete?.(true);
		});
	}
	function applyClose() {
		const closing = layer.close(popupElement);
		if (!closing) return;
		cancelAnimationFrame(focusFrame);
		focusFrame = 0;
		options.onOpenChange(false);
		closing.then(() => {
			if (layer.signal.aborted || state.current.active) return;
			const active = getDeepActiveElement();
			const focusLeftScope = activeInteractionRoot && active instanceof Element && !containsComposed(activeInteractionRoot, active);
			restoreBackground();
			const restoreTarget = triggerElement?.isConnected ? triggerElement : previousFocus;
			if (!focusLeftScope && restoreTarget?.isConnected) restoreTarget.focus();
			previousFocus = null;
			options.onOpenChangeComplete?.(false);
		});
	}
	function scheduleInitialFocus() {
		cancelAnimationFrame(focusFrame);
		focusFrame = requestAnimationFrame(() => {
			focusFrame = 0;
			if (layer.signal.aborted || !state.current.active || !popupElement) return;
			(popupElement.querySelector("[autofocus]") ?? getTabbableElements(popupElement)[0] ?? popupElement).focus();
		});
	}
	function handleDocumentKeydown(event) {
		if (event.key !== "Tab" || !state.current.active || !popupElement || !modality.current.documentModal) return;
		const tabbable = getTabbableElements(popupElement);
		if (tabbable.length === 0) {
			event.preventDefault();
			popupElement.focus();
			return;
		}
		const active = getDeepActiveElement();
		const first = tabbable[0];
		const last = tabbable[tabbable.length - 1];
		if (event.shiftKey && (active === first || !active || !containsComposed(popupElement, active))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (active === last || !active || !containsComposed(popupElement, active))) {
			event.preventDefault();
			first.focus();
		}
	}
	function handleDocumentFocusin(event) {
		if (!state.current.active || !popupElement) return;
		if (event.target instanceof Element && containsComposed(popupElement, event.target)) return;
		if (activeInteractionRoot && event.target instanceof Element && !containsComposed(activeInteractionRoot, event.target)) return;
		(getTabbableElements(popupElement)[0] ?? popupElement).focus();
	}
	function setTriggerElement(el) {
		triggerElement = el;
	}
	function setPopupElement(el) {
		if (popupElement !== el) restoreBackground();
		popupElement = el;
		resolveInteractionRoot();
		if (el && state.current.active) isolateBackground();
		const active = getDeepActiveElement();
		if (el && state.current.active && (!active || !containsComposed(el, active))) scheduleInitialFocus();
	}
	function setInteractionRoot(el) {
		if (requestedInteractionRoot === el) return;
		restoreBackground();
		requestedInteractionRoot = el;
		resolveInteractionRoot();
		if (popupElement && state.current.active) isolateBackground();
	}
	layer.signal.addEventListener("abort", () => {
		cancelAnimationFrame(focusFrame);
		focusFrame = 0;
		restoreBackground();
		popupElement = null;
		triggerElement = null;
		previousFocus = null;
		requestedInteractionRoot = null;
		activeInteractionRoot = null;
	});
	return {
		input: state,
		modality,
		triggerProps: { onClick() {
			applyOpen();
		} },
		open: applyOpen,
		close: applyClose,
		setTriggerElement,
		setPopupElement,
		setInteractionRoot,
		destroy: layer.destroy
	};
	function isolateBackground() {
		if (!popupElement?.isConnected || isolatedElements.size > 0 || releaseInteractionLock) return;
		resolveInteractionRoot();
		walkAncestors(popupElement, (current) => {
			if (current === activeInteractionRoot || current === popupElement?.ownerDocument.body) return true;
			if (current.assignedSlot) {
				for (const sibling of current.assignedSlot.assignedElements({ flatten: true })) if (sibling !== current && sibling instanceof HTMLElement) makeInert(sibling);
				return;
			}
			const parent = current.parentElement;
			if (parent) {
				for (const sibling of parent.children) if (sibling !== current && sibling instanceof HTMLElement) makeInert(sibling);
				return;
			}
			const root = current.getRootNode();
			if (!(root instanceof ShadowRoot)) return void 0;
			for (const sibling of root.children) if (sibling !== current && sibling instanceof HTMLElement) makeInert(sibling);
		}, { composed: true });
		if (activeInteractionRoot) releaseInteractionLock = lockInteractions(activeInteractionRoot);
	}
	function makeInert(element) {
		isolatedElements.set(element, element.hasAttribute("inert"));
		element.setAttribute("inert", "");
	}
	function restoreBackground() {
		for (const [element, wasInert] of isolatedElements) if (!wasInert) element.removeAttribute("inert");
		isolatedElements.clear();
		releaseInteractionLock?.();
		releaseInteractionLock = null;
	}
	function resolveInteractionRoot() {
		activeInteractionRoot = requestedInteractionRoot && popupElement && containsComposed(requestedInteractionRoot, popupElement) ? requestedInteractionRoot : null;
		modality.patch({ documentModal: !activeInteractionRoot });
	}
	function shouldHandleScopedEvent(event) {
		if (!activeInteractionRoot) return true;
		const target = event.target instanceof Element ? event.target : getDeepActiveElement();
		return target instanceof Element && containsComposed(activeInteractionRoot, target);
	}
}

//#endregion
//#region ../core/dist/dev/core/ui/dialog/core.js
/** @internal */
var DialogCore = class {
	static defaultProps = {
		open: false,
		defaultOpen: false,
		closeOnEscape: true
	};
	#role;
	#input = null;
	#titleId = void 0;
	#descriptionId = void 0;
	#documentModal = true;
	constructor(role = "dialog") {
		this.#role = role;
	}
	/** Accept props for API consistency. Props are consumed by platform layers. */
	setProps(_props) {}
	setInput(input) {
		this.#input = input;
	}
	setTitleId(id) {
		this.#titleId = id;
	}
	setDescriptionId(id) {
		this.#descriptionId = id;
	}
	setDocumentModal(documentModal) {
		this.#documentModal = documentModal;
	}
	getState() {
		const input = this.#input;
		return {
			open: input.active,
			status: input.status,
			titleId: this.#titleId,
			descriptionId: this.#descriptionId,
			...getTransitionFlags(input.status)
		};
	}
	getTriggerAttrs(state, popupId) {
		return {
			"aria-expanded": state.open && state.status !== "ending" ? "true" : "false",
			"aria-haspopup": "dialog",
			"aria-controls": popupId
		};
	}
	getPopupAttrs(state) {
		return {
			role: this.#role,
			"aria-modal": this.#documentModal ? "true" : void 0,
			"aria-labelledby": state.titleId,
			"aria-describedby": state.descriptionId
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/dialog/data.js
/** @internal */
const DialogDataAttrs = {
	/** Present when the dialog is open. */
	open: "data-open",
	/** Present during the open transition. */
	transitionStarting: "data-starting-style",
	/** Present during the close transition. */
	transitionEnding: "data-ending-style"
};

//#endregion
export { DialogCore as n, createDialog as r, DialogDataAttrs as t };
//# sourceMappingURL=data-CYlQCNZY.js.map