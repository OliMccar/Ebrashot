import * as THREE from 'three';

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let cached: ReturnType<typeof make> | null = null;
export function textures() { return (cached ??= make()); }

function make() {
  const glow = canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,240,200,0.8)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  const flash = canvasTex(64, (c, s) => {
    c.translate(s / 2, s / 2);
    for (let i = 0; i < 6; i++) {
      c.rotate(Math.PI / 3);
      const g = c.createLinearGradient(0, 0, s / 2, 0);
      g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(1, 'rgba(255,170,60,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, -4); c.lineTo(s / 2, 0); c.lineTo(0, 4); c.fill();
    }
    const g2 = c.createRadialGradient(0, 0, 0, 0, 0, s / 4);
    g2.addColorStop(0, 'rgba(255,255,240,1)'); g2.addColorStop(1, 'rgba(255,190,90,0)');
    c.fillStyle = g2; c.fillRect(-s / 2, -s / 2, s, s);
  });
  const puff = canvasTex(128, (c, s) => {
    for (let i = 0; i < 22; i++) {
      const x = s / 2 + (Math.random() - 0.5) * s * 0.45, y = s / 2 + (Math.random() - 0.5) * s * 0.45;
      const r = s * (0.16 + Math.random() * 0.2);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    }
  });
  const flame = canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s * 0.65, 0, s / 2, s * 0.6, s / 2);
    g.addColorStop(0, 'rgba(255,250,200,1)'); g.addColorStop(0.3, 'rgba(255,170,40,0.9)'); g.addColorStop(0.7, 'rgba(220,60,10,0.4)'); g.addColorStop(1, 'rgba(120,20,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(s / 2, s * 0.6, s * 0.3, s * 0.42, 0, 0, Math.PI * 2); c.fill();
  });
  const hole = canvasTex(32, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(10,8,6,1)'); g.addColorStop(0.35, 'rgba(20,16,12,0.9)'); g.addColorStop(0.6, 'rgba(40,32,24,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  const scorch = canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(15,10,6,0.85)'); g.addColorStop(0.7, 'rgba(25,18,10,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  const letter = (ch: string, color: string) => canvasTex(256, (c, s) => {
    c.font = `bold ${s * 0.75}px Impact, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.globalAlpha = 0.85;
    c.fillStyle = color; c.fillText(ch, s / 2, s / 2 + s * 0.04);
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { c.globalAlpha = Math.random() * 0.5; c.fillRect(Math.random() * s, Math.random() * s, 3 + Math.random() * 6, 2 + Math.random() * 4); }
  });
  return { glow, flash, puff, flame, hole, scorch, letterA: letter('A', '#c0261e'), letterB: letter('B', '#c0261e') };
}
