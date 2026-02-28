import { api } from '../../lib/api';

export const OpeningPositionService = {
    /**
     * Submits the initial opening position configuration to the backend
     * @param {Object} payload { assets: [], liabilities: [], capital: 0, inventory: [] }
     */
    async submitOpeningPosition(payload) {
        return api.post('/opening-position', payload);
    }
};
