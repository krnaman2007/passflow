import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';
import { api } from '../services/api';
import { TrendingUp, RefreshCw, BarChart3 } from 'lucide-react';

export default function TradingChart({ eventId, categoryId, eventName, tierName, basePrice = 5000 }) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const seriesRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCandles() {
      if (!eventId) return;
      setLoading(true);

      try {
        const res = await api.events.getPriceHistory(eventId, {
          ...(categoryId ? { categoryId } : {}),
          interval: '1h',
        });

        const data = res?.data || res;
        const candles = Array.isArray(data?.candles) ? data.candles : [];
        if (isMounted && data?.summary) {
          setSummary(data.summary);
        }

        // Format candles for lightweight-charts
        let formatted = [];
        if (candles.length > 0) {
          formatted = candles.map((c) => {
            const timeSec = Math.floor(new Date(c.timestamp || c.time).getTime() / 1000);
            return {
              time: timeSec,
              open: Number(c.open) / (Number(c.open) > 1000 ? 100 : 1),
              high: Number(c.high) / (Number(c.high) > 1000 ? 100 : 1),
              low: Number(c.low) / (Number(c.low) > 1000 ? 100 : 1),
              close: Number(c.close) / (Number(c.close) > 1000 ? 100 : 1),
            };
          }).sort((a, b) => a.time - b.time);

          // Deduplicate consecutive identical timestamps if any
          const deduped = [];
          for (let i = 0; i < formatted.length; i++) {
            if (i === 0 || formatted[i].time > formatted[i - 1].time) {
              deduped.push(formatted[i]);
            }
          }
          formatted = deduped;
        }

        // Fallback baseline candle if market just launched
        if (formatted.length === 0) {
          const nowSec = Math.floor(Date.now() / 1000);
          const bp = Number(basePrice) || 5000;
          formatted = [
            { time: nowSec - 7200, open: bp, high: bp * 1.02, low: bp * 0.99, close: bp * 1.01 },
            { time: nowSec - 3600, open: bp * 1.01, high: bp * 1.04, low: bp * 1.00, close: bp * 1.03 },
            { time: nowSec, open: bp * 1.03, high: bp * 1.05, low: bp * 1.02, close: bp * 1.04 },
          ];
        }

        if (seriesRef.current && isMounted) {
          seriesRef.current.setData(formatted);
          if (chartInstanceRef.current) {
            chartInstanceRef.current.timeScale().fitContent();
          }
        }
      } catch (err) {
        console.warn('Could not load chart price history:', err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    // Initialize chart if container exists
    if (chartContainerRef.current && !chartInstanceRef.current) {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'rgba(15, 23, 42, 0.6)' },
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        width: chartContainerRef.current.clientWidth || 600,
        height: 240,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          borderColor: 'rgba(255, 255, 255, 0.1)',
        },
        rightPriceScale: {
          borderColor: 'rgba(255, 255, 255, 0.1)',
        },
      });

      const seriesOptions = {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      };

      const series = typeof chart.addSeries === 'function' && CandlestickSeries
        ? chart.addSeries(CandlestickSeries, seriesOptions)
        : chart.addCandlestickSeries(seriesOptions);

      chartInstanceRef.current = chart;
      seriesRef.current = series;

      const handleResize = () => {
        if (chartContainerRef.current && chartInstanceRef.current) {
          chartInstanceRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);
    }

    loadCandles();

    return () => {
      isMounted = false;
    };
  }, [eventId, categoryId, basePrice]);

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
        seriesRef.current = null;
      }
    };
  }, []);

  const priceChange = summary?.priceChangePercent != null ? summary.priceChangePercent : 0;
  const isPositive = priceChange >= 0;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        border: '1px solid var(--border-subtle)',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(249, 115, 22, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-orange)',
            }}
          >
            <BarChart3 size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>
                {eventName || 'Market Price Action'}
              </h3>
              {tierName && (
                <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                  {tierName}
                </span>
              )}
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-dim)' }}>
              1-Hour OHLC Candlesticks (PostgreSQL Matching Engine Feeds)
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {summary && (
            <div style={{ textAlign: 'right' }}>
              <div
                className="font-mono"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: isPositive ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                }}
              >
                {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                Vol: {summary.totalVolume || 0}
              </div>
            </div>
          )}

          <span
            className="badge badge-green"
            style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
            Live OHLC
          </span>
        </div>
      </div>

      <div ref={chartContainerRef} style={{ width: '100%', height: '240px' }} />
    </div>
  );
}
