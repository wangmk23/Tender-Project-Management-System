//#region ../utils/dist/dom/children.js
/** @internal */
function getElementChildren(parent, predicate) {
	const children = [];
	for (let index = 0; index < parent.children.length; index++) {
		const child = parent.children.item(index);
		if (child && predicate(child, index)) children.push(child);
	}
	return children;
}
/** @internal */
function findElementChild(parent, predicate) {
	for (let index = 0; index < parent.children.length; index++) {
		const child = parent.children.item(index);
		if (child && predicate(child, index)) return child;
	}
	return null;
}
/**
* Return what an element composes: the elements assigned to a slot, or otherwise its own children.
*
* A slot with nothing assigned yields its fallback content, so the result always describes what renders.
*
* @internal
*/
function getComposedChildren(parent) {
	if (parent instanceof HTMLSlotElement) {
		const assigned = parent.assignedElements();
		if (assigned.length > 0) return assigned;
	}
	return [...parent.children];
}
/** @internal */
function findComposedElement(root, predicate) {
	const children = getComposedChildren(root);
	for (const [index, child] of children.entries()) {
		if (predicate(child, index)) return child;
		const nested = findComposedElement(child, predicate);
		if (nested) return nested;
	}
	return null;
}

//#endregion
export { findElementChild as n, getElementChildren as r, findComposedElement as t };
//# sourceMappingURL=children-D2Flrhz2.js.map