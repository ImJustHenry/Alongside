from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
root=Path(__file__).parent/'fixtures';root.mkdir(exist_ok=True)
im=Image.new('RGB',(640,480),'#e9e4d8');d=ImageDraw.Draw(im)
font=ImageFont.truetype('DejaVuSans.ttf',24);small=ImageFont.truetype('DejaVuSans.ttf',17)
d.rectangle((0,0,640,74),fill='#b64635');d.text((20,10),'SIMULATED CAMERA TEST',font=font,fill='white');d.text((20,43),'No Quest or physical camera was used',font=small,fill='white')
d.rectangle((65,200,575,415),fill='#9b7955');d.rectangle((140,245,245,345),fill='#286c62');d.rectangle((330,240,470,335),fill='#d97146');d.text((150,275),'A',font=font,fill='white');d.text((370,272),'B',font=font,fill='white')
d.text((22,445),'Transport / pointer mapping test fixture only',font=small,fill='#253e36');im.save(root/'simulated-camera.jpg',quality=75)
print(root/'simulated-camera.jpg')
