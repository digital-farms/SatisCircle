// ============================================
// BALL ESCAPE - TikTok Live Game
// Кастомный рендер на Matter.js
// ============================================

// Matter.js модули
const Engine = Matter.Engine;
const World = Matter.World;
const Bodies = Matter.Bodies;
const Body = Matter.Body;
const Composite = Matter.Composite;
const Events = Matter.Events;
const Vector = Matter.Vector;

// ============ НАСТРОЙКИ ИГРЫ ============
const ASPECT_RATIO = 4 / 3;
const BALL_RADIUS = 22; // Побольше шарики
const TRAP_RADIUS = 320; // Ещё больше ловушка
const TRAP_SEGMENTS = 60; // Больше сегментов для точности
const TRAP_GAP = 3; // Маленькая дырка
const TRAP_ROTATION_SPEED = 0.005;
const TRAIL_LENGTH = 15;
const PARTICLE_LIFETIME = 500; // мс
const VICTORY_DELAY = 5000; // 5 секунд до рестарта
const SPEED_MULTIPLIER = 2.0; // Множитель скорости для OBS (1.0 = норма, 1.5 = на 50% быстрее)
const FREEZE_DURATION = 5000; // Длительность заморозки в мс (5 секунд)
const FREEZE_GIFT = "You're Amazing"; // Название подарка для заморозки
// ========================================

// Глобальные переменные
let canvas, ctx;
let engine, world;
let trap = null;
let balls = [];
let particles = [];
let totalBallsSpawned = 0;
let gameState = 'playing'; // 'playing', 'victory', 'restarting'
let winner = null;
let victoryTimer = null;
let dpr = 1;
let canvasWidth, canvasHeight;

// Демо режим
let demoMode = true;
let demoBalls = [];
const DEMO_BALL_COUNT = 5;
const DEMO_NAMES = ['Player1', 'Gamer', 'Star', 'Lucky', 'Winner'];

// Динамика ловушки
let trapSpeed = TRAP_ROTATION_SPEED;
let trapDirection = 1;
let lastSpeedChange = 0;
const SPEED_CHANGE_INTERVAL = 8000; // Каждые 8 секунд

// Эффект ряби при ударах
let ripples = [];

// Аудио контекст для звуков
let audioCtx = null;
let lastSoundTime = 0;
const SOUND_COOLDOWN = 50; // Минимум 50мс между звуками

// Кэш аватарок
const avatarCache = new Map();

// Socket.io
const socket = io();

// ============ ИНИЦИАЛИЗАЦИЯ ============
function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    
    // High DPI поддержка
    dpr = window.devicePixelRatio || 1;
    
    // Размеры канваса (4:3)
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Создаём физический движок
    engine = Engine.create();
    world = engine.world;
    
    // Гравитация (очень слабая)
    engine.world.gravity.y = 0.2;
    engine.world.gravity.x = 0;
    
    // Создаём границы (без нижней)
    createBoundaries();
    
    // Создаём ловушку
    createTrap();
    
    // Обработка коллизий
    Events.on(engine, 'collisionStart', handleCollision);
    
    // Socket события
    setupSocketEvents();
    
    // Запуск игрового цикла
    gameLoop();
}

