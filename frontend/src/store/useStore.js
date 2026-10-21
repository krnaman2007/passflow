import { create } from 'zustand';

export const useAppStore = create((set) => ({
  user: null,
  token: null,
  isConnected: false,
  chartSymbol: 'BTC/USDT',
  
  setUser: (user, token) => set({ user, token }),
  logout: () => set({ user: null, token: null }),
  setConnected: (status) => set({ isConnected: status }),
  setChartSymbol: (symbol) => set({ chartSymbol: symbol }),
}));
