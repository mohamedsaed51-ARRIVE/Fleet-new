import sys,re,json,os
from playwright.sync_api import sync_playwright
T='/home/claude/work/test'; FA=T+'/fontawesome-free-6.5.2-web'
BASE=os.environ.get('BASE','http://localhost:8123/')
def route(page):
    def h(r):
        u=r.request.url
        if 'localhost' in u: return r.continue_()
        if 'Chart.js' in u: return r.fulfill(path=T+'/chart.umd.js',content_type='text/javascript')
        if 'font-awesome' in u and u.endswith('all.min.css'):
            css=open(FA+'/css/all.min.css').read().replace('../webfonts/','http://fa.local/webfonts/')
            return r.fulfill(body=css,content_type='text/css')
        if 'fa.local' in u:
            return r.fulfill(path=FA+'/webfonts/'+u.split('/webfonts/')[1].split('?')[0])
        if 'googleapis' in u or 'gstatic' in u: return r.fulfill(body='',content_type='text/css')
        r.abort()
    page.add_init_script("try{localStorage.setItem('fleetSupportApiUrl','"+BASE+"exec')}catch(e){}")
    page.route('**/*',h)
def run(fn):
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome') if os.path.exists('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') else p.chromium.launch()
        fn(b); b.close()
if __name__=='__main__':
    errs=[]
    def go(b):
        for name,w,h in [('desktop',1440,900),('tablet',820,1100)]:
            pg=b.new_page(viewport={'width':w,'height':h}); route(pg)
            pg.on('console',lambda m:errs.append((name,m.type,m.text)) if m.type in('error','warning') else None)
            pg.on('pageerror',lambda e:errs.append((name,'pageerror',str(e))))
            pg.goto(BASE); pg.wait_for_selector('body:not(.is-loading)',timeout=15000); pg.wait_for_timeout(800)
            for pid in ['page-home','page-dashboard','page-branches','page-employees','page-open']:
                pg.click(f'[data-page="{pid}"]') if w>900 else (pg.click('#menuBtn'),pg.click(f'[data-page="{pid}"]'))
                pg.wait_for_timeout(700); pg.screenshot(path=f'{T}/shots/{name}_{pid}.png',full_page=True)
    os.makedirs(T+'/shots',exist_ok=True); run(go)
    print(json.dumps(errs,ensure_ascii=False,indent=1))
