import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createNoise3D } from 'simplex-noise';

const normalizeBreakawayId = (rawId) => {
  if (rawId === undefined || rawId === null) {
    return '';
  }
  const maybeNumber = Number(rawId);
  return Number.isNaN(maybeNumber) ? String(rawId) : String(maybeNumber);
};

const toBreakawayRecord = (raw = {}) => {
  const id = normalizeBreakawayId(raw.id);
  const dotsSource = raw.ba_dots ?? raw.ba_dot ?? 0;
  const dots = Number(dotsSource);
  return {
    id,
    name: raw.name ?? '',
    ba_dots: Number.isNaN(dots) ? 0 : dots,
  };
};

const usePrefersReducedMotion = () => {
  const getPreference = () => (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const [prefers, setPrefers] = useState(getPreference);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setPrefers(media.matches);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  return prefers;
};

const PrismBackground = () => {
  const reducedMotion = usePrefersReducedMotion();
  const ReactBitsGlobal = window.ReactBits || window.reactbits || {};
  const PrismComponent = ReactBitsGlobal.Prism || ReactBitsGlobal.Backgrounds?.Prism || window.Prism || null;

  useEffect(() => {
    if (!PrismComponent) {
      console.warn('ReactBits Prism component not found. Confirm the UMD bundle is loaded before the board bundle.');
    }
  }, [PrismComponent]);

  if (reducedMotion || !PrismComponent) {
    return null;
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: 'none'
      }}
    >
      <PrismComponent
        animationType="rotate"
        timeScale={0.5}
        height={3.5}
        baseWidth={5.5}
        scale={3.6}
        hueShift={0}
        colorFrequency={1}
        noise={0.5}
        glow={1}
      />
    </div>
  );
};

const BreakawayLabel = ({ children }) => (
  <span className="breakaway-label">{children}</span>
);

const BreakawayCard = ({ item }) => (
  <div className="breakaway-col" id={`breakaway_${item.id}`}>
    <div className="breakaway-content">
      <div className="breakaway-header">
        <BreakawayLabel>Breakaways</BreakawayLabel>
        <h3>
          <span id={`breakawayName_${item.id}`}>{item.name}</span>
        </h3>
      </div>
      <div className="breakaway-counter">
        <div className="counter-circle">
          <strong id={`ba_dot_${item.id}`}>{item.ba_dots}</strong>
        </div>
      </div>
    </div>
  </div>
);

const BreakawayEmpty = () => (
  <div className="breakaway-empty" role="status">No breakaways yet</div>
);

const BreakawayRibbon = ({ items }) => {
  if (!items || items.length === 0) {
    return <BreakawayEmpty />;
  }

  return (
    <React.Fragment>
      {items.map((item) => (
        <BreakawayCard item={item} key={item.id} />
      ))}
    </React.Fragment>
  );
};

const randomBetween = (min, max) => min + Math.random() * (max - min);

const createSpark = (center = 0.5, spread = 0.02) => ({
  x: randomBetween(center - spread, center + spread),
  y: 1,
  vx: randomBetween(-0.05, 0.05),
  vy: randomBetween(0.8, 1.2),
  size: randomBetween(0.8, 1.8),
  life: 0,
  maxLife: randomBetween(0.5, 1.0)
});

// Candle flame positions - far left and far right
const CANDLE_POSITIONS = [
  { center: 0.15, sparkCenter: 0.15, sparkSpread: 0.015 }, // Left candle
  { center: 0.85, sparkCenter: 0.85, sparkSpread: 0.015 }  // Right candle
];

// Simplified layers for candle-like appearance
const CANDLE_LAYERS = [
  {
    // Outer glow layer
    amplitude: 0.35,
    baseHeight: 0.08,
    width: 0.06,
    gradientHeight: 0.45,
    blur: 25,
    colorStops: [
      [0, 'rgba(255, 60, 0, 0.2)'],
      [0.5, 'rgba(255, 100, 20, 0.3)'],
      [1, 'rgba(255, 140, 40, 0)']
    ],
    noiseScale: 2.0,
    speed: 0.25,
    step: 4
  },
  {
    // Middle flame layer
    amplitude: 0.3,
    baseHeight: 0.06,
    width: 0.045,
    gradientHeight: 0.35,
    blur: 12,
    colorStops: [
      [0, 'rgba(255, 100, 20, 0.5)'],
      [0.4, 'rgba(255, 150, 50, 0.6)'],
      [0.75, 'rgba(255, 200, 100, 0.4)'],
      [1, 'rgba(255, 220, 150, 0)']
    ],
    noiseScale: 2.5,
    speed: 0.35,
    step: 3
  },
  {
    // Inner hot core
    amplitude: 0.25,
    baseHeight: 0.04,
    width: 0.03,
    gradientHeight: 0.25,
    blur: 6,
    colorStops: [
      [0, 'rgba(255, 180, 100, 0.7)'],
      [0.3, 'rgba(255, 220, 180, 0.8)'],
      [0.7, 'rgba(255, 255, 230, 0.6)'],
      [1, 'rgba(255, 255, 255, 0)']
    ],
    noiseScale: 3.0,
    speed: 0.45,
    step: 2
  }
];

const BrandFlames = () => {
  const reducedMotion = usePrefersReducedMotion();
  const canvasRef = useRef(null);
  const sparksRef = useRef([]);
  const noiseRef = useRef(createNoise3D());

  useEffect(() => {
    if (reducedMotion) {
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    const noiseFn = noiseRef.current;

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    let frameId;
    let lastTime = performance.now();

    const render = (time) => {
      const dt = Math.min(0.05, (time - lastTime) / 1000 || 0.016);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      lastTime = time;

      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);

      // Subtle base gradient for ambiance
      const baseGradient = ctx.createLinearGradient(0, height, 0, height * 0.5);
      baseGradient.addColorStop(0, 'rgba(10, 2, 0, 0.4)');
      baseGradient.addColorStop(0.5, 'rgba(30, 8, 0, 0.2)');
      baseGradient.addColorStop(1, 'rgba(60, 20, 0, 0)');
      ctx.fillStyle = baseGradient;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'lighter';

      const timeSeconds = time / 1000;
      
      // Render each candle flame
      CANDLE_POSITIONS.forEach((candle, candleIndex) => {
        CANDLE_LAYERS.forEach((layer, layerIndex) => {
          ctx.save();
          if (layer.blur) {
            ctx.filter = `blur(${layer.blur}px)`;
          }
          
          ctx.beginPath();
          
          // Create teardrop/candle flame shape
          const centerX = candle.center * width;
          const flameWidth = layer.width * width;
          const step = layer.step || 3;
          
          // Start from bottom left of flame
          ctx.moveTo(centerX - flameWidth, height);
          
          // Left side of flame (going up)
          for (let i = 0; i <= 20; i++) {
            const t = i / 20; // 0 to 1 from bottom to top
            const y = height - (t * layer.gradientHeight * height);
            
            // Teardrop shape - wider at bottom, pointed at top
            const shapeWidth = flameWidth * (1 - t * t * 0.8);
            
            // Add noise for organic movement
            const noiseValue = noiseFn(
              candleIndex * 100 + layerIndex * 10 + t * layer.noiseScale,
              timeSeconds * layer.speed,
              0
            );
            const wobble = noiseValue * layer.amplitude * 0.1 * width * (1 - t * 0.5);
            
            ctx.lineTo(centerX - shapeWidth + wobble, y);
          }
          
          // Top point of flame
          const topNoise = noiseFn(
            candleIndex * 100 + layerIndex * 10 + 99,
            timeSeconds * layer.speed * 1.2,
            0
          );
          const topWobble = topNoise * layer.amplitude * 0.15 * width;
          ctx.lineTo(centerX + topWobble, height - layer.gradientHeight * height);
          
          // Right side of flame (going down)
          for (let i = 20; i >= 0; i--) {
            const t = i / 20;
            const y = height - (t * layer.gradientHeight * height);
            
            const shapeWidth = flameWidth * (1 - t * t * 0.8);
            
            const noiseValue = noiseFn(
              candleIndex * 100 + layerIndex * 10 + t * layer.noiseScale,
              timeSeconds * layer.speed,
              1
            );
            const wobble = noiseValue * layer.amplitude * 0.1 * width * (1 - t * 0.5);
            
            ctx.lineTo(centerX + shapeWidth + wobble, y);
          }
          
          // Close at bottom right
          ctx.lineTo(centerX + flameWidth, height);
          ctx.closePath();

          // Create gradient for this flame
          const gradient = ctx.createLinearGradient(
            centerX, 
            height, 
            centerX, 
            height * (1 - layer.gradientHeight)
          );
          layer.colorStops.forEach(([stop, color]) => gradient.addColorStop(stop, color));

          ctx.fillStyle = gradient;
          ctx.fill();
          ctx.restore();
        });
      });

      // Sparks/embers
      ctx.globalCompositeOperation = 'screen';

      const sparks = sparksRef.current;
      CANDLE_POSITIONS.forEach(({ sparkCenter, sparkSpread }) => {
        if (sparks.length < 30 && Math.random() < 0.15) {
          sparks.push(createSpark(sparkCenter, sparkSpread));
        }
      });

      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i];
        spark.life += dt;
        spark.y -= spark.vy * dt;
        spark.x += spark.vx * dt;
        spark.vy *= 0.98; // Slow down over time

        const lifeRatio = spark.life / spark.maxLife;
        if (lifeRatio >= 1 || spark.y < -0.1) {
          sparks.splice(i, 1);
          continue;
        }

        const radius = spark.size * (1 - lifeRatio * 0.8);
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, ${Math.floor(200 + 50 * (1 - lifeRatio))}, ${Math.floor(150 + 80 * (1 - lifeRatio))}, ${0.8 - lifeRatio * 0.7})`;
        ctx.shadowColor = 'rgba(255, 180, 100, 0.5)';
        ctx.shadowBlur = 6;
        ctx.arc(spark.x * width, spark.y * height, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
  }, [reducedMotion]);

  if (reducedMotion) {
    return null;
  }

  return <canvas ref={canvasRef} className="brand-lockup-flames-canvas" aria-hidden="true" />;
};

const getInitialBreakaways = () => {
  if (window.breakawayDataMap instanceof Map) {
    return Array.from(window.breakawayDataMap.values()).map(toBreakawayRecord);
  }

  if (Array.isArray(window.__BREAKAWAYS__)) {
    return window.__BREAKAWAYS__.map(toBreakawayRecord);
  }

  return [];
};

const ensureBreakawayMap = (items) => {
  if (!(window.breakawayDataMap instanceof Map)) {
    window.breakawayDataMap = new Map();
  }

  if (Array.isArray(items)) {
    window.breakawayDataMap.clear();
    items.forEach((item) => {
      const record = toBreakawayRecord(item);
      if (!record.id) { return; }
      window.breakawayDataMap.set(record.id, record);
    });
  }
};

let boardBackgroundRootElement = null;
let breakawayRootElement = null;
let brandFlamesRootElement = null;
let prismRoot = null;
let breakawayRoot = null;
let brandFlamesRoot = null;

function ensurePrismRoot() {
  if (!boardBackgroundRootElement) {
    boardBackgroundRootElement = document.getElementById('board-background-root');
  }
  if (!boardBackgroundRootElement) { return null; }
  if (!prismRoot) {
    prismRoot = ReactDOM.createRoot(boardBackgroundRootElement);
  }
  return prismRoot;
}

function ensureBreakawayRoot() {
  if (!breakawayRootElement) {
    breakawayRootElement = document.getElementById('breakaway-react-root');
  }
  if (!breakawayRootElement) { return null; }
  if (!breakawayRoot) {
    breakawayRoot = ReactDOM.createRoot(breakawayRootElement);
  }
  return breakawayRoot;
}

function ensureBrandFlamesRoot() {
  if (!brandFlamesRootElement) {
    brandFlamesRootElement = document.getElementById('brand-lockup-flames');
  }
  if (!brandFlamesRootElement) { return null; }
  if (!brandFlamesRoot) {
    brandFlamesRoot = ReactDOM.createRoot(brandFlamesRootElement);
  }
  return brandFlamesRoot;
}

function renderPrismBackground() {
  const root = ensurePrismRoot();
  if (!root) { return; }
  root.render(<PrismBackground />);
}

function renderBreakawayRibbon(items) {
  const root = ensureBreakawayRoot();
  if (!root) { return; }
  const safeItems = Array.isArray(items) ? items.slice() : [];
  const normalizedItems = safeItems
    .map(toBreakawayRecord)
    .filter((record) => Boolean(record.id));
  ensureBreakawayMap(normalizedItems);
  root.render(<BreakawayRibbon items={normalizedItems} />);
  if (typeof window.fitCurrentPlayer === 'function') {
    window.fitCurrentPlayer();
  }
}

function renderBrandFlames() {
  const root = ensureBrandFlamesRoot();
  if (!root) { return; }
  root.render(<BrandFlames />);
}

window.renderPrismBackground = renderPrismBackground;
window.renderBreakawayRibbon = renderBreakawayRibbon;

const initialRibbonItems = window.breakawayDataMap ? Array.from(window.breakawayDataMap.values()) : [];

const bootstrapReactBits = () => {
  renderPrismBackground();
  renderBreakawayRibbon(initialRibbonItems);
  renderBrandFlames();
  refreshElectricBorderSpots();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapReactBits, { once: true });
} else {
  bootstrapReactBits();
}
