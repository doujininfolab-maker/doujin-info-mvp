"use client";

import { useMemo, useState } from "react";
import type { ProductTrendPoint } from "@/lib/types";

const RANGE_OPTIONS = [
  { value: "30d", label: "過去30日", days: 30 },
  { value: "thisMonth", label: "今月", days: 30 },
  { value: "lastMonth", label: "先月", days: 30 },
  { value: "twoMonthsAgo", label: "先々月", days: 30 },
  { value: "halfYear", label: "半年", days: 180 },
  { value: "year", label: "1年", days: 365 },
] as const;

type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

type TrendPoint = {
  date: string;
  label: string;
  sales: number;
  revenue: number;
  price: number;
};

type ChartPoint = TrendPoint & {
  x: number;
  salesY?: number;
  revenueY?: number;
  priceY?: number;
};

type WorkTrendChartsProps = {
  priceCurrent?: number | null;
  priceOriginal?: number | null;
  salesCount?: number | null;
  trendPoints?: ProductTrendPoint[];
};

const SALES_REVENUE_WIDTH = 900;
const PRICE_WIDTH = 900;
const CHART_HEIGHT = 260;
const PAD = {
  top: 34,
  right: 72,
  bottom: 48,
  left: 58,
};

function getRangeDays(range: RangeValue): number {
  return RANGE_OPTIONS.find((option) => option.value === range)?.days ?? 30;
}

