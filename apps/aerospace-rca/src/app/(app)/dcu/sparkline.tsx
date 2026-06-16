'use client';

import { useMemo } from 'react';
import type { SensorKind } from '@/lib/dcu-types';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  kind: SensorKind;
}

const STROKE_BY_KIND: Record<SensorKind, string> = {
  vibration: 'hsl(0 70% 60%)',
  pressure: 'hsl(20 90% 60%)',
  temperature: 'hsl(35 90% 60%)',
  voltage: 'hsl(50 90% 60%)',
  flow: 'hsl(190 70% 55%)',
};

/**
 * Inline SVG sparkline. Auto-scaled to the value range across the
 * provided history window (no chart library — ~30 LOC of math).
 *
 * If the values are all-zero or single-point we draw a flat baseline
 * rather than crashing on NaN from min===max.
 */
export function Sparkline({
  values,
  width = 160,
  height = 40,
  kind,
}: SparklineProps) {
  const stroke = STROKE_BY_KIND[kind];
  const { path, fill } = useMemo(() => {
    if (values.length < 2) {
      return {
        path: `M0,${height / 2} L${width},${height / 2}`,
        fill: '',
      };
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min) || !isFinite(max) || max - min < 1e-9) {
      return {
        path: `M0,${height / 2} L${width},${height / 2}`,
        fill: '',
      };
    }
    const dx = width / (values.length - 1);
    const range = max - min;
    const pad = 2;
    const usable = height - pad * 2;
    const yFor = (v: number) => pad + (1 - (v - min) / range) * usable;
    let path = `M0,${yFor(values[0]!)}`;
    for (let i = 1; i < values.length; i++) {
      path += ` L${(i * dx).toFixed(1)},${yFor(values[i]!).toFixed(1)}`;
    }
    // light area fill
    const fill =
      path +
      ` L${width},${height} L0,${height} Z`;
    return { path, fill };
  }, [values, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
    >
      {fill && <path d={fill} fill={stroke} fillOpacity={0.08} />}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
}
