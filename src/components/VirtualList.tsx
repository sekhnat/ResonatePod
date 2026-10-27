import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * A long list that mounts only the rows near the viewport. The page scrolls inside <main> with the list some way
 * below a header, so the scroll element is found from the list and rows are placed relative to where it starts.
 * Rows can change height (show notes open), so each one is measured.
 */
export function VirtualList({ count, estimate, itemKey, overscan = 8, children }: {
  count: number;
  /** A row's height before it has been measured. */
  estimate: number;
  itemKey: (index: number) => string;
  overscan?: number;
  children: (index: number) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);

  // Where the list starts within the scrolling content; it moves when the header above it changes size.
  useLayoutEffect(() => {
    const list = listRef.current;
    const page = list?.closest('main') as HTMLElement | null;
    if (!list || !page) return;
    setScroller(page);
    const measure = () => setMargin(Math.round(list.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(page);
    if (list.previousElementSibling) watch.observe(list.previousElementSibling);
    return () => watch.disconnect();
  }, []);

  const virtual = useVirtualizer({ count, getScrollElement: () => scroller, estimateSize: () => estimate, overscan, scrollMargin: margin, getItemKey: itemKey });

  return (
    <div ref={listRef} className="vlist" style={{ height: virtual.getTotalSize() }}>
      {virtual.getVirtualItems().map((item) => (
        <div key={item.key} data-index={item.index} ref={virtual.measureElement}
          className="vlist-item" style={{ transform: `translateY(${item.start - margin}px)` }}>
          {children(item.index)}
        </div>
      ))}
    </div>
  );
}
