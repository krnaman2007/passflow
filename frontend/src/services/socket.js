import { marketStream, MarketStreamClient, CONNECTION_STATUS } from './marketStream.js';

// Lazy-initialized or active shared socket instance
export const socket = marketStream.initSocket();

export { marketStream, MarketStreamClient, CONNECTION_STATUS };
export default marketStream;
