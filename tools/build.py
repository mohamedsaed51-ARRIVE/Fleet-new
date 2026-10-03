#!/usr/bin/env python3
"""
tools/build.py — يبني index.html من المصادر (Option A: parts/ هو المصدر، index.html ناتج).

    parts/markup.html   الهيكل (يحتوي <!--__DESIGN_SYSTEM__--> و /*__APP__*/)
    parts/app.js        منطق الصفحة (يحتوي "__LOGO_DATA_URI__" ← يُستبدل بشعار Assets.gs)
    DesignSystem.html   الـ Design System (CSS/tokens) — مصدر واحد
    Assets.gs           الشعار (ARRIVE_LOGO_B64_) — مصدر واحد

الاستخدام:
    python3 tools/build.py            يبني index.html (يرفض لو index.html اتعدّل يدويًا بعد آخر build)
    python3 tools/build.py --check    لا يكتب: يتحقق أن index.html مطابق للمصادر (exit 1 لو لا)
    python3 tools/build.py --force    يبني حتى لو index.html معدّل يدويًا (يضيّع التعديل اليدوي!)

حماية من «بناء نسخة أقدم فوق الأحدث»:
  1) tools/index.html.sha256 يحفظ بصمة آخر index.html تم بناؤه. لو بصمة index.html الحالي مختلفة
     (أي تعديل يدوي لم ينتقل إلى parts/) يتوقف البناء ولا يكتب شيئًا.
  2) فحوصات على الناتج: كل الـ placeholders اتبدّلت، وسم القالب <?!= serverApiUrl ?> موجود مرة واحدة
     فقط (أي <? زيادة تكسر Apps Script template)، والعلامات الأساسية موجودة، والحجم لا يقل عن 90%
     من index.html الحالي.
"""
import hashlib, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
P = lambda *a: os.path.join(ROOT, *a)
rd = lambda p: open(p, encoding='utf-8', newline='').read()
sha = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
STAMP = P('tools', 'index.html.sha256')
OUT = P('index.html')

def build():
    markup, app, ds, assets = rd(P('parts', 'markup.html')), rd(P('parts', 'app.js')), rd(P('DesignSystem.html')), rd(P('Assets.gs'))
    m = re.search(r"ARRIVE_LOGO_B64_ = '([A-Za-z0-9+/=]+)'", assets)
    if not m: sys.exit('خطأ: لم أجد ARRIVE_LOGO_B64_ في Assets.gs')
    for tok, src, name in (('/*__APP__*/', markup, 'markup.html'), ('<!--__DESIGN_SYSTEM__-->', markup, 'markup.html'), ('__LOGO_DATA_URI__', app, 'app.js')):
        if src.count(tok) != 1: sys.exit('خطأ: %s يجب أن يظهر مرة واحدة في %s (وجدت %d)' % (tok, name, src.count(tok)))
    # ملفات المصدر تنتهي بسطر جديد واحد إضافي؛ نزيله ليخرج الناتج مطابقًا بالبايت للنسخة المنشورة
    if app.endswith('\n'): app = app[:-1]
    if ds.endswith('\n'): ds = ds[:-1]
    app = app.replace('__LOGO_DATA_URI__', 'data:image/png;base64,' + m.group(1))
    return markup.replace('<!--__DESIGN_SYSTEM__-->', ds).replace('/*__APP__*/', app)

def validate(out, current):
    errs = []
    if any(t in out for t in ('/*__APP__*/', '<!--__DESIGN_SYSTEM__-->', '__LOGO_DATA_URI__')):
        errs.append('بقيت placeholders غير مستبدلة')
    if out.count('<?') != 1 or "<?!= serverApiUrl ? serverApiUrl : '' ?>" not in out:
        errs.append('وسوم القالب <? غير متوقعة (المتوقع وسم serverApiUrl واحد فقط) — Apps Script سيفشل في تقييم الصفحة')
    for must in ('id="chartjs"', 'chartReady', 'function apiCall', 'arrive-tokens', 'data:image/png;base64,'):
        if must not in out: errs.append('علامة أساسية مفقودة في الناتج: ' + must)
    if current and len(out) < 0.9 * len(current):
        errs.append('الناتج أصغر من index.html الحالي بأكثر من 10%% (%d مقابل %d) — غالبًا مصادر قديمة' % (len(out), len(current)))
    return errs

def main():
    a = sys.argv[1:]
    out = build()
    current = rd(OUT) if os.path.exists(OUT) else None
    errs = validate(out, current)
    if errs:
        print('فشل التحقق من الناتج:\n - ' + '\n - '.join(errs)); sys.exit(1)
    if '--check' in a:
        if current == out: print('OK: index.html مطابق للمصادر.'); return
        print('X: index.html لا يطابق ناتج البناء من parts/ — إما parts قديم أو index.html معدّل يدويًا.'); sys.exit(1)
    if current is not None and current != out and '--force' not in a:
        stamp = open(STAMP).read().strip() if os.path.exists(STAMP) else None
        if stamp != sha(current):
            print('تم الإيقاف: index.html الحالي لا يطابق آخر نسخة مبنية (تعديل يدوي لم يُنقل إلى parts/).\n'
                  'انقل التعديل إلى parts/ أو DesignSystem.html أولًا، أو استخدم --force لو متأكد.'); sys.exit(2)
    open(OUT, 'w', encoding='utf-8', newline='').write(out)
    open(STAMP, 'w').write(sha(out) + '\n')
    print('تم بناء index.html (%d بايت).' % len(out.encode('utf-8')))

if __name__ == '__main__':
    main()
