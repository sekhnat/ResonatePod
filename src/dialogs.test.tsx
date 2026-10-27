import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialogs } from './components/Dialogs';
import { platform } from './platform';
import { useStore } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
const settle = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
const type = (el: Element, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement;

async function open(backend: { secure: boolean; backend: string }) {
  vi.spyOn(platform, 'secretStatus').mockResolvedValue(backend);
  useStore.setState({ ...initial, hydrated: true, dialog: 'sync' }, true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Dialogs />); });
  await settle();
  type(container.querySelector('#sync-server')!, 'gpodder.example');
  type(container.querySelector('#sync-user')!, 'ines');
  type(container.querySelector('#sync-pass')!, 'hunter2');
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('saving a password', () => {
  it('works as usual when a desktop keyring protects it', async () => {
    await open({ secure: true, backend: 'gnome_libsecret' });
    expect(container.textContent).not.toContain('Save it anyway');
    expect(button('Connect').disabled).toBe(false);
  });

  it('says so, and waits for a yes, when it would be saved as plain text', async () => {
    await open({ secure: false, backend: 'basic_text' });
    expect(container.textContent).toContain('No desktop keyring');
    expect(container.textContent).toContain('plain text in ~/.config/Resonate/secrets.json');
    expect(button('Connect').disabled).toBe(true);
    act(() => { (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    expect(button('Connect').disabled).toBe(false);
  });

  it('also waits when the answer could not be had', async () => {
    vi.spyOn(platform, 'secretStatus').mockRejectedValue(new Error('gone'));
    useStore.setState({ ...initial, hydrated: true, dialog: 'sync' }, true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<Dialogs />); });
    await settle();
    type(container.querySelector('#sync-server')!, 'gpodder.example');
    type(container.querySelector('#sync-user')!, 'ines');
    type(container.querySelector('#sync-pass')!, 'x');
    expect(container.textContent).toContain('can’t tell whether a desktop keyring');
    expect(button('Connect').disabled).toBe(true);
  });
});