function resizeCanvas() {
    const container = document.getElementById('game-container');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // Вычисляем размер с учётом соотношения 4:3
    let width, height;
    if (containerWidth / containerHeight > ASPECT_RATIO) {
        height = containerHeight;
        width = height * ASPECT_RATIO;
    } else {
        width = containerWidth;
        height = width / ASPECT_RATIO;
    }
    
    canvasWidth = width;
    canvasHeight = height;
    
    // Устанавливаем размер канваса с учётом DPI
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    
    // Масштабируем контекст
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ============ ГРАНИЦЫ МИРА ============
function createBoundaries() {
    const thickness = 50;
    const wallOptions = {
        isStatic: true,
        friction: 0.3,
        restitution: 0.5,
        label: 'wall'
    };
    
    // Левая стена
    const leftWall = Bodies.rectangle(
        -thickness / 2, 
        canvasHeight / 2, 
        thickness, 
        canvasHeight * 2, 
        wallOptions
    );
    
    // Правая стена
    const rightWall = Bodies.rectangle(
        canvasWidth + thickness / 2, 
        canvasHeight / 2, 
        thickness, 
        canvasHeight * 2, 
        wallOptions
    );
    
    // Верхняя стена
    const topWall = Bodies.rectangle(
        canvasWidth / 2, 
        -thickness / 2, 
        canvasWidth * 2, 
        thickness, 
        wallOptions
    );
    
    World.add(world, [leftWall, rightWall, topWall]);
}

// ============ ЛОВУШКА (КОЛЬЦО) ============
function createTrap() {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const segmentCount = TRAP_SEGMENTS;
    
    const segments = [];
    const angleStep = (Math.PI * 2) / segmentCount;
    const segmentLength = (2 * Math.PI * TRAP_RADIUS) / segmentCount * 1.1;
    const segmentWidth = 8;
    
    // Создаём все сегменты кроме разрыва
    for (let i = 0; i < segmentCount; i++) {
        // Пропускаем сегменты в разрыве (внизу)
        if (i >= segmentCount - TRAP_GAP) continue;
        
        const angle = i * angleStep - Math.PI / 2; // Начинаем сверху
        const x = centerX + Math.cos(angle) * TRAP_RADIUS;
        const y = centerY + Math.sin(angle) * TRAP_RADIUS;
        
        const segment = Bodies.rectangle(x, y, segmentLength, segmentWidth, {
            isStatic: true,
            angle: angle + Math.PI / 2,
            friction: 0.1,
            restitution: 0.8,
            label: 'trap',
            render: { visible: false }
        });
        
        segment.trapIndex = i;
        segments.push(segment);
    }
    
    // Сохраняем данные ловушки
    trap = {
        centerX: centerX,
        centerY: centerY,
        angle: 0,
        segments: segments
    };
    
    World.add(world, segments);
}

function rotateTrap() {
    if (!trap || gameState !== 'playing') return;
    
    // Динамическое изменение скорости и направления
    const now = Date.now();
    if (now - lastSpeedChange > SPEED_CHANGE_INTERVAL) {
        lastSpeedChange = now;
        
        // Случайно меняем направление (30% шанс)
        if (Math.random() < 0.3) {
            trapDirection *= -1;
        }
        
        // Случайная скорость от 0.5x до 1.5x базовой
        trapSpeed = TRAP_ROTATION_SPEED * (0.5 + Math.random());
    }
    
    trap.angle += trapSpeed * trapDirection;
    
    const centerX = trap.centerX;
    const centerY = trap.centerY;
    const angleStep = (Math.PI * 2) / TRAP_SEGMENTS;
    
    trap.segments.forEach((segment, idx) => {
        // Вычисляем базовый угол для этого сегмента
        const baseAngle = segment.trapIndex * angleStep - Math.PI / 2;
        const angle = baseAngle + trap.angle;
        
        const x = centerX + Math.cos(angle) * TRAP_RADIUS;
        const y = centerY + Math.sin(angle) * TRAP_RADIUS;
        
        Body.setPosition(segment, { x, y });
        Body.setAngle(segment, angle + Math.PI / 2);
    });
}

function removeTrap() {
    if (!trap) return;
    
    trap.segments.forEach(segment => {
        World.remove(world, segment);
    });
    trap = null;
}

// ============ ДЕМО РЕЖИМ ============
function startDemoMode() {
    if (!demoMode || balls.length > 0) return;
    
    // Создаём демо-шарики
    for (let i = 0; i < DEMO_BALL_COUNT; i++) {
        createDemoBall(i);
    }
}

function createDemoBall(index) {
    const x = canvasWidth / 2 + (Math.random() - 0.5) * 100;
    const y = canvasHeight / 2 + (Math.random() - 0.5) * 100;
    
    const neonColors = ['#ff00ff', '#00ffff', '#ffff00', '#ff6600', '#00ff66'];
    
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
        restitution: 0.95,
        friction: 0.001,
        frictionAir: 0.0005,
        label: 'demoBall'
    });
    
    ball.customData = {
        nickname: DEMO_NAMES[index % DEMO_NAMES.length],
        color: neonColors[index % neonColors.length],
        trail: [],
        isDemo: true
    };
    
    // Начальный импульс
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 3;
    Body.setVelocity(ball, {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
    });
    
    demoBalls.push(ball);
    World.add(world, ball);
}

function clearDemoMode() {
    demoBalls.forEach(ball => {
        World.remove(world, ball);
    });
    demoBalls = [];
    demoMode = false;
}

// ============ ШАРИКИ ============
function createBall(data) {
    if (gameState !== 'playing') return;
    
    // Убираем демо-шарики при первом реальном игроке
    if (demoMode && demoBalls.length > 0) {
        clearDemoMode();
    }
    
    // Спавн в центре ловушки с небольшим разбросом
    const x = canvasWidth / 2 + (Math.random() - 0.5) * 80;
    const y = canvasHeight / 2 + (Math.random() - 0.5) * 80;
    
    const ball = Bodies.circle(x, y, BALL_RADIUS, {
        restitution: 0.95, // Более упругие
        friction: 0.001,
        frictionAir: 0.0005, // Меньше сопротивление воздуха
        label: 'ball'
    });
    
    // Кастомные данные
    ball.customData = {
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        avatarUrl: data.avatarUrl,
        color: data.color,
        trail: [],
        avatarLoaded: false,
        avatarImage: null
    };
    
    // Предзагрузка аватарки
    if (data.avatarUrl) {
        loadAvatar(ball, data.avatarUrl);
    }
    
    // Начальный импульс в случайном направлении
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 3;
    Body.setVelocity(ball, {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
    });
    
    World.add(world, ball);
    balls.push(ball);
    totalBallsSpawned++;
    
    // Звук появления
    playSpawnSound();
    
    updatePlayerCount();
}

