import re,sys
m=open('parts/markup.html',encoding='utf-8').read();a=open('parts/app.js',encoding='utf-8').read()
open('index.html','w',encoding='utf-8').write(m.replace('/*__APP__*/',a))
