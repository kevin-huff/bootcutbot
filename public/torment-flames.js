(function () {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        return;
    }

    const container = document.getElementById('tormentHeaderFlames');
    if (!container) {
        return;
    }
    if (container.dataset.flamesInitialized === 'true') {
        return;
    }
    container.dataset.flamesInitialized = 'true';

    const canvas = document.createElement('canvas');
    canvas.className = 'torment-header-flames-canvas';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const sparks = [];
    const createNoise3D = () => {
        return (x, y, z) => {
            const v1 = Math.sin(x * 1.21 + y * 1.77 + z * 1.91);
            const v2 = Math.sin(x * 0.67 + y * 2.13 + z * 0.43 + Math.sin(x - z * 0.7));
            return (v1 + v2) * 0.5;
        };
    };
    const noise = createNoise3D();

    const randomBetween = (min, max) => min + Math.random() * (max - min);
    const createSpark = (center = 0.5, spread = 0.02) => ({
        x: randomBetween(center - spread, center + spread),
        y: 1,
        vx: randomBetween(-0.05, 0.05),
        vy: randomBetween(0.85, 1.25),
        size: randomBetween(0.9, 1.8),
        life: 0,
        maxLife: randomBetween(0.5, 1.0)
    });

    const CANDLE_POSITIONS = [
        { center: 0.18, sparkCenter: 0.18, sparkSpread: 0.02 },
        { center: 0.82, sparkCenter: 0.82, sparkSpread: 0.02 }
    ];

    const CANDLE_LAYERS = [
        {
            amplitude: 0.35,
            width: 0.075,
            gradientHeight: 0.48,
            blur: 28,
            colorStops: [
                [0, 'rgba(255, 60, 0, 0.18)'],
                [0.45, 'rgba(255, 110, 25, 0.28)'],
                [1, 'rgba(255, 160, 50, 0)']
            ],
            noiseScale: 2.0,
            speed: 0.26,
            step: 4
        },
        {
            amplitude: 0.3,
            width: 0.055,
            gradientHeight: 0.38,
            blur: 14,
            colorStops: [
                [0, 'rgba(255, 110, 30, 0.45)'],
                [0.4, 'rgba(255, 156, 60, 0.55)'],
                [0.75, 'rgba(255, 208, 120, 0.38)'],
                [1, 'rgba(255, 220, 160, 0)']
            ],
            noiseScale: 2.6,
            speed: 0.34,
            step: 3
        },
        {
            amplitude: 0.24,
            width: 0.035,
            gradientHeight: 0.26,
            blur: 6,
            colorStops: [
                [0, 'rgba(255, 190, 120, 0.62)'],
                [0.35, 'rgba(255, 230, 190, 0.78)'],
                [0.7, 'rgba(255, 255, 240, 0.62)'],
                [1, 'rgba(255, 255, 255, 0)']
            ],
            noiseScale: 3.1,
            speed: 0.46,
            step: 2
        }
    ];

    let frameId = null;
    let lastTime = performance.now();

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

    const render = (time) => {
        const dt = Math.min(0.05, (time - lastTime) / 1000 || 0.016);
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        lastTime = time;

        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, width, height);

        const baseGradient = ctx.createLinearGradient(0, height, 0, height * 0.45);
        baseGradient.addColorStop(0, 'rgba(12, 0, 0, 0.45)');
        baseGradient.addColorStop(0.6, 'rgba(36, 8, 0, 0.22)');
        baseGradient.addColorStop(1, 'rgba(60, 20, 0, 0)');
        ctx.fillStyle = baseGradient;
        ctx.fillRect(0, 0, width, height);

        ctx.globalCompositeOperation = 'lighter';
        const timeSeconds = time / 1000;

        CANDLE_POSITIONS.forEach((candle, candleIndex) => {
            CANDLE_LAYERS.forEach((layer, layerIndex) => {
                ctx.save();
                if (layer.blur) {
                    ctx.filter = `blur(${layer.blur}px)`;
                }

                ctx.beginPath();
                const centerX = candle.center * width;
                const flameWidth = layer.width * width;

                ctx.moveTo(centerX - flameWidth, height);

                for (let i = 0; i <= 20; i++) {
                    const t = i / 20;
                    const y = height - (t * layer.gradientHeight * height);
                    const shapeWidth = flameWidth * (1 - t * t * 0.82);
                    const noiseValue = noise(
                        candleIndex * 100 + layerIndex * 10 + t * layer.noiseScale,
                        timeSeconds * layer.speed,
                        0
                    );
                    const wobble = noiseValue * layer.amplitude * 0.1 * width * (1 - t * 0.55);
                    ctx.lineTo(centerX - shapeWidth + wobble, y);
                }

                const topNoise = noise(
                    candleIndex * 100 + layerIndex * 10 + 99,
                    timeSeconds * layer.speed * 1.2,
                    0
                );
                const topWobble = topNoise * layer.amplitude * 0.16 * width;
                ctx.lineTo(centerX + topWobble, height - layer.gradientHeight * height);

                for (let i = 20; i >= 0; i--) {
                    const t = i / 20;
                    const y = height - (t * layer.gradientHeight * height);
                    const shapeWidth = flameWidth * (1 - t * t * 0.82);
                    const noiseValue = noise(
                        candleIndex * 100 + layerIndex * 10 + t * layer.noiseScale,
                        timeSeconds * layer.speed,
                        1
                    );
                    const wobble = noiseValue * layer.amplitude * 0.1 * width * (1 - t * 0.55);
                    ctx.lineTo(centerX + shapeWidth + wobble, y);
                }

                ctx.lineTo(centerX + flameWidth, height);
                ctx.closePath();

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

        ctx.globalCompositeOperation = 'screen';
        CANDLE_POSITIONS.forEach(({ sparkCenter, sparkSpread }) => {
            if (sparks.length < 36 && Math.random() < 0.18) {
                sparks.push(createSpark(sparkCenter, sparkSpread));
            }
        });

        for (let i = sparks.length - 1; i >= 0; i--) {
            const spark = sparks[i];
            spark.life += dt;
            spark.y -= spark.vy * dt;
            spark.x += spark.vx * dt;
            spark.vy *= 0.985;

            const lifeRatio = spark.life / spark.maxLife;
            if (lifeRatio >= 1 || spark.y < -0.1) {
                sparks.splice(i, 1);
                continue;
            }

            const radius = spark.size * (1 - lifeRatio * 0.8);
            ctx.beginPath();
            ctx.fillStyle = `rgba(255, ${Math.floor(200 + 50 * (1 - lifeRatio))}, ${Math.floor(150 + 80 * (1 - lifeRatio))}, ${0.7 - lifeRatio * 0.6})`;
            ctx.shadowColor = 'rgba(255, 180, 100, 0.45)';
            ctx.shadowBlur = 6;
            ctx.arc(spark.x * width, spark.y * height, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.shadowBlur = 0;
        frameId = requestAnimationFrame(render);
    };

    const handleResize = () => {
        resize();
    };

    const handleVisibility = () => {
        if (document.hidden && frameId) {
            cancelAnimationFrame(frameId);
            frameId = null;
        } else if (!document.hidden && !frameId) {
            lastTime = performance.now();
            frameId = requestAnimationFrame(render);
        }
    };

    resize();
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
    frameId = requestAnimationFrame(render);

    window.addEventListener('beforeunload', () => {
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', handleVisibility);
        if (frameId) {
            cancelAnimationFrame(frameId);
        }
    });
})();
