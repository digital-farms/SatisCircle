const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { TikTokLiveConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============ НАСТРОЙКИ ============
const PORT = 3000;
const TIKTOK_USERNAME = 'digital.n0mad'; // Замените на свой username
// ===================================

// Статические файлы
app.use(express.static('public'));

// Прокси для аватарок (обход CORS)
app.get('/avatar', (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) {
        return res.status(400).send('URL required');
    }
    
    // Поддержка http и https
    const httpModule = imageUrl.startsWith('https') ? https : require('http');
    
    httpModule.get(imageUrl, (response) => {
        // Следуем редиректам
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            const redirectModule = response.headers.location.startsWith('https') ? https : require('http');
            redirectModule.get(response.headers.location, (redirectResponse) => {
                res.set('Content-Type', redirectResponse.headers['content-type'] || 'image/jpeg');
                res.set('Cache-Control', 'public, max-age=86400');
                redirectResponse.pipe(res);
            }).on('error', () => res.status(500).send('Redirect error'));
            return;
        }
        
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        response.pipe(res);
    }).on('error', (err) => {
        console.error('[Avatar] Error:', err.message);
        res.status(500).send('Error fetching image');
    });
});

// Генерация случайного яркого неонового цвета
function generateNeonColor() {
    const neonColors = [
        '#ff00ff', '#00ffff', '#ff0080', '#80ff00', '#ff8000',
        '#00ff80', '#8000ff', '#ff0040', '#40ff00', '#00ff40',
        '#ff4000', '#0040ff', '#ff00bf', '#bfff00', '#00bfff',
        '#ff6600', '#6600ff', '#00ff66', '#ff0066', '#66ff00'
    ];
    return neonColors[Math.floor(Math.random() * neonColors.length)];
}

// Подключение к TikTok Live
let tiktokConnection = null;
let isConnected = false;
let isConnecting = false;


