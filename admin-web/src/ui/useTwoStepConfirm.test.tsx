import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTwoStepConfirm } from './useTwoStepConfirm';

describe('useTwoStepConfirm', () => {
  it('does not run the action on the first click, only arms it', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useTwoStepConfirm(action));

    act(() => result.current.handleClick());

    expect(action).not.toHaveBeenCalled();
    expect(result.current.armed).toBe(true);
  });

  it('runs the action and disarms on the second click', () => {
    const action = vi.fn();
    const { result } = renderHook(() => useTwoStepConfirm(action));

    act(() => result.current.handleClick());
    act(() => result.current.handleClick());

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);
  });

  it('disarms itself after the timeout without running the action', () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const { result } = renderHook(() => useTwoStepConfirm(action, { timeoutMs: 1000 }));

    act(() => result.current.handleClick());
    expect(result.current.armed).toBe(true);

    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.armed).toBe(false);
    expect(action).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('uses the provided armedLabel', () => {
    const { result } = renderHook(() => useTwoStepConfirm(vi.fn(), { armedLabel: 'Custom label' }));

    expect(result.current.armedLabel).toBe('Custom label');
  });
});
