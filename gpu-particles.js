/**
 * BabyKeyPlay — GPU Particle Engine
 * Transform-feedback based particle system supporting 100K–200K particles
 */

const GPUParticles = (() => {
  'use strict';

  const VERT_UPDATE = `#version 300 es
    precision highp float;

    in vec2 a_position;
    in vec2 a_velocity;
    in vec4 a_color;
    in float a_life;
    in float a_maxLife;
    in float a_size;
    in float a_angle;
    in float a_spin;

    out vec2 v_position;
    out vec2 v_velocity;
    out vec4 v_color;
    out float v_life;
    out float v_maxLife;
    out float v_size;
    out float v_angle;
    out float v_spin;

    uniform float u_dt;
    uniform vec2 u_resolution;
    uniform float u_gravity;
    uniform float u_drag;
    uniform float u_turbulence;
    uniform float u_time;

    // Simple pseudo-random from position
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    // Simplex-like noise for turbulence
    vec2 curlNoise(vec2 p, float t) {
      float n1 = hash(p + vec2(t * 0.1, 0.0));
      float n2 = hash(p + vec2(0.0, t * 0.1));
      return vec2(
        sin(n1 * 6.2831 + t) * u_turbulence,
        cos(n2 * 6.2831 + t * 1.3) * u_turbulence
      );
    }

    void main() {
      float newLife = a_life - u_dt;

      if (newLife <= 0.0) {
        // Dead particle — park offscreen
        v_position = vec2(-9999.0);
        v_velocity = vec2(0.0);
        v_color = vec4(0.0);
        v_life = 0.0;
        v_maxLife = a_maxLife;
        v_size = 0.0;
        v_angle = 0.0;
        v_spin = 0.0;
        return;
      }

      vec2 turbForce = curlNoise(a_position * 0.002, u_time);
      vec2 gravity = vec2(0.0, u_gravity);

      vec2 newVel = a_velocity;
      newVel += gravity * u_dt;
      newVel += turbForce * u_dt;
      newVel *= (1.0 - u_drag * u_dt);

      vec2 newPos = a_position + newVel * u_dt;

      v_position = newPos;
      v_velocity = newVel;
      v_color = a_color;
      v_life = newLife;
      v_maxLife = a_maxLife;
      v_size = a_size;
      v_angle = a_angle + a_spin * u_dt;
      v_spin = a_spin;
    }
  `;

  const VERT_RENDER = `#version 300 es
    precision highp float;

    in vec2 a_position;
    in vec4 a_color;
    in float a_life;
    in float a_maxLife;
    in float a_size;
    in float a_angle;

    out vec4 v_color;
    out float v_lifeFrac;
    out float v_angle;

    uniform vec2 u_resolution;

    void main() {
      float lifeFrac = clamp(a_life / max(a_maxLife, 0.01), 0.0, 1.0);

      // Fade in fast, fade out with easing
      float fadeIn = smoothstep(0.0, 0.1, 1.0 - lifeFrac);
      float fadeOut = lifeFrac * lifeFrac; // quadratic falloff
      float alpha = fadeIn * fadeOut;

      // Scale grows then shrinks
      float sizeScale = sin(lifeFrac * 3.14159) * 1.2 + 0.3;

      vec2 ndc = (a_position / u_resolution) * 2.0 - 1.0;
      ndc.y *= -1.0;

      gl_Position = vec4(ndc, 0.0, 1.0);
      gl_PointSize = a_size * sizeScale * (u_resolution.y / 900.0);

      v_color = vec4(a_color.rgb, a_color.a * alpha);
      v_lifeFrac = lifeFrac;
      v_angle = a_angle;
    }
  `;

  const FRAG_RENDER = `#version 300 es
    precision mediump float;

    in vec4 v_color;
    in float v_lifeFrac;
    in float v_angle;

    out vec4 fragColor;

    void main() {
      vec2 coord = gl_PointCoord - 0.5;

      // Rotate
      float c = cos(v_angle);
      float s = sin(v_angle);
      coord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);

      float dist = length(coord);

      // Soft circle with glow
      float core = 1.0 - smoothstep(0.15, 0.35, dist);
      float glow = 1.0 - smoothstep(0.0, 0.5, dist);
      glow = glow * glow * 0.6;

      float brightness = core + glow;
      float alpha = brightness * v_color.a;

      if (alpha < 0.005) discard;

      // Neon bloom: brighten center
      vec3 bloomColor = v_color.rgb + vec3(core * 0.4);

      fragColor = vec4(bloomColor * alpha, alpha);
    }
  `;

  const THEMES = {
    cyber: {
      background: [0.04, 0.04, 0.10],
      palette: [
        [0, 1, 1, 1],
        [1, 0, 1, 1],
        [1, 1, 0, 1],
        [0, 1, 0.6, 1],
        [0.5, 0.5, 1, 1],
        [1, 0.4, 0.7, 1]
      ],
      gravity: 30,
      drag: 0.8,
      turbulence: 120,
      burstCount: 800,
      speed: [80, 400],
      life: [0.6, 2.0],
      size: [3, 14]
    },
    aurora: {
      background: [0.02, 0.06, 0.12],
      palette: [
        [0, 1, 0.4, 1],
        [0, 0.6, 1, 1],
        [0.3, 1, 0.7, 1],
        [0.1, 0.8, 0.9, 1],
        [0.5, 1, 0.5, 1],
        [0.2, 0.5, 1, 1]
      ],
      gravity: -15,
      drag: 1.2,
      turbulence: 200,
      burstCount: 600,
      speed: [40, 180],
      life: [1.5, 3.5],
      size: [4, 18]
    },
    lava: {
      background: [0.08, 0.02, 0.02],
      palette: [
        [1, 0.5, 0, 1],
        [1, 0.2, 0, 1],
        [1, 0.8, 0, 1],
        [1, 0.1, 0.1, 1],
        [1, 0.6, 0.2, 1],
        [0.9, 0.3, 0, 1]
      ],
      gravity: 80,
      drag: 0.5,
      turbulence: 80,
      burstCount: 700,
      speed: [100, 500],
      life: [0.5, 1.8],
      size: [3, 12]
    },
    cosmic: {
      background: [0.04, 0.02, 0.08],
      palette: [
        [0.7, 0.3, 1, 1],
        [1, 0.6, 0, 1],
        [0.3, 0.6, 1, 1],
        [1, 0.2, 0.6, 1],
        [0.5, 0.8, 1, 1],
        [1, 1, 0.3, 1]
      ],
      gravity: 5,
      drag: 0.3,
      turbulence: 150,
      burstCount: 750,
      speed: [60, 350],
      life: [0.8, 2.5],
      size: [2, 10]
    },
    ocean: {
      background: [0.02, 0.06, 0.10],
      palette: [
        [0, 0.7, 1, 1],
        [0, 1, 0.8, 1],
        [0.3, 0.8, 1, 1],
        [0, 0.9, 0.7, 1],
        [0.4, 0.6, 1, 1],
        [0.2, 1, 0.9, 1]
      ],
      gravity: -20,
      drag: 1.5,
      turbulence: 180,
      burstCount: 550,
      speed: [30, 150],
      life: [1.8, 3.8],
      size: [5, 20]
    },
    candy: {
      background: [0.08, 0.04, 0.06],
      palette: [
        [1, 0.4, 0.6, 1],
        [1, 0.7, 0.2, 1],
        [0.6, 0.4, 1, 1],
        [1, 0.5, 0.8, 1],
        [0.4, 0.9, 0.6, 1],
        [1, 0.85, 0.3, 1]
      ],
      gravity: 40,
      drag: 0.7,
      turbulence: 100,
      burstCount: 650,
      speed: [70, 320],
      life: [0.7, 2.2],
      size: [4, 16]
    }
  };

  const DENSITY_MAP = {
    low: 25000,
    medium: 50000,
    high: 100000,
    ultra: 200000
  };

  let gl = null;
  let updateProgram = null;
  let renderProgram = null;
  let transformFeedback = null;
  let currentBufferIndex = 0;
  let vaosUpdate = [null, null];
  let vaosRender = [null, null];
  let buffers = [null, null];
  let maxParticles = 100000;
  let activeParticles = 0;
  let particlePool = null;
  let spawnQueue = [];
  let alive = [];
  let theme = 'cyber';
  let time = 0;
  let ready = false;
  let reduceMotion = false;

  const ATTRIB_STRIDE = 11; // position(2) + velocity(2) + color(4) + life(1) + maxLife(1) + size(1) = 11
  // + angle(1) + spin(1) = 13 total floats per particle
  const FLOATS_PER_PARTICLE = 13;

  function init(canvas, options) {
    const contextOptions = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    };

    gl = canvas.getContext('webgl2', contextOptions);
    if (!gl) {
      console.warn('WebGL2 not available, falling back to 2D');
      return false;
    }

    if (options) {
      if (options.density && DENSITY_MAP[options.density]) {
        maxParticles = DENSITY_MAP[options.density];
      }
      if (options.theme && THEMES[options.theme]) {
        theme = options.theme;
      }
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for neon glow
    gl.disable(gl.DEPTH_TEST);

    if (!initShaders()) {
      return false;
    }

    initBuffers();
    ready = true;
    return true;
  }

  function initShaders() {
    // Update program with transform feedback
    const updateVS = compileShader(gl.VERTEX_SHADER, VERT_UPDATE);
    const dummyFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision lowp float;
      out vec4 fragColor;
      void main() { fragColor = vec4(0.0); }
    `);

    if (!updateVS || !dummyFS) return false;

    updateProgram = gl.createProgram();
    gl.attachShader(updateProgram, updateVS);
    gl.attachShader(updateProgram, dummyFS);

    gl.transformFeedbackVaryings(updateProgram, [
      'v_position', 'v_velocity', 'v_color', 'v_life', 'v_maxLife', 'v_size', 'v_angle', 'v_spin'
    ], gl.INTERLEAVED_ATTRIBS);

    gl.linkProgram(updateProgram);
    if (!gl.getProgramParameter(updateProgram, gl.LINK_STATUS)) {
      console.error('Update program link failed:', gl.getProgramInfoLog(updateProgram));
      return false;
    }

    // Render program
    const renderVS = compileShader(gl.VERTEX_SHADER, VERT_RENDER);
    const renderFS = compileShader(gl.FRAGMENT_SHADER, FRAG_RENDER);
    if (!renderVS || !renderFS) return false;

    renderProgram = gl.createProgram();
    gl.attachShader(renderProgram, renderVS);
    gl.attachShader(renderProgram, renderFS);
    gl.linkProgram(renderProgram);

    if (!gl.getProgramParameter(renderProgram, gl.LINK_STATUS)) {
      console.error('Render program link failed:', gl.getProgramInfoLog(renderProgram));
      return false;
    }

    transformFeedback = gl.createTransformFeedback();
    return true;
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function initBuffers() {
    const byteSize = maxParticles * FLOATS_PER_PARTICLE * 4;

    for (let i = 0; i < 2; i++) {
      buffers[i] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
      gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_COPY);
    }

    // Create VAOs for update pass
    for (let i = 0; i < 2; i++) {
      vaosUpdate[i] = gl.createVertexArray();
      gl.bindVertexArray(vaosUpdate[i]);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
      setupAttributes(updateProgram);
      gl.bindVertexArray(null);
    }

    // Create VAOs for render pass
    for (let i = 0; i < 2; i++) {
      vaosRender[i] = gl.createVertexArray();
      gl.bindVertexArray(vaosRender[i]);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[i]);
      setupAttributes(renderProgram);
      gl.bindVertexArray(null);
    }

    particlePool = new Float32Array(maxParticles * FLOATS_PER_PARTICLE);
    activeParticles = 0;
  }

  function setupAttributes(program) {
    const stride = FLOATS_PER_PARTICLE * 4;
    const attrs = [
      { name: 'a_position', size: 2, offset: 0 },
      { name: 'a_velocity', size: 2, offset: 8 },
      { name: 'a_color', size: 4, offset: 16 },
      { name: 'a_life', size: 1, offset: 32 },
      { name: 'a_maxLife', size: 1, offset: 36 },
      { name: 'a_size', size: 1, offset: 40 },
      { name: 'a_angle', size: 1, offset: 44 },
      { name: 'a_spin', size: 1, offset: 48 }
    ];

    for (const attr of attrs) {
      const loc = gl.getAttribLocation(program, attr.name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, stride, attr.offset);
      }
    }
  }

  function setTheme(newTheme) {
    if (THEMES[newTheme]) {
      theme = newTheme;
    }
  }

  function setDensity(density) {
    const newMax = DENSITY_MAP[density] || 100000;
    if (newMax === maxParticles) return;
    maxParticles = newMax;
    if (ready) {
      initBuffers();
      activeParticles = 0;
    }
  }

  function setReduceMotion(value) {
    reduceMotion = Boolean(value);
  }

  function spawnBurst(x, y, strength, options) {
    if (!ready) return;

    const t = THEMES[theme];
    let count = Math.round(t.burstCount * Math.max(0.1, Math.min(2, strength)));
    if (reduceMotion) count = Math.round(count * 0.35);
    if (options && options.idle) count = Math.round(count * 0.4);

    const baseHue = options && options.hue !== undefined ? options.hue : Math.random();

    for (let i = 0; i < count; i++) {
      if (activeParticles >= maxParticles) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = t.speed[0] + Math.random() * (t.speed[1] - t.speed[0]);
      const finalSpeed = speed * (options && options.idle ? 0.4 : 1);

      const colorIndex = Math.floor(Math.random() * t.palette.length);
      const color = t.palette[colorIndex];

      // Slight color variation
      const variation = 0.1;
      const r = Math.min(1, Math.max(0, color[0] + (Math.random() - 0.5) * variation));
      const g = Math.min(1, Math.max(0, color[1] + (Math.random() - 0.5) * variation));
      const b = Math.min(1, Math.max(0, color[2] + (Math.random() - 0.5) * variation));

      const life = t.life[0] + Math.random() * (t.life[1] - t.life[0]);
      const size = t.size[0] + Math.random() * (t.size[1] - t.size[0]);

      const idx = activeParticles * FLOATS_PER_PARTICLE;
      particlePool[idx] = x + (Math.random() - 0.5) * 8;      // position.x
      particlePool[idx + 1] = y + (Math.random() - 0.5) * 8;  // position.y
      particlePool[idx + 2] = Math.cos(angle) * finalSpeed;     // velocity.x
      particlePool[idx + 3] = Math.sin(angle) * finalSpeed;     // velocity.y
      particlePool[idx + 4] = r;                                 // color.r
      particlePool[idx + 5] = g;                                 // color.g
      particlePool[idx + 6] = b;                                 // color.b
      particlePool[idx + 7] = 1.0;                               // color.a
      particlePool[idx + 8] = life;                               // life
      particlePool[idx + 9] = life;                               // maxLife
      particlePool[idx + 10] = size;                              // size
      particlePool[idx + 11] = Math.random() * Math.PI * 2;      // angle
      particlePool[idx + 12] = (Math.random() - 0.5) * 4;        // spin

      activeParticles++;
    }

    uploadParticles();
  }

  function spawnTrail(x, y, dx, dy) {
    if (!ready) return;

    const t = THEMES[theme];
    const speed = Math.hypot(dx, dy);
    let count = Math.min(30, Math.max(4, Math.round(speed * 0.15)));
    if (reduceMotion) count = Math.max(2, Math.round(count * 0.4));

    for (let i = 0; i < count; i++) {
      if (activeParticles >= maxParticles) break;

      const colorIndex = Math.floor(Math.random() * t.palette.length);
      const color = t.palette[colorIndex];

      const idx = activeParticles * FLOATS_PER_PARTICLE;
      particlePool[idx] = x + (Math.random() - 0.5) * 10;
      particlePool[idx + 1] = y + (Math.random() - 0.5) * 10;
      particlePool[idx + 2] = dx * (0.8 + Math.random() * 0.8) + (Math.random() - 0.5) * 40;
      particlePool[idx + 3] = dy * (0.8 + Math.random() * 0.8) + (Math.random() - 0.5) * 40;
      particlePool[idx + 4] = color[0];
      particlePool[idx + 5] = color[1];
      particlePool[idx + 6] = color[2];
      particlePool[idx + 7] = 0.9;
      particlePool[idx + 8] = 0.2 + Math.random() * 0.5;
      particlePool[idx + 9] = particlePool[idx + 8];
      particlePool[idx + 10] = 2 + Math.random() * 6;
      particlePool[idx + 11] = Math.random() * Math.PI * 2;
      particlePool[idx + 12] = (Math.random() - 0.5) * 6;

      activeParticles++;
    }

    uploadParticles();
  }

  function uploadParticles() {
    const src = currentBufferIndex;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[src]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, particlePool.subarray(0, activeParticles * FLOATS_PER_PARTICLE));
  }

  function update(dt) {
    if (!ready || activeParticles === 0) return;

    time += dt;
    const t = THEMES[theme];

    const src = currentBufferIndex;
    const dst = 1 - src;

    gl.useProgram(updateProgram);

    gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_dt'), dt);
    gl.uniform2f(gl.getUniformLocation(updateProgram, 'u_resolution'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_gravity'), t.gravity);
    gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_drag'), t.drag);
    gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_turbulence'), reduceMotion ? t.turbulence * 0.3 : t.turbulence);
    gl.uniform1f(gl.getUniformLocation(updateProgram, 'u_time'), time);

    gl.bindVertexArray(vaosUpdate[src]);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffers[dst]);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, activeParticles);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    currentBufferIndex = dst;

    // Read back for CPU-side particle count management
    // (In production, use a fence + async readback or just track CPU-side)
    compactParticles();
  }

  function compactParticles() {
    // Decrement particle count for expired particles
    // Approximate: reduce by expected death rate
    const t = THEMES[theme];
    const avgLife = (t.life[0] + t.life[1]) / 2;
    const deathRate = activeParticles / avgLife / 60;
    activeParticles = Math.max(0, Math.round(activeParticles - deathRate));
  }

  function render() {
    if (!ready) return;

    const t = THEMES[theme];
    const bg = t.background;

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (activeParticles === 0) return;

    gl.useProgram(renderProgram);
    gl.uniform2f(gl.getUniformLocation(renderProgram, 'u_resolution'), gl.canvas.width, gl.canvas.height);

    gl.bindVertexArray(vaosRender[currentBufferIndex]);
    gl.drawArrays(gl.POINTS, 0, activeParticles);
    gl.bindVertexArray(null);
  }

  function resize(width, height, dpr) {
    if (!gl) return;
    gl.canvas.width = Math.floor(width * dpr);
    gl.canvas.height = Math.floor(height * dpr);
    gl.canvas.style.width = width + 'px';
    gl.canvas.style.height = height + 'px';
  }

  function getActiveCount() {
    return activeParticles;
  }

  function getThemeConfig() {
    return THEMES[theme];
  }

  function isReady() {
    return ready;
  }

  function destroy() {
    if (!gl) return;
    ready = false;

    for (let i = 0; i < 2; i++) {
      if (buffers[i]) gl.deleteBuffer(buffers[i]);
      if (vaosUpdate[i]) gl.deleteVertexArray(vaosUpdate[i]);
      if (vaosRender[i]) gl.deleteVertexArray(vaosRender[i]);
    }
    if (transformFeedback) gl.deleteTransformFeedback(transformFeedback);
    if (updateProgram) gl.deleteProgram(updateProgram);
    if (renderProgram) gl.deleteProgram(renderProgram);

    gl = null;
  }

  return {
    init,
    setTheme,
    setDensity,
    setReduceMotion,
    spawnBurst,
    spawnTrail,
    update,
    render,
    resize,
    getActiveCount,
    getThemeConfig,
    isReady,
    destroy,
    THEMES,
    DENSITY_MAP
  };
})();
