from shot import *
import json,urllib.request,re,collections
rows=json.load(urllib.request.urlopen('http://localhost:8123/raw'))
B={'SOLVED':['تم الحل','تم التسليم'],'FOLLOWUP':['جارى الحل','تم التاكيد'],'OPEN':['لم يتم الحل','لم يتم التاكيد']}
def bucket(s):
    for k,v in B.items():
        if s in v: return k
    return 'U'
res=[]
def ok(name,cond,detail=''):
    res.append((name,bool(cond),detail)); print(('PASS' if cond else 'FAIL'),name,detail)
def go(b):
    pg=b.new_page(viewport={'width':1440,'height':900}); route(pg)
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto(BASE); pg.wait_for_selector('body:not(.is-loading)'); pg.wait_for_timeout(600)
    # --- independent KPIs
    tot=len(rows); cnt=collections.Counter(bucket(r[9]) for r in rows)
    txt=lambda sel: pg.inner_text(sel)
    kp=pg.inner_text('#dashKpis') if False else None
    pg.click('[data-page="page-dashboard"]'); pg.wait_for_timeout(300)
    t=pg.inner_text('#dashKpis')
    ok('KPI total',str(tot) in t,f'{tot}')
    ok('KPI solved/followup/open',all(str(cnt[k]) in t for k in('SOLVED','FOLLOWUP','OPEN')),dict(cnt))
    rate=round(cnt['SOLVED']/tot*1000)/10
    ok('KPI rate',f'{rate:.1f}' in t,rate)
    # branch table
    pg.click('[data-page="page-branches"]'); pg.wait_for_timeout(300)
    br=collections.defaultdict(lambda:[0,0,0,0])
    for r in rows:
        if not r[7]: continue
        x=br[r[7]]; x[0]+=1; k=bucket(r[9]); x[{'SOLVED':1,'FOLLOWUP':2,'OPEN':3}.get(k,0)]+= (1 if k!='U' else 0)
    trs=pg.eval_on_selector_all('#branchTableHost tbody tr',"els=>els.map(e=>[...e.children].map(c=>c.innerText.trim()))")
    good=True
    for tr in trs:
        name=tr[1]; v=br[name]
        if [int(tr[2]),int(tr[3]),int(tr[4]),int(tr[5])]!=v: good=False;print('mismatch',name,tr,v)
    ok('Branch table equals independent calc',good and len(trs)==len(br),f'{len(trs)} rows')
    foot=pg.inner_text('#branchTableHost tfoot'); ok('Branch summary row total',str(tot) in foot.replace('\n',' '),foot.replace('\n',' '))
    # sort
    pg.click('#branchTableHost th[data-k="total"]'); pg.wait_for_timeout(200)
    first=pg.inner_text('#branchTableHost tbody tr:first-child td:nth-child(3)')
    pg.click('#branchTableHost th[data-k="total"]'); pg.wait_for_timeout(200)
    first2=pg.inner_text('#branchTableHost tbody tr:first-child td:nth-child(3)')
    ok('Sort asc then desc',int(first)<int(first2),f'{first} < {first2}')
    # search
    pg.fill('#branchTableHost [data-r=q]','طنطا'); pg.wait_for_timeout(200)
    ok('Search filters rows',pg.locator('#branchTableHost tbody tr').count()==1)
    pg.fill('#branchTableHost [data-r=q]','zzzz'); pg.wait_for_timeout(200)
    ok('Search empty state',('لا توجد نتائج' in pg.inner_text('#branchTableHost tbody')))
    pg.fill('#branchTableHost [data-r=q]','')
    # pagination on open cases
    pg.click('[data-page="page-open"]'); pg.wait_for_timeout(300)
    n_open=sum(1 for r in rows if bucket(r[9]) in('FOLLOWUP','OPEN'))
    ok('Open cases count (excl. unknown)',f'({n_open})' in pg.inner_text('#openTableHost .count') or str(n_open) in pg.inner_text('#openTableHost .count'),n_open)
    pg.click('#openTableHost button[data-p="2"]'); pg.wait_for_timeout(200)
    ok('Pagination page 2',('26' in pg.inner_text('#openTableHost .ar-pager')))
    # filters
    pg.click('[data-page="page-dashboard"]')
    pg.select_option('#filterBranch','طنطا'); pg.click('#applyFiltersBtn'); pg.wait_for_selector('body:not(.is-loading)'); pg.wait_for_timeout(500)
    tb=sum(1 for r in rows if r[7]=='طنطا'); t=pg.inner_text('#dashKpis')
    ok('Filter branch -> KPI total',str(tb) in t.split()[2:6].__str__() or str(tb) in t,tb)
    ok('Chip shown',pg.locator('.ar-chip').count()==1)
    pg.click('.ar-chip button'); pg.wait_for_selector('body:not(.is-loading)'); pg.wait_for_timeout(400)
    ok('Chip removal restores all',str(tot) in pg.inner_text('#dashKpis'))
    # empty state via date range with no data
    pg.fill('#filterDateFrom','2030-01-01'); pg.click('#applyFiltersBtn'); pg.wait_for_selector('body:not(.is-loading)'); pg.wait_for_timeout(500)
    ok('Empty state text',('لا توجد بيانات متاحة وفقًا للفلاتر المحددة.' in pg.inner_text('#page-dashboard')))
    pg.screenshot(path=OUT+'/empty_dashboard.png',full_page=True)
    pg.click('[data-page="page-home"]'); pg.wait_for_timeout(200); pg.screenshot(path=OUT+'/empty_home.png',full_page=True)
    pg.click('#clearFiltersBtn'); pg.wait_for_selector('body:not(.is-loading)'); pg.wait_for_timeout(400)
    ok('Reset restores',str(tot) in pg.inner_text('#homeKpis'))
    # compare
    pg.click('[data-page="page-branches"]'); pg.select_option('#branchM1','2026-06'); pg.select_option('#branchM2','2026-07'); pg.click('#branchCompareBtn'); pg.wait_for_timeout(1200)
    a=sum(1 for r in rows if str(r[3]).startswith('2026-06')); c=sum(1 for r in rows if str(r[3]).startswith('2026-07'))
    ok('Branch compare totals',pg.inner_text('#branchCompM1Total').strip()==str(a) and pg.inner_text('#branchCompM2Total').strip()==str(c),(a,c,pg.inner_text('#branchCompDiff')))
    pg.screenshot(path=OUT+'/compare.png',full_page=True)
    pg.click('[data-page="page-employees"]'); pg.click('#employeeCompareBtn'); pg.wait_for_timeout(1200)
    ok('Employee compare table rows',pg.locator('#employeeCompareTableHost tbody tr').count()>0)
    # settings modal
    pg.click('#settingsBtn'); ok('Settings modal opens',pg.locator('#settingsModal.is-open').count()==1); pg.keyboard.press('Escape'); ok('Escape closes',pg.locator('#settingsModal.is-open').count()==0)
    # csv export
    pg.click('[data-page="page-reports"]'); pg.click('#showStatsBtn'); pg.wait_for_selector('.rp-doc'); pg.wait_for_timeout(800)
    with pg.expect_download() as d: pg.click('#exportExcelBtn')
    f=d.value.path(); csv=open(f,encoding='utf-8-sig').read(); ok('CSV export has totals',f'إجمالى المشاكل,{tot}' in csv)
    ok('Report doc total',str(tot) in pg.inner_text('.rp-cover'))
    with pg.expect_download() as d2: pg.click('#exportPdfBtn')
    ok('Server PDF action returns file',d2.value.suggested_filename.endswith('.pdf'),d2.value.suggested_filename)
    # stale notice
    pg.select_option('#filterBranch','طنطا'); pg.click('#applyFiltersBtn'); pg.wait_for_selector('body:not(.is-loading)'); pg.wait_for_timeout(500)
    pg.click('[data-page="page-reports"]'); ok('Stale report notice',('لا يطابق الفلاتر' in pg.inner_text('#reportMsg')))
    # RTL checks
    ok('html dir=rtl',pg.evaluate("document.documentElement.dir")=='rtl')
    ok('Sidebar on right',pg.evaluate("document.getElementById('sidebar').getBoundingClientRect().left>innerWidth/2"))
    ok('No horizontal overflow @1440',pg.evaluate("document.documentElement.scrollWidth<=innerWidth"))
    ok('Fonts declared',('Cairo' in pg.evaluate("getComputedStyle(document.body).fontFamily")))
    print('PAGEERRORS',errs)
run(go)
failed=sum(1 for r in res if not r[1]); print(failed,'FAILED of',len(res)); sys.exit(1 if failed else 0)
