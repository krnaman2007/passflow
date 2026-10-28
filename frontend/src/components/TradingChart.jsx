import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  AreaSeries,
  CrosshairMode,
  createSeriesMarkers,
} from 'lightweight-charts';
import { api } from '../services/api';
import {
  BarChart3,
  Columns,
  Maximize2,
} from 'lucide-react';

/**
 * Sanitizes series data:
 * - Ensures strictly increasing timestamps (no duplicate times)
 * - Filters out invalid, null, or negative prices
 * - Dynamic color variation:
 *   - Upward price ticks -> Vibrant Green (#10b981)
 *   - Downward price ticks -> Vibrant Red (#ef4444)
 */
function sanitizeSeriesData(data, theme = 'dynamic') {
  if (!Array.isArray(data) || data.length === 0) return [];
  const valid = data
    .filter((d) => d && Number.isFinite(d.time) && d.time > 0 && Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => a.time - b.time);

  const deduped = [];
  for (let i = 0; i < valid.length; i++) {
    const raw = valid[i];
    const item = { time: raw.time, value: raw.value };

    if (deduped.length === 0) {
      if (theme === 'sell') {
        item.lineColor = '#ef4444';
        item.topColor = 'rgba(239, 68, 68, 0.35)';
        item.bottomColor = 'rgba(239, 68, 68, 0.01)';
      } else if (theme === 'buy') {
        item.lineColor = '#10b981';
        item.topColor = 'rgba(16, 185, 129, 0.35)';
        item.bottomColor = 'rgba(16, 185, 129, 0.01)';
      } else {
        item.lineColor = '#10b981';
        item.topColor = 'rgba(16, 185, 129, 0.35)';
        item.bottomColor = 'rgba(16, 185, 129, 0.01)';
      }
      deduped.push(item);
    } else {
      const prev = deduped[deduped.length - 1];
      const isUp = item.value >= prev.value;

      if (theme === 'sell') {
        // Red theme with brightness variation: rises are light red (#f87171), drops are deep crimson (#dc2626)
        item.lineColor = isUp ? '#f87171' : '#dc2626';
        item.topColor = isUp ? 'rgba(248, 113, 113, 0.38)' : 'rgba(220, 38, 38, 0.28)';
        item.bottomColor = 'rgba(220, 38, 38, 0.01)';
      } else if (theme === 'buy') {
        // Green theme with brightness variation: rises are bright emerald (#10b981), drops are forest green (#059669)
        item.lineColor = isUp ? '#10b981' : '#059669';
        item.topColor = isUp ? 'rgba(16, 185, 129, 0.38)' : 'rgba(5, 150, 105, 0.28)';
        item.bottomColor = 'rgba(16, 185, 129, 0.01)';
      } else {
        // Dynamic dual variation: Up moves are GREEN (#10b981), Down moves are RED (#ef4444)
        item.lineColor = isUp ? '#10b981' : '#ef4444';
        item.topColor = isUp ? 'rgba(16, 185, 129, 0.38)' : 'rgba(239, 68, 68, 0.38)';
        item.bottomColor = isUp ? 'rgba(16, 185, 129, 0.01)' : 'rgba(239, 68, 68, 0.01)';
      }

      if (item.time === prev.time) {
        // Same timestamp: overwrite with latest
        deduped[deduped.length - 1] = item;
      } else if (item.time > prev.time) {
        deduped.push(item);
      }
    }
  }
  return deduped;
}

