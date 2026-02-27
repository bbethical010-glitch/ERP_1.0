import { commandBus, COMMANDS } from './CommandBus';

/**
 * Grid Engine
 * Manages 2D matrix traversal (Row/Col) for complex data entry forms like Vouchers.
 */
class GridEngine {
    constructor() {
        this.rows = []; // Array of arrays: [ [col1Id, col2Id], [col1Id, col2Id] ]
        this.currentRowIdx = 0;
        this.currentColIdx = 0;
        this.viewId = null;
        this.unsubscribeBus = null;
        this.onRowAdd = null; // Callback when tabbing past last row
        this.isEnabled = false; // Disabled temporarily for architectural stability
        console.log('[%cGridEngine%c] Instantiated (Layer 5 Engine)', 'color: #008f5a; font-weight: bold', 'color: inherit');
    }

    /**
     * Initializes the GridEngine for a specific view.
     * @param {string} viewId - The unique identifier for this view instance.
     * @param {function} onRowAdd - Callback to trigger when advancing past the final row.
     */
    init(viewId, onRowAdd) {
        if (!this.isEnabled) {
            console.log(`[%cGridEngine%c] Init skipped for view: ${viewId} (Engine is currently disabled)`, 'color: gray', 'color: inherit');
            return;
        }
        this.viewId = viewId;
        this.rows = [];
        this.currentRowIdx = 0;
        this.currentColIdx = 0;
        this.onRowAdd = onRowAdd;

        if (this.unsubscribeBus) {
            this.unsubscribeBus();
        }

        // Grid specific shortcuts: ArrowDown/Up handles rows natively here, Enter/Tab handle columns
        const unsubNext = commandBus.subscribe(COMMANDS.FOCUS_NEXT, () => this.moveNextCol());
        const unsubPrev = commandBus.subscribe(COMMANDS.FOCUS_PREV, () => this.movePrevCol());

        // Create new specific commands for grid row traversal
        const unsubGridDown = commandBus.subscribe(COMMANDS.GRID_DOWN, () => this.moveDownRow());
        const unsubGridUp = commandBus.subscribe(COMMANDS.GRID_UP, () => this.moveUpRow());

        this.unsubscribeBus = () => {
            unsubNext();
            unsubPrev();
            unsubGridDown();
            unsubGridUp();
        };

        console.log(`[%cGridEngine%c] Initialized for view: ${viewId}`, 'color: #008f5a', 'color: inherit');
    }

    destroy() {
        if (this.unsubscribeBus) {
            this.unsubscribeBus();
            this.unsubscribeBus = null;
        }
        this.rows = [];
        this.currentRowIdx = 0;
        this.currentColIdx = 0;
        this.viewId = null;
        this.onRowAdd = null;
    }

    /**
     * Registers a full matrix of IDs.
     * Called whenever the React rendering loop finishes building the rows.
     */
    registerMatrix(matrix) {
        this.rows = matrix;
    }

    setCurrentCoord(rowIdx, colIdx) {
        if (rowIdx < 0 || rowIdx >= this.rows.length) return;
        if (colIdx < 0 || colIdx >= this.rows[rowIdx].length) return;

        this.currentRowIdx = rowIdx;
        this.currentColIdx = colIdx;

        const elId = this.rows[rowIdx][colIdx];
        if (elId) this._focusDOMElement(elId);
    }

    _findNextValidCell(startRow, startCol) {
        let r = startRow;
        let c = startCol;
        while (r < this.rows.length) {
            while (c < this.rows[r].length) {
                if (this.rows[r][c] !== null) {
                    return [r, c];
                }
                c++;
            }
            // Move to next row's start
            r++;
            c = 0;

            // If we've traversed off the edge of the matrix, trigger onRowAdd
            if (r >= this.rows.length && this.onRowAdd) {
                this.onRowAdd();
                // We return null so caller knows we reached the end
                return null;
            }
        }
        return null; // Reached end, no more cells
    }

    _findPrevValidCell(startRow, startCol) {
        let r = startRow;
        let c = startCol;
        while (r >= 0) {
            while (c >= 0) {
                if (this.rows[r][c] !== null) {
                    return [r, c];
                }
                c--;
            }
            // Move to previous row's end
            r--;
            if (r >= 0) {
                c = this.rows[r].length - 1;
            }
        }
        return null;
    }

    moveNextCol() {
        if (this.rows.length === 0) return;
        const nextTarget = this._findNextValidCell(this.currentRowIdx, this.currentColIdx + 1);
        if (nextTarget) {
            this.setCurrentCoord(nextTarget[0], nextTarget[1]);
        }
    }

    movePrevCol() {
        if (this.rows.length === 0) return;
        const prevTarget = this._findPrevValidCell(this.currentRowIdx, this.currentColIdx - 1);
        if (prevTarget) {
            this.setCurrentCoord(prevTarget[0], prevTarget[1]);
        }
    }

    moveDownRow() {
        if (this.currentRowIdx < this.rows.length - 1) {
            // Find valid cell straight down, or if null, next valid in that row
            let targetCol = this.currentColIdx;
            while (targetCol < this.rows[this.currentRowIdx + 1].length && this.rows[this.currentRowIdx + 1][targetCol] === null) {
                targetCol++;
            }
            // If still null (went off edge), maybe search left? For simplicity, we assume columns align mostly well. 
            // If the cell directly underneath or to the right is null, we just use the found targetCol.
            if (targetCol >= this.rows[this.currentRowIdx + 1].length) {
                targetCol = 0; // fallback
            }
            this.setCurrentCoord(this.currentRowIdx + 1, targetCol);
        }
    }

    moveUpRow() {
        if (this.currentRowIdx > 0) {
            let targetCol = this.currentColIdx;
            while (targetCol < this.rows[this.currentRowIdx - 1].length && this.rows[this.currentRowIdx - 1][targetCol] === null) {
                targetCol++;
            }
            if (targetCol >= this.rows[this.currentRowIdx - 1].length) {
                targetCol = 0;
            }
            this.setCurrentCoord(this.currentRowIdx - 1, targetCol);
        }
    }

    _focusDOMElement(id) {
        // ... focus logic remains the same ...
        setTimeout(() => { // slight delay needed for new rows added via onRowAdd
            const el = document.getElementById(id);
            if (el) {
                el.focus();
                if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number')) {
                    el.select();
                }
            }
        }, 10);
    }
}

// Global singleton instance
export const gridEngine = new GridEngine();
