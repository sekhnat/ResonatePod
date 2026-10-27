import { parseFeed } from '../shared/feed';

// Parses feeds for feed-parse.ts, so a big one doesn't hold up the window while it is read.
const scope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<{ id: number; xml: string }>) => void): void;
};

scope.addEventListener('message', (e) => {
  const { id, xml } = e.data;
  try {
    scope.postMessage({ id, feed: parseFeed(xml) });
  } catch (err) {
    scope.postMessage({ id, error: (err as Error).message });
  }
});
