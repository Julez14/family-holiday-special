"""Original illustrative development cartoons. No uploaded photos, models or music."""
import math
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'renderer'))
from media import end_card, command, binary
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'fixtures'; OUT.mkdir(exist_ok=True, parents=True)
W,H = 1280,720
INK='#173e35'; CREAM='#fff8e5'
PALETTES=['#bd3741','#dc9a3d','#538e7a','#7f80ad','#508ba4','#bd6e8b']


def person(index, pose=0, size=(260,460)):
    image=Image.new('RGBA',(300,510)); d=ImageDraw.Draw(image)
    skin=['#e8b38e','#a96c4f','#f4c6a0','#c28a6d','#e0a478','#9c634b'][index%6]
    coat=PALETTES[index%6]
    # Generous silhouettes, visible faces, distinctive scarves/hair/glasses.
    d.line([(122,355),(98+pose*8,459),(63+pose*8,468)],fill=INK,width=23)
    d.line([(181,355),(205-pose*9,459),(244-pose*9,468)],fill=INK,width=23)
    d.rounded_rectangle((65,233,239,378),radius=48,fill=coat,outline=INK,width=7)
    d.line([(82,258),(36,303+pose*24),(22,274+pose*24)],fill=INK,width=27)
    d.line([(218,260),(265,300-pose*32),(278,267-pose*32)],fill=INK,width=27)
    d.ellipse((8,248+pose*24,38,286+pose*24),fill=skin,outline=INK,width=5)
    d.ellipse((264,243-pose*32,293,280-pose*32),fill=skin,outline=INK,width=5)
    d.rectangle((121,190,182,242),fill=skin,outline=INK,width=6)
    d.ellipse((67,67,238,240),fill=skin,outline=INK,width=7)
    hair=['#5a3429','#25362e','#633b29','#332c2c','#b38247','#352a27'][index%6]
    d.pieslice((58,38,244,176),180,360,fill=hair,outline=INK,width=6)
    for k in range(4):
        d.ellipse((64+k*31,49-(k%2)*13,117+k*31,119),fill=hair,outline=INK,width=4)
    if index%3==2:
        d.ellipse((188,89,261,216),fill=hair,outline=INK,width=5)
    d.arc((100,120,133,141),190,340,fill=INK,width=5)
    d.arc((166,118,199,139),195,345,fill=INK,width=5)
    d.ellipse((111,147,124,165),fill=INK);d.ellipse((176,146,189,164),fill=INK)
    d.arc((136,148,163,182),270,90,fill=INK,width=4)
    d.pieslice((113,168,195,215),0,180,fill=CREAM,outline=INK,width=5)
    d.arc((117,169,191,208),0,180,fill=INK,width=3)
    if index%3==0:
        d.rounded_rectangle((92,134,139,176),radius=14,outline=INK,width=5)
        d.rounded_rectangle((162,134,209,176),radius=14,outline=INK,width=5)
        d.line((139,149,163,149),fill=INK,width=4)
    d.rounded_rectangle((90,226,217,258),radius=15,fill='#efce6c',outline=INK,width=5)
    d.polygon([(177,253),(216,250),(222,324),(198,340)],fill='#efce6c',outline=INK,width=5)
    d.line((193,266,200,312),fill=INK,width=3)
    for yy in (282,311,340):d.ellipse((139,yy,149,yy+10),fill=CREAM)
    image.thumbnail(size)
    return image


def background(preset):
    base=Image.new('RGB',(W,H),{'snowball':'#bed9d5','giftwrap':'#deb3a0','danceoff':'#bbb8d5'}[preset]);d=ImageDraw.Draw(base)
    if preset=='snowball':
        for x,y in [(112,126),(362,82),(803,132),(1156,74),(1007,290)]:
            d.line((x-9,y,x+9,y),fill=CREAM,width=4);d.line((x,y-9,x,y+9),fill=CREAM,width=4)
        for x,size in [(15,235),(1080,280),(970,185)]:
            d.rectangle((x+55,390,x+78,570),fill='#8a6553')
            d.polygon([(x+67,150),(x-30,454),(x+170,454)],fill='#466f5b',outline=INK,width=5)
            d.polygon([(x+67,150),(x+28,272),(x+104,272)],fill=CREAM)
        d.ellipse((-150,480,1430,1000),fill=CREAM)
        for x in range(60,1240,80):
            d.rectangle((x,414,x+27,544),fill='#ba5552',outline=INK,width=3)
        d.rectangle((45,458,1245,473),fill='#ba5552',outline=INK,width=3)
    elif preset=='giftwrap':
        d.rectangle((0,527,W,H),fill='#ecd2ab')
        d.rectangle((990,210,1215,530),fill='#a8584b',outline=INK,width=7)
        d.rectangle((1030,340,1180,530),fill=INK)
        for x in range(70,1220,100):
            y=65+int(35*math.sin(x/350))
            d.line((x-100,y-8,x,y),fill=INK,width=3);d.ellipse((x-9,y-9,x+9,y+9),fill=['#fff5c4','#b8434a'][x%3==0],outline=INK,width=2)
        for x,y,c in [(70,390,'#5c9179'),(1080,545,'#be3d49'),(910,565,'#dba03e')]:
            d.rounded_rectangle((x,y,x+120,y+100),radius=8,fill=c,outline=INK,width=5)
            d.rectangle((x+49,y,x+69,y+100),fill=CREAM,outline=INK,width=3)
    else:
        d.rectangle((0,530,W,H),fill='#5c766c')
        d.ellipse((260,540,1020,670),fill='#e5d5ae')
        for x in (100,1150):
            d.rounded_rectangle((x,100,x+35,560),radius=12,fill=CREAM,outline=INK,width=5)
            for y in range(120,540,65):d.polygon([(x,y),(x+35,y+22),(x+35,y+42),(x,y+20)],fill='#bd3741')
        d.arc((120,0,1180,450),180,360,fill='#d7ae4e',width=30)
        d.regular_polygon((640,120,66),5,rotation=0,fill='#edcb65',outline=INK,width=4)
    return base