function loadAvatar(ball, url) {
    // Проверяем кэш
    if (avatarCache.has(url)) {
        ball.customData.avatarImage = avatarCache.get(url);
        ball.customData.avatarLoaded = true;
        return;
    }
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        ball.customData.avatarImage = img;
        ball.customData.avatarLoaded = true;
        avatarCache.set(url, img);
    };
    img.onerror = () => {
        ball.customData.avatarLoaded = false;
    };
    // Используем прокси для обхода CORS
    img.src = '/avatar?url=' + encodeURIComponent(url);
}

function removeBall(ball) {
    const index = balls.indexOf(ball);
    if (index > -1) {
        balls.splice(index, 1);
        World.remove(world, ball);
        updatePlayerCount();
    }
}

function updatePlayerCount() {
    // Счётчик убран из UI
}

// ============ ЗАМОРОЗКА ШАРИКОВ ============
function freezeBalls(uniqueId) {
    // Находим все шарики этого игрока
    const playerBalls = balls.filter(ball => ball.customData && ball.customData.uniqueId === uniqueId);
    
    if (playerBalls.length === 0) return;
    
    playerBalls.forEach(ball => {
        // Сохраняем текущую скорость
        ball.customData.savedVelocity = { ...ball.velocity };
        ball.customData.frozen = true;
        ball.customData.freezeEnd = Date.now() + FREEZE_DURATION;
        
        // Останавливаем шарик
        Body.setVelocity(ball, { x: 0, y: 0 });
        Body.setStatic(ball, true);
    });
    
    console.log(`❄️ Заморожено ${playerBalls.length} шариков игрока`);
    
    // Звук заморозки
    playFreezeSound();
}

function updateFrozenBalls() {
    const now = Date.now();
    
    balls.forEach(ball => {
        if (ball.customData && ball.customData.frozen && now >= ball.customData.freezeEnd) {
            // Размораживаем
            ball.customData.frozen = false;
            Body.setStatic(ball, false);
            
            // Восстанавливаем скорость или даём новую
            const savedVel = ball.customData.savedVelocity;
            if (savedVel) {
                Body.setVelocity(ball, savedVel);
            } else {
                const angle = Math.random() * Math.PI * 2;
                Body.setVelocity(ball, { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 });
            }
            
            console.log(`🔥 Шарик разморожен`);
        }
    });
}

function playFreezeSound() {
    try {
        const ctx = initAudio();
        if (ctx.state === 'suspended') ctx.resume();
        
        const currentTime = ctx.currentTime;
        
        // Ледяной звук - нисходящий
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, currentTime + 0.3);
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.2, currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.4);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        // Реверб
        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.5;
        gain.connect(wetGain);
        wetGain.connect(reverbNode);
        reverbNode.connect(ctx.destination);
        
        osc.start(currentTime);
        osc.stop(currentTime + 0.5);
    } catch (e) {}
}

// ============ ПАРТИКЛЫ ============
function createParticles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
        const speed = 2 + Math.random() * 4;
        
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 2 + Math.random() * 4,
            color: color,
            alpha: 1,
            createdAt: Date.now()
        });
    }
}

function updateParticles() {
    const now = Date.now();
    
    particles = particles.filter(p => {
        const age = now - p.createdAt;
        if (age > PARTICLE_LIFETIME) return false;
        
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1; // Гравитация
        p.alpha = 1 - (age / PARTICLE_LIFETIME);
        p.radius *= 0.98;
        
        return true;
    });
}

// ============ КОЛЛИЗИИ ============
function handleCollision(event) {
    event.pairs.forEach(pair => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        
        // Проверяем столкновение шарика с чем-либо
        let ball = null;
        let other = null;
        
        if (bodyA.label === 'ball' || bodyA.label === 'demoBall') {
            ball = bodyA;
            other = bodyB;
        } else if (bodyB.label === 'ball' || bodyB.label === 'demoBall') {
            ball = bodyB;
            other = bodyA;
        }
        
        if (ball && ball.customData) {
            // Создаём партиклы при столкновении
            const contactPoint = pair.collision.supports[0] || ball.position;
            createParticles(
                contactPoint.x, 
                contactPoint.y, 
                ball.customData.color,
                6
            );
            
            // Если столкновение с ловушкой - создаём рябь и звук
            if (other && other.label === 'trap') {
                // Вычисляем силу удара
                const velocity = ball.velocity;
                const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
                
                // Создаём рябь и звук только если удар достаточно сильный
                if (speed > 1.5) {
                    createRipple(contactPoint.x, contactPoint.y, speed, ball.customData.color);
                    playCrystalSound(speed);
                }
            }
        }
    });
}

