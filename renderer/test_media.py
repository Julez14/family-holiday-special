import array
import io
import math
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from PIL import Image
from media import command, normalize, render, probe, end_card

class MediaContractTests(unittest.TestCase):
    def test_normalization_strips_metadata_and_applies_orientation(self):
        image=Image.new('RGB',(90,120),'#ba3b44');exif=image.getexif();exif[274]=6;exif[270]='private source note'
        data=io.BytesIO();image.save(data,'JPEG',exif=exif)
        normalized,size=normalize(data.getvalue())
        self.assertEqual(size,(120,90))
        with Image.open(io.BytesIO(normalized)) as output:
            self.assertEqual(len(output.getexif()),0)
        with self.assertRaises(ValueError):normalize(data.getvalue(),{'x':.8,'y':0,'width':.3,'height':1})

    def test_decoded_dimension_limit_and_unsupported_encoding(self):
        data=io.BytesIO();Image.new('RGB',(1,1)).save(data,'PNG');png=bytearray(data.getvalue())
        png[16:24]=struct.pack('>II',10000,10000);png[29:33]=struct.pack('>I',zlib.crc32(png[12:29])&0xffffffff)
        with self.assertRaises((ValueError,Image.DecompressionBombError)):normalize(bytes(png))
        gif=io.BytesIO();Image.new('RGB',(10,10)).save(gif,'GIF')
        with self.assertRaises(ValueError):normalize(gif.getvalue())

    def test_cast_composition_includes_every_selected_portrait(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);colors=['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'];portraits=[]
            for i,color in enumerate(colors):
                path=root/f'{i}.png';Image.new('RGB',(100,150),color).save(path);portraits.append(path)
            output=root/'card.png';end_card(portraits,output)
            pixels=set(Image.open(output).getdata())
            for color in colors:self.assertIn(tuple(bytes.fromhex(color[1:])),pixels)

    def test_twenty_second_h264_edit_contains_only_selected_audio(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);clip=root/'generated-with-unwanted-audio.mp4';music=root/'approved-test-tone.wav'
            command(['ffmpeg','-y','-v','error','-f','lavfi','-i','color=c=0x356b61:s=640x360:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','5','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac',str(clip)])
            command(['ffmpeg','-y','-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','20',str(music)])
            portrait=root/'portrait.png';Image.new('RGBA',(200,300),'#b7424a').save(portrait)
            final=root/'final.mp4';render([clip]*4,[portrait],music,final,root)
            p=probe(final);self.assertAlmostEqual(float(p['format']['duration']),20,delta=.12)
            video=next(s for s in p['streams'] if s['codec_type']=='video');audio=[s for s in p['streams'] if s['codec_type']=='audio']
            self.assertEqual((video['width'],video['height'],video['codec_name'],video['r_frame_rate']),(1280,720,'h264','24/1'))
            self.assertEqual(len(audio),1);self.assertEqual(audio[0]['codec_name'],'aac')
            pcm=command(['ffmpeg','-v','error','-ss','1','-i',str(final),'-t','1','-map','0:a:0','-ac','1','-ar','8000','-f','s16le','-'])
            samples=array.array('h');samples.frombytes(pcm)
            def magnitude(hz):
                return abs(sum(value*complex(math.cos(2*math.pi*hz*i/8000),math.sin(2*math.pi*hz*i/8000)) for i,value in enumerate(samples)))
            self.assertGreater(magnitude(880),1_000_000)
            self.assertLess(magnitude(440)/magnitude(880),.01,'Generated source audio leaked into final output')

if __name__=='__main__':unittest.main()
