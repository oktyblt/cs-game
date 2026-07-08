import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://230d4a12.cs-web-game.pages.dev', { waitUntil: 'networkidle0', timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));
  const html = await page.content();
  if (html.includes('Sistem başlatılıyor...')) {
     console.log('STUCK AT SPLASH SCREEN!');
     const splashStatus = await page.evaluate(() => document.getElementById('splash-status')?.textContent);
     console.log('Current Splash Text:', splashStatus);
  } else {
     console.log('SPLASH DISAPPEARED');
  }
  await browser.close();
})();