// ============ ЭФФЕКТ РЯБИ ============
let lastRippleTime = 0;
const RIPPLE_COOLDOWN = 100; // Минимум 100мс между рябью

function createRipple(x, y, strength, color) {
    const now = Date.now();
    
    // Ограничиваем частоту создания ряби
    if (now - lastRippleTime < RIPPLE_COOLDOWN) return;
    if (ripples.length >= 3) return; // Максимум 3 одновременно
    
    lastRippleTime = now;
    
    ripples.push({
        x: x,
        y: y,
        radius: TRAP_RADIUS,
        maxRadius: TRAP_RADIUS + 20 + strength * 5, // Размер зависит от силы удара
        alpha: 0.35 + Math.min(strength * 0.05, 0.15), // Чуть ярче
        color: color,
        createdAt: now,
        duration: 300 // Фиксированная короткая длительность
    });
}

// ============ КРИСТАЛЛИЧЕСКИЙ ЗВУК ============
let reverbNode = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        createReverb();
    }
    return audioCtx;
}

function createReverb() {
    // Создаём convolver для реверба
    reverbNode = audioCtx.createConvolver();
    
    // Генерируем импульсный отклик для большого пространства
    const sampleRate = audioCtx.sampleRate;
    const length = sampleRate * 2; // 2 секунды реверба
    const impulse = audioCtx.createBuffer(2, length, sampleRate);
    
    for (let channel = 0; channel < 2; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            // Экспоненциальное затухание с шумом
            channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
        }
    }
    
    reverbNode.buffer = impulse;
}

function playCrystalSound(strength) {
    const now = Date.now();
    if (now - lastSoundTime < SOUND_COOLDOWN) return;
    lastSoundTime = now;
    
    try {
        const ctx = initAudio();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        
        const currentTime = ctx.currentTime;
        
        // Рандомная базовая частота (кристаллические ноты - ещё ниже)
        const baseFrequencies = [131, 147, 165, 175, 196, 220, 247, 262]; // C3-C4
        const baseFreq = baseFrequencies[Math.floor(Math.random() * baseFrequencies.length)];
        
        // Небольшая вариация частоты
        const freq = baseFreq * (0.95 + Math.random() * 0.1);
        
        // Громкость зависит от силы удара
        const volume = Math.min(0.1 + strength * 0.015, 0.2);
        
        // Основной тон - треугольная волна
        const osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, currentTime);
        osc1.frequency.exponentialRampToValueAtTime(freq * 1.2, currentTime + 0.01);
        osc1.frequency.exponentialRampToValueAtTime(freq * 0.9, currentTime + 0.1);
        
        // Щелчок удара - высокая частота, очень короткий
        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(2000 + Math.random() * 1000, currentTime);
        osc2.frequency.exponentialRampToValueAtTime(500, currentTime + 0.02);
        
        // Огибающая основного тона
        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime(volume, currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.15);
        
        // Огибающая щелчка - очень быстрая атака и затухание
        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(volume * 0.03, currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.025);
        
        // Микшер для сухого и мокрого сигнала
        const dryGain = ctx.createGain();
        dryGain.gain.value = 0.5;
        
        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.5;
        
        // Подключаем
        osc1.connect(gain1);
        osc2.connect(gain2);
        
        // Сухой сигнал
        gain1.connect(dryGain);
        gain2.connect(ctx.destination); // Щелчок без реверба - чёткий
        dryGain.connect(ctx.destination);
        
        // Мокрый сигнал (через реверб) - только основной тон
        gain1.connect(wetGain);
        wetGain.connect(reverbNode);
        reverbNode.connect(ctx.destination);
        
        // Запускаем и останавливаем
        osc1.start(currentTime);
        osc2.start(currentTime);
        osc1.stop(currentTime + 0.2);
        osc2.stop(currentTime + 0.03);
        
    } catch (e) {
        // Игнорируем ошибки аудио
    }
}

