import { useCallback, useEffect, useRef, useState } from "react";

const INTRO_DURATION = 4.0;
const EXIT_DURATION = 1.35;
const SPEED_RANGE: readonly [number, number] = [0.2, 0.6];
const RICHNESS_RANGE: readonly [number, number] = [0.3, 0.8];
const BUBBLES_RANGE: readonly [number, number] = [0.5, 0.18];
const MAX_MOBILE_SAFE_DPR = 1.75;
const SESSION_STORAGE_KEY = "workshop:intro-splash-seen:v1";

const HEADLINE = "创意工坊 2.0";
const SUBTITLE = "命定之诗与黄昏之歌";
const TITLE_SCALE = 1.6;
const SUBTITLE_SCALE = 1.7;

const HEADLINE_FONT_FAMILY =
  '"WorkshopLongZhu", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const SUBTITLE_FONT_FAMILY = '"WorkshopSerif", "Songti SC", "STSong", "Noto Serif SC", "SimSun", serif';

// 定稿四色颜料：纯黑 #000000、薄荷青 #6FCEC8、朱砂暖橙 #FF3B1D、明黄 #FFD43B
const INTRO_PALETTE: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.0, 0.0, 0.0],
  [0.435, 0.808, 0.784],
  [1.0, 0.231, 0.114],
  [1.0, 0.831, 0.231],
];

