#!/usr/bin/env bash
# اختبارات المتصفح (Playwright + chromium) على الباك إند الحقيقي ببيانات تجريبية.
# اختياري: ضع chart.umd.js و fontawesome-free-6.5.2-web في tests/.deps (أو TEST_DEPS=...) لعرض الرسوم والأيقونات.
# بدون chart.umd.js تعمل الصفحة بدون رسوم (سلوك مدعوم) وتبقى اختبارات الأرقام والجداول والفلاتر صالحة.
cd "$(dirname "$0")" || exit 1
export TEST_OUT="${TEST_OUT:-$(pwd)/shots}"; mkdir -p "$TEST_OUT"
TZ=${TZ:-Africa/Cairo} node server.js > "$TEST_OUT/server.log" 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT; sleep 2
rc=0
python3 func.py || rc=1
python3 ui_responsive.py || rc=1
exit $rc