function playSpawnSound() {
    try {
        const ctx = initAudio();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        
        const currentTime = ctx.currentTime;
        
        // Восходящий "свуш" звук
        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(200, currentTime);
        osc1.frequency.exponentialRampToValueAtTime(800, currentTime + 0.15);
        osc1.frequency.exponentialRampToValueAtTime(400, currentTime + 0.25);
        
        // Шипящий призвук
        const osc2 = ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(100, currentTime);
        osc2.frequency.exponentialRampToValueAtTime(1200, currentTime + 0.1);
        
        // Огибающие
        const gain1 = ctx.createGain();
        gain1.gain.setValueAtTime(0.15, currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.3);
        
        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0.03, currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, currentTime + 0.12);
        
        // Подключаем с ревербом
        osc1.connect(gain1);
        osc2.connect(gain2);
        
        const dryGain = ctx.createGain();
        dryGain.gain.value = 0.6;
        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.4;
        
        gain1.connect(dryGain);
        gain2.connect(dryGain);
        dryGain.connect(ctx.destination);
        
        gain1.connect(wetGain);
        wetGain.connect(reverbNode);
        reverbNode.connect(ctx.destination);
        
        osc1.start(currentTime);
        osc2.start(currentTime);
        osc1.stop(currentTime + 0.35);
        osc2.stop(currentTime + 0.15);
        
    } catch (e) {
        // Игнорируем ошибки аудио
    }
}

function playVictorySound() {
    try {
        const ctx = initAudio();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        
        const currentTime = ctx.currentTime;
        
        // Победная мелодия - арпеджио вверх
        const notes = [262, 330, 392, 523, 659, 784]; // C E G C E G (мажорный аккорд)
        
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'triangle';
            
            const startTime = currentTime + i * 0.1;
            osc.frequency.setValueAtTime(freq, startTime);
            osc.frequency.setValueAtTime(freq * 1.02, startTime + 0.05);
            
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            // Реверб
            const wetGain = ctx.createGain();
            wetGain.gain.value = 0.5;
            gain.connect(wetGain);
            wetGain.connect(reverbNode);
            reverbNode.connect(ctx.destination);
            
            osc.start(startTime);
            osc.stop(startTime + 0.5);
        });
        
        // Финальный аккорд
        const chordTime = currentTime + 0.7;
        const chordFreqs = [523, 659, 784]; // C E G высокий
        
        chordFreqs.forEach(freq => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, chordTime);
            
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.12, chordTime);
            gain.gain.exponentialRampToValueAtTime(0.001, chordTime + 1.5);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            const wetGain = ctx.createGain();
            wetGain.gain.value = 0.6;
            gain.connect(wetGain);
            wetGain.connect(reverbNode);
            reverbNode.connect(ctx.destination);
            
            osc.start(chordTime);
            osc.stop(chordTime + 1.8);
        });
        
    } catch (e) {
        // Игнорируем ошибки аудио
    }
}

function updateRipples() {
    const now = Date.now();
    ripples = ripples.filter(ripple => {
        const age = now - ripple.createdAt;
        return age < ripple.duration;
    });
}

function renderRipples() {
    if (!trap || ripples.length === 0) return;
    
    const now = Date.now();
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    
    // Вычисляем угол дырки (синхронизировано с ловушкой)
    const angleStep = (Math.PI * 2) / TRAP_SEGMENTS;
    const gapStartIndex = TRAP_SEGMENTS - TRAP_GAP;
    const gapStartAngle = gapStartIndex * angleStep - Math.PI / 2 + trap.angle;
    const gapEndAngle = gapStartAngle + TRAP_GAP * angleStep;
    
    // Без save/restore для каждой ряби - быстрее
    ctx.lineCap = 'round';
    
    ripples.forEach(ripple => {
        const age = now - ripple.createdAt;
        const progress = age / ripple.duration;
        
        const currentRadius = ripple.radius + (ripple.maxRadius - ripple.radius) * progress;
        const alpha = ripple.alpha * (1 - progress);
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, currentRadius, gapEndAngle, gapStartAngle);
        ctx.strokeStyle = ripple.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = alpha;
        ctx.stroke();
    });
    
    ctx.globalAlpha = 1;
}

// ============ ПРОВЕРКА ПОБЕДЫ ============
let lastSurvivor = null; // Последний выживший шарик

function checkVictory() {
    if (gameState !== 'playing') return;
    
    // Если есть шарики - запоминаем последнего
    if (balls.length > 0) {
        lastSurvivor = balls[balls.length - 1];
    }
    
    // Условие победы: был хотя бы 1 шарик и все вылетели
    if (totalBallsSpawned >= 1 && balls.length === 0 && lastSurvivor) {
        declareVictory(lastSurvivor);
        lastSurvivor = null;
    }
    // Или: было больше 1 шарика и остался только 1
    else if (totalBallsSpawned > 1 && balls.length === 1) {
        declareVictory(balls[0]);
    }
}

