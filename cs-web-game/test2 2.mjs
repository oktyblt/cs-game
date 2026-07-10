import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.error('PAGE ERROR:', error));

  await page.goto('http://localhost:5173');
  
  setTimeout(async () => {
    console.log('Clicking join button...');
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-join-room') || document.querySelector('#btn-launch');
      if (btn) btn.click();
    });
    
    setTimeout(async () => {
        await browser.close();
    }, 2000);
  }, 3000);
})();
