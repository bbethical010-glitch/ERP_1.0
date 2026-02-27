import { commandBus, COMMANDS } from './CommandBus';

/**
 * Focus Graph Engine
 * Manages deterministic, state-based focus traversal independent of DOM order.
 */
class FocusGraph {
    constructor() {
        this.nodes = new Map(); // id -> node definition
        this.currentNodeId = null;
        this.viewId = null;
        this.unsubscribeBus = null;
        this.isEnabled = true; // Slowly re-enabling for Q7 verification
        console.log('[%cFocusGraph%c] Instantiated (Layer 3 Engine)', 'color: #8f0075; font-weight: bold', 'color: inherit');
    }

    /**
     * Initializes the FocusGraph for a specific view.
     * @param {string} viewId - The unique identifier for this view instance.
     */
    init(viewId) {
        if (!this.isEnabled) {
            console.log(`[%cFocusGraph%c] Init skipped for view: ${viewId} (Engine is currently disabled)`, 'color: gray', 'color: inherit');
            return;
        }
        this.viewId = viewId;
        this.nodes.clear();
        this.currentNodeId = null;

        if (this.unsubscribeBus) {
            this.unsubscribeBus();
        }

        // Subscribe to next/prev commands
        const unsubNext = commandBus.subscribe(COMMANDS.FOCUS_NEXT, () => this.moveNext());
        const unsubPrev = commandBus.subscribe(COMMANDS.FOCUS_PREV, () => this.movePrev());

        this.unsubscribeBus = () => {
            unsubNext();
            unsubPrev();
        };

        console.log(`[%cFocusGraph%c] Initialized for view: ${viewId}`, 'color: #8f0075', 'color: inherit');
    }

    destroy() {
        if (this.unsubscribeBus) {
            this.unsubscribeBus();
            this.unsubscribeBus = null;
        }
        this.nodes.clear();
        this.currentNodeId = null;
        this.viewId = null;
    }

    /**
     * Registers a node in the graph.
     * @param {string} id - Unique identifier for the field (e.g. 'ledgerName')
     * @param {object} edges - { next: string, prev: string }
     */
    registerNode(id, edges) {
        this.nodes.set(id, { id, ...edges });
    }

    /**
     * Unregisters a node (e.g., if a field is hidden/unmounted).
     */
    unregisterNode(id) {
        this.nodes.delete(id);
        if (this.currentNodeId === id) {
            this.currentNodeId = null; // Lost focus
        }
    }

    /**
     * Sets the current active node and actually focuses the HTML element if it exists in DOM.
     */
    setCurrentNode(id) {
        if (!this.nodes.has(id)) {
            console.warn(`[FocusGraph] Attempted to set current node to unregistered ID: ${id}`);
            return;
        }
        this.currentNodeId = id;
        this._focusDOMElement(id);
    }

    moveNext() {
        if (!this.currentNodeId) return;
        const currentNode = this.nodes.get(this.currentNodeId);
        if (currentNode && currentNode.next) {
            if (typeof currentNode.next === 'function') {
                const nextId = currentNode.next();
                if (nextId) this.setCurrentNode(nextId);
            } else {
                this.setCurrentNode(currentNode.next);
            }
        }
    }

    movePrev() {
        if (!this.currentNodeId) return;
        const currentNode = this.nodes.get(this.currentNodeId);
        if (currentNode && currentNode.prev) {
            if (typeof currentNode.prev === 'function') {
                const prevId = currentNode.prev();
                if (prevId) this.setCurrentNode(prevId);
            } else {
                this.setCurrentNode(currentNode.prev);
            }
        }
    }

    _focusDOMElement(id) {
        const el = document.getElementById(id);
        if (el) {
            el.focus();
            if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number')) {
                el.select();
            }
        } else {
            console.warn(`[FocusGraph] DOM element with ID '${id}' not found. Focus state updated but DOM ignored.`);
        }
    }
}

// Global singleton instance
export const focusGraph = new FocusGraph();
