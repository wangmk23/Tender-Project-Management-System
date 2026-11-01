import { t as getDeepActiveElement } from "./focus-CkXNMiCg.js";
import { r as forceLayout, t as PopoverCSSVars } from "./vars-CTJASilF.js";
import { t as containsComposed } from "./tree-idPlGAlz.js";
import { t as createPopover } from "./popover-BfzYkhvl.js";

//#region ../core/dist/dev/core/ui/menu/item.js
/**
* Data attributes set on all navigable menu item elements.
*
* @parts item, radio-item, checkbox-item, trigger
* @internal
*/
const MenuItemDataAttrs = {
	/**
	* Present on all navigable item types: Item, RadioItem, CheckboxItem, and the Trigger when acting as a submenu
	* trigger inside a parent menu. Use `[data-item]` as a shared selector to target all item types at once.
	*/
	item: "data-item",
	/** Present when the item is highlighted. Set to `pointer` when pointer movement caused the highlight; otherwise empty. */
	highlighted: "data-highlighted"
};

//#endregion
//#region ../core/dist/dev/core/ui/menu/vars.js
/**
* CSS custom property names for menu layout and positioning.
*
* @internal
*/
const MenuCSSVars = {
	/** Distance between the popup and the trigger along the side axis. */
	sideOffset: "--media-popover-side-offset",
	/** Distance between the popup and the trigger along the alignment axis. */
	alignOffset: "--media-popover-align-offset",
	/** Minimum distance between the popup and the positioning boundary. */
	boundaryOffset: "--media-popover-boundary-offset",
	/** Width of the trigger, set by popup positioning. */
	anchorWidth: "--media-popover-anchor-width",
	/** Height of the trigger, set by popup positioning. */
	anchorHeight: "--media-popover-anchor-height",
	/** Width of the active menu panel (px). */
	width: "--media-menu-width",
	/** Height of the active menu panel (px). */
	height: "--media-menu-height",
	/** Width available within the positioning boundary (px). */
	availableWidth: "--media-menu-available-width",
	/** Height available within the positioning boundary (px). */
	availableHeight: "--media-menu-available-height"
};

//#endregion
//#region ../core/dist/dev/dom/ui/menu/menu.js
/** @internal */
function isMenuNavigationKey(event) {
	const { key } = event;
	return key === "ArrowDown" || key === "ArrowUp" || key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End" || key === "Enter" || key === " " || key === "Escape" || key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
}
/** @internal */
function getRootPositionOptions(side, align) {
	if (!side || !align) return null;
	return {
		side,
		align
	};
}
/**
* Uses Popover offset inputs while publishing Menu-owned available-size outputs.
*
* @internal
*/
const MenuPositioningCSSVars = {
	...PopoverCSSVars,
	availableWidth: MenuCSSVars.availableWidth,
	availableHeight: MenuCSSVars.availableHeight
};
const parents = /* @__PURE__ */ new WeakMap();
/** @internal */
function completeMenuItemSelection(menu) {
	menu.close();
}
/** @internal */
function createMenu(options) {
	const items = [];
	let highlightedItem = null;
	let triggerElement = null;
	let contentElement = null;
	let popupElement = null;
	const submenus = /* @__PURE__ */ new Set();
	const submenuUnsubscribes = /* @__PURE__ */ new Map();
	let typeaheadBuffer = "";
	let typeaheadTimer = null;
	let pendingFocusOut = null;
	let openRafId = 0;
	let lastCloseReason = null;
	let api;
	function isItemHidden(item) {
		const availability = item.getAttribute("data-availability");
		return Boolean(item.hidden || item.hasAttribute("data-hidden") || item.getAttribute("aria-hidden") === "true" || availability === "unavailable" || availability === "unsupported");
	}
	function getNavigableItems() {
		return items.filter((item) => !isItemHidden(item));
	}
	function getAdjacentNavigableItem(direction) {
		if (items.length === 0) return null;
		const currentIndex = highlightedItem ? items.indexOf(highlightedItem) : direction === 1 ? -1 : 0;
		for (let offset = 1; offset <= items.length; offset++) {
			const index = (currentIndex + direction * offset + items.length) % items.length;
			const candidate = items[index];
			if (candidate && !isItemHidden(candidate)) return candidate;
		}
		return null;
	}
	function highlight(element, highlightOptions) {
		if (!element && openRafId) {
			cancelAnimationFrame(openRafId);
			openRafId = 0;
		}
		if (element && isItemHidden(element)) {
			if (element === highlightedItem) highlight(getAdjacentNavigableItem(1), highlightOptions);
			return;
		}
		if (highlightedItem === element) {
			element?.setAttribute(MenuItemDataAttrs.highlighted, highlightOptions?.pointer === true ? "pointer" : "");
			return;
		}
		const previousItem = highlightedItem;
		if (previousItem) previousItem.tabIndex = -1;
		highlightedItem = element;
		if (element) {
			element.tabIndex = 0;
			element.setAttribute(MenuItemDataAttrs.highlighted, highlightOptions?.pointer === true ? "pointer" : "");
			if (previousItem && compareItems(element, previousItem) < 0 && highlightOptions?.pointer) forceLayout(element.parentElement);
			previousItem?.removeAttribute(MenuItemDataAttrs.highlighted);
			if (highlightOptions?.focus !== false) {
				if (highlightOptions?.preventScroll) element.focus({ preventScroll: true });
				else element.focus();
			}
		} else previousItem?.removeAttribute(MenuItemDataAttrs.highlighted);
		options.onHighlightChange?.(element);
	}
	function clearHighlight() {
		if (highlightedItem) {
			highlightedItem.tabIndex = -1;
			highlightedItem.removeAttribute(MenuItemDataAttrs.highlighted);
			highlightedItem = null;
			options.onHighlightChange?.(null);
		}
	}
	function highlightFirstItem(options) {
		highlight(getNavigableItems()[0] ?? null, options);
	}
	function highlightInitialItem(options) {
		highlight(getInitialHighlightItem(), options);
	}
	function restoreFocus(focusOptions) {
		if (lastCloseReason === "imperative-action" || lastCloseReason === "group-open" || lastCloseReason === "blur" || lastCloseReason === "outside-click") return;
		if (focusOptions) triggerElement?.focus(focusOptions);
		else triggerElement?.focus();
	}
	function getInitialHighlightItem() {
		const navigableItems = getNavigableItems();
		return navigableItems.find((item) => item.matches("[role=\"menuitemradio\"][aria-checked=\"true\"], [aria-selected=\"true\"]")) ?? navigableItems[0] ?? null;
	}
	function clearTypeahead() {
		if (typeaheadTimer !== null) {
			clearTimeout(typeaheadTimer);
			typeaheadTimer = null;
		}
		typeaheadBuffer = "";
	}
	function scheduleInitialHighlight() {
		cancelAnimationFrame(openRafId);
		openRafId = requestAnimationFrame(() => {
			openRafId = 0;
			if (!popover.input.current.active || popover.input.current.status === "ending" || highlightedItem) return;
			highlight(getInitialHighlightItem(), { preventScroll: true });
		});
	}
	function handleTypeahead(char) {
		typeaheadBuffer = typeaheadBuffer.length === 1 && typeaheadBuffer.toLowerCase() === char.toLowerCase() ? char : typeaheadBuffer + char;
		if (typeaheadTimer !== null) clearTimeout(typeaheadTimer);
		typeaheadTimer = setTimeout(clearTypeahead, 500);
		const navigableItems = getNavigableItems();
		const searchStart = (highlightedItem ? navigableItems.indexOf(highlightedItem) : -1) + 1;
		const candidates = [...navigableItems.slice(searchStart), ...navigableItems.slice(0, searchStart)];
		const needle = typeaheadBuffer.toLowerCase();
		const match = candidates.find((candidate) => {
			return (candidate.textContent?.trim().toLowerCase() ?? "").startsWith(needle);
		});
		if (match) highlight(match);
	}
	const popover = createPopover({
		transition: options.transition,
		deferOpenChanges: true,
		onOpenChange(open, details) {
			lastCloseReason = open ? null : details.reason;
			options.onOpenChange(open, details);
			if (open) scheduleInitialHighlight();
			else {
				clearHighlight();
				clearTypeahead();
			}
		},
		onOpenChangeComplete(open) {
			options.onOpenChangeComplete?.(open);
			if (!open && contentElement) {
				const active = getDeepActiveElement(contentElement.ownerDocument);
				if (!(active instanceof Element) || active === contentElement.ownerDocument.body || containsComposed(contentElement, active)) restoreFocus();
			}
		},
		closeOnEscape: options.closeOnEscape,
		closeOnOutsideClick: options.closeOnOutsideClick,
		...options.group ? { group: options.group } : {}
	});
	const contentProps = {
		onFocusOut(event) {
			if (event.relatedTarget === null && hasClosingSubmenu()) {
				pendingFocusOut = event;
				return;
			}
			popover.popupProps.onFocusOut(event);
		},
		onKeyDown(event) {
			const { key } = event;
			const navigableItems = getNavigableItems();
			if (key !== "Escape" && isMenuNavigationKey(event) && !event.defaultPrevented) event.preventDefault();
			if (navigableItems.length === 0) return;
			switch (key) {
				case "ArrowDown":
					event.preventDefault();
					highlight(getAdjacentNavigableItem(1));
					break;
				case "ArrowUp":
					event.preventDefault();
					highlight(getAdjacentNavigableItem(-1));
					break;
				case "Home":
					event.preventDefault();
					highlight(navigableItems[0] ?? null);
					break;
				case "End":
					event.preventDefault();
					highlight(navigableItems[navigableItems.length - 1] ?? null);
					break;
				case "Enter":
				case " ":
					event.preventDefault();
					if (highlightedItem && navigableItems.includes(highlightedItem)) highlightedItem.click();
					break;
				default: if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) handleTypeahead(key);
			}
		}
	};
	function handleTriggerKeyDown(event) {
		const input = popover.input.current;
		if (!input.active || input.status === "ending") return;
		if (event.key === "Escape") return;
		if (!isMenuNavigationKey(event)) return;
		contentProps.onKeyDown(event);
		event.stopPropagation();
	}
	function setTriggerElement(element) {
		triggerElement = element;
		popover.setTriggerElement(element);
	}
	function setContentElement(element) {
		contentElement = element;
	}
	function setPopupElement(element) {
		popupElement = element;
		popover.setPopupElement(element);
	}
	function compareItems(a, b) {
		if (a === b) return 0;
		const position = a.compareDocumentPosition(b);
		if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
		if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
		return 0;
	}
	function registerItem(element) {
		const onFocus = () => highlight(element, { focus: false });
		element.tabIndex = -1;
		element.setAttribute(MenuItemDataAttrs.item, "");
		element.addEventListener("focus", onFocus);
		items.push(element);
		items.sort(compareItems);
		if (popover.input.current.active && popover.input.current.status !== "ending" && !highlightedItem) scheduleInitialHighlight();
		return () => {
			element.removeEventListener("focus", onFocus);
			const index = items.indexOf(element);
			if (index !== -1) items.splice(index, 1);
			if (highlightedItem === element) clearHighlight();
		};
	}
	function registerSubmenu(menu) {
		submenus.add(menu);
		parents.set(menu, api);
		const unsubscribe = menu.input.subscribe(handlePendingFocusOut);
		submenuUnsubscribes.set(menu, unsubscribe);
		return () => {
			submenus.delete(menu);
			if (parents.get(menu) === api) parents.delete(menu);
			submenuUnsubscribes.get(menu)?.();
			submenuUnsubscribes.delete(menu);
			handlePendingFocusOut();
		};
	}
	function hasClosingSubmenu() {
		return [...submenus].some(({ input }) => input.current.status === "ending");
	}
	function handlePendingFocusOut() {
		if (!pendingFocusOut || hasClosingSubmenu()) return;
		const event = pendingFocusOut;
		pendingFocusOut = null;
		popover.popupProps.onFocusOut(event);
	}
	function syncOpen(open) {
		if (open) parents.get(api)?.highlight(null);
		else for (const submenu of submenus) submenu.close("imperative-action");
		popover.syncOpen(open);
	}
	function destroy() {
		cancelAnimationFrame(openRafId);
		openRafId = 0;
		clearTypeahead();
		for (const unsubscribe of submenuUnsubscribes.values()) unsubscribe();
		for (const submenu of submenus) if (parents.get(submenu) === api) parents.delete(submenu);
		submenuUnsubscribes.clear();
		submenus.clear();
		parents.delete(api);
		pendingFocusOut = null;
		popover.destroy();
	}
	api = {
		input: popover.input,
		triggerProps: {
			onClick: popover.triggerProps.onClick,
			onKeyDown: handleTriggerKeyDown
		},
		contentProps,
		get triggerElement() {
			return triggerElement;
		},
		get contentElement() {
			return contentElement;
		},
		get popupElement() {
			return popupElement;
		},
		setTriggerElement,
		setContentElement,
		setPopupElement,
		registerItem,
		registerSubmenu,
		highlight,
		highlightFirstItem,
		highlightInitialItem,
		restoreFocus,
		open: popover.open,
		close: popover.close,
		syncOpen,
		destroy
	};
	return api;
}

//#endregion
export { isMenuNavigationKey as a, getRootPositionOptions as i, completeMenuItemSelection as n, MenuCSSVars as o, createMenu as r, MenuPositioningCSSVars as t };
//# sourceMappingURL=menu--bNbak0v.js.map