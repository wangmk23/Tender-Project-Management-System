import { r as isShadowRoot } from "./predicates-C_TReuAB.js";

//#region ../utils/dist/dom/tree.js
/** @internal */
function containsComposed(root, element) {
	let current = element;
	while (current) {
		if (current === root || root.contains(current)) return true;
		const nodeRoot = current.getRootNode();
		current = current.assignedSlot ?? current.parentElement ?? (isShadowRoot(nodeRoot) ? nodeRoot.host : null);
	}
	return false;
}

//#endregion
export { containsComposed as t };
//# sourceMappingURL=tree-idPlGAlz.js.map