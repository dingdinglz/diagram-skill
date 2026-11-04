'use client';

/**
 * Application-specific adaptation of React Bits Aurora.
 * Source: https://reactbits.dev/r/Aurora-TS-CSS (native WebGL2).
 * Copyright (c) 2026 David Haz — MIT + Commons Clause License Condition v1.0.
 * Full license: skills/diagram-plan/licenses/react-bits-LICENSE.md.
 * Incorporation in an application is permitted; standalone component resale,
 * sublicensing and redistribution are restricted. The project's MIT license
 * does not replace these terms.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useReducedMotion } from '../useReducedMotion';

const DESKTOP = '(min-width: 761px) and (hover: hover) and (pointer: fine)';
const subscribeDesktop = (notify: () => void) => {
  const media = window.matchMedia(DESKTOP);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const desktopSnapshot = () => window.matchMedia(DESKTOP).matches;
const serverSnapshot = () => false;

const VERTEX = `#version 300 es
layout(location = 0) in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// Upstream simplex noise, OKLCH ramp, layered hem and premultiplied light-mode
// output. Fixed settings remove pointer-follow, intro and generic uniforms.
const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uStops[3];
out vec4 outColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}
vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * 2.0;
  int i = int(min(floor(x), 1.0));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lch = mix(uStops[i], uStops[i + 1], f);
  lch.x = min(lch.x, 0.7);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / uResolution.y;
  float u = frag.x / uResolution.x;
  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;
  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < 2; k++) {
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = uTime * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = 0.36 + layer * 0.07 + wave * 0.15 * 0.7;
    float soft = (0.04 + 0.7 * 0.16) * (1.0 + layer * 0.9);
    float rise = hem - y;
    float low = -soft - 0.6 * 0.14;
    float high = 0.26 + soft * 0.6;
    float body = pow(smootherstep(low, high, rise), 1.5 + 0.6 * 0.6);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float alpha = clamp(body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer), 0.0, 1.0);
    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }
  glow *= 0.26;
  cover *= 0.26;
  float dither = (hash(frag) - 0.5) / 255.0;
  vec3 tint = cover > 0.0001 ? glow / cover : vec3(0.0);
  cover *= smootherstep(0.0, 0.26, cover);
  float alpha = cover * 0.7;
  outColor = vec4(tint * alpha + dither, clamp(alpha + dither, 0.0, 1.0));
}
`;

// Upstream linear-sRGB -> OKLab -> OKLCH conversion and shortest-arc hues.
function palette() {
  let previous: number | undefined;
  return new Float32Array(['829de2', '81cbbb', '9daceb'].flatMap(hex => {
    const rgb = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [r, g, b] = rgb.map(c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bLab = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    let hue = Math.atan2(bLab, a);
    if (previous !== undefined) {
      while (hue - previous > Math.PI) hue -= Math.PI * 2;
      while (hue - previous < -Math.PI) hue += Math.PI * 2;
    }
    previous = hue;
    return [lightness, Math.hypot(a, bLab), hue];
  }));
}
const PALETTE = palette();
const FRAME_MS = 1000 / 30;

function editing() {
  const active = document.activeElement;
  return active instanceof HTMLElement &&
    (active.matches('input, textarea, select') || active.isContentEditable);
}

export function Aurora({ enabled, paused }: { enabled: boolean; paused: boolean }) {
  const reduced = useReducedMotion();
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, serverSnapshot);
  const eligible = enabled && desktop && !reduced;
  const rootRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const syncRef = useRef<(() => void) | null>(null);

  // Modal/busy changes never rebuild the GPU. This effect precedes setup.
  useEffect(() => {
    pausedRef.current = paused;
    syncRef.current?.();
  }, [paused]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.state = 'static';
    if (!eligible) return; // No canvas, context, observers, timers or RAF in static mode.

    // A fresh canvas per lifetime is essential: loseContext() during StrictMode
    // cleanup must not poison the next setup or a later eligibility toggle.
    const canvas = document.createElement('canvas');
    canvas.className = 'aurora-canvas';
    canvas.dataset.frame = '0';
    canvas.style.visibility = 'hidden';
    root.appendChild(canvas);
    let alive = true;
    let gl: WebGL2RenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    const shaders: WebGLShader[] = [];
    const listeners = new AbortController();
    let resizeObserver: ResizeObserver | undefined;
    let intersection: IntersectionObserver | undefined;
    let raf = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let visible = false; // First still is immediate; RAF waits for intersection.
    let focused = editing();
    let wheeling = false;
    const pointers = new Set<number>();
    let clock = 0;
    let lastTick: number | null = null;
    let lastDraw = -Infinity;
    let frames = 0;

    const dispose = () => {
      if (!alive) return;
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(wheelTimer);
      listeners.abort();
      resizeObserver?.disconnect();
      intersection?.disconnect();
      syncRef.current = null;
      canvas.remove();
      if (gl) {
        for (const shader of shaders) gl.deleteShader(shader);
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
        // Optional extension; never let a driver failure escape into the app.
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already lost */ }
      }
    };
    const fallback = () => {
      dispose();
      canvas.style.visibility = 'hidden';
      root.dataset.state = 'fallback';
    };

    try {
      const context = canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: true, antialias: false,
        depth: false, stencil: false, preserveDrawingBuffer: false,
      });
      gl = context;
      if (!context) throw new Error('WebGL2 unavailable');
      const compile = (type: number, source: string) => {
        const shader = context.createShader(type);
        if (!shader) throw new Error('Shader allocation failed');
        shaders.push(shader); // Own immediately, including all partial failures.
        context.shaderSource(shader, source);
        context.compileShader(shader);
        if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error('Shader compilation failed');
        return shader;
      };
      const vertex = compile(context.VERTEX_SHADER, VERTEX);
      const fragment = compile(context.FRAGMENT_SHADER, FRAGMENT);
      program = context.createProgram();
      if (!program) throw new Error('Program allocation failed');
      context.attachShader(program, vertex);
      context.attachShader(program, fragment);
      context.linkProgram(program);
      if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error('Program link failed');
      for (const shader of shaders) {
        context.detachShader(program, shader);
        context.deleteShader(shader);
      }
      shaders.length = 0;
      buffer = context.createBuffer();
      vao = context.createVertexArray();
      if (!buffer || !vao) throw new Error('Geometry allocation failed');
      context.bindVertexArray(vao);
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), context.STATIC_DRAW);
      context.enableVertexAttribArray(0);
      context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
      context.useProgram(program);
      context.uniform3fv(context.getUniformLocation(program, 'uStops[0]'), PALETTE);
      const resolution = context.getUniformLocation(program, 'uResolution');
      const time = context.getUniformLocation(program, 'uTime');
      const canRun = () => alive && !pausedRef.current && !document.hidden && visible &&
        !focused && !wheeling && pointers.size === 0;

      const draw = (now: number) => {
        if (!alive) return;
        try {
          if (context.isContextLost()) { fallback(); return; }
          context.viewport(0, 0, canvas.width, canvas.height);
          context.uniform2f(resolution, canvas.width, canvas.height);
          context.uniform1f(time, clock);
          context.drawArrays(context.TRIANGLES, 0, 3);
          canvas.dataset.frame = String(++frames);
          canvas.style.visibility = 'visible';
          lastDraw = now;
        } catch { fallback(); }
      };
      const frame = (now: number) => {
        raf = 0;
        if (!canRun()) { sync(); return; }
        if (lastTick !== null) clock += Math.min(now - lastTick, 50) * 0.001 * 0.22;
        lastTick = now;
        if (now - lastDraw >= FRAME_MS) draw(now);
        if (alive && running) raf = requestAnimationFrame(frame);
      };
      const sync = () => {
        if (!alive) return;
        const next = canRun();
        if (next !== running) lastTick = null; // Never count paused wall time.
        running = next;
        root.dataset.state = running ? 'running' : 'paused';
        if (!running) {
          cancelAnimationFrame(raf);
          raf = 0;
        } else if (!raf) {
          raf = requestAnimationFrame(frame);
        }
      };
      const resize = () => {
        if (!alive) return;
        const { width, height } = root.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 1, 1280 / Math.max(1, width));
        const w = Math.max(1, Math.floor(width * ratio));
        const h = Math.max(1, Math.floor(height * ratio));
        if (canvas.width === w && canvas.height === h && frames > 0) return;
        canvas.width = w;
        canvas.height = h;
        // Resizing clears the buffer: refresh a paused still exactly once.
        // Running resizes use the capped animation loop instead.
        if (!canRun() || frames === 0) draw(performance.now());
      };
      const onFocus = () => { focused = editing(); sync(); };
      const onBlur = () => {
        queueMicrotask(() => { if (alive) onFocus(); });
      };
      const onPointerDown = (event: PointerEvent) => { pointers.add(event.pointerId); sync(); };
      const onPointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); sync(); };
      const onWindowBlur = () => { pointers.clear(); sync(); };
      const onWheel = () => {
        wheeling = true;
        clearTimeout(wheelTimer);
        sync();
        wheelTimer = setTimeout(() => {
          if (!alive) return;
          wheeling = false;
          sync();
        }, 250);
      };
      const options = { passive: true, signal: listeners.signal };
      const capture = { ...options, capture: true };
      // Listen on the graph area, not the pointer-transparent background.
      const parentCanvas = root.parentElement;
      parentCanvas?.addEventListener('pointerdown', onPointerDown, capture);
      parentCanvas?.addEventListener('wheel', onWheel, capture);
      window.addEventListener('pointerup', onPointerUp, capture);
      window.addEventListener('pointercancel', onPointerUp, capture);
      window.addEventListener('blur', onWindowBlur, options);
      document.addEventListener('focusin', onFocus, capture);
      document.addEventListener('focusout', onBlur, capture);
      document.addEventListener('visibilitychange', sync, options);
      // No auto-recovery: a lost renderer stays CSS-only until eligibility changes.
      canvas.addEventListener('webglcontextlost', fallback, { signal: listeners.signal });
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(root);
      intersection = new IntersectionObserver(entries => {
        if (!alive) return;
        visible = entries.some(entry => entry.isIntersecting);
        sync();
      });
      intersection.observe(root);
      syncRef.current = sync;
      resize(); // Fully revealed first frame, even if initially paused.
      sync();
    } catch {
      fallback();
    }

    return () => {
      dispose();
      canvas.style.visibility = 'hidden';
      root.dataset.state = 'static';
    };
  }, [eligible]);

  // The parent owns positioning and the always-visible pale-blue/teal CSS base.
  // Imperative data attributes avoid React updates on frames and interaction.
  return (
    <div ref={rootRef} className="aurora-background" aria-hidden="true" data-state="static" />
  );
}
