import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ToolbarButton from './ToolbarButton';

describe('ToolbarButton', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    window.history.replaceState({}, '', '/viewer?reportId=report-42');

    const fakeCanvas = document.createElement('canvas');
    fakeCanvas.toBlob = callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
    jest.spyOn(document, 'querySelector').mockReturnValue(fakeCanvas);
  });

  afterEach(() => {
    if (root) {
      root.unmount();
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    jest.restoreAllMocks();
  });

  it('captures and uploads viewport JPEG', async () => {
    await act(async () => {
      root.render(<ToolbarButton />);
    });

    const button = container.querySelector('button');
    expect(button).toBeTruthy();

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/reports/report-42/attach'),
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});
