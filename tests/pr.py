from shot import *
def go(b):
    pg=b.new_page(viewport={'width':1440,'height':900}); route(pg)
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('body:not(.is-loading)'); pg.wait_for_timeout(500)
    pg.click('[data-page="page-reports"]'); pg.click('#showStatsBtn'); pg.wait_for_selector('.rp-doc'); pg.wait_for_timeout(1000)
    pg.emulate_media(media='print'); pg.evaluate("document.body.classList.add('print-report')")
    pg.pdf(path=OUT+'/report.pdf',prefer_css_page_size=True,print_background=True); print(errs)
run(go)
