const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error));

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  console.log('Clicking join button...');
  await page.evaluate(() => {
    const btn = document.querySelector('#btn-launch');
    if (btn) btn.click();
    else console.log('btn-launch not found!');
  });

  await page.waitForTimeout(2000);
  await browser.close();
})();