export default function TradingChart({
  eventId,
  categoryId,
  eventName,
  tierName,
  basePrice = 5000,
  bestBid = null,
  bestAsk = null,
  spread = null,
  trades = [],
}) {
  // Container refs
  const sellContainerRef = useRef(null);
  const buyContainerRef = useRef(null);
  const singleContainerRef = useRef(null);

  // Chart instances
  const sellChartRef = useRef(null);
  const buyChartRef = useRef(null);
  const singleChartRef = useRef(null);

  // Series instances
  const sellSeriesRef = useRef(null);
  const buySeriesRef = useRef(null);
  const singleSellSeriesRef = useRef(null); // Sell (Red) series on Single chart
  const singleBuySeriesRef = useRef(null);  // Buy (Green) series on Single chart

  // Price lines
  const sellPriceLineRef = useRef(null);
  const buyPriceLineRef = useRef(null);
  const singlePriceLineAskRef = useRef(null);
  const singlePriceLineBidRef = useRef(null);

  // Markers plugin refs
  const sellMarkersPluginRef = useRef(null);
  const buyMarkersPluginRef = useRef(null);

  // Component state
  const [viewMode, setViewMode] = useState('split'); // 'split' or 'single'
  const [candleData, setCandleData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isChartReady, setIsChartReady] = useState(0);

  // 1. Fetch historical price data
  useEffect(() => {
    let isMounted = true;

    async function loadCandles() {
      if (!eventId) return;

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

        let formatted = [];
        if (candles.length > 0) {
          formatted = candles
            .map((c) => {
              const ts = c.timestamp ?? c.time ?? c.datetime ?? c.date;
              if (!ts) return null;
              const timeSec = Math.floor(new Date(ts).getTime() / 1000);
              if (!Number.isFinite(timeSec) || timeSec <= 0) return null;

              // Convert paise to rupees if price > 1000
              const toRupees = (v) => {
                const num = Number(v);
                if (!Number.isFinite(num)) return 0;
                return num > 1000 ? num / 100 : num;
              };

              return {
                time: timeSec,
                open: toRupees(c.open),
                high: toRupees(c.high),
                low: toRupees(c.low),
                close: toRupees(c.close),
              };
            })
            .filter((c) => c && c.close > 0);
        }

        // Fallback baseline candles if newly created market
        if (formatted.length === 0) {
          const nowSec = Math.floor(Date.now() / 1000);
          const bp = Number(basePrice) > 1000 ? Number(basePrice) / 100 : Number(basePrice) || 5000;
          formatted = [
            { time: nowSec - 7200, open: bp, high: bp * 1.02, low: bp * 0.99, close: bp * 1.01 },
            { time: nowSec - 3600, open: bp * 1.01, high: bp * 1.04, low: bp * 1.00, close: bp * 1.03 },
            { time: nowSec, open: bp * 1.03, high: bp * 1.05, low: bp * 1.02, close: bp * 1.04 },
          ];
        }

        if (isMounted) {
          setCandleData(formatted);
        }
      } catch (err) {
        console.warn('Could not load chart price history:', err.message);
      }
    }

    loadCandles();

    return () => {
      isMounted = false;
    };
  }, [eventId, categoryId, basePrice]);

  // 2. Initialize Charts whenever viewMode changes
  useEffect(() => {
    const commonChartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(15, 23, 42, 0.7)' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      height: 220,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(255, 255, 255, 0.08)',
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
    };

    // Clean up any existing instances first
    if (sellChartRef.current) {
      try { sellChartRef.current.remove(); } catch {}
      sellChartRef.current = null;
      sellSeriesRef.current = null;
      sellPriceLineRef.current = null;
      sellMarkersPluginRef.current = null;
    }
    if (buyChartRef.current) {
      try { buyChartRef.current.remove(); } catch {}
      buyChartRef.current = null;
      buySeriesRef.current = null;
      buyPriceLineRef.current = null;
      buyMarkersPluginRef.current = null;
    }
    if (singleChartRef.current) {
      try { singleChartRef.current.remove(); } catch {}
      singleChartRef.current = null;
      singleSellSeriesRef.current = null;
      singleBuySeriesRef.current = null;
      singlePriceLineAskRef.current = null;
      singlePriceLineBidRef.current = null;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width <= 0) continue;

        if (entry.target === sellContainerRef.current && sellChartRef.current) {
          sellChartRef.current.applyOptions({ width });
        }
        if (entry.target === buyContainerRef.current && buyChartRef.current) {
          buyChartRef.current.applyOptions({ width });
        }
        if (entry.target === singleContainerRef.current && singleChartRef.current) {
          singleChartRef.current.applyOptions({ width });
        }
      }
    });

    if (viewMode === 'split') {
      // 1. LEFT CHART: SELL (ASKS) - RED
      if (sellContainerRef.current) {
        const initialWidth = sellContainerRef.current.clientWidth || 360;
        const sellChart = createChart(sellContainerRef.current, {
          ...commonChartOptions,
          width: initialWidth,
        });

        const sellSeries = sellChart.addSeries(AreaSeries, {
          lineColor: '#ef4444',
          topColor: 'rgba(239, 68, 68, 0.35)',
          bottomColor: 'rgba(239, 68, 68, 0.01)',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });

        sellChartRef.current = sellChart;
        sellSeriesRef.current = sellSeries;
        resizeObserver.observe(sellContainerRef.current);
      }

      // 2. RIGHT CHART: BUY (BIDS) - GREEN
      if (buyContainerRef.current) {
        const initialWidth = buyContainerRef.current.clientWidth || 360;
        const buyChart = createChart(buyContainerRef.current, {
          ...commonChartOptions,
          width: initialWidth,
        });

        const buySeries = buyChart.addSeries(AreaSeries, {
          lineColor: '#10b981',
          topColor: 'rgba(16, 185, 129, 0.35)',
          bottomColor: 'rgba(16, 185, 129, 0.01)',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });

        buyChartRef.current = buyChart;
        buySeriesRef.current = buySeries;
        resizeObserver.observe(buyContainerRef.current);
      }

      // Synchronize visible logical range between Sell and Buy charts
      if (sellChartRef.current && buyChartRef.current) {
        let isSyncing = false;
        sellChartRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!isSyncing && buyChartRef.current && range && Number.isFinite(range.from)) {
            isSyncing = true;
            try {
              buyChartRef.current.timeScale().setVisibleLogicalRange(range);
            } catch {}
            isSyncing = false;
          }
        });
        buyChartRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (!isSyncing && sellChartRef.current && range && Number.isFinite(range.from)) {
            isSyncing = true;
            try {
              sellChartRef.current.timeScale().setVisibleLogicalRange(range);
            } catch {}
            isSyncing = false;
          }
        });
      }
    } else {
      // SINGLE COMBINED CHART: Dual Red (Sell) & Green (Buy) lines with color variation
      if (singleContainerRef.current) {
        const initialWidth = singleContainerRef.current.clientWidth || 720;
        const singleChart = createChart(singleContainerRef.current, {
          ...commonChartOptions,
          width: initialWidth,
          height: 240,
        });

        // 1. SELL (Asks) Curve in RED
        const singleSellSeries = singleChart.addSeries(AreaSeries, {
          lineColor: '#ef4444', // Red for Sell/Ask
          topColor: 'rgba(239, 68, 68, 0.22)',
          bottomColor: 'rgba(239, 68, 68, 0.01)',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });

        // 2. BUY (Bids) Curve in GREEN
        const singleBuySeries = singleChart.addSeries(AreaSeries, {
          lineColor: '#10b981', // Green for Buy/Bid
          topColor: 'rgba(16, 185, 129, 0.22)',
          bottomColor: 'rgba(16, 185, 129, 0.01)',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });

        singleChartRef.current = singleChart;
        singleSellSeriesRef.current = singleSellSeries;
        singleBuySeriesRef.current = singleBuySeries;
        resizeObserver.observe(singleContainerRef.current);
      }
    }

    setIsChartReady((prev) => prev + 1);

    return () => {
      resizeObserver.disconnect();
      if (sellChartRef.current) {
        try { sellChartRef.current.remove(); } catch {}
        sellChartRef.current = null;
        sellSeriesRef.current = null;
      }
      if (buyChartRef.current) {
        try { buyChartRef.current.remove(); } catch {}
        buyChartRef.current = null;
        buySeriesRef.current = null;
      }
      if (singleChartRef.current) {
        try { singleChartRef.current.remove(); } catch {}
        singleChartRef.current = null;
        singleSellSeriesRef.current = null;
        singleBuySeriesRef.current = null;
      }
    };
  }, [viewMode]);

  // 3. Populate Series Data & Update Price Lines with Color Variation
  useEffect(() => {
    if (!candleData || candleData.length === 0) return;

    const numAsk = parseFloat(bestAsk);
    const numBid = parseFloat(bestBid);
    const nowSec = Math.floor(Date.now() / 1000);

    // Build sell points (Asks action: tracking highest ask level and real-time bestAsk)
    const rawSellPoints = candleData.map((c) => ({
      time: c.time,
      value: c.high || c.close,
    }));

    // Build buy points (Bids action: tracking lowest bid level and real-time bestBid)
    const rawBuyPoints = candleData.map((c) => ({
      time: c.time,
      value: c.low || c.close,
    }));

    // Append / update real-time bestAsk to sell curve
    if (Number.isFinite(numAsk) && numAsk > 0) {
      const lastPoint = rawSellPoints[rawSellPoints.length - 1];
      if (lastPoint && nowSec > lastPoint.time) {
        rawSellPoints.push({ time: nowSec, value: numAsk });
      } else if (lastPoint) {
        lastPoint.value = numAsk;
      }
    }

    // Append / update real-time bestBid to buy curve
    if (Number.isFinite(numBid) && numBid > 0) {
      const lastPoint = rawBuyPoints[rawBuyPoints.length - 1];
      if (lastPoint && nowSec > lastPoint.time) {
        rawBuyPoints.push({ time: nowSec, value: numBid });
      } else if (lastPoint) {
        lastPoint.value = numBid;
      }
    }

    // Sanitize with distinct theme variations
    const cleanSellData = sanitizeSeriesData(rawSellPoints, 'sell');
    const cleanBuyData = sanitizeSeriesData(rawBuyPoints, 'buy');
    // Dynamic data: green on upward ticks, red on downward ticks
    const cleanDynamicSell = sanitizeSeriesData(rawSellPoints, 'sell');
    const cleanDynamicBuy = sanitizeSeriesData(rawBuyPoints, 'buy');

    // Apply to Left: Sell Series (Red)
    if (sellSeriesRef.current && cleanSellData.length > 0) {
      try {
        sellSeriesRef.current.setData(cleanSellData);
        if (sellChartRef.current) {
          sellChartRef.current.timeScale().fitContent();
        }
      } catch (err) {
        console.warn('Error applying sell series data:', err);
      }
    }

    // Apply to Right: Buy Series (Green)
    if (buySeriesRef.current && cleanBuyData.length > 0) {
      try {
        buySeriesRef.current.setData(cleanBuyData);
        if (buyChartRef.current) {
          buyChartRef.current.timeScale().fitContent();
        }
      } catch (err) {
        console.warn('Error applying buy series data:', err);
      }
    }

    // Apply to Single Chart: Both Sell (Red) and Buy (Green) series
    if (singleSellSeriesRef.current && cleanDynamicSell.length > 0) {
      try {
        singleSellSeriesRef.current.setData(cleanDynamicSell);
      } catch (err) {
        console.warn('Error applying single sell series data:', err);
      }
    }
    if (singleBuySeriesRef.current && cleanDynamicBuy.length > 0) {
      try {
        singleBuySeriesRef.current.setData(cleanDynamicBuy);
        if (singleChartRef.current) {
          singleChartRef.current.timeScale().fitContent();
        }
      } catch (err) {
        console.warn('Error applying single buy series data:', err);
      }
    }

    // Update Price Lines on Sell Chart
    if (sellSeriesRef.current && typeof sellSeriesRef.current.createPriceLine === 'function') {
      if (sellPriceLineRef.current) {
        try { sellSeriesRef.current.removePriceLine(sellPriceLineRef.current); } catch {}
        sellPriceLineRef.current = null;
      }
      if (Number.isFinite(numAsk) && numAsk > 0) {
        try {
          sellPriceLineRef.current = sellSeriesRef.current.createPriceLine({
            price: numAsk,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `ASK ₹${numAsk.toFixed(2)}`,
          });
        } catch {}
      }
    }

    // Update Price Lines on Buy Chart
    if (buySeriesRef.current && typeof buySeriesRef.current.createPriceLine === 'function') {
      if (buyPriceLineRef.current) {
        try { buySeriesRef.current.removePriceLine(buyPriceLineRef.current); } catch {}
        buyPriceLineRef.current = null;
      }
      if (Number.isFinite(numBid) && numBid > 0) {
        try {
          buyPriceLineRef.current = buySeriesRef.current.createPriceLine({
            price: numBid,
            color: '#10b981',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `BID ₹${numBid.toFixed(2)}`,
          });
        } catch {}
      }
    }

    // Update Price Lines on Single Chart
    if (singleSellSeriesRef.current && typeof singleSellSeriesRef.current.createPriceLine === 'function') {
      if (singlePriceLineAskRef.current) {
        try { singleSellSeriesRef.current.removePriceLine(singlePriceLineAskRef.current); } catch {}
        singlePriceLineAskRef.current = null;
      }
      if (Number.isFinite(numAsk) && numAsk > 0) {
        try {
          singlePriceLineAskRef.current = singleSellSeriesRef.current.createPriceLine({
            price: numAsk,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `ASK ₹${numAsk.toFixed(2)}`,
          });
        } catch {}
      }
    }

    if (singleBuySeriesRef.current && typeof singleBuySeriesRef.current.createPriceLine === 'function') {
      if (singlePriceLineBidRef.current) {
        try { singleBuySeriesRef.current.removePriceLine(singlePriceLineBidRef.current); } catch {}
        singlePriceLineBidRef.current = null;
      }
      if (Number.isFinite(numBid) && numBid > 0) {
        try {
          singlePriceLineBidRef.current = singleBuySeriesRef.current.createPriceLine({
            price: numBid,
            color: '#10b981',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `BID ₹${numBid.toFixed(2)}`,
          });
        } catch {}
      }
    }
  }, [candleData, bestBid, bestAsk, isChartReady, viewMode]);

  // 4. Update Trade Markers
  useEffect(() => {
    if (!Array.isArray(trades) || trades.length === 0) return;
    if (typeof createSeriesMarkers !== 'function') return;

    const candleTimes = new Set((candleData || []).map((c) => c.time));
    if (candleTimes.size === 0) return;

    const sellMarkers = [];
    const buyMarkers = [];

    const recent = trades.slice(0, 15);
    for (const tr of recent) {
      const isBuy = tr.side === 'buy' || tr.side === 'BID';
      const trSec = tr.executedAt
        ? Math.floor(new Date(tr.executedAt).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      let closestTime = null;
      let minDiff = Infinity;
      for (const t of candleTimes) {
        const diff = Math.abs(t - trSec);
        if (diff < minDiff) {
          minDiff = diff;
          closestTime = t;
        }
      }

      if (closestTime) {
        if (isBuy) {
          buyMarkers.push({
            time: closestTime,
            position: 'belowBar',
            color: '#10b981',
            shape: 'arrowUp',
            text: `BUY ₹${tr.price}`,
          });
        } else {
          sellMarkers.push({
            time: closestTime,
            position: 'aboveBar',
            color: '#ef4444',
            shape: 'arrowDown',
            text: `SELL ₹${tr.price}`,
          });
        }
      }
    }

    sellMarkers.sort((a, b) => a.time - b.time);
    buyMarkers.sort((a, b) => a.time - b.time);

    try {
      if (sellSeriesRef.current && sellMarkers.length > 0) {
        if (!sellMarkersPluginRef.current) {
          sellMarkersPluginRef.current = createSeriesMarkers(sellSeriesRef.current, sellMarkers);
        } else {
          sellMarkersPluginRef.current.setMarkers(sellMarkers);
        }
      }
      if (buySeriesRef.current && buyMarkers.length > 0) {
        if (!buyMarkersPluginRef.current) {
          buyMarkersPluginRef.current = createSeriesMarkers(buySeriesRef.current, buyMarkers);
        } else {
          buyMarkersPluginRef.current.setMarkers(buyMarkers);
        }
      }
    } catch {}
  }, [trades, candleData, isChartReady]);

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
      {/* Top Main Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(99, 102, 241, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary, #6366f1)',
            }}
          >
            <BarChart3 size={19} />
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
              Dual Visualizer: <span style={{ color: '#ef4444', fontWeight: 600 }}>● Sell (Asks) in Red</span> |{' '}
              <span style={{ color: '#10b981', fontWeight: 600 }}>● Buy (Bids) in Green</span>
            </p>
          </div>
        </div>

        {/* Global Market Stats & Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {spread && spread !== '--' && (
            <span
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 6,
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-subtle)',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              Spread: <span style={{ color: 'var(--accent-orange)' }}>₹{spread}</span>
            </span>
          )}

          {summary && (
            <div
              className="font-mono"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: isPositive ? '#10b981' : '#ef4444',
                padding: '4px 8px',
                borderRadius: 6,
                background: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              }}
            >
              {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
            </div>
          )}

          {/* Toggle between Split (Dual) and Single view */}
          <div
            style={{
              display: 'inline-flex',
              padding: 2,
              borderRadius: 6,
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              onClick={() => setViewMode('split')}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                background: viewMode === 'split' ? 'var(--accent-primary, #6366f1)' : 'transparent',
                color: viewMode === 'split' ? '#ffffff' : 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease',
              }}
            >
              <Columns size={12} />
              Split (Sell / Buy)
            </button>
            <button
              onClick={() => setViewMode('single')}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                background: viewMode === 'single' ? 'var(--accent-primary, #6366f1)' : 'transparent',
                color: viewMode === 'single' ? '#ffffff' : 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease',
              }}
            >
              <Maximize2 size={12} />
              Single
            </button>
          </div>
        </div>
      </div>

      {/* Graphs Layout */}
      {viewMode === 'split' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {/* LEFT GRAPH: SELL SIDE (RED) */}
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.03)',
              borderRadius: 'var(--radius-md, 8px)',
              padding: '12px 14px',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              position: 'relative',
            }}
          >
            {/* Sub-header for Sell Side */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#ef4444',
                    boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', letterSpacing: '0.02em' }}>
                  SELL GRAPH (ASKS)
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  fontWeight: 700,
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                }}
              >
                Best Ask: ₹{bestAsk || '--'}
              </span>
            </div>

            <div ref={sellContainerRef} style={{ width: '100%', height: '220px' }} />
          </div>

          {/* RIGHT GRAPH: BUY SIDE (GREEN) */}
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.03)',
              borderRadius: 'var(--radius-md, 8px)',
              padding: '12px 14px',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              position: 'relative',
            }}
          >
            {/* Sub-header for Buy Side */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981', letterSpacing: '0.02em' }}>
                  BUY GRAPH (BIDS)
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  fontWeight: 700,
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }}
              >
                Best Bid: ₹{bestBid || '--'}
              </span>
            </div>

            <div ref={buyContainerRef} style={{ width: '100%', height: '220px' }} />
          </div>
        </div>
      ) : (
        /* Single Full-Width Chart Mode with Dual Red & Green Curves */
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 'var(--radius-md, 8px)',
            padding: '12px 14px',
            border: '1px solid var(--border-subtle)',
            position: 'relative',
          }}
        >
          {/* Sub-header with Legend */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#ef4444',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#ef4444',
                    boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
                  }}
                />
                SELL CURVE (ASKS): ₹{bestAsk || '--'}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#10b981',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
                  }}
                />
                BUY CURVE (BIDS): ₹{bestBid || '--'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-dim)' }}>
              <span>
                Movements: <span style={{ color: '#10b981', fontWeight: 600 }}>▲ Rise (Green)</span> /{' '}
                <span style={{ color: '#ef4444', fontWeight: 600 }}>▼ Dip (Red)</span>
              </span>
            </div>
          </div>

          <div style={{ width: '100%', height: '240px' }} ref={singleContainerRef} />
        </div>
      )}
    </div>
  );
}