function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function formatCompactCurrency(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 10000).toLocaleString("ja-JP")}万`;
  if (value >= 10000) return `${Math.round(value / 1000).toLocaleString("ja-JP")}千`;
  return Math.round(value).toLocaleString("ja-JP");
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("ja-JP");
}

function formatDateLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatMonthLabel(date: Date): string {
  return `${date.getMonth() + 1}月`;
}

function formatTooltipDate(point: TrendPoint): string {
  if (point.date.length === 7) {
    const month = Number(point.date.slice(5, 7));
    return Number.isFinite(month) ? `${month}月` : point.label;
  }

  const [, month, day] = point.date.split("-").map(Number);
  if (Number.isFinite(month) && Number.isFinite(day)) {
    return `${month}/${day}`;
  }

  return point.label;
}

function isMonthlyRange(range: RangeValue): boolean {
  return range === "halfYear" || range === "year";
}

function roundUpNice(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const normalized = value / base;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * base;
}

function getInnerSize(width: number) {
  return {
    left: PAD.left,
    right: width - PAD.right,
    top: PAD.top,
    bottom: CHART_HEIGHT - PAD.bottom,
    width: width - PAD.left - PAD.right,
    height: CHART_HEIGHT - PAD.top - PAD.bottom,
  };
}

function yScale(value: number, max: number): number {
  const inner = getInnerSize(SALES_REVENUE_WIDTH);
  return inner.bottom - (value / Math.max(max, 1)) * inner.height;
}

function priceYScale(value: number, min: number, max: number): number {
  const inner = getInnerSize(PRICE_WIDTH);
  const range = Math.max(max - min, 1);
  return inner.bottom - ((value - min) / range) * inner.height;
}

function getX(index: number, count: number, width: number): number {
  const inner = getInnerSize(width);
  return inner.left + (inner.width * index) / Math.max(count - 1, 1);
}

function createLinePath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function createAreaPath(points: Array<{ x: number; y: number }>, width: number): string {
  if (points.length === 0) return "";
  const inner = getInnerSize(width);
  const line = createLinePath(points);
  return `${line} L${points[points.length - 1].x.toFixed(1)},${inner.bottom} L${points[0].x.toFixed(1)},${inner.bottom} Z`;
}

function getXAxisTicks(data: TrendPoint[]): Array<{ index: number; label: string }> {
  if (data.length === 0) return [];
  if (data.length <= 12) {
    return data.map((point, index) => ({ index, label: point.label }));
  }

  const indexes = [
    0,
    Math.floor((data.length - 1) * 0.25),
    Math.floor((data.length - 1) * 0.5),
    Math.floor((data.length - 1) * 0.75),
    data.length - 1,
  ];
  return [...new Set(indexes)].map((index) => ({ index, label: data[index]?.label ?? "" }));
}

function getDotIndexes(data: TrendPoint[]): number[] {
  return data.map((_, index) => index);
}

function aggregateMonthlyTrendData(data: TrendPoint[]): TrendPoint[] {
  const monthly = new Map<string, TrendPoint>();

  data.forEach((point) => {
    const key = point.date.slice(0, 7);
    const existing = monthly.get(key);
    const [year, month] = key.split("-").map(Number);
    const monthDate = new Date(year, (month ?? 1) - 1, 1);

    if (existing) {
      existing.sales += point.sales;
      existing.revenue += point.revenue;
      existing.price = point.price;
    } else {
      monthly.set(key, {
        date: key,
        label: formatMonthLabel(monthDate),
        sales: point.sales,
        revenue: point.revenue,
        price: point.price,
      });
    }
  });

  return [...monthly.values()];
}

function createDummyDailyTrendData(range: RangeValue, priceCurrent?: number | null, priceOriginal?: number | null, salesCount?: number | null): TrendPoint[] {
  const days = getRangeDays(range);
  const today = new Date();
  const price = Math.max(100, priceCurrent ?? priceOriginal ?? 990);
  const original = Math.max(price, priceOriginal ?? price);
  const totalSales = Math.max(120, salesCount ?? 2000);
  const dailyBase = Math.max(1, Math.round(totalSales / Math.max(days * 5, 1)));

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - index - 1));

    const wave = 1 + Math.sin(index / 4.2) * 0.35 + Math.cos(index / 9.5) * 0.22;
    const weekendBoost = [0, 6].includes(date.getDay()) ? 1.45 : 1;
    const recentBoost = index > days * 0.82 ? 1.8 + (index - days * 0.82) / Math.max(days * 0.18, 1) : 1;
    const launchSpike = index > days * 0.88 ? 1 + ((index - days * 0.88) / Math.max(days * 0.12, 1)) * 3.2 : 1;
    const sales = Math.max(0, Math.round(dailyBase * wave * weekendBoost * recentBoost * launchSpike));

    const discountWindow = index > days * 0.25 && index < days * 0.55;
    const secondDiscount = index > days * 0.76;
    const simulatedPrice = secondDiscount ? price : discountWindow ? Math.round(original * 0.9) : original;

    return {
      date: date.toISOString().slice(0, 10),
      label: formatDateLabel(date),
      sales,
      revenue: sales * simulatedPrice,
      price: simulatedPrice,
    };
  });
}

function createDummyTrendData(range: RangeValue, priceCurrent?: number | null, priceOriginal?: number | null, salesCount?: number | null): TrendPoint[] {
  const dailyData = createDummyDailyTrendData(range, priceCurrent, priceOriginal, salesCount);
  return isMonthlyRange(range) ? aggregateMonthlyTrendData(dailyData) : dailyData;
}

function parseTrendDate(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  return new Date(year, month - 1, day);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getRangeBounds(range: RangeValue): { start: Date; end: Date } {
  const today = new Date();

  switch (range) {
    case "thisMonth": {
      return { start: startOfMonth(today), end: today };
    }
    case "lastMonth": {
      const target = addMonths(today, -1);
      return { start: startOfMonth(target), end: endOfMonth(target) };
    }
    case "twoMonthsAgo": {
      const target = addMonths(today, -2);
      return { start: startOfMonth(target), end: endOfMonth(target) };
    }
    case "halfYear":
      return { start: addDays(today, -(getRangeDays(range) - 1)), end: today };
    case "year":
      return { start: addDays(today, -(getRangeDays(range) - 1)), end: today };
    case "30d":
    default:
      return { start: addDays(today, -(getRangeDays(range) - 1)), end: today };
  }
}

function createActualTrendData(points: ProductTrendPoint[], range: RangeValue): TrendPoint[] {
  const { start, end } = getRangeBounds(range);
  const dailyData = points
    .map((point) => ({ point, dateValue: parseTrendDate(point.date) }))
    .filter((item): item is { point: ProductTrendPoint; dateValue: Date } => {
      if (!item.dateValue) return false;
      return item.dateValue >= start && item.dateValue <= end;
    })
    .sort((a, b) => a.dateValue.getTime() - b.dateValue.getTime())
    .map(({ point, dateValue }) => ({
      date: point.date,
      label: formatDateLabel(dateValue),
      sales: point.sales,
      revenue: point.revenue,
      price: point.price,
    }));

  return isMonthlyRange(range) ? aggregateMonthlyTrendData(dailyData) : dailyData;
}

function AxisGrid({ width, leftTicks, rightTicks }: { width: number; leftTicks: number[]; rightTicks?: number[] }) {
  const inner = getInnerSize(width);

  return (
    <g className="workChart__axis">
      {leftTicks.map((tick, index) => {
        const ratio = index / Math.max(leftTicks.length - 1, 1);
        const y = inner.bottom - ratio * inner.height;
        return (
          <g key={tick}>
            <line className="workChart__gridLine" x1={inner.left} x2={inner.right} y1={y} y2={y} />
            <text className="workChart__yLabel workChart__yLabel--left" x={inner.left - 10} y={y + 4}>{formatNumber(tick)}</text>
            {rightTicks ? (
              <text className="workChart__yLabel workChart__yLabel--right" x={inner.right + 10} y={y + 4}>{formatCompactCurrency(rightTicks[index] ?? 0)}</text>
            ) : null}
          </g>
        );
      })}
      <line className="workChart__axisLine" x1={inner.left} x2={inner.right} y1={inner.bottom} y2={inner.bottom} />
      <line className="workChart__axisLine" x1={inner.left} x2={inner.left} y1={inner.top} y2={inner.bottom} />
      {rightTicks ? <line className="workChart__axisLine" x1={inner.right} x2={inner.right} y1={inner.top} y2={inner.bottom} /> : null}
    </g>
  );
}

function XAxis({ data, width }: { data: TrendPoint[]; width: number }) {
  const inner = getInnerSize(width);
  const ticks = getXAxisTicks(data);

  return (
    <g className="workChart__xAxis">
      {ticks.map((tick) => {
        const x = getX(tick.index, data.length, width);
        return (
          <g key={`${tick.index}_${tick.label}`}>
            <line className="workChart__xTick" x1={x} x2={x} y1={inner.top} y2={inner.bottom} />
            <text x={x} y={inner.bottom + 26}>{tick.label}</text>
          </g>
        );
      })}
    </g>
  );
}

function SalesRevenueChart({ data }: { data: TrendPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = SALES_REVENUE_WIDTH;
  const maxSales = roundUpNice(Math.max(...data.map((point) => point.sales), 1));
  const maxRevenue = roundUpNice(Math.max(...data.map((point) => point.revenue), 1));
  const salesTicks = Array.from({ length: 5 }, (_, index) => Math.round((maxSales * index) / 4));
  const revenueTicks = Array.from({ length: 5 }, (_, index) => Math.round((maxRevenue * index) / 4));
  const points: ChartPoint[] = data.map((point, index) => ({
    ...point,
    x: getX(index, data.length, width),
    salesY: yScale(point.sales, maxSales),
    revenueY: yScale(point.revenue, maxRevenue),
  }));
  const salesLinePoints = points.map((point) => ({ x: point.x, y: point.salesY ?? 0 }));
  const revenueLinePoints = points.map((point) => ({ x: point.x, y: point.revenueY ?? 0 }));
  const salesPath = createLinePath(salesLinePoints);
  const salesArea = createAreaPath(salesLinePoints, width);
  const revenuePath = createLinePath(revenueLinePoints);
  const dotIndexes = getDotIndexes(data);
  const hoveredPoint = hoveredIndex == null ? null : points[hoveredIndex] ?? null;
  const tooltipWidth = 178;
  const tooltipHeight = 70;
  const inner = getInnerSize(width);
  const tooltipX = hoveredPoint
    ? Math.min(Math.max(hoveredPoint.x - tooltipWidth / 2, inner.left + 4), inner.right - tooltipWidth - 4)
    : 0;
  const tooltipY = hoveredPoint
    ? Math.max(Math.min(Math.min(hoveredPoint.salesY ?? inner.top, hoveredPoint.revenueY ?? inner.top) - tooltipHeight - 14, inner.bottom - tooltipHeight - 18), inner.top + 4)
    : 0;
  const tooltipPointerX = hoveredPoint ? Math.min(Math.max(hoveredPoint.x, tooltipX + 14), tooltipX + tooltipWidth - 14) : 0;

  return (
    <svg className="workChart" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} role="img" aria-label="販売数と推定売上額の推移">
      <text className="workChart__unit workChart__unit--left" x={PAD.left} y="18">販売数（本）</text>
      <text className="workChart__unit workChart__unit--right" x={width - PAD.right} y="18">推定売上額（円）</text>
      <AxisGrid width={width} leftTicks={salesTicks} rightTicks={revenueTicks} />
      <XAxis data={data} width={width} />
      <path className="workChart__area workChart__area--sales" d={salesArea} />
      <path className="workChart__line workChart__line--sales" d={salesPath} />
      <path className="workChart__line workChart__line--revenue" d={revenuePath} />
      {dotIndexes.map((index) => {
        const point = points[index];
        if (!point) return null;

        return (
          <g
            key={`${point.date}_${index}`}
            className="workChart__hoverTarget"
            tabIndex={0}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
          >
            <circle className="workChart__dot workChart__dot--sales" cx={point.x} cy={point.salesY} r={2.8} />
            <circle className="workChart__dot workChart__dot--revenue" cx={point.x} cy={point.revenueY} r={2.8} />
            <circle className="workChart__hitArea" cx={point.x} cy={Math.min(point.salesY ?? 0, point.revenueY ?? 0)} r={10} />
          </g>
        );
      })}
      {hoveredPoint ? (
        <g className="workChartTooltip" pointerEvents="none">
          <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" />
          <path d={`M${tooltipPointerX - 7},${tooltipY + tooltipHeight} L${tooltipPointerX},${tooltipY + tooltipHeight + 8} L${tooltipPointerX + 7},${tooltipY + tooltipHeight} Z`} />
          <text x={tooltipX + 12} y={tooltipY + 22} className="workChartTooltip__title">{formatTooltipDate(hoveredPoint)}</text>
          <rect className="workChartTooltip__marker workChartTooltip__marker--sales" x={tooltipX + 12} y={tooltipY + 32} width="13" height="13" />
          <text x={tooltipX + 31} y={tooltipY + 43}>販売数: {formatNumber(hoveredPoint.sales)} 本</text>
          <rect className="workChartTooltip__marker workChartTooltip__marker--revenue" x={tooltipX + 12} y={tooltipY + 51} width="13" height="13" />
          <text x={tooltipX + 31} y={tooltipY + 62}>販売額: {formatCurrency(hoveredPoint.revenue)}</text>
        </g>
      ) : null}
    </svg>
  );
}

function PriceChart({ data }: { data: TrendPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = PRICE_WIDTH;
  const rawMin = Math.min(...data.map((point) => point.price), 0);
  const rawMax = Math.max(...data.map((point) => point.price), 1);
  const minPrice = Math.max(0, Math.floor(rawMin * 0.85 / 100) * 100);
  const maxPrice = Math.ceil(rawMax * 1.08 / 100) * 100;
  const priceTicks = Array.from({ length: 5 }, (_, index) => Math.round((minPrice + ((maxPrice - minPrice) * index) / 4) / 10) * 10);
  const points: ChartPoint[] = data.map((point, index) => ({
    ...point,
    x: getX(index, data.length, width),
    priceY: priceYScale(point.price, minPrice, maxPrice),
  }));
  const pricePath = createLinePath(points.map((point) => ({ x: point.x, y: point.priceY ?? 0 })));
  const dotIndexes = getDotIndexes(data);
  const hoveredPoint = hoveredIndex == null ? null : points[hoveredIndex] ?? null;
  const tooltipWidth = 154;
  const tooltipHeight = 50;
  const inner = getInnerSize(width);
  const tooltipX = hoveredPoint
    ? Math.min(Math.max(hoveredPoint.x - tooltipWidth / 2, inner.left + 4), inner.right - tooltipWidth - 4)
    : 0;
  const tooltipY = hoveredPoint
    ? Math.max(Math.min((hoveredPoint.priceY ?? inner.top) - tooltipHeight - 14, inner.bottom - tooltipHeight - 18), inner.top + 4)
    : 0;
  const tooltipPointerX = hoveredPoint ? Math.min(Math.max(hoveredPoint.x, tooltipX + 14), tooltipX + tooltipWidth - 14) : 0;

  return (
    <svg className="workChart" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} role="img" aria-label="販売価格推移">
      <text className="workChart__unit workChart__unit--left" x={PAD.left} y="18">販売価格（円）</text>
      <AxisGrid width={width} leftTicks={priceTicks} />
      <XAxis data={data} width={width} />
      <path className="workChart__line workChart__line--price" d={pricePath} />
      {dotIndexes.map((index) => {
        const point = points[index];
        if (!point) return null;

        return (
          <g
            key={`${point.date}_${index}`}
            className="workChart__hoverTarget"
            tabIndex={0}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
          >
            <circle className="workChart__dot workChart__dot--price" cx={point.x} cy={point.priceY} r={2.8} />
            <circle className="workChart__hitArea" cx={point.x} cy={point.priceY} r={10} />
          </g>
        );
      })}
      {hoveredPoint ? (
        <g className="workChartTooltip" pointerEvents="none">
          <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" />
          <path d={`M${tooltipPointerX - 7},${tooltipY + tooltipHeight} L${tooltipPointerX},${tooltipY + tooltipHeight + 8} L${tooltipPointerX + 7},${tooltipY + tooltipHeight} Z`} />
          <text x={tooltipX + 12} y={tooltipY + 22} className="workChartTooltip__title">{formatTooltipDate(hoveredPoint)}</text>
          <rect className="workChartTooltip__marker workChartTooltip__marker--price" x={tooltipX + 12} y={tooltipY + 32} width="13" height="13" />
          <text x={tooltipX + 31} y={tooltipY + 43}>販売価格: {formatCurrency(hoveredPoint.price)}</text>
        </g>
      ) : null}
    </svg>
  );
}

export function WorkTrendCharts({ priceCurrent, priceOriginal, salesCount, trendPoints }: WorkTrendChartsProps) {
  const [range, setRange] = useState<RangeValue>("30d");
  const hasActualTrendPoints = trendPoints !== undefined;
  const data = useMemo(
    () => hasActualTrendPoints
      ? createActualTrendData(trendPoints, range)
      : createDummyTrendData(range, priceCurrent, priceOriginal, salesCount),
    [hasActualTrendPoints, range, priceCurrent, priceOriginal, salesCount, trendPoints],
  );

  const totalSales = data.reduce((sum, point) => sum + point.sales, 0);
  const totalRevenue = data.reduce((sum, point) => sum + point.revenue, 0);
  const latestPrice = data[data.length - 1]?.price ?? priceCurrent ?? 0;

  return (
    <section className="workTrendSection" aria-label="販売データグラフ">
      <div className="workTrendHeader">
        <div>
          <h2>販売数・売上額</h2>
          <p>{hasActualTrendPoints ? "DLsite取得データを基に表示しています。半年・1年は月ごとの累計です。" : "過去30日〜先々月は日次、半年・1年は月ごとの累計で表示しています。現在はダミーデータです。"}</p>
        </div>
        <label className="workTrendRange">
          <span>表示範囲</span>
          <select value={range} onChange={(event) => setRange(event.target.value as RangeValue)}>
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="workTrendSummary">
        <span className="workTrendSummary__range">{RANGE_OPTIONS.find((option) => option.value === range)?.label ?? "過去30日"}</span>
        <span><b>販売数</b> <strong>{formatNumber(totalSales)}本</strong></span>
        <span><b>推定売上額</b> <strong>{formatCurrency(totalRevenue)}</strong></span>
      </div>

      <SalesRevenueChart data={data} />
      <div className="workChartLegend">
        <span><i className="legendSales" />販売数</span>
        <span><i className="legendRevenue" />推定売上額</span>
      </div>
      <p className="workChartNote">{hasActualTrendPoints ? "※税込 / 取得できた日次データのみ表示" : "※税込 / 欠けたデータは中間値で自動補完"}</p>

      <div className="workTrendHeader workTrendHeader--sub">
        <div>
          <h2>販売価格推移</h2>
          <p>価格変更・セール推移を確認できます。</p>
        </div>
        <div className="workTrendCurrentPrice">現在価格 <strong>{formatCurrency(latestPrice)}</strong></div>
      </div>
      <PriceChart data={data} />
      <div className="workChartLegend">
        <span><i className="legendPrice" />販売価格</span>
      </div>
    </section>
  );
}
