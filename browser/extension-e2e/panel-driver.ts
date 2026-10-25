import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BrowserContext, CDPSession } from '@playwright/test'

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type TargetInfo = { targetId: string; type: string; url: string }
type RelayMessage = {
  id?: number
  result?: unknown
  error?: { code: number; message: string }
  method?: string
  params?: unknown
}

/** Drives the actual Chrome side panel, which Playwright does not expose as a Page. */
export class SidePanelDriver {
  private nextCommandId = 0
  private readonly pending = new Map<number, PendingCommand>()
  private closed = false
  readonly consoleMessages: string[] = []
  readonly exceptions: string[] = []

  constructor(
    private readonly cdp: CDPSession,
    private readonly sessionId: string,
    readonly targetId: string,
  ) {
    cdp.on('Target.receivedMessageFromTarget', this.onMessage)
    cdp.on('Target.detachedFromTarget', this.onDetached)
  }

  private readonly onMessage = (event: { sessionId: string; message: string }): void => {
    if (event.sessionId !== this.sessionId) return
    const message = JSON.parse(event.message) as RelayMessage
    if (message.method === 'Runtime.consoleAPICalled') {
      const params = message.params as { type: string; args: { value?: unknown; description?: string }[] }
      this.consoleMessages.push(`${params.type}: ${params.args.map(arg => String(arg.value ?? arg.description ?? '')).join(' ')}`)
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const params = message.params as { exceptionDetails: { text: string; exception?: { description?: string } } }
      this.exceptions.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text)
    }
    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(`Side panel CDP: ${message.error.message}`))
    else pending.resolve(message.result)
  }

  private readonly onDetached = (event: { sessionId: string }): void => {
    if (event.sessionId === this.sessionId) this.rejectPending(new Error('Side panel target detached'))
  }

  private rejectPending(error: Error): void {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) throw new Error('Side panel driver is closed')
    const id = ++this.nextCommandId
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Side panel CDP command timed out: ${method}`))
      }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
    })
    void this.cdp.send('Target.sendMessageToTarget', {
      sessionId: this.sessionId,
      message: JSON.stringify({ id, method, params }),
    }).catch(error => {
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    })
    return await response as T
  }

  async evaluate<T>(expression: string, userGesture = false): Promise<T> {
    const response = await this.send<{
      result: { value?: T; unserializableValue?: string; description?: string }
      exceptionDetails?: { text: string; exception?: { description?: string } }
    }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture })
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    }
    if (response.result.unserializableValue !== undefined) {
      throw new Error(`Side panel evaluate returned a non-JSON value: ${response.result.unserializableValue}`)
    }
    return response.result.value as T
  }

  async click(selector: string): Promise<void> {
    const point = await this.evaluate<{ x: number; y: number }>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error('Missing side panel element: ' + ${JSON.stringify(selector)});
      if (element.matches(':disabled,[aria-disabled="true"]')) throw new Error('Side panel element is disabled');
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error('Side panel element is not visible');
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }

  async screenshot(path: string): Promise<void> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(data, 'base64'))
  }

  async close(): Promise<void> {
    if (!this.closed) {
      await this.cdp.send('Target.detachFromTarget', { sessionId: this.sessionId }).catch(() => {})
    }
    this.cdp.off('Target.receivedMessageFromTarget', this.onMessage)
    this.cdp.off('Target.detachedFromTarget', this.onDetached)
    this.rejectPending(new Error('Side panel driver closed'))
    await this.cdp.detach().catch(() => {})
  }
}

export async function connectSidePanel(
  context: BrowserContext,
  extensionId: string,
  timeoutMs = 10_000,
): Promise<SidePanelDriver> {
  const browser = context.browser()
  if (!browser) throw new Error('The persistent Chromium context has no browser connection')
  const cdp = await browser.newBrowserCDPSession()
  const panelUrl = `chrome-extension://${extensionId}/panel.html`
  const deadline = Date.now() + timeoutMs
  try {
    do {
      const { targetInfos } = await cdp.send('Target.getTargets') as { targetInfos: TargetInfo[] }
      const target = targetInfos.find(info => info.type === 'page' && info.url === panelUrl)
      if (target) {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
        const panel = new SidePanelDriver(cdp, sessionId, target.targetId)
        await panel.send('Runtime.enable')
        await panel.send('Page.enable')
        return panel
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    throw new Error(`Timed out waiting for actual side panel: ${panelUrl}`)
  } catch (error) {
    await cdp.detach().catch(() => {})
    throw error
  }
}
