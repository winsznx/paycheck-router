"use client";

import { type KeyboardEvent, type PointerEvent, useId, useRef } from "react";

export type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Arrow keys move by `step`; Shift moves tenfold (PRD 14.6, 16.4). */
  step?: number;
  onChange: (value: number) => void;
  /** e.g. (v) => `${v}%`; also used for aria-valuetext. */
  format: (value: number) => string;
  numberLabel: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** 2 px track, 20 px square thumb, paired numeric input as the non-drag alternative (2.5.7). */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  numberLabel,
}: SliderProps) {
  const labelId = useId();
  const numberId = useId();
  const railRef = useRef<HTMLDivElement>(null);
  const ratio = (clamp(value, min, max) - min) / (max - min);

  function commit(next: number) {
    const snapped = Math.round(next / step) * step;
    const clamped = clamp(snapped, min, max);
    if (clamped !== value) onChange(clamped);
  }

  function valueFromPointer(clientX: number) {
    const rail = railRef.current;
    if (!rail) return value;
    const rect = rail.getBoundingClientRect();
    const inset = 10;
    const x = clamp((clientX - rect.left - inset) / (rect.width - inset * 2), 0, 1);
    return min + x * (max - min);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    commit(valueFromPointer(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      commit(valueFromPointer(event.clientX));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const big = event.shiftKey ? step * 10 : step;
    const moves: Record<string, number> = {
      ArrowRight: value + big,
      ArrowUp: value + big,
      ArrowLeft: value - big,
      ArrowDown: value - big,
      PageUp: value + step * 10,
      PageDown: value - step * 10,
      Home: min,
      End: max,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    commit(next);
  }

  return (
    <div className="pr-field">
      <span id={labelId} className="pr-field__label">
        {label}
      </span>
      <div className="pr-slider">
        <div
          ref={railRef}
          className="pr-slider__rail"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <div className="pr-slider__track">
            <span className="pr-slider__range" style={{ inlineSize: `${ratio * 100}%` }} />
          </div>
          <div
            className="pr-slider__thumb"
            role="slider"
            tabIndex={0}
            aria-labelledby={labelId}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={format(value)}
            onKeyDown={onKeyDown}
            style={{ insetInlineStart: `calc(10px + (100% - 20px) * ${ratio})` }}
          />
        </div>
        <div className="pr-field__control pr-slider__number">
          <label htmlFor={numberId} className="pr-sr-only">
            {numberLabel}
          </label>
          <input
            id={numberId}
            className="pr-field__input"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) commit(next);
            }}
          />
        </div>
      </div>
    </div>
  );
}
