/**
 * Audio Waveform Intro Video Recording
 *
 * This Playwright test records a full walkthrough of the Audio Waveform app.
 * It injects an on-screen transcription overlay at each scene,
 * creating a narrated walkthrough suitable for a product intro.
 *
 * Prerequisites:
 *   - Dev server running: bun server.bun.js (or node server.js)
 *   - A sample video file at e2e/video/sample.mp4 (>2GB for full demo)
 *
 * Run:
 *   cd e2e
 *   npx playwright test video/record-intro.spec.ts --config=playwright.video.config.ts
 *
 * Output:
 *   test-results/record-intro-{hash}/video.webm
 *   Convert to MP4 via scripts/record-video.sh
 */
import { test, type Page } from '@playwright/test'
import * as path from 'path'
import transcriptions from './transcriptions.json' with { type: 'json' }

// ---------------------------------------------------------------------------
// Overlay helpers
// ---------------------------------------------------------------------------

async function injectOverlay(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById('aw-overlay')) return

    const overlay = document.createElement('div')
    overlay.id = 'aw-overlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      bottom: '40px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      background: 'rgba(15, 52, 96, 0.92)',
      color: '#4fc3f7',
      padding: '16px 32px',
      borderRadius: '12px',
      fontSize: '22px',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontWeight: '500',
      letterSpacing: '0.01em',
      maxWidth: '720px',
      textAlign: 'center',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(79, 195, 247, 0.3)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      opacity: '0',
      transition: 'opacity 0.4s ease',
      pointerEvents: 'none',
    })
    document.body.appendChild(overlay)
  })
}

async function showCaption(page: Page, text: string) {
  await page.evaluate((t) => {
    const el = document.getElementById('aw-overlay')
    if (!el) return
    el.textContent = t
    el.style.opacity = '1'
  }, text)
}

async function hideCaption(page: Page) {
  await page.evaluate(() => {
    const el = document.getElementById('aw-overlay')
    if (el) el.style.opacity = '0'
  })
}

async function caption(page: Page, scene: number) {
  const t = transcriptions.find((s) => s.scene === scene)
  if (!t) return
  await showCaption(page, t.text)
  await page.waitForTimeout(t.duration)
  await hideCaption(page)
  await page.waitForTimeout(400) // fade-out gap
}

function delay(page: Page, ms: number) {
  return page.waitForTimeout(ms)
}

// ---------------------------------------------------------------------------
// Video recording test
// ---------------------------------------------------------------------------