def frame(preset,shot,t):
    base=background(preset).convert('RGBA');d=ImageDraw.Draw(base)
    for index,x in [(shot%6,320),( (shot+1)%6,710)]:
        pose=math.sin(t*5+index)*(.8 if preset=='danceoff' else .3)
        figure=person(index,pose,(250,450))
        angle=(math.sin(t*4+index)*(12 if preset=='danceoff' else 5))
        figure=figure.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True)
        y=200-int(abs(math.sin(t*4+index))*17)
        base.alpha_composite(figure,(x,y))
    d=ImageDraw.Draw(base)
    if preset=='snowball':
        x=int(130+(t*230)%1100);y=int(430-abs(math.sin(t*2.5))*145)
        radius=22 if shot%2==0 else 72
        d.ellipse((x-radius,y-radius,x+radius,y+radius),fill='white',outline=INK,width=5)
        for offset in (35,65,90):d.line((x-radius-offset,y-8,x-radius-offset+15,y-10),fill=INK,width=3)
    elif preset=='giftwrap':
        x=618;yy=490-int(abs(math.sin(t*4))*34)
        d.rounded_rectangle((x-60,yy-70,x+60,yy+30),radius=8,fill='#c23f48',outline=INK,width=5)
        d.rectangle((x-10,yy-70,x+10,yy+30),fill='#f1cb65',outline=INK,width=3)
        d.ellipse((x-47,yy-105,x,yy-65),fill='#f1cb65',outline=INK,width=4)
        d.ellipse((x,yy-105,x+47,yy-65),fill='#f1cb65',outline=INK,width=4)
        for i in range(12):
            a=i*2.4+t;cx=640+math.sin(a)*170;cy=250+(t*70+i*29)%220
            d.rectangle((cx,cy,cx+10,cy+6),fill=PALETTES[i%6])
    else:
        for i in range(6):
            x=110+i*200;y=180+math.sin(t*3+i)*50
            d.regular_polygon((x,y,12),4,fill='#fff2c4')
    return base.convert('RGB')


def encode_clip(preset,shot):
    target=OUT/f'{preset}-clip-{shot}.mp4'
    args=[binary('ffmpeg'),'-y','-v','error','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r','24','-i','-','-an','-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p','-threads','2',str(target)]
    process=subprocess.Popen(args,stdin=subprocess.PIPE)
    for n in range(120):process.stdin.write(frame(preset,shot,n/24).tobytes())
    process.stdin.close()
    if process.wait():raise RuntimeError('Fixture encoding failed')
    frame(preset,shot,.3).save(OUT/f'{preset}-frame-{shot}.png')


def main():
    for i in range(6):person(i,0,(360,510)).save(OUT/f'portrait-{i+1}.png')
    portraits=[OUT/f'portrait-{i+1}.png' for i in range(6)]
    import tempfile
    for preset in ('snowball','giftwrap','danceoff'):
        for shot in range(4):encode_clip(preset,shot)
        frame(preset,0,.8).save(OUT/f'{preset}-poster.jpg',quality=92)
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);parts=[]
            for shot in range(4):
                part=folder/f'part-{shot}.mp4';command(['ffmpeg','-y','-v','error','-i',str(OUT/f'{preset}-clip-{shot}.mp4'),'-an','-t','4.5','-c:v','libx264','-preset','fast','-crf','24','-threads','2',str(part)]);parts.append(part)
            for n in range(1,7):
                card=folder/'card.png';end_card(portraits[:n],card)
                tail=folder/'tail.mp4';command(['ffmpeg','-y','-v','error','-loop','1','-i',str(card),'-an','-t','2','-r','24','-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p','-threads','2',str(tail)])
                listing=folder/'concat.txt';listing.write_text(''.join(f"file '{p.name}'\n" for p in parts+[tail]))
                silent=folder/'silent.mp4';command(['ffmpeg','-y','-v','error','-f','concat','-safe','1','-i',str(listing),'-an','-c:v','copy',str(silent)])
                command(['ffmpeg','-y','-v','error','-i',str(silent),'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-t','20','-movflags','+faststart',str(OUT/f'{preset}-{n}.mp4')])
        print(f'{preset}: four moving fixtures, six cast end cards',flush=True)
    print('Fixtures are original code-drawn illustrations with silent development audio, not inference output.',flush=True)
if __name__=='__main__':main()
