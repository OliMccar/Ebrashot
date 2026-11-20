import * as THREE from 'three';
import type { Team } from '../shared/constants';
import { buildMap } from '../shared/map';
import type { WeaponId } from '../shared/weapons';
import { buildMapMesh } from './render/mapMesh';
import { type CharacterModel, buildCharacter, poseCharacter, setCharacterWeapon } from './render/models';
import type { Settings } from './settings';

/** Onde o personagem fica em cada time: no spawn, de frente para a câmera, com o mapa ao fundo. */
const STAGE: Record<Team, { pos: THREE.Vector3; face: number }> = {
  T: { pos: new THREE.Vector3(-3, 0, 50), face: Math.PI }, // olha para +z; fundo = meio do mapa
  CT: { pos: new THREE.Vector3(3, 0, -50), face: 0 }, // olha para -z
};

/**
 * Cena 3D do menu principal (estilo "agente em destaque"): o personagem do jogador
 * em pé no mapa, animação parada, sombra própria e rotação arrastando o mouse.
 */
export class MenuScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 520);
  private sun: THREE.DirectionalLight;
  private char: CharacterModel | null = null;
  private team: Team = 'T';
  private weapon: WeaponId = 'ak47';
  private raf = 0;
  private running = false;
  private t = 0;
  private last = 0;
  private spin = 0; // rotação extra do personagem (arrastar)
  private spinV = 0;
  private dragging = false;
  private dragX = 0;
  private mx = 0; private my = 0; // posição do mouse (-1..1) para parallax
  private cam = new THREE.Vector3();
  private look = new THREE.Vector3();
  private swapT = 0; // animação ao trocar de arma/time
  private snapCam = true;

  constructor(private canvas: HTMLCanvasElement, private settings: Settings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.fog = new THREE.Fog(0xead7b4, 30, 210);
    this.scene.add(new THREE.HemisphereLight(0xfff3dd, 0x8a6c48, 1.45));
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d2, 2.3);
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.intensity = 0.75;
    const sc = sun.shadow.camera; sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 80;
    this.scene.add(sun, sun.target);
    // luz de recorte (contorno) vinda de trás, deixa o personagem destacado do fundo
    const rim = new THREE.DirectionalLight(0xffe2b8, 1.4);
    rim.name = 'rim';
    this.scene.add(rim, rim.target);
    const map = buildMapMesh(buildMap());
    map.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.MeshLambertMaterial) o.receiveShadow = true; });
    this.scene.add(map);

    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  // ---------------------------------------------------------------- entrada
  private onDown = (e: PointerEvent) => { this.dragging = true; this.dragX = e.clientX; this.canvas.style.cursor = 'grabbing'; };
  private onMove = (e: PointerEvent) => {
    this.mx = (e.clientX / window.innerWidth) * 2 - 1;
    this.my = (e.clientY / window.innerHeight) * 2 - 1;
    if (!this.dragging) return;
    const dx = e.clientX - this.dragX;
    this.dragX = e.clientX;
    this.spinV = dx * 0.012;
    this.spin += dx * 0.012;
  };
  private onUp = () => { this.dragging = false; this.canvas.style.cursor = ''; };
  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * Math.min(1.25, this.settings.gScale)));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // em telas estreitas o personagem fica mais centralizado e um pouco mais longe
    this.camera.fov = w / h < 1.2 ? 44 : 34;
    this.camera.updateProjectionMatrix();
  };

  // ---------------------------------------------------------------- personagem
  setLook(team: Team, weapon: WeaponId) {
    if (this.char && team === this.team && weapon === this.weapon) return;
    const teamChanged = !this.char || team !== this.team;
    this.team = team; this.weapon = weapon;
    if (teamChanged) {
      if (this.char) this.scene.remove(this.char.root);
      const c = this.char = buildCharacter(team);
      c.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.scene.add(c.root);
      this.spin = 0; this.spinV = 0;
      this.snapCam = true;
    }
    setCharacterWeapon(this.char!, weapon);
    poseCharacter(this.char!, 'idle');
    this.char!.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.swapT = 1;
    this.placeLights();
  }

  private placeLights() {
    const st = STAGE[this.team];
    const fwd = new THREE.Vector3(-Math.sin(st.face), 0, -Math.cos(st.face));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    // sol pela frente-direita do personagem, alto; recorte por trás-esquerda
    this.sun.position.copy(st.pos).addScaledVector(fwd, 14).addScaledVector(right, 10).add(new THREE.Vector3(0, 22, 0));
    this.sun.target.position.copy(st.pos);
    const rim = this.scene.getObjectByName('rim') as THREE.DirectionalLight;
    rim.position.copy(st.pos).addScaledVector(fwd, -10).addScaledVector(right, -6).add(new THREE.Vector3(0, 6, 0));
    rim.target.position.copy(st.pos).add(new THREE.Vector3(0, 1.2, 0));
  }

  // ---------------------------------------------------------------- loop
  start() {
    if (this.running) return;
    this.running = true;
    this.onResize();
    this.renderer.shadowMap.enabled = this.settings.gShadows !== 'off';
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.animate(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private animate(dt: number) {
    const c = this.char;
    if (!c) return;
    const st = STAGE[this.team];
    const t = this.t;
    // rotação por arrasto com inércia, voltando devagar para a pose de frente
    if (!this.dragging) {
      this.spin += this.spinV;
      this.spinV *= Math.exp(-dt * 6);
      if (Math.abs(this.spinV) < 0.002) this.spin *= Math.exp(-dt * 0.8);
    }
    const breathe = Math.sin(t * 1.7);
    const shift = Math.sin(t * 0.45);
    c.root.position.copy(st.pos);
    c.root.position.y = 0;
    // 3/4 de perfil, como os agentes no menu
    c.root.rotation.set(0, st.face - 0.38 + this.spin + shift * 0.03, 0);
    const hips = c.upper.parent as THREE.Object3D;
    hips.position.y = 0.92 + breathe * 0.004 - Math.abs(shift) * 0.012;
    hips.rotation.z = shift * 0.025;
    // arma baixa (posição de descanso) com respiração
    this.swapT = Math.max(0, this.swapT - dt * 2.2);
    const swap = Math.sin(this.swapT * Math.PI) * 0.35;
    c.upper.rotation.set(-0.04 - swap * 0.4 + breathe * 0.012, 0.1 + shift * 0.04, -shift * 0.02);
    c.upper.position.y = breathe * 0.006;
    c.head.rotation.set(0.08 + Math.sin(t * 0.37) * 0.04, -0.1 + Math.sin(t * 0.23) * 0.18, 0);
    c.legL.rotation.set(0.04 + shift * 0.03, 0, 0.05);
    c.legR.rotation.set(-0.06 - shift * 0.03, 0, -0.04);
    c.shinL.rotation.x = -0.05; c.shinR.rotation.x = -0.02;
    // câmera: personagem à direita do centro, com leve parallax do mouse
    const fwd = new THREE.Vector3(-Math.sin(st.face), 0, -Math.cos(st.face));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    // tela larga e alta: personagem à direita (painéis à esquerda); celular deitado ou tela estreita: centralizado
    const wide = this.camera.aspect >= 1.2 && window.innerHeight > 480;
    const side = wide ? 0.4 : 0.1;
    const dist = wide ? 4.4 : 5.2;
    this.cam.copy(st.pos).addScaledVector(fwd, dist).addScaledVector(right, side + this.mx * 0.12);
    this.cam.y = 1.32 - this.my * 0.06;
    // alvo da câmera deslocado para o lado direito do personagem = ele aparece à direita da tela
    this.look.copy(st.pos).addScaledVector(right, wide ? 0.85 : 0.05).add(new THREE.Vector3(0, 1.02, 0));
    if (this.snapCam) { this.camera.position.copy(this.cam); this.snapCam = false; }
    else this.camera.position.lerp(this.cam, Math.min(1, dt * 6));
    this.camera.lookAt(this.look);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