function declareVictory(winnerBall) {
    gameState = 'victory';
    winner = winnerBall;
    
    console.log(`🏆 Победитель: ${winner.customData.nickname}`);
    
    // Звук победы
    playVictorySound();
    
    // Плавно удаляем ловушку
    removeTrap();
    
    // Показываем оверлей победителя
    const overlay = document.getElementById('winner-overlay');
    const nameElement = overlay.querySelector('.winner-name');
    const avatarElement = overlay.querySelector('.winner-avatar');
    
    nameElement.textContent = winner.customData.nickname;
    
    // Устанавливаем аватарку победителя
    if (winner.customData.avatarUrl) {
        avatarElement.style.backgroundImage = `url('/avatar?url=${encodeURIComponent(winner.customData.avatarUrl)}')`;
        avatarElement.style.display = 'block';
    } else {
        avatarElement.style.display = 'none';
    }
    
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('visible'), 50);
    
    // Таймер рестарта
    victoryTimer = setTimeout(() => {
        restartGame();
    }, VICTORY_DELAY);
}

// ============ АНИМАЦИЯ ПОБЕДИТЕЛЯ ============
function animateWinner() {
    if (!winner || gameState !== 'victory') return;
    
    // Просто удаляем шарик из физики, оставляем только оверлей
    if (winner && !winner.customData.removed) {
        World.remove(world, winner);
        winner.customData.removed = true;
    }
}

// ============ РЕСТАРТ ============
function restartGame() {
    gameState = 'restarting';
    
    // Скрываем оверлей
    const overlay = document.getElementById('winner-overlay');
    overlay.classList.remove('visible');
    setTimeout(() => overlay.classList.add('hidden'), 500);
    
    // Удаляем все шарики
    balls.forEach(ball => World.remove(world, ball));
    balls = [];
    
    // Сбрасываем счётчики
    totalBallsSpawned = 0;
    winner = null;
    lastSurvivor = null;
    particles = [];
    ripples = [];
    
    // Включаем демо-режим снова
    demoMode = true;
    demoBalls = [];
    
    // Сбрасываем динамику ловушки
    trapSpeed = TRAP_ROTATION_SPEED;
    trapDirection = 1;
    lastSpeedChange = Date.now();
    
    // Пересоздаём ловушку
    createTrap();
    
    // Обновляем UI
    updatePlayerCount();
    
    // Возвращаем состояние игры
    gameState = 'playing';
    
    console.log('🔄 Игра перезапущена');
}

// ============ SOCKET СОБЫТИЯ ============
function setupSocketEvents() {
    socket.on('connect', () => {
        console.log('✓ Подключено к серверу');
    });
    
    socket.on('tiktokStatus', (data) => {
        // Статус бар убран из UI
        console.log(`TikTok: ${data.connected ? 'подключено' : 'отключено'}`);
    });
    
    socket.on('newBall', (data) => {
        console.log(`🎁 Новый шарик: ${data.nickname}`);
        createBall(data);
    });
    
    socket.on('freezeBalls', (data) => {
        console.log(`❄️ Заморозка шариков: ${data.uniqueId}`);
        freezeBalls(data.uniqueId);
    });
    
    socket.on('resetGame', () => {
        console.log('🔄 Сброс игры по команде');
        if (victoryTimer) {
            clearTimeout(victoryTimer);
            victoryTimer = null;
        }
        restartGame();
    });
}

// ============ ОБНОВЛЕНИЕ ШЛЕЙФОВ ============
function updateTrails() {
    balls.forEach(ball => {
        if (!ball.customData) return;
        
        // Добавляем текущую позицию в историю
        ball.customData.trail.unshift({
            x: ball.position.x,
            y: ball.position.y
        });
        
        // Ограничиваем длину шлейфа
        if (ball.customData.trail.length > TRAIL_LENGTH) {
            ball.customData.trail.pop();
        }
    });
}

// ============ ПРОВЕРКА ВЫПАВШИХ ШАРИКОВ ============
function checkFallenBalls() {
    const ballsToRemove = [];
    
    balls.forEach(ball => {
        if (ball.position.y > canvasHeight + 100) {
            ballsToRemove.push(ball);
        }
    });
    
    ballsToRemove.forEach(ball => {
        console.log(`💀 ${ball.customData.nickname} выпал`);
        removeBall(ball);
    });
}

// ============ ПОДДЕРЖАНИЕ ДВИЖЕНИЯ ШАРИКОВ ============
function keepBallsMoving() {
    const minSpeed = 2;
    
    balls.forEach(ball => {
        const velocity = ball.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        
        // Если шарик слишком медленный - добавляем импульс
        if (speed < minSpeed) {
            const angle = Math.random() * Math.PI * 2;
            const boost = minSpeed - speed + 1;
            Body.setVelocity(ball, {
                x: velocity.x + Math.cos(angle) * boost,
                y: velocity.y + Math.sin(angle) * boost
            });
        }
    });
}

function keepDemoBallsMoving() {
    const minSpeed = 2;
    
    demoBalls.forEach(ball => {
        const velocity = ball.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        
        if (speed < minSpeed) {
            const angle = Math.random() * Math.PI * 2;
            const boost = minSpeed - speed + 1;
            Body.setVelocity(ball, {
                x: velocity.x + Math.cos(angle) * boost,
                y: velocity.y + Math.sin(angle) * boost
            });
        }
        
        // Если демо-шарик вылетел - возвращаем в центр
        if (ball.position.y > canvasHeight + 50) {
            Body.setPosition(ball, {
                x: canvasWidth / 2 + (Math.random() - 0.5) * 100,
                y: canvasHeight / 2
            });
            const angle = Math.random() * Math.PI * 2;
            Body.setVelocity(ball, {
                x: Math.cos(angle) * 4,
                y: Math.sin(angle) * 4
            });
        }
    });
}

// ============ РЕНДЕРИНГ ============
function render() {
    // Очистка (прозрачный фон)
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    
    // Рисуем шлейфы
    renderTrails();
    
    // Рисуем ловушку
    renderTrap();
    
    // Рисуем рябь (после ловушки, перед шариками)
    renderRipples();
    
    // Рисуем шарики
    renderBalls();
    
    // Рисуем демо-шарики
    if (demoMode && demoBalls.length > 0) {
        renderDemoBalls();
        renderDemoText();
    }
    
    // Рисуем партиклы
    renderParticles();
    
    // Победа - ничего не рисуем на канвасе, только оверлей
}

function renderDemoBalls() {
    demoBalls.forEach(ball => {
        if (!ball.customData) return;
        
        const x = ball.position.x;
        const y = ball.position.y;
        const color = ball.customData.color;
        
        ctx.save();
        ctx.globalAlpha = 0.5; // Полупрозрачные
        
        // Свечение
        ctx.shadowBlur = 20;
        ctx.shadowColor = color;
        
        // Круг
        ctx.beginPath();
        ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        
        // Обводка
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.restore();
        
        // Обновляем шлейф
        ball.customData.trail.push({ x, y });
        if (ball.customData.trail.length > TRAIL_LENGTH) {
            ball.customData.trail.shift();
        }
    });
    
    // Рисуем шлейфы демо-шариков
    demoBalls.forEach(ball => {
        if (!ball.customData || ball.customData.trail.length < 2) return;
        
        const trail = ball.customData.trail;
        const color = ball.customData.color;
        
        ctx.save();
        ctx.globalAlpha = 0.3; // Ещё более прозрачные шлейфы
        
        ctx.beginPath();
        ctx.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) {
            ctx.lineTo(trail[i].x, trail[i].y);
        }
        
        ctx.strokeStyle = color;
        ctx.lineWidth = BALL_RADIUS;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        ctx.restore();
    });
}

function renderDemoText() {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    
    ctx.save();
    
    // Пульсация
    const pulse = 0.9 + Math.sin(Date.now() / 500) * 0.1;
    
    ctx.font = `bold ${48 * pulse}px Montserrat`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Тень/свечение
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00ffff';
    
    // Текст
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SEND GIFT TO START!', centerX, centerY);
    
    ctx.restore();
}

function renderTrails() {
    balls.forEach(ball => {
        if (!ball.customData || ball.customData.trail.length < 2) return;
        
        const trail = ball.customData.trail;
        const color = ball.customData.color;
        
        ctx.beginPath();
        ctx.moveTo(trail[0].x, trail[0].y);
        
        for (let i = 1; i < trail.length; i++) {
            ctx.lineTo(trail[i].x, trail[i].y);
        }
        
        ctx.strokeStyle = color;
        ctx.lineWidth = BALL_RADIUS * 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Градиент прозрачности - более яркий
        const gradient = ctx.createLinearGradient(
            trail[0].x, trail[0].y,
            trail[trail.length - 1].x, trail[trail.length - 1].y
        );
        gradient.addColorStop(0, color + 'CC'); // 80% opacity
        gradient.addColorStop(0.5, color + '80'); // 50% opacity
        gradient.addColorStop(1, color + '00'); // 0% opacity
        ctx.strokeStyle = gradient;
        
        // Добавляем свечение
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        
        ctx.stroke();
    });
}