const VS_SOURCE = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FS_SOURCE = `
  precision highp float;

  varying vec2 v_uv;

  uniform vec2 u_res;
  uniform float u_progress;
  uniform float u_exit;
  uniform float u_flow;
  uniform float u_morph;
  uniform float u_elongation;
  uniform float u_bubbles;
  uniform float u_richness;
  uniform vec2 u_textHalfBox;

  uniform vec3 u_pal0;
  uniform vec3 u_pal1;
  uniform vec3 u_pal2;
  uniform vec3 u_pal3;

  uniform sampler2D u_textSampler;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  float bubbleHoleField(vec2 p, float densityGate, float seed) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float hole = 0.0;

    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 rnd = hash22(ip + nb + seed);
        if (rnd.x > densityGate) {
          vec2 center = nb + 0.18 + 0.64 * hash22(ip + nb + seed + 17.3);
          float radius = mix(0.14, 0.36, fract(rnd.y * 9.7));
          vec2 diff = (fp - center) * vec2(1.0, 0.86);
          float dist = length(diff);
          hole = max(hole, (radius - dist) * 3.2);
        }
      }
    }
    return hole;
  }

  float splashDroplets(vec2 p, float regionMask, float seed) {
    if (regionMask <= 0.01) return 0.0;
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    vec2 rnd = hash22(ip + seed);
    if (rnd.x < 0.62) return 0.0;
    vec2 center = 0.22 + 0.56 * rnd;
    vec2 diff = (fp - center) * vec2(1.12, 0.72);
    float r = (0.12 + 0.16 * fract(rnd.y * 13.1)) * regionMask;
    return max(0.0, (r - length(diff)) * 4.0);
  }

  float strandReach(float progress, float startP, float endP, float yPos, float jitter) {
    float t = clamp((progress - startP) / max(endP - startP, 0.001), 0.0, 1.0);
    if (t <= 0.001) return 0.0;
    float front = mix(-0.18, 1.42, pow(t, 0.90)) + jitter;
    return 1.0 - smoothstep(front - 0.14, front + 0.06, yPos);
  }

  void main() {
    float aspect = u_res.x / max(u_res.y, 1.0);
    float aa = 1.5 / max(u_res.y, 1.0);
    vec2 p = vec2((v_uv.x - 0.5) * aspect, v_uv.y);

    float wAlpha = 0.0;
    vec3 paintRGB = vec3(0.0, 0.0, 0.0);

    if (u_progress > 0.015) {
      // 鹅卵石绕流（无接缝平滑分水势流场）
      vec2 streamP = p;
      float rx = max(u_textHalfBox.x * aspect * 1.25, 0.18);
      float ry = max(u_textHalfBox.y * 1.95, 0.11);
      float nx = p.x / rx;
      float ny = (p.y - 0.50) / ry;
      float potential = exp(-(nx * nx) - (ny * ny));
      streamP.x -= (nx * potential) * 0.055 * rx;
      streamP.y -= potential * 0.009;

      float warpX = snoise(vec3(streamP.x * 2.5, streamP.y * 1.12 - u_flow * 0.92, u_morph * 0.44)) * 0.082;
      float sx = streamP.x + warpX;

      float nMain = snoise(vec3(sx * 5.0, streamP.y * 1.15 - u_flow * 1.12, u_morph * 0.50));
      float nFast = snoise(vec3(sx * 10.4 + 7.4, streamP.y * 2.10 - u_flow * 1.68, u_morph * 0.70 + 4.1));
      float nFine = snoise(vec3(sx * 18.0 - 3.2, streamP.y * 3.35 - u_flow * 2.15, u_morph * 0.84 + 9.3));

      float ribbonMain = 0.5 + 0.5 * nMain;
      float ribbonFast = 1.0 - abs(nFast);
      float streamDensity = ribbonMain * 0.62 + ribbonFast * 0.42 + (0.5 + 0.5 * nFine) * 0.14;

      float fingerWave = snoise(vec3(sx * 4.8, 0.8, u_morph * 0.30)) * 0.16
                       + snoise(vec3(sx * 11.5, 2.3, u_morph * 0.45)) * 0.08;

      float pFront = clamp((u_progress - 0.02) / 0.30, 0.0, 1.0);
      float frontY = mix(-0.28, 1.44, pow(pFront, 0.86)) + fingerWave;
      float leadTaper = 1.0 - smoothstep(frontY - 0.24, frontY + 0.02, p.y);

      float tailY = -0.34;
      float tailTaper = 1.0;
      float tailBand = 0.0;
      if (u_exit > 0.001) {
        tailY = mix(-0.34, 1.46, pow(u_exit, 1.05)) + fingerWave * 0.92;
        tailTaper = smoothstep(tailY - 0.02, tailY + 0.28, p.y);
        tailBand = exp(-pow((p.y - tailY - 0.04) / 0.12, 2.0)) * step(0.02, u_exit) * step(u_exit, 0.98);
      }

      float bodyWindow = leadTaper * tailTaper;

      if (bodyWindow > 0.001 || (p.y < frontY + 0.14 && p.y > tailY - 0.14)) {
        float bubbleCut = 0.0;
        if (u_bubbles > 0.01) {
          float gate1 = mix(0.95, 0.38, u_bubbles);
          float gate2 = mix(0.97, 0.48, u_bubbles);
          vec2 bCoord1 = vec2(sx * 11.5, (streamP.y - u_flow * 1.42) * 10.5);
          vec2 bCoord2 = vec2(sx * 21.0 + 5.2, (streamP.y - u_flow * 1.92) * 19.0);
          bubbleCut = max(
            bubbleHoleField(bCoord1, gate1, 3.1),
            bubbleHoleField(bCoord2, gate2, 14.7)
          );
        }

        float frontBand = exp(-pow((p.y - frontY + 0.04) / 0.11, 2.0)) * step(0.02, pFront) * step(pFront, 0.98);
        float drops = splashDroplets(vec2(sx * 16.0, (p.y - u_flow * 1.65) * 14.0), max(frontBand, tailBand), 29.4);

        float baseThresh = mix(0.76, 0.22, u_richness);
        float localThresh = mix(0.96, baseThresh, bodyWindow);
        float netDensity = max(streamDensity - bubbleCut, drops * 0.95);
        float edgeAA = clamp(aa * 4.2, 0.0035, 0.012);
        wAlpha = smoothstep(localThresh - edgeAA, localThresh + edgeAA, netDensity);

        if (wAlpha > 0.001) {
          float stretchRatio = mix(6.0, 9.2, u_elongation);
          float freqX = mix(6.4, 12.2, u_elongation);
          float freqY = freqX / stretchRatio;

          float ribbonCurl = (streamDensity - 0.5) * 0.055
                           + snoise(vec3(sx * 3.8, streamP.y * 0.95 - u_flow * 1.14, u_morph * 0.34)) * 0.042;
          float px = sx + ribbonCurl;
          float colorAA = clamp(aa * 6.5, 0.006, 0.018);

          // 无底色透明起手：四缕彩墨依次自上而下浮现交织
          vec3 col = vec3(0.0, 0.0, 0.0);
          float colorCov = 0.0;

          float jitter0 = snoise(vec3(px * 4.2, 1.3, u_morph * 0.25)) * 0.18;
          float reach0 = strandReach(u_progress, 0.05, 0.41, streamP.y, jitter0);
          if (reach0 > 0.001) {
            float f0 = snoise(vec3(px * (freqX * 0.95), (streamP.y - u_flow * 1.18) * freqY, u_morph * 0.28 + 3.1));
            float th0 = mix(0.74, 0.02, reach0);
            float m0 = smoothstep(th0 - colorAA, th0 + colorAA, f0);
            col = mix(col, u_pal0, m0);
            colorCov = max(colorCov, m0);
          }

          float jitter1 = snoise(vec3(px * 5.6 + 6.1, 2.7, u_morph * 0.28)) * 0.20;
          float reach1 = strandReach(u_progress, 0.20, 0.545, streamP.y, jitter1);
          if (reach1 > 0.001) {
            float f1 = snoise(vec3(px * (freqX * 1.18) + 9.4, (streamP.y - u_flow * 1.38) * (freqY * 1.12), u_morph * 0.34 + 11.7));
            float th1 = mix(0.76, 0.10, reach1);
            float m1 = smoothstep(th1 - colorAA, th1 + colorAA, f1);
            col = mix(col, u_pal1, m1);
            colorCov = max(colorCov, m1);
          }

          float jitter2 = snoise(vec3(px * 6.4 - 4.3, 4.1, u_morph * 0.31)) * 0.20;
          float reach2 = strandReach(u_progress, 0.365, 0.695, streamP.y, jitter2);
          if (reach2 > 0.001) {
            float f2 = snoise(vec3(px * (freqX * 1.42) - 5.8, (streamP.y - u_flow * 1.56) * (freqY * 1.28), u_morph * 0.39 + 19.2));
            float th2 = mix(0.78, 0.18, reach2);
            float m2 = smoothstep(th2 - colorAA, th2 + colorAA, f2);
            col = mix(col, u_pal2, m2);
            colorCov = max(colorCov, m2);
          }

          float jitter3 = snoise(vec3(px * 7.8 + 2.5, 5.9, u_morph * 0.35)) * 0.18;
          float reach3 = strandReach(u_progress, 0.53, 0.86, streamP.y, jitter3);
          if (reach3 > 0.001) {
            float f3 = snoise(vec3(px * (freqX * 1.80) + 4.6, (streamP.y - u_flow * 1.78) * (freqY * 1.48), u_morph * 0.45 + 27.5));
            float th3 = mix(0.80, 0.24, reach3);
            float m3 = smoothstep(th3 - colorAA, th3 + colorAA, f3);
            col = mix(col, u_pal3, m3);
            colorCov = max(colorCov, m3);
          }

          wAlpha *= colorCov;
          paintRGB = col;
        }
      }
    }

    float tMask = texture2D(u_textSampler, v_uv).a;
    vec3 finalRGB = mix(paintRGB, vec3(1.0, 1.0, 1.0), tMask);
    gl_FragColor = vec4(finalRGB * wAlpha, wAlpha);
  }
`;

