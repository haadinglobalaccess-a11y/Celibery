const {chromium}=require('playwright');
const {expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base='http://localhost:5173';
(async()=>{
 const home=(await(await fetch(base+'/api/home')).json()).data;
 const items=[...new Map([...home.featured,...home.categoryProducts.flatMap(c=>c.items),...home.bestSellers.items,...home.collections.flatMap(c=>c.products)].map(p=>[p._id,p])).values()].slice(0,5);
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const results=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:960}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/en');await page.waitForSelector('.product-story--pinned');await page.waitForTimeout(800);
  const root=page.locator('.product-story'),slides=root.locator('.product-story__slide');
  assert.equal(await slides.count(),5);
  assert.equal(await page.locator('.cel-holosphere').count(),1);
  assert.equal(await page.locator('.product-motion').count(),2);
  for(let i=0;i<5;i++){
   assert.equal(await slides.nth(i).locator('h3').textContent(),items[i].name.en);
   assert.equal(await slides.nth(i).locator('.product-story__copy p').textContent(),items[i].shortDescription.en);
   assert.equal(await slides.nth(i).locator('a').getAttribute('href'),'/en/p/'+items[i].slug);
   assert.equal(Number((await slides.nth(i).locator('.price__now').textContent()).replace(/[^0-9.]/g,'')),items[i].price/100);
   await root.evaluate((el,index)=>{const panel=el.querySelector('.product-story__panel');window.scrollTo({top:el.getBoundingClientRect().top+scrollY-parseFloat(getComputedStyle(panel).top)+index/4*(el.offsetHeight-panel.offsetHeight),behavior:'instant'})},i);
   await expect(root).toHaveAttribute('data-active-index',String(i));
   await page.waitForTimeout(1400);
   const box=await root.locator('.product-story__panel').boundingBox();assert.ok(Math.abs(box.y-68)<4,JSON.stringify(box));
   await expect(slides.nth(i).locator('a')).toBeVisible();
   await page.screenshot({path:`e2e/.artifacts/story-desktop-${i+1}.png`});
   console.log('PASS desktop real product',i+1,items[i].slug);
  }
  await root.getByRole('button',{name:'Previous product',exact:true}).click();await expect(root).toHaveAttribute('data-active-index','3');
  await root.getByRole('button',{name:items[1].name.en,exact:true}).click();await expect(root).toHaveAttribute('data-active-index','1');
  await root.getByRole('button',{name:'Next product',exact:true}).click();await expect(root).toHaveAttribute('data-active-index','2');
  await root.evaluate(el=>window.scrollTo({top:el.offsetTop+el.offsetHeight+200,behavior:'instant'}));await page.waitForTimeout(300);
  assert.ok((await root.locator('.product-story__panel').boundingBox()).y<0,'sticky releases');
  await root.evaluate(el=>window.scrollTo({top:el.offsetTop-1000,behavior:'instant'}));await page.waitForTimeout(200);await expect(root).toHaveAttribute('data-active-index','0');
  // Navigate using the actual new CTA.
  await root.getByRole('button',{name:items[2].name.en,exact:true}).evaluate(el=>el.click());await expect(root).toHaveAttribute('data-active-index','2');await page.waitForTimeout(1200);
  await slides.nth(2).getByRole('link',{name:'View Product'}).click();await page.waitForURL('**/en/p/'+items[2].slug);await expect(page.locator('h1')).toContainText(items[2].name.en);
  assert.deepEqual(errors,[]);results.push({desktop:'5 real slides, content, pin, horizontal motion, controls, reverse scroll, release, real CTA passed'});
  await context.close();
  for(const viewport of [{width:390,height:844},{width:820,height:1180}]){
   const ctx=await browser.newContext({viewport,isMobile:true,hasTouch:true});const p=await ctx.newPage();await p.goto(base+'/en');await p.waitForSelector('.product-story');const r=p.locator('.product-story');
   assert.ok(!await r.evaluate(el=>el.classList.contains('product-story--pinned')));
   const rail=r.locator('.product-story__track');await rail.scrollIntoViewIfNeeded();
   await r.getByRole('button',{name:'Next product',exact:true}).click();await expect(r).toHaveAttribute('data-active-index','1');
   const cdp=await ctx.newCDPSession(p);const bounds=await rail.boundingBox();const x=bounds.x+bounds.width*.8,y=Math.max(100,Math.min(viewport.height-100,bounds.y+150));
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=10;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-bounds.width*.65*step/10,y}]});await p.waitForTimeout(20)}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await expect(r).toHaveAttribute('data-active-index','2');
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
   await p.screenshot({path:`e2e/.artifacts/story-mobile-${viewport.width}.png`});
   const before=await p.evaluate(()=>scrollY);await p.mouse.wheel(0,600);await p.waitForTimeout(400);assert.ok(await p.evaluate(y=>scrollY>y,before),'vertical scroll continues');
   await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(200);assert.ok(!await r.evaluate(el=>el.classList.contains('product-story--pinned')));
   await r.getByRole('button',{name:items[4].name.en,exact:true}).evaluate(el=>el.click());await expect(r).toHaveAttribute('data-active-index','4');
   assert.equal(await r.locator('.product-story__image img').last().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
   results.push({viewport,touch:'native touch swipe, next, progress, vertical scroll, overflow and reduced motion passed'});console.log('PASS touch',viewport.width);await ctx.close();
  }
  const p=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});await p.goto(base+'/en');await p.waitForSelector('.product-story');assert.equal(await p.locator('.product-story--pinned').count(),0);await p.close();
 }finally{fs.writeFileSync('e2e/.artifacts/story-results.json',JSON.stringify(results,null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