test.describe('Audio Waveform Intro Video', () => {
  test('record full intro walkthrough', async ({ page }) => {
    // 30 minutes — processing a 3GB file through WASM takes time
    test.setTimeout(1_800_000)

    // -----------------------------------------------------------------------
    // Scene 1: Landing — app title and subtitle
    // -----------------------------------------------------------------------
    const baseURL = process.env.BASE_URL || 'http://localhost:3333'
    await page.goto(baseURL)
    await page.waitForLoadState('networkidle')
    await injectOverlay(page)
    await delay(page, 800)
    await caption(page, 1)

    // -----------------------------------------------------------------------
    // Scene 2: Drop zone — highlight the upload area
    // -----------------------------------------------------------------------
    const dropZone = page.locator('#drop-zone')
    await dropZone.hover()
    await delay(page, 500)

    // Simulate dragover visual state
    await page.evaluate(() => {
      document.getElementById('drop-zone')?.classList.add('dragover')
    })
    await delay(page, 1000)

    await injectOverlay(page)
    await caption(page, 2)

    // Remove dragover state
    await page.evaluate(() => {
      document.getElementById('drop-zone')?.classList.remove('dragover')
    })
    await delay(page, 500)

    // -----------------------------------------------------------------------
    // Scene 3: Upload a sample video file (3GB — chunked to IndexedDB)
    // -----------------------------------------------------------------------
    const sampleVideoPath = path.resolve(__dirname, 'sample.mp4')
    const fileInput = page.locator('#file-input')
    await fileInput.setInputFiles(sampleVideoPath)

    // 3GB file = 60 chunks × 50MB — allow up to 10 minutes for IndexedDB storage
    await page.locator('#files-section').waitFor({ state: 'visible', timeout: 600_000 })
    await delay(page, 800)

    await injectOverlay(page)
    await caption(page, 3)

    // -----------------------------------------------------------------------
    // Scene 4: Click "Extract & Visualize" — ffmpeg loading
    // -----------------------------------------------------------------------
    const extractBtn = page.getByText('Extract & Visualize')
    await extractBtn.hover()
    await delay(page, 500)
    await extractBtn.click()

    // Wait for ffmpeg loading message in the log
    await page.locator('#log .log-entry.success').first().waitFor({ timeout: 300_000 })
    await delay(page, 500)

    await injectOverlay(page)
    await caption(page, 4)

    // -----------------------------------------------------------------------
    // Scene 5: Audio extraction progress
    // -----------------------------------------------------------------------
    // 3GB file uses WORKERFS mount — extraction via stream copy should be fast
    // but WASM I/O overhead can be significant
    await page.locator('#extract-status:has-text("Audio extracted")').waitFor({ timeout: 600_000 })
    await delay(page, 500)

    await injectOverlay(page)
    await caption(page, 5)

    // -----------------------------------------------------------------------
    // Scene 6: Downsampling progress
    // -----------------------------------------------------------------------
    // Wait for analysis phase
    await page.locator('#analyze-progress').waitFor({ state: 'visible', timeout: 60_000 })
    await delay(page, 1000)

    await injectOverlay(page)
    await caption(page, 6)

    // -----------------------------------------------------------------------
    // Scene 7: Peak extraction
    // -----------------------------------------------------------------------
    // Downsampling 13 minutes of audio through WASM can take a while
    await page.locator('#analyze-status:has-text("Analysis complete")').waitFor({ timeout: 600_000 })
    await delay(page, 500)

    await injectOverlay(page)
    await caption(page, 7)

    // -----------------------------------------------------------------------
    // Scene 8: Waveform rendered — show the full visualization
    // -----------------------------------------------------------------------
    await page.locator('#waveform-section').waitFor({ state: 'visible', timeout: 30_000 })
    await delay(page, 1000)

    // Scroll to waveform section
    await page.locator('#waveform-section').scrollIntoViewIfNeeded()
    await delay(page, 800)

    await injectOverlay(page)
    await caption(page, 8)

    // -----------------------------------------------------------------------
    // Scene 9: Click to seek — demonstrate playback cursor
    // -----------------------------------------------------------------------
    const waveformContainer = page.locator('#waveform-container')
    const containerBox = await waveformContainer.boundingBox()

    if (containerBox) {
      // Click at 30% position
      await page.mouse.click(
        containerBox.x + containerBox.width * 0.3,
        containerBox.y + containerBox.height / 2
      )
      await delay(page, 800)

      // Click play
      await page.locator('#play-btn').click()
      await delay(page, 2000)

      // Pause
      await page.locator('#play-btn').click()
      await delay(page, 500)

      // Click at 60% position
      await page.mouse.click(
        containerBox.x + containerBox.width * 0.6,
        containerBox.y + containerBox.height / 2
      )
      await delay(page, 500)
    }

    await injectOverlay(page)
    await caption(page, 9)

    // -----------------------------------------------------------------------
    // Scene 10: Zoom controls
    // -----------------------------------------------------------------------
    // Zoom in 3 times
    for (let i = 0; i < 3; i++) {
      await page.locator('#zoom-in-btn').click()
      await delay(page, 600)
    }

    await delay(page, 800)

    await injectOverlay(page)
    await caption(page, 10)

    // Zoom fit
    await page.locator('#zoom-fit-btn').click()
    await delay(page, 800)

    // Zoom out
    for (let i = 0; i < 2; i++) {
      await page.locator('#zoom-out-btn').click()
      await delay(page, 600)
    }
    await delay(page, 500)

    // Zoom fit again
    await page.locator('#zoom-fit-btn').click()
    await delay(page, 800)

    // -----------------------------------------------------------------------
    // Scene 11: Scroll the log to show all processing steps
    // -----------------------------------------------------------------------
    await page.locator('#log-section').scrollIntoViewIfNeeded()
    await delay(page, 500)

    // Scroll log to top then slowly to bottom
    await page.evaluate(() => {
      const log = document.getElementById('log')
      if (log) log.scrollTop = 0
    })
    await delay(page, 800)

    await page.evaluate(() => {
      const log = document.getElementById('log')
      if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
    })
    await delay(page, 1500)

    await injectOverlay(page)
    await caption(page, 11)

    // -----------------------------------------------------------------------
    // Scene 12: Closing — scroll back to top
    // -----------------------------------------------------------------------
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await delay(page, 1000)

    await injectOverlay(page)
    await caption(page, 12)
    await delay(page, 1000)
  })
})
