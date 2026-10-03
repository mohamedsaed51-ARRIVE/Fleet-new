"""ui_responsive.py — لا تمرير أفقي في أي صفحة عند 390 / 820 / 1440، وعنوان الـ header ظاهر (عرضه > 0)."""
from shot import *
fails = []
def go(b):
    for w, h in [(390, 844), (820, 1100), (1440, 900)]:
        pg = b.new_page(viewport={'width': w, 'height': h}); route(pg)
        pg.goto(BASE); pg.wait_for_selector('body:not(.is-loading)', timeout=15000); pg.wait_for_timeout(600)
        for pid in ['page-home', 'page-dashboard', 'page-branches', 'page-employees', 'page-open', 'page-reports']:
            if w > 899: pg.click(f'[data-page="{pid}"]')
            else: pg.click('#menuBtn'); pg.click(f'[data-page="{pid}"]')
            pg.wait_for_timeout(300)
            if pg.evaluate("document.documentElement.scrollWidth>innerWidth"): fails.append(f'overflow {w}px {pid}')
            if pg.evaluate("document.getElementById('headerTitle').getBoundingClientRect().width<40"): fails.append(f'header title collapsed {w}px {pid}')
        pg.close()
run(go)
print('PASS ui_responsive' if not fails else 'FAIL ' + str(fails)); sys.exit(1 if fails else 0)
