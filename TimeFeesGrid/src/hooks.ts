import * as React from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's border-box size. The host resizes the component container, so width is the
 * only signal available for picking a layout density.
 */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, ElementSize] {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState<ElementSize>({ width: 0, height: 0 });

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setSize((previous) =>
        Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

export interface TransientMessage {
  text: string;
  tone: 'info' | 'warning';
  /** Set for destructive actions so the UI can offer an undo. */
  undoable?: boolean;
}

/** A message that clears itself after a few seconds. */
export function useTransientMessage(timeoutMs = 8000): {
  message: TransientMessage | null;
  show: (message: TransientMessage) => void;
  clear: () => void;
} {
  const [message, setMessage] = React.useState<TransientMessage | null>(null);
  const timer = React.useRef<number | undefined>(undefined);

  const clear = React.useCallback((): void => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    setMessage(null);
  }, []);

  const show = React.useCallback(
    (next: TransientMessage): void => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      setMessage(next);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        setMessage(null);
      }, timeoutMs);
    },
    [timeoutMs],
  );

  React.useEffect(() => clear, [clear]);

  return { message, show, clear };
}
