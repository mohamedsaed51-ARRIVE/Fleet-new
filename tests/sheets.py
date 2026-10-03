from PIL import Image
import glob,os,subprocess
os.chdir(os.environ.get('TEST_OUT',os.path.join(os.path.dirname(os.path.abspath(__file__)),'shots')))
for f in glob.glob('rp-*.png')+glob.glob('sheet*.png'): os.remove(f)
subprocess.run('pdftoppm -r 60 -png report.pdf rp 2>/dev/null',shell=True)
fs=sorted(glob.glob('rp-*.png'));im=[Image.open(f) for f in fs];w,h=im[0].size
for k,a in enumerate(range(0,len(im),10)):
    sub=im[a:a+10];sheet=Image.new('RGB',(w*5,h*2),'#888')
    for i,x in enumerate(sub): sheet.paste(x,((i%5)*w,(i//5)*h))
    sheet.save(f'sheet{k}.png')
print(len(im))