export function shouldPlayIntroSplash(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    if (window.sessionStorage.getItem(SESSION_STORAGE_KEY) === "1") return false;
  } catch {
    // 隐私模式或受限 iframe 下无法读写 sessionStorage 时仍允许播放
  }
  return true;
}

function markIntroSplashSeen(): void {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
  } catch {
    // 忽略存储受限异常
  }
}

// 首尾各留 12% 轻缓起落，中间 76% 保持均匀线性过渡（C1 连续无折角）
function softLinearCurve(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  const k = 0.12;
  const m = 1 / (1 - k);
  if (t < k) return (0.5 * m * t * t) / k;
  if (t <= 1 - k) return 0.5 * m * k + m * (t - k);
  const u = 1 - t;
  return 1 - (0.5 * m * u * u) / k;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mountIntroSplash(
  canvas: HTMLCanvasElement,
  exitingRef: { current: boolean },
  onReachClimax: () => void,
  onFinished: () => void,
): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    markIntroSplashSeen();
    onFinished();
    return () => {};
  }

  const gl =
    canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true }) ??
    (canvas.getContext("experimental-webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    }) as WebGLRenderingContext | null);

  if (!gl) {
    markIntroSplashSeen();
    onFinished();
    return () => {};
  }

  const compileShader = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compileShader(gl.VERTEX_SHADER, VS_SOURCE);
  const fs = compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    markIntroSplashSeen();
    onFinished();
    return () => {};
  }

  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    markIntroSplashSeen();
    onFinished();
    return () => {};
  }

  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    markIntroSplashSeen();
    onFinished();
    return () => {};
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook
  gl.useProgram(prog);

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  const aPosLoc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPosLoc);
  gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

  const u = {
    res: gl.getUniformLocation(prog, "u_res"),
    progress: gl.getUniformLocation(prog, "u_progress"),
    exit: gl.getUniformLocation(prog, "u_exit"),
    flow: gl.getUniformLocation(prog, "u_flow"),
    morph: gl.getUniformLocation(prog, "u_morph"),
    elongation: gl.getUniformLocation(prog, "u_elongation"),
    bubbles: gl.getUniformLocation(prog, "u_bubbles"),
    richness: gl.getUniformLocation(prog, "u_richness"),
    textHalfBox: gl.getUniformLocation(prog, "u_textHalfBox"),
    pal0: gl.getUniformLocation(prog, "u_pal0"),
    pal1: gl.getUniformLocation(prog, "u_pal1"),
    pal2: gl.getUniformLocation(prog, "u_pal2"),
    pal3: gl.getUniformLocation(prog, "u_pal3"),
    textSampler: gl.getUniformLocation(prog, "u_textSampler"),
  };

  const textCanvas = document.createElement("canvas");
  const textCtx = textCanvas.getContext("2d");
  const textTex = gl.createTexture();
  let textBoxHalfUV: [number, number] = [0.22, 0.09];
  let disposed = false;

  const updateTopTextTexture = () => {
    if (!textCtx || !textTex || disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_MOBILE_SAFE_DPR);
    const w = Math.max(Math.floor(window.innerWidth * dpr), 2);
    const h = Math.max(Math.floor(window.innerHeight * dpr), 2);

    textCanvas.width = w;
    textCanvas.height = h;
    textCtx.clearRect(0, 0, w, h);

    const vw = window.innerWidth;
    let titlePx = Math.round(Math.min(Math.max(vw * 0.088, 40), 112) * dpr * TITLE_SCALE);
    let subPx = Math.round(Math.min(Math.max(vw * 0.015, 12), 18) * dpr * SUBTITLE_SCALE);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxTextWidth = w * 0.88;

    textCtx.textAlign = "center";
    textCtx.textBaseline = "middle";
    textCtx.fillStyle = "#FFFFFF";

    textCtx.font = `400 ${titlePx}px ${HEADLINE_FONT_FAMILY}`;
    const titleMeasured = textCtx.measureText(HEADLINE);
    if (titleMeasured.width > maxTextWidth && titleMeasured.width > 0) {
      titlePx = Math.max(Math.floor(titlePx * (maxTextWidth / titleMeasured.width)), Math.round(24 * dpr));
    }

    textCtx.font = `700 ${subPx}px ${SUBTITLE_FONT_FAMILY}`;
    if ("letterSpacing" in textCtx) {
      (textCtx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(subPx * 0.24)}px`;
    }
    const subMeasured = textCtx.measureText(SUBTITLE);
    if (subMeasured.width > maxTextWidth && subMeasured.width > 0) {
      subPx = Math.max(Math.floor(subPx * (maxTextWidth / subMeasured.width)), Math.round(10 * dpr));
      textCtx.font = `700 ${subPx}px ${SUBTITLE_FONT_FAMILY}`;
    }
    textCtx.fillText(SUBTITLE, cx, cy - (titlePx * 0.62 + subPx * 0.75));

    textCtx.font = `400 ${titlePx}px ${HEADLINE_FONT_FAMILY}`;
    if ("letterSpacing" in textCtx) {
      (textCtx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        `${Math.round(titlePx * 0.08)}px`;
    }
    textCtx.fillText(HEADLINE, cx, cy + titlePx * 0.08);

    const finalMeasured = textCtx.measureText(HEADLINE);
    const halfW = Math.max((finalMeasured.width * 0.52) / w, 0.14);
    const halfH = Math.max((titlePx * 0.75) / h, 0.075);
    textBoxHalfUV = [halfW, halfH];

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  };

  const resizeViewport = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_MOBILE_SAFE_DPR);
    canvas.width = Math.max(Math.floor(window.innerWidth * dpr), 2);
    canvas.height = Math.max(Math.floor(window.innerHeight * dpr), 2);
    gl.viewport(0, 0, canvas.width, canvas.height);
    updateTopTextTexture();
  };

  window.addEventListener("resize", resizeViewport);
  resizeViewport();
  if (document.fonts) {
    void Promise.all([
      document.fonts.load('400 48px "WorkshopLongZhu"'),
      document.fonts.load('700 24px "WorkshopSerif"'),
    ]).then(() => {
      if (!disposed) updateTopTextTexture();
    });
  }
  markIntroSplashSeen();

  let elapsed = 0;
  let exitElapsed = 0;
  let flowPhase = 0;
  let morphTime = 0;
  let lastTick = 0;
  let rafId = 0;
  let reachedClimax = false;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    window.cancelAnimationFrame(rafId);
    window.removeEventListener("resize", resizeViewport);
    if (textTex) gl.deleteTexture(textTex);
    if (quadBuf) gl.deleteBuffer(quadBuf);
    gl.deleteProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  };

  const renderLoop = (now: number) => {
    if (disposed) return;
    if (!lastTick) lastTick = now;
    const dt = Math.min((now - lastTick) / 1000, 0.05);
    lastTick = now;

    elapsed += dt;
    const progress = Math.min(elapsed / INTRO_DURATION, 1.0);
    if (progress >= 1.0 && !reachedClimax) {
      reachedClimax = true;
      onReachClimax();
    }

    let exitProgress = 0;
    if (exitingRef.current) {
      exitElapsed += dt;
      exitProgress = Math.min(exitElapsed / EXIT_DURATION, 1.0);
      if (exitProgress >= 1.0) {
        cleanup();
        onFinished();
        return;
      }
    }

    const curve = softLinearCurve(0.05, 0.95, progress);
    const exitCurve = softLinearCurve(0.0, 1.0, exitProgress);
    const curSpeed = lerp(SPEED_RANGE[0], SPEED_RANGE[1], curve) + exitCurve * 0.35;
    const curRichness = lerp(lerp(RICHNESS_RANGE[0], RICHNESS_RANGE[1], curve), 0.36, exitCurve);
    const curBubbles = lerp(lerp(BUBBLES_RANGE[0], BUBBLES_RANGE[1], curve), 0.56, exitCurve);

    if (progress > 0.015) {
      flowPhase += dt * (0.45 + curSpeed * 1.35);
      morphTime += dt * (0.5 + curSpeed * 0.85);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (progress > 0.015) {
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook
      gl.useProgram(prog);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.progress, progress);
      gl.uniform1f(u.exit, exitProgress);
      gl.uniform1f(u.flow, flowPhase);
      gl.uniform1f(u.morph, morphTime);
      gl.uniform1f(u.elongation, 0.72);
      gl.uniform1f(u.bubbles, curBubbles);
      gl.uniform1f(u.richness, curRichness);
      gl.uniform2fv(u.textHalfBox, textBoxHalfUV);

      gl.uniform3fv(u.pal0, INTRO_PALETTE[0]);
      gl.uniform3fv(u.pal1, INTRO_PALETTE[1]);
      gl.uniform3fv(u.pal2, INTRO_PALETTE[2]);
      gl.uniform3fv(u.pal3, INTRO_PALETTE[3]);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(u.textSampler, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    rafId = window.requestAnimationFrame(renderLoop);
  };

  rafId = window.requestAnimationFrame(renderLoop);
  return cleanup;
}

export function IntroSplash({ blocked }: { blocked: boolean }) {
  const [visible, setVisible] = useState<boolean>(() => shouldPlayIntroSplash());
  const [readyToEnter, setReadyToEnter] = useState(false);
  const [exiting, setExiting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const exitingRef = useRef(false);

  const dismiss = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
  }, []);

  const active = visible && !blocked;

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) {
      setVisible(false);
      return;
    }
    return mountIntroSplash(
      canvas,
      exitingRef,
      () => setReadyToEnter(true),
      () => setVisible(false),
    );
  }, [active]);

  useEffect(() => {
    if (!active || exiting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || (readyToEnter && (event.key === "Enter" || event.key === " "))) {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, exiting, readyToEnter, dismiss]);

  if (!active) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 250,
        pointerEvents: exiting ? "none" : "auto",
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={() => {
          if (readyToEnter && !exiting) dismiss();
        }}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          cursor: readyToEnter && !exiting ? "pointer" : "default",
        }}
      />

      {!exiting ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "max(44px, 10vh)",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            onClick={dismiss}
            style={{
              pointerEvents: "auto",
              padding: "10px 28px",
              borderRadius: "999px",
              border: readyToEnter ? "1px solid rgba(255, 255, 255, 0.85)" : "1px solid rgba(255, 255, 255, 0.36)",
              background: readyToEnter ? "rgba(17, 19, 24, 0.68)" : "rgba(17, 19, 24, 0.52)",
              color: "#FFFFFF",
              fontSize: "14px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              backdropFilter: "blur(10px)",
              boxShadow: readyToEnter ? "0 10px 30px rgba(0, 0, 0, 0.45)" : "0 4px 16px rgba(0, 0, 0, 0.35)",
              transition: "all 240ms ease",
            }}
          >
            进入工坊
          </button>
          <span
            aria-hidden={!readyToEnter}
            style={{
              minHeight: "18px",
              lineHeight: "18px",
              color: "rgba(255, 255, 255, 0.85)",
              fontSize: "12px",
              letterSpacing: "0.06em",
              textShadow: "0 1px 6px rgba(0, 0, 0, 0.55)",
              opacity: readyToEnter ? 1 : 0,
              transition: "opacity 280ms ease",
            }}
          >
            点击任意位置继续
          </span>
        </div>
      ) : null}
    </div>
  );
}
