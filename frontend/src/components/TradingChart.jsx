import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';

export default function TradingChart() {
  const chartContainerRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 320,
    });

    const seriesOptions = {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    };

    // Lightweight Charts v5 uses chart.addSeries(CandlestickSeries, options)
    // while v4 used chart.addCandlestickSeries(options)
    const candlestickSeries = typeof chart.addSeries === 'function' && CandlestickSeries
      ? chart.addSeries(CandlestickSeries, seriesOptions)
      : chart.addCandlestickSeries(seriesOptions);

    // Sample historical candle data
    const initialData = [
      { time: '2026-10-15', open: 67200, high: 67800, low: 67100, close: 67650 },
      { time: '2026-10-16', open: 67650, high: 68400, low: 67500, close: 68200 },
      { time: '2026-10-17', open: 68200, high: 68900, low: 67900, close: 68500 },
      { time: '2026-10-18', open: 68500, high: 69200, low: 68300, close: 68850 },
      { time: '2026-10-19', open: 68850, high: 69400, low: 68600, close: 69100 },
      { time: '2026-10-20', open: 69100, high: 69850, low: 68900, close: 69600 },
      { time: '2026-10-21', open: 69600, high: 70400, low: 69500, close: 70150 },
    ];

    candlestickSeries.setData(initialData);

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  return (
    <div style={{
      background: '#0f172a',
      borderRadius: '12px',
      padding: '16px',
      border: '1px solid #1e293b',
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.1rem', fontWeight: 600 }}>
          TradingView Lightweight Chart (BTC/USDT)
        </h3>
        <span style={{ fontSize: '0.85rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 8px', borderRadius: '4px', fontWeight: 500 }}>
          Live Market Data
        </span>
      </div>
      <div ref={chartContainerRef} style={{ width: '100%', height: '320px' }} />
    </div>
  );
}
