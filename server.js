const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.options('*', cors());
app.use(express.json());

const upload = multer({ dest: os.tmpdir() });

let FF = 'ffmpeg';
try { const s = require('ffmpeg-static'); if (s) FF = s; } catch(e) {}
console.log('FF:', FF);

app.get('/', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ ok: true, ff: FF }));

app.post('/api/render', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'overlay', maxCount: 1 }
]), (req, res) => {
  const vf = (req.files || {})['video']?.[0];
  const of = (req.files || {})['overlay']?.[0];
  if (!vf) return res.status(400).json({ error: 'no video' });

  const ts = parseFloat(req.body?.trimStart) || 0;
  const te = parseFloat(req.body?.trimEnd) || 0;
  const dur = te > ts ? te - ts : 0;
  const out = os.tmpdir() + '/out_' + Date.now() + '.mp4';

  const args = of ? [
    '-y', '-ss', String(ts), '-i', vf.path, '-i', of.path,
    ...(dur > 0 ? ['-t', String(dur)] : []),
    '-filter_complex', '[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:format=auto[vout]',
    '-map', '[vout]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out
  ] : [
    '-y', '-ss', String(ts), '-i', vf.path,
    ...(dur > 0 ? ['-t', String(dur)] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out
  ];

  const proc = spawn(FF, args);
  let err = '';
  proc.stderr.on('data', d => err += d.toString());

  proc.on('close', code => {
    try { fs.unlinkSync(vf.path); } catch(e) {}
    if (of) { try { fs.unlinkSync(of.path); } catch(e) {} }
    if (code !== 0) {
      console.error('FFmpeg error:', err.slice(-500));
      return res.headersSent ? null : res.status(500).json({ error: err.slice(-200) });
    }
    try {
      const size = fs.statSync(out).size;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', size);
      const s = fs.createReadStream(out);
      s.pipe(res);
      s.on('end', () => { try { fs.unlinkSync(out); } catch(e) {} });
    } catch(e) {
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  setTimeout(() => { proc.kill(); }, 170000);
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('Server ready on port', process.env.PORT || 3000);
});
