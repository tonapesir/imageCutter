# Photo / Signature Crop Tool — Web आवृत्ती

[imagecutter.amanattar.com](https://imagecutter.amanattar.com/) सारखीच — पूर्णपणे
ब्राऊझरमध्येच चालणारी, फोल्डर/एकापेक्षा जास्त टेम्प्लेट अपलोड करून हेडशॉट+सही
कापून एका ZIP मध्ये डाउनलोड करणारी वेब आवृत्ती.

**कुठलीही इमेज कुठल्याही सर्व्हरला अपलोड होत नाही** — सर्व क्रॉपिंग, साईझ-फिटिंग
व ZIP तयार करणे तुमच्याच ब्राऊझरमध्ये (JavaScript + Canvas) होते. यामुळे हे
मोफत GitHub Pages वर होस्ट करता येते — बॅकएंड सर्व्हरची गरज नाही.

## स्थानिक पातळीवर वापरून बघणे

कुठलाही static file server पुरेसा आहे (उदा.):

```bash
cd web
python3 -m http.server 8000
```

मग ब्राऊझरमध्ये `http://localhost:8000` उघडा.

(नुसती `index.html` file:// ने थेट उघडल्यास `fetch("config/boxes.json")`
काही ब्राऊझर्समध्ये CORS मुळे अडवले जाऊ शकते — म्हणून लोकल सर्व्हरने चालवा.)

## GitHub Pages वर होस्ट करणे

1. GitHub वर नवीन repo तयार करा (उदा. `image-cutter`), किंवा आधीच्या
   Python प्रोजेक्टच्याच repo मध्ये हे `web/` फोल्डर वेगळ्या repo/branch
   मध्ये ठेवा.
2. `web/` फोल्डरमधील सर्व फाईल्स (`index.html`, `css/`, `js/`, `config/`)
   repo च्या रूटमध्ये push करा:
   ```bash
   cd web
   git init
   git add -A
   git commit -m "Photo/Signature Crop Tool - web version"
   git branch -M main
   git remote add origin https://github.com/<username>/image-cutter.git
   git push -u origin main
   ```
3. GitHub वर repo → **Settings → Pages** → Source: **Deploy from a branch**,
   Branch: **main**, Folder: **/(root)** → Save.
4. काही मिनिटांत `https://<username>.github.io/image-cutter/` वर लाईव्ह होईल.

## मर्यादा (सध्याच्या आवृत्तीत)

- सध्या फक्त एकाच टेम्प्लेटसाठी (`config/boxes.json` — Maharashtra Board
  SSC/HSC फॉर्म, ९ फोटो + ९ सह्या) काम करते. वेगळा फॉर्म असल्यास
  `calibrate.py` (Python) वापरून नवीन `config/boxes.json` तयार करून
  `web/config/boxes.json` अपडेट करावी लागेल.
- मोठ्या स्कॅन इमेज्स (उदा. १०+ पाने एकदम) असल्यास प्रोसेसिंगला काही सेकंद
  लागू शकतात — हे normal आहे, ब्राऊझर गोठलेला नाही.
- Internet Explorer किंवा खूप जुने ब्राऊझर्स समर्थित नाहीत (आधुनिक Chrome,
  Edge, Firefox, Safari आवश्यक).

## फाईल रचना

```
web/
├── index.html
├── css/style.css
├── config/boxes.json      # टेम्प्लेटचे बॉक्स-कोऑर्डिनेट्स (Python calibrate.py तून)
└── js/
    ├── border.js          # पानाची बाहेरील फ्रेम शोधणे (sheet_cutter.py चा पोर्ट)
    ├── boxmath.js         # transform व box_to_pixels गणित
    ├── headshot.js        # मार्जिन+फ्रेम काढून हेडशॉट (passport_crop.py चा पोर्ट)
    ├── sizefit.js          # JPEG साईझ-बजेट एन्कोडिंग
    └── app.js              # UI लॉजिक, फाईल अपलोड, ZIP पॅकेजिंग
```

`border.js`, `boxmath.js`, `headshot.js` मधील गणित मूळ Python कोडशी पिक्सेल-दर-पिक्सेल
जुळवून टेस्ट केलेले आहे (Node.js मध्ये त्याच स्कॅन इमेजवर दोन्ही आवृत्त्यांचे निकाल
ताडून पाहिले).

## कोऑर्डिनेशन: बॉर्डर + कोपरा-टिंब

टेम्प्लेटमध्ये बाहेरील बॉर्डरजवळ चारही कोपऱ्यांत ठळक काळे चौकोनी टिंब असतील (नवीन
`config/boxes.json` मध्ये `corner_marks` असल्यास), तर `border.js` मधील
`detectCornerMarks()` ते शोधून त्यांच्या आधारे अचूक affine transform (रोटेशन/
तिरकेपणासकट) काढतो — Python च्या `sheet_cutter.py` प्रमाणेच प्राधान्यक्रम
(README.md मध्ये सविस्तर). टिंब नसलेल्या जुन्या टेम्प्लेटसाठी आपोआप फक्त-बॉर्डर
पद्धतीकडे वळते.
