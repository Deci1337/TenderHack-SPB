const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function resolveWbTokenFromBrowser({
  url = 'https://www.wildberries.ru/',
  userAgent = process.env.WB_BROWSER_USER_AGENT || DEFAULT_USER_AGENT,
  headless = process.env.WB_BROWSER_HEADLESS !== '0',
  waitMs = Number(process.env.WB_BROWSER_WAIT_MS ?? 7000),
  maxWaitMs = Number(process.env.WB_BROWSER_MAX_WAIT_MS ?? 30000),
  maxAttempts = Number(process.env.WB_BROWSER_MAX_ATTEMPTS ?? 3),
  proxyServer = process.env.WB_BROWSER_PROXY,
} = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run: npm i -D playwright');
  }

  const browser = await chromium.launch({
    headless,
    proxy: proxyServer ? { server: proxyServer } : undefined,
  });

  try {
    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
      const context = await browser.newContext({ userAgent });
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        if (waitMs > 0) {
          await sleep(waitMs);
        }

        const startedAt = Date.now();
        while (Date.now() - startedAt <= Math.max(waitMs, maxWaitMs)) {
          const cookies = await context.cookies(url).catch(() => []);
          const tokenCookie = cookies.find((cookie) => cookie.name === 'x_wbaas_token');
          if (tokenCookie?.value) {
            return {
              token: tokenCookie.value,
              cookie: `x_wbaas_token=${tokenCookie.value}`,
              pow: null,
            };
          }

          // Challenge pages can reload/close tabs; keep polling cookie state from context.
          await sleep(1000);
        }
      } finally {
        await context.close().catch(() => {});
      }
    }

    throw new Error('x_wbaas_token cookie was not found');
  } finally {
    await browser.close();
  }
}
