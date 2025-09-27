import './electric-border.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const defaultOptions = { color: '#5227FF', speed: 1, chaos: 1, thickness: 2 };
let idCounter = 0;

const createSvgElement = (tag) => document.createElementNS(SVG_NS, tag);

const beginAnimations = (animations) => {
  if (!Array.isArray(animations) || !animations.length) { return; }
  requestAnimationFrame(() => {
    animations.forEach((animation) => {
      if (animation && typeof animation.beginElement === 'function') {
        try {
          animation.beginElement();
        } catch {
          /* ignore browser failures */
        }
      }
    });
  });
};

export const attachElectricBorder = (host, options = {}) => {
  if (!(host instanceof HTMLElement)) { return null; }

  const existing = host.__electricBorder;
  if (existing && typeof existing.applyOptions === 'function') {
    existing.applyOptions(options);
    return existing.cleanup;
  }

  const state = {
    host,
    options: { ...defaultOptions, ...options },
    animations: [],
    dyAnimations: [],
    dxAnimations: [],
    observer: null,
    resizeHandler: null,
    cleaned: false,
  };

  const filterId = `electric-border-filter-${++idCounter}`;

  const layers = document.createElement('div');
  layers.className = 'eb-layers';

  const stroke = document.createElement('div');
  stroke.className = 'eb-stroke';
  layers.appendChild(stroke);

  const glow1 = document.createElement('div');
  glow1.className = 'eb-glow-1';
  layers.appendChild(glow1);

  const glow2 = document.createElement('div');
  glow2.className = 'eb-glow-2';
  layers.appendChild(glow2);

  const backgroundGlow = document.createElement('div');
  backgroundGlow.className = 'eb-background-glow';
  layers.appendChild(backgroundGlow);

  const svg = createSvgElement('svg');
  svg.classList.add('eb-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const defs = createSvgElement('defs');
  const filter = createSvgElement('filter');
  filter.setAttribute('id', filterId);
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '140%');

  const turbulence1 = createSvgElement('feTurbulence');
  turbulence1.setAttribute('type', 'turbulence');
  turbulence1.setAttribute('baseFrequency', '0.02');
  turbulence1.setAttribute('numOctaves', '10');
  turbulence1.setAttribute('result', 'noise1');
  turbulence1.setAttribute('seed', '1');
  filter.appendChild(turbulence1);

  const offset1 = createSvgElement('feOffset');
  offset1.setAttribute('in', 'noise1');
  offset1.setAttribute('dx', '0');
  offset1.setAttribute('dy', '0');
  offset1.setAttribute('result', 'offsetNoise1');
  const animateDy1 = createSvgElement('animate');
  animateDy1.setAttribute('attributeName', 'dy');
  animateDy1.setAttribute('values', '700; 0');
  animateDy1.setAttribute('dur', '6s');
  animateDy1.setAttribute('repeatCount', 'indefinite');
  animateDy1.setAttribute('calcMode', 'linear');
  offset1.appendChild(animateDy1);
  filter.appendChild(offset1);
  state.dyAnimations.push(animateDy1);

  const turbulence2 = createSvgElement('feTurbulence');
  turbulence2.setAttribute('type', 'turbulence');
  turbulence2.setAttribute('baseFrequency', '0.02');
  turbulence2.setAttribute('numOctaves', '10');
  turbulence2.setAttribute('result', 'noise2');
  turbulence2.setAttribute('seed', '1');
  filter.appendChild(turbulence2);

  const offset2 = createSvgElement('feOffset');
  offset2.setAttribute('in', 'noise2');
  offset2.setAttribute('dx', '0');
  offset2.setAttribute('dy', '0');
  offset2.setAttribute('result', 'offsetNoise2');
  const animateDy2 = createSvgElement('animate');
  animateDy2.setAttribute('attributeName', 'dy');
  animateDy2.setAttribute('values', '0; -700');
  animateDy2.setAttribute('dur', '6s');
  animateDy2.setAttribute('repeatCount', 'indefinite');
  animateDy2.setAttribute('calcMode', 'linear');
  offset2.appendChild(animateDy2);
  filter.appendChild(offset2);
  state.dyAnimations.push(animateDy2);

  const turbulence3 = createSvgElement('feTurbulence');
  turbulence3.setAttribute('type', 'turbulence');
  turbulence3.setAttribute('baseFrequency', '0.02');
  turbulence3.setAttribute('numOctaves', '10');
  turbulence3.setAttribute('result', 'noise1');
  turbulence3.setAttribute('seed', '2');
  filter.appendChild(turbulence3);

  const offset3 = createSvgElement('feOffset');
  offset3.setAttribute('in', 'noise1');
  offset3.setAttribute('dx', '0');
  offset3.setAttribute('dy', '0');
  offset3.setAttribute('result', 'offsetNoise3');
  const animateDx1 = createSvgElement('animate');
  animateDx1.setAttribute('attributeName', 'dx');
  animateDx1.setAttribute('values', '490; 0');
  animateDx1.setAttribute('dur', '6s');
  animateDx1.setAttribute('repeatCount', 'indefinite');
  animateDx1.setAttribute('calcMode', 'linear');
  offset3.appendChild(animateDx1);
  filter.appendChild(offset3);
  state.dxAnimations.push(animateDx1);

  const turbulence4 = createSvgElement('feTurbulence');
  turbulence4.setAttribute('type', 'turbulence');
  turbulence4.setAttribute('baseFrequency', '0.02');
  turbulence4.setAttribute('numOctaves', '10');
  turbulence4.setAttribute('result', 'noise2');
  turbulence4.setAttribute('seed', '2');
  filter.appendChild(turbulence4);

  const offset4 = createSvgElement('feOffset');
  offset4.setAttribute('in', 'noise2');
  offset4.setAttribute('dx', '0');
  offset4.setAttribute('dy', '0');
  offset4.setAttribute('result', 'offsetNoise4');
  const animateDx2 = createSvgElement('animate');
  animateDx2.setAttribute('attributeName', 'dx');
  animateDx2.setAttribute('values', '0; -490');
  animateDx2.setAttribute('dur', '6s');
  animateDx2.setAttribute('repeatCount', 'indefinite');
  animateDx2.setAttribute('calcMode', 'linear');
  offset4.appendChild(animateDx2);
  filter.appendChild(offset4);
  state.dxAnimations.push(animateDx2);

  const composite1 = createSvgElement('feComposite');
  composite1.setAttribute('in', 'offsetNoise1');
  composite1.setAttribute('in2', 'offsetNoise2');
  composite1.setAttribute('result', 'part1');
  filter.appendChild(composite1);

  const composite2 = createSvgElement('feComposite');
  composite2.setAttribute('in', 'offsetNoise3');
  composite2.setAttribute('in2', 'offsetNoise4');
  composite2.setAttribute('result', 'part2');
  filter.appendChild(composite2);

  const blend = createSvgElement('feBlend');
  blend.setAttribute('in', 'part1');
  blend.setAttribute('in2', 'part2');
  blend.setAttribute('mode', 'color-dodge');
  blend.setAttribute('result', 'combinedNoise');
  filter.appendChild(blend);

  const displacement = createSvgElement('feDisplacementMap');
  displacement.setAttribute('in', 'SourceGraphic');
  displacement.setAttribute('in2', 'combinedNoise');
  displacement.setAttribute('scale', '30');
  displacement.setAttribute('xChannelSelector', 'R');
  displacement.setAttribute('yChannelSelector', 'B');
  filter.appendChild(displacement);

  defs.appendChild(filter);
  svg.appendChild(defs);

  host.insertBefore(svg, host.firstChild);
  host.appendChild(layers);
  host.classList.add('electric-border');
  stroke.style.filter = `url(#${filterId})`;

  const animations = [...state.dyAnimations, ...state.dxAnimations];
  state.animations = animations;

  const updateAnimationState = () => {
    if (!host.isConnected) { return; }
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || host.clientWidth || 0));
    const height = Math.max(1, Math.round(rect.height || host.clientHeight || 0));

    if (state.dyAnimations.length >= 2) {
      state.dyAnimations[0].setAttribute('values', `${height}; 0`);
      state.dyAnimations[1].setAttribute('values', `0; -${height}`);
    }

    if (state.dxAnimations.length >= 2) {
      state.dxAnimations[0].setAttribute('values', `${width}; 0`);
      state.dxAnimations[1].setAttribute('values', `0; -${width}`);
    }

    const baseDur = 6;
    const speed = Number(state.options.speed) || defaultOptions.speed;
    const dur = Math.max(0.001, baseDur / speed);
    animations.forEach((animation) => {
      if (animation) {
        animation.setAttribute('dur', `${dur}s`);
      }
    });

    const chaos = Number(state.options.chaos) || defaultOptions.chaos;
    displacement.setAttribute('scale', String(30 * chaos));

    filter.setAttribute('x', '-200%');
    filter.setAttribute('y', '-200%');
    filter.setAttribute('width', '500%');
    filter.setAttribute('height', '500%');

    beginAnimations(animations);
  };

  state.applyOptions = (nextOptions = {}) => {
    state.options = { ...state.options, ...nextOptions };

    if (state.options.color) {
      host.style.setProperty('--electric-border-color', state.options.color);
    } else {
      host.style.removeProperty('--electric-border-color');
    }

    const thickness = Number(state.options.thickness);
    if (Number.isFinite(thickness)) {
      host.style.setProperty('--eb-border-width', `${thickness}px`);
    } else {
      host.style.removeProperty('--eb-border-width');
    }

    updateAnimationState();
  };

  if (typeof ResizeObserver === 'function') {
    state.observer = new ResizeObserver(() => updateAnimationState());
    state.observer.observe(host);
  } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    state.resizeHandler = () => updateAnimationState();
    window.addEventListener('resize', state.resizeHandler);
  }

  state.cleanup = () => {
    if (state.cleaned) { return; }
    state.cleaned = true;

    if (state.observer) {
      state.observer.disconnect();
    }
    if (state.resizeHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', state.resizeHandler);
    }

    host.classList.remove('electric-border');
    host.style.removeProperty('--electric-border-color');
    host.style.removeProperty('--eb-border-width');

    if (layers.parentNode === host) {
      host.removeChild(layers);
    }
    if (svg.parentNode === host) {
      host.removeChild(svg);
    }

    delete host.__electricBorder;
  };

  host.__electricBorder = state;

  state.applyOptions();

  return state.cleanup;
};