async function connectToTikTok() {
    // Защита от повторного подключения
    if (isConnecting || isConnected) {
        console.log('[TikTok] Уже подключено или подключается...');
        return;
    }
    isConnecting = true;
    
    console.log(`[TikTok] Подключение к @${TIKTOK_USERNAME}...`);
    
    // Отключаем старое соединение если есть
    if (tiktokConnection) {
        try {
            tiktokConnection.disconnect();
        } catch (e) {}
        tiktokConnection = null;
    }
    
    tiktokConnection = new TikTokLiveConnection(TIKTOK_USERNAME, {
        processInitialData: false, // Не обрабатывать старые данные
        enableExtendedGiftInfo: true
    });

    try {
        const state = await tiktokConnection.connect();
        console.log(`[TikTok] ✓ Подключено к roomId: ${state.roomId}`);
        isConnected = true;
        isConnecting = false;
    } catch (err) {
        console.error('[TikTok] ✗ Ошибка подключения:', err.message);
        console.log('[TikTok] Повторная попытка через 10 секунд...');
        isConnecting = false;
        isConnected = false;
        setTimeout(connectToTikTok, 10000);
        return;
    }

    // Событие отключения
    tiktokConnection.on('disconnected', () => {
        console.log('[TikTok] Отключено от стрима');
        isConnected = false;
    });

    // Событие окончания стрима
    tiktokConnection.on('streamEnd', () => {
        console.log('[TikTok] Стрим завершён');
        isConnected = false;
    });

    // Обработка подарков
    tiktokConnection.on('gift', (data) => {
        // repeatEnd: 0 = стрик в процессе, 1 = стрик завершён
        // Обрабатываем ТОЛЬКО финальное событие (repeatEnd=1)
        if (data.repeatEnd === 0 || data.repeatEnd === false) {
            return; // Стрик в процессе - пропускаем
        }
        
        // Получаем данные пользователя из вложенной структуры
        const userFromPieces = data.common?.displayText?.piecesList?.[0]?.userValue?.user;
        const user = userFromPieces || data.user || data;
        
        const uniqueId = user?.uniqueId || data.uniqueId || 'unknown';
        const nickname = user?.nickname || data.nickname || uniqueId;
        
        // Аватарка в profilePicture.url[]
        let avatarUrl = null;
        if (user?.profilePicture?.url?.[0]) {
            avatarUrl = user.profilePicture.url[0];
        } else if (user?.profilePicture?.url?.[1]) {
            avatarUrl = user.profilePicture.url[1]; // jpeg fallback
        } else if (data.profilePictureUrl) {
            avatarUrl = data.profilePictureUrl;
        }
        
        const giftName = data.giftName || data.gift_name || 'Gift';
        const giftId = data.giftId || data.gift_id || 0;
        const repeatCount = data.repeatCount || 1;

        console.log(`[Gift] ${nickname} -> ${giftName} (ID: ${giftId}) x${repeatCount}`);
        
        // Проверяем на подарок заморозки (ID: 5879 = "Пончик")
        if (giftId === 5879) {
            console.log(`[Freeze] ${nickname} заморозил свои шарики!`);
            io.emit('freezeBalls', { uniqueId: uniqueId });
            return; // Не создаём новые шарики
        }
        
        // Создаём шарики по количеству в комбо
        for (let i = 0; i < repeatCount; i++) {
            const ballData = {
                uniqueId: uniqueId,
                nickname: nickname,
                avatarUrl: avatarUrl,
                color: generateNeonColor(),
                giftName: giftName
            };
            io.emit('newBall', ballData);
        }
    });

    // Обработка лайков
    tiktokConnection.on('like', (data) => {
        const user = data.user || data;
        const uniqueId = user?.uniqueId || data.uniqueId || 'unknown';
        const nickname = user?.nickname || data.nickname || uniqueId;
        const likeCount = data.likeCount || data.likes || 1;
        
        // Аватарка
        let avatarUrl = null;
        if (user?.profilePicture?.url?.[0]) {
            avatarUrl = user.profilePicture.url[0];
        } else if (user?.profilePicture?.url?.[1]) {
            avatarUrl = user.profilePicture.url[1];
        } else if (data.profilePictureUrl) {
            avatarUrl = data.profilePictureUrl;
        }
        
        console.log(`[Like] ${nickname} отправил ${likeCount} лайк(ов)`);
        
        // Создаём шарики за лайки (максимум 5 за раз чтобы не спамить)
        const ballsToCreate = Math.min(likeCount, 5);
        for (let i = 0; i < ballsToCreate; i++) {
            const ballData = {
                uniqueId: uniqueId,
                nickname: nickname,
                avatarUrl: avatarUrl,
                color: generateNeonColor(),
                giftName: 'Like'
            };
            io.emit('newBall', ballData);
        }
    });

    // Обработка чата
    tiktokConnection.on('chat', (data) => {
        const user = data.user || data;
        const uniqueId = user.uniqueId || user.unique_id || data.uniqueId || 'unknown';
        const comment = data.comment || data.content || '';
        console.log(`[Chat] ${uniqueId}: ${comment}`);
    });

    // Ошибки
    tiktokConnection.on('error', (err) => {
        console.error('[TikTok] Ошибка:', err.message);
    });
}

// Socket.io подключения
io.on('connection', (socket) => {
    console.log(`[Socket] Клиент подключён: ${socket.id}`);
    
    // Отправляем статус подключения к TikTok
    socket.emit('tiktokStatus', { connected: isConnected, username: TIKTOK_USERNAME });

    socket.on('disconnect', () => {
        console.log(`[Socket] Клиент отключён: ${socket.id}`);
    });

    // Тестовое событие для отладки (можно вызвать из консоли браузера)
    socket.on('testBall', () => {
        const testData = {
            uniqueId: 'test_user_' + Math.floor(Math.random() * 1000),
            nickname: 'Тестовый игрок',
            avatarUrl: null,
            color: generateNeonColor(),
            giftName: 'Test Gift'
        };
        io.emit('newBall', testData);
        console.log('[Test] Создан тестовый шарик');
    });

    // Тестовый сброс
    socket.on('testReset', () => {
        io.emit('resetGame');
        console.log('[Test] Сброс игры');
    });
});

// Запуск сервера
server.listen(PORT, () => {
    console.log('========================================');
    console.log('       🎮 BALL ESCAPE - TikTok Live');
    console.log('========================================');
    console.log(`[Server] Запущен на http://localhost:${PORT}`);
    console.log(`[TikTok] Username: @${TIKTOK_USERNAME}`);
    console.log('========================================');
    
    // Подключаемся к TikTok
    connectToTikTok();
});