function renderTrap() {
    if (!trap) return;
    
    const centerX = trap.centerX;
    const centerY = trap.centerY;
    
    ctx.save();
    
    // Плавный переход цветов (HSL)
    const time = Date.now() / 3000; // Медленный цикл ~3 сек
    const hue = (time * 60) % 360; // Плавно меняем оттенок
    const trapColor = `hsl(${hue}, 100%, 60%)`;
    const trapGlow = `hsl(${hue}, 100%, 40%)`;
    
    // Неоновое свечение
    ctx.shadowBlur = 25;
    ctx.shadowColor = trapColor;
    ctx.strokeStyle = trapColor;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    
    // Рисуем кольцо с разрывом - синхронизировано с физикой
    const angleStep = (Math.PI * 2) / TRAP_SEGMENTS;
    const gapStartIndex = TRAP_SEGMENTS - TRAP_GAP;
    
    // Угол начала дырки (в физике)
    const gapStartAngle = gapStartIndex * angleStep - Math.PI / 2 + trap.angle;
    // Угол конца дырки
    const gapEndAngle = gapStartAngle + TRAP_GAP * angleStep;
    
    // Рисуем дугу ОТ конца дырки ДО начала дырки (т.е. всё кроме дырки)
    ctx.beginPath();
    ctx.arc(centerX, centerY, TRAP_RADIUS, gapEndAngle, gapStartAngle);
    ctx.stroke();
    
    // Второй слой свечения
    ctx.shadowBlur = 40;
    ctx.shadowColor = trapGlow;
    ctx.strokeStyle = `hsla(${hue}, 100%, 50%, 0.3)`;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(centerX, centerY, TRAP_RADIUS, gapEndAngle, gapStartAngle);
    ctx.stroke();
    
    ctx.restore();
}

function renderBalls() {
    balls.forEach(ball => {
        if (!ball.customData) return;
        
        const x = ball.position.x;
        const y = ball.position.y;
        const scale = ball.customData.scale || 1;
        const radius = BALL_RADIUS * scale;
        const color = ball.customData.color;
        
        ctx.save();
        
        // Свечение вокруг шарика
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        
        // Обводка со свечением
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Клиппинг для аватарки
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        
        // Рисуем аватарку или заглушку
        if (ball.customData.avatarLoaded && ball.customData.avatarImage) {
            ctx.drawImage(
                ball.customData.avatarImage,
                x - radius,
                y - radius,
                radius * 2,
                radius * 2
            );
        } else {
            // Заглушка - градиентный круг
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, shadeColor(color, -50));
            ctx.fillStyle = gradient;
            ctx.fill();
            
            // Первая буква ника
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${radius}px Montserrat`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowBlur = 0;
            const initial = ball.customData.nickname.charAt(0).toUpperCase();
            ctx.fillText(initial, x, y);
        }
        
        ctx.restore();
        
        // Ник под шариком (только в обычном режиме)
        if (gameState === 'playing' && scale === 1) {
            ctx.save();
            ctx.fillStyle = '#fff';
            ctx.font = '12px Montserrat';
            ctx.textAlign = 'center';
            ctx.shadowBlur = 5;
            ctx.shadowColor = '#000';
            
            const nickname = ball.customData.nickname;
            const displayName = nickname.length > 12 ? nickname.substring(0, 12) + '...' : nickname;
            ctx.fillText(displayName, x, y + radius + 18);
            ctx.restore();
        }
    });
}

function renderParticles() {
    particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.restore();
    });
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function shadeColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (
        0x1000000 +
        (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255)
    ).toString(16).slice(1);
}

// ============ ИГРОВОЙ ЦИКЛ ============
function gameLoop() {
    // Обновляем физику (с множителем скорости для OBS)
    Engine.update(engine, (1000 / 60) * SPEED_MULTIPLIER);
    
    // Вращаем ловушку
    rotateTrap();
    
    // Запускаем демо если нет игроков
    if (demoMode && balls.length === 0 && demoBalls.length === 0 && gameState === 'playing') {
        startDemoMode();
    }
    
    // Поддерживаем движение шариков
    keepBallsMoving();
    keepDemoBallsMoving();
    
    // Проверяем замороженные шарики
    updateFrozenBalls();
    
    // Обновляем шлейфы
    updateTrails();
    
    // Обновляем партиклы
    updateParticles();
    
    // Обновляем рябь
    updateRipples();
    
    // Проверяем выпавшие шарики
    checkFallenBalls();
    
    // Проверяем победу
    checkVictory();
    
    // Анимация победителя
    if (gameState === 'victory') {
        animateWinner();
    }
    
    // Рендерим
    render();
    
    // Следующий кадр
    requestAnimationFrame(gameLoop);
}

// ============ ТЕСТОВЫЕ ФУНКЦИИ (для отладки) ============
window.testBall = function() {
    socket.emit('testBall');
};

window.testReset = function() {
    socket.emit('testReset');
};

window.spawnTestBalls = function(count = 10) {
    for (let i = 0; i < count; i++) {
        setTimeout(() => socket.emit('testBall'), i * 200);
    }
};

// Запуск при загрузке
document.addEventListener('DOMContentLoaded', init);
