import { api } from '../../lib/api';

export const OpeningPositionService = {
    /**
     * Submits the strict opening position payload
     * @param {Object} payload { openingBalances: [], items: [], stockJournalMetadata: {} }
     */
    async submitOpeningPosition(payload) {
        return api.post('/opening-position', payload);
    }
};
