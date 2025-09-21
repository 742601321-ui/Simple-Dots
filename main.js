(function() {
    'use strict';

    // 基础配置
    const BOARD_COLS = 5;
    const BOARD_ROWS = 8;
    // 莫兰迪色系配色（高对比度）
    const COLORS = ['#7BA7BC', '#D4A5A5', '#C4A484', '#F5E6D3', '#8FBC8F'];
    const CELL_PADDING = 10; // 视觉留白
    const MOVES_LIMIT = 20;
    const MIN_PATH_LEN = 3; // 最小连接长度（非回路）

    // 画布 & UI 引用
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = document.getElementById('score');
    const movesEl = document.getElementById('moves-left');
    const goalsEl = document.getElementById('goals');
    const currentLevelEl = document.getElementById('current-level');
    const levelTargetEl = document.getElementById('level-target');
    const btnRestart = document.getElementById('btn-restart');
    const btnHint = document.getElementById('btn-hint');
    const btnReshuffle = document.getElementById('btn-reshuffle');
    const btnMusic = document.getElementById('btn-music');
    const overlay = document.getElementById('overlay');
    const overlayRestart = document.getElementById('overlay-restart');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayDesc = document.getElementById('overlay-desc');
    const startOverlay = document.getElementById('start-overlay');
    const startGameBtn = document.getElementById('start-game-btn');

    // 动态尺寸（高清渲染，保持圆形不失真）
    const logicalWidth = canvas.width;
    const logicalHeight = canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 限制最大DPR为2，避免性能问题
    canvas.width = Math.round(logicalWidth * dpr);
    canvas.height = Math.round(logicalHeight * dpr);
    canvas.style.width = logicalWidth + 'px';
    canvas.style.height = logicalHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = logicalWidth;
    const height = logicalHeight;
    
    // 确保网格完全在画布内
    const gridW = width - CELL_PADDING * 2;
    const gridH = height - CELL_PADDING * 2;
    const cellSize = Math.min(Math.floor(gridW / BOARD_COLS), Math.floor(gridH / BOARD_ROWS));
    const offsetX = Math.floor((width - cellSize * BOARD_COLS) / 2);
    const offsetY = Math.floor((height - cellSize * BOARD_ROWS) / 2);
    const dotRadius = Math.floor(cellSize * 0.28);

    // 状态
    let grid = []; // grid[row][col] -> { colorIndex }
    let iceGrid = []; // iceGrid[row][col] -> 0 无冰, 1 有冰
    let score = 0;
    let movesLeft = MOVES_LIMIT;
    let isDragging = false;
    let path = []; // [{row,col,colorIndex}...]
    let lastPointer = null;
    // 粒子与动效
    let particles = [];
    let shakeTime = 0;
    let shakeMagnitude = 0;
    let timeMs = 0;
    let iceAnims = []; // {r,c,life,maxLife}
    let hintPath = null; // 提示路径
    let goals = {}; // colorIndex -> remaining count
    let goalOrder = [];
    let tutorialStep = 0; // 新手引导步骤
    let tutorialActive = false; // 是否在引导中
    let tutorialPath = []; // 引导路径
    let tutorialTimer = 0; // 引导计时器
    
    // 关卡系统
    let currentLevel = 1;
    let levelTarget = 30; // 当前关卡目标
    let levelProgress = 0; // 当前关卡进度
    let totalEliminated = 0; // 总消除数量
    
    // 新手引导控制
    let hasCompletedTutorial = false; // 是否已完成新手引导
    let hasShownSuccessPopup = false; // 是否已显示过成功弹窗

    // 音频系统
    let audioCtx = null;
    let bgmAudio = null;
    let bgmEnabled = true;
    
    function ensureAudio() {
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { /* ignore */ }
        }
        return audioCtx;
    }
    
    // 背景音乐控制
    function initBGM() {
        bgmAudio = document.getElementById('bgm');
        if (bgmAudio) {
            bgmAudio.volume = 0.3; // 设置背景音乐音量
            bgmAudio.loop = true;
            bgmAudio.preload = 'auto';
            
            // 移动端音频初始化
            bgmAudio.addEventListener('canplaythrough', function() {
                console.log('音频已准备就绪');
            });
            
            bgmAudio.addEventListener('error', function(e) {
                console.log('音频加载失败:', e);
                bgmEnabled = false;
                if (btnMusic) btnMusic.textContent = '🔇';
            });
        }
    }
    
    function startBGM() {
        if (bgmAudio && bgmEnabled) {
            // 移动端需要用户交互才能播放音频
            const playPromise = bgmAudio.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.log('背景音乐播放失败:', e);
                    // 移动端通常需要用户交互才能播放音频
                    bgmEnabled = false;
                    if (btnMusic) btnMusic.textContent = '🔇';
                });
            }
        }
    }
    
    function stopBGM() {
        if (bgmAudio) {
            bgmAudio.pause();
        }
    }
    
    function toggleBGM() {
        bgmEnabled = !bgmEnabled;
        if (bgmEnabled) {
            startBGM();
            if (btnMusic) btnMusic.textContent = '🎵';
        } else {
            stopBGM();
            if (btnMusic) btnMusic.textContent = '🔇';
        }
    }
    function playBeep(freq = 440, dur = 0.08, vol = 0.06) {
        const ac = ensureAudio(); if (!ac) return;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.value = vol;
        o.connect(g); g.connect(ac.destination);
        const t = ac.currentTime;
        o.start(t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.stop(t + dur + 0.02);
    }
    
    // 铃铛音效 - 消除成功时播放
    function playBellSound() {
        const ac = ensureAudio(); if (!ac) return;
        const t = ac.currentTime;
        
        // 创建多个铃铛音调
        const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5 和弦
        const durations = [0.3, 0.4, 0.5];
        
        frequencies.forEach((freq, index) => {
            const o = ac.createOscillator();
            const g = ac.createGain();
            
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.value = 0;
            
            o.connect(g);
            g.connect(ac.destination);
            
            // 淡入淡出效果
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.08, t + 0.05);
            g.gain.exponentialRampToValueAtTime(0.0001, t + durations[index]);
            
            o.start(t);
            o.stop(t + durations[index] + 0.02);
        });
    }

    // 开始游戏函数
    function startGame() {
        if (startOverlay) {
            startOverlay.style.display = 'none';
        }
        // 在用户交互后尝试播放背景音乐
        if (bgmEnabled) {
            startBGM();
        }
    }
    
    function resetGame() {
        score = 0;
        movesLeft = MOVES_LIMIT;
        isDragging = false;
        path = [];
        lastPointer = null;
        tutorialStep = 0;
        tutorialActive = false;
        tutorialPath = [];
        tutorialTimer = 0;
        levelProgress = 0;
        totalEliminated = 0;
        overlay.classList.add('hidden');
        
        // 确保加载最新的新手教程状态
        loadTutorialProgress();
        
        generateBoard();
        generateGoals();
        updateLevelTarget();
        render();
        updateUI();
        renderGoals();
        updateLevelUI();
        // 只在第一次访问时开始新手引导
        if (!hasCompletedTutorial) {
            startTutorial();
        }
    }

    function generateBoard() {
        grid = new Array(BOARD_ROWS).fill(null).map(() => new Array(BOARD_COLS).fill(null));
        iceGrid = new Array(BOARD_ROWS).fill(null).map(() => new Array(BOARD_COLS).fill(0));
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                grid[r][c] = { colorIndex: randColorIndex() };
                // 随机生成部分冰块（约 15%）
                if (Math.random() < 0.15) {
                    iceGrid[r][c] = 1;
                }
            }
        }
    }

    function randColorIndex() {
        return Math.floor(Math.random() * COLORS.length);
    }

    function updateUI() {
        scoreEl.textContent = String(score);
        movesEl.textContent = String(movesLeft);
    }

    function updateLevelUI() {
        if (currentLevelEl) currentLevelEl.textContent = String(currentLevel);
        if (levelTargetEl) levelTargetEl.textContent = `消除${levelTarget}个圆点 (${levelProgress}/${levelTarget})`;
    }

    function updateLevelTarget() {
        // 根据关卡设置目标
        levelTarget = Math.min(20 + currentLevel * 10, 100);
        levelProgress = 0;
    }

    function generateGoals() {
        goals = {};
        goalOrder = [];
        const indices = Array.from({ length: COLORS.length }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
        }
        const pick = indices.slice(0, Math.min(3, COLORS.length));
        for (const ci of pick) {
            goals[ci] = 10;
            goalOrder.push(ci);
        }
    }

    function renderGoals() {
        if (!goalsEl) return;
        goalsEl.innerHTML = '';
        for (const ci of goalOrder) {
            const item = document.createElement('div');
            item.className = 'goal-item';
            const dot = document.createElement('div');
            dot.className = 'goal-dot';
            dot.style.background = COLORS[ci];
            const count = document.createElement('div');
            count.className = 'goal-count';
            count.textContent = String(Math.max(0, goals[ci] || 0));
            item.appendChild(dot);
            item.appendChild(count);
            goalsEl.appendChild(item);
        }
    }

    // 坐标换算
    function cellCenter(col, row) {
        const x = offsetX + col * cellSize + cellSize / 2;
        const y = offsetY + row * cellSize + cellSize / 2;
        return { x, y };
    }

    function posToCell(x, y) {
        const col = Math.floor((x - offsetX) / cellSize);
        const row = Math.floor((y - offsetY) / cellSize);
        // 严格检查边界，确保不超出网格范围
        if (col < 0 || col >= BOARD_COLS || row < 0 || row >= BOARD_ROWS) return null;
        return { col, row };
    }

    function isValidCell(row, col) {
        return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    }

    function areAdjacent(a, b) {
        const dr = Math.abs(a.row - b.row);
        const dc = Math.abs(a.col - b.col);
        // 确保两个点都在有效范围内且相邻
        return (dr + dc === 1) && 
               isValidCell(a.row, a.col) && 
               isValidCell(b.row, b.col);
    }

    // 渲染
    function render() {
        ctx.save();
        // 屏幕抖动
        if (shakeTime > 0) {
            const dx = (Math.random() * 2 - 1) * shakeMagnitude;
            const dy = (Math.random() * 2 - 1) * shakeMagnitude;
            ctx.translate(dx, dy);
        }
        ctx.clearRect(0, 0, width, height);
        drawGridBackground();
        drawDots();
        drawIce();
        drawPath();
        drawHint();
        drawTutorial();
        drawParticles();
        ctx.restore();
    }

    function drawGridBackground() {
        ctx.save();
        ctx.fillStyle = '#0f1226';
        ctx.fillRect(0, 0, width, height);

        // 网格卡槽
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const x = offsetX + c * cellSize;
                const y = offsetY + r * cellSize;
                ctx.fillStyle = 'rgba(255,255,255,0.05)';
                ctx.fillRect(x + 4, y + 4, cellSize - 8, cellSize - 8);
            }
        }
        ctx.restore();
    }

    function drawDots() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const dot = grid[r][c];
                if (!dot) continue;
                const center = cellCenter(c, r);
                ctx.beginPath();
                ctx.fillStyle = COLORS[dot.colorIndex];
                ctx.arc(center.x, center.y, dotRadius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function drawIce() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (iceGrid[r][c] > 0) {
                    const x = offsetX + c * cellSize + 6;
                    const y = offsetY + r * cellSize + 6;
                    const w = cellSize - 12;
                    const h = cellSize - 12;
                    // 冰块半透明覆盖
                    const grd = ctx.createLinearGradient(x, y, x + w, y + h);
                    grd.addColorStop(0, 'rgba(200, 240, 255, 0.55)');
                    grd.addColorStop(1, 'rgba(140, 200, 255, 0.45)');
                    ctx.fillStyle = grd;
                    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                    ctx.lineWidth = 2;
                    ctx.fillRect(x, y, w, h);
                    ctx.strokeRect(x, y, w, h);
                    // 简单裂纹
                    ctx.beginPath();
                    ctx.moveTo(x + w * 0.2, y + h * 0.2);
                    ctx.lineTo(x + w * 0.5, y + h * 0.4);
                    ctx.lineTo(x + w * 0.8, y + h * 0.2);
                    ctx.moveTo(x + w * 0.3, y + h * 0.7);
                    ctx.lineTo(x + w * 0.6, y + h * 0.55);
                    ctx.lineTo(x + w * 0.8, y + h * 0.8);
                    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
            }
        }
    }

    function drawPath() {
        if (path.length === 0) return;
        ctx.save();
        ctx.lineWidth = Math.max(10, Math.floor(dotRadius * 0.9));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const color = COLORS[path[0].colorIndex];
        ctx.strokeStyle = color + 'cc';
        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
            const { col, row } = path[i];
            const { x, y } = cellCenter(col, row);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        if (isDragging && lastPointer) {
            ctx.lineTo(lastPointer.x, lastPointer.y);
        }
        ctx.stroke();
        ctx.restore();

        // 高亮路径上的点
        for (let i = 0; i < path.length; i++) {
            const { col, row, colorIndex } = path[i];
            const { x, y } = cellCenter(col, row);
            ctx.beginPath();
            ctx.fillStyle = COLORS[colorIndex];
            ctx.arc(x, y, dotRadius * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }

        // 回路高亮环动画（拖拽中提示）
        if (isDragging && isLoop()) {
            const first = path[0];
            const { x, y } = cellCenter(first.col, first.row);
            const base = dotRadius * 0.9;
            const pulse = base + Math.sin(timeMs / 120) * 6;
            ctx.beginPath();
            ctx.strokeStyle = COLORS[path[0].colorIndex] + 'aa';
            ctx.lineWidth = 3;
            ctx.arc(x, y, pulse, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    function drawParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    function drawHint() {
        if (!hintPath || hintPath.length < 2) return;
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = Math.max(6, Math.floor(dotRadius * 0.6));
        ctx.strokeStyle = '#ffffff55';
        ctx.beginPath();
        for (let i = 0; i < hintPath.length; i++) {
            const { col, row } = hintPath[i];
            const { x, y } = cellCenter(col, row);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawTutorial() {
        if (!tutorialActive) return;
        
        ctx.save();
        
        // 绘制引导路径
        if (tutorialPath.length >= 2) {
            ctx.setLineDash([12, 8]);
            ctx.lineWidth = Math.max(8, Math.floor(dotRadius * 0.8));
            ctx.strokeStyle = '#FFD700aa';
            ctx.beginPath();
            for (let i = 0; i < tutorialPath.length; i++) {
                const { col, row } = tutorialPath[i];
                const { x, y } = cellCenter(col, row);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        
        // 绘制高亮圆点
        for (let i = 0; i < tutorialPath.length; i++) {
            const { col, row } = tutorialPath[i];
            const { x, y } = cellCenter(col, row);
            const pulse = 1 + Math.sin(timeMs / 200) * 0.3;
            
            // 外圈高亮
            ctx.beginPath();
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 4;
            ctx.arc(x, y, dotRadius * pulse, 0, Math.PI * 2);
            ctx.stroke();
            
            // 内圈闪烁
            ctx.beginPath();
            ctx.fillStyle = '#FFD700' + '66';
            ctx.arc(x, y, dotRadius * 0.8, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // 绘制引导文字
        if (tutorialStep === 0) {
            // 主标题
            ctx.font = 'bold 18px Nunito';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.strokeText('点击金色圆点开始连接', width / 2, 50);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('点击金色圆点开始连接', width / 2, 50);
            
            // 副标题
            ctx.font = 'bold 14px Nunito';
            ctx.strokeText(tutorialPath.length >= 3 ? `连接${tutorialPath.length}个相同颜色的圆点` : '连接至少3个相同颜色的圆点', width / 2, 75);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(tutorialPath.length >= 3 ? `连接${tutorialPath.length}个相同颜色的圆点` : '连接至少3个相同颜色的圆点', width / 2, 75);
            
            // 规则说明
            ctx.font = 'bold 12px Nunito';
            ctx.strokeText('只能上下左右相邻连接，不能斜线连接', width / 2, 95);
            ctx.fillStyle = '#FFD700';
            ctx.fillText('只能上下左右相邻连接，不能斜线连接', width / 2, 95);
            
            // 提示信息
            ctx.font = 'bold 11px Nunito';
            ctx.strokeText('点击错误位置时会重新显示此提示', width / 2, 115);
            ctx.fillStyle = '#FFA500';
            ctx.fillText('点击错误位置时会重新显示此提示', width / 2, 115);
        } else if (tutorialStep === 1) {
            // 主标题
            ctx.font = 'bold 18px Nunito';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.strokeText('形成回路可清除该色全部点', width / 2, 50);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText('形成回路可清除该色全部点', width / 2, 50);
            
            // 副标题
            ctx.font = 'bold 14px Nunito';
            ctx.strokeText(tutorialPath.length >= 4 ? `连接${tutorialPath.length}个点形成回路` : '尝试连接回到起点形成闭环', width / 2, 75);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(tutorialPath.length >= 4 ? `连接${tutorialPath.length}个点形成回路` : '尝试连接回到起点形成闭环', width / 2, 75);
            
            // 规则说明
            ctx.font = 'bold 12px Nunito';
            ctx.strokeText('只能上下左右相邻连接，不能斜线连接', width / 2, 95);
            ctx.fillStyle = '#FFD700';
            ctx.fillText('只能上下左右相邻连接，不能斜线连接', width / 2, 95);
            
            // 提示信息
            ctx.font = 'bold 11px Nunito';
            ctx.strokeText('点击错误位置时会重新显示此提示', width / 2, 115);
            ctx.fillStyle = '#FFA500';
            ctx.fillText('点击错误位置时会重新显示此提示', width / 2, 115);
        }
        
        ctx.restore();
    }

    // 输入处理
    function getPointer(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
        const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (logicalWidth / rect.width),
            y: (clientY - rect.top) * (logicalHeight / rect.height)
        };
    }

    function onPointerDown(e) {
        if (movesLeft <= 0) return;
        
        const p = getPointer(e);
        const cell = posToCell(p.x, p.y);
        if (!cell) return;
        const { row, col } = cell;
        const dot = grid[row][col];
        if (!dot) return;
        
        // 如果在引导中，检查是否点击了正确的起始点
        if (tutorialActive && tutorialPath.length > 0) {
            const firstPoint = tutorialPath[0];
            if (row === firstPoint.row && col === firstPoint.col) {
                // 点击了正确的起始点，开始引导操作
                tutorialActive = false;
                isDragging = true;
                path = [{ row, col, colorIndex: dot.colorIndex }];
                lastPointer = p;
                render();
                return;
            } else {
                // 点击了错误的位置，显示提示并重新激活引导
                showTutorialHint();
                return;
            }
        }
        
        // 如果未完成新手引导且点击了错误位置，重新激活引导
        if (!hasCompletedTutorial && !tutorialActive) {
            showTutorialHint();
            return;
        }
        
        // 如果已完成新手引导，直接开始正常游戏
        if (hasCompletedTutorial) {
            isDragging = true;
            path = [{ row, col, colorIndex: dot.colorIndex }];
            lastPointer = p;
            render();
        }
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const p = getPointer(e);
        lastPointer = p;
        const cell = posToCell(p.x, p.y);
        if (cell) {
            const { row, col } = cell;
            const dot = grid[row][col];
            if (!dot) { render(); return; }
            const currentColor = path[0].colorIndex;
            const last = path[path.length - 1];
            // 回退
            if (path.length >= 2 && row === path[path.length - 2].row && col === path[path.length - 2].col) {
                path.pop();
                render();
                return;
            }
            // 只能相同颜色，且相邻，且未重复（除形成回路时可回到首点）
            if (dot.colorIndex === currentColor && areAdjacent({ row, col }, last)) {
                const existsIndex = path.findIndex(n => n.row === row && n.col === col);
                if (existsIndex === -1) {
                    path.push({ row, col, colorIndex: dot.colorIndex });
                    // 连线粒子
                    const { x, y } = cellCenter(col, row);
                    spawnTrailParticles(x, y, COLORS[currentColor]);
                } else if (existsIndex === 0 && path.length >= 3) {
                    // 形成回路（闭环）
                    path.push({ row, col, colorIndex: dot.colorIndex });
                }
            }
        }
        render();
    }

    function onPointerUp() {
        if (!isDragging) return;
        isDragging = false;
        lastPointer = null;
        
        // 判定消除
        const cleared = resolveClear();
        if (cleared > 0) {
            movesLeft = Math.max(0, movesLeft - 1);
            score += cleared;
            levelProgress += cleared;
            totalEliminated += cleared;
            applyGravity();
            refill();
            updateUI();
            renderGoals();
            updateLevelUI();
            checkLevelComplete();
            checkWinLose();
            // 检查无解情况
            checkAndHandleNoMoves();
            
            // 如果刚完成引导操作且未显示过成功弹窗，显示成功提示
            if (tutorialStep === 0 && !hasShownSuccessPopup) {
                showTutorialSuccess();
            }
        } else {
            // 如果操作失败，重新开始引导
            if (tutorialStep === 0) {
                restartTutorial();
            }
        }
        path = [];
        render();
    }

    function isLoop() {
        if (path.length < 4) return false;
        const first = path[0];
        const last = path[path.length - 1];
        return first.row === last.row && first.col === last.col;
    }

    function resolveClear() {
        if (path.length < 2) return 0;
        const loop = isLoop();
        const colorIndex = path[0].colorIndex;

        // 非回路时需要达到最小连接长度
        if (!loop && path.length < MIN_PATH_LEN) return 0;

        // 收集要清除的点
        let toClear = new Set();
        if (loop && path.length >= 4) {
            // 闭环：清除全场同色
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    if (grid[r][c] && grid[r][c].colorIndex === colorIndex) {
                        toClear.add(r + ',' + c);
                    }
                }
            }
        } else if (path.length >= 2) {
            // 非闭环：只清路径上的
            for (let i = 0; i < path.length; i++) {
                const n = path[i];
                toClear.add(n.row + ',' + n.col);
            }
        }

        // 执行清除
        let count = 0;
        toClear.forEach(key => {
            const [r, c] = key.split(',').map(Number);
            if (grid[r][c]) {
                const clr = grid[r][c].colorIndex;
                grid[r][c] = null;
                if (iceGrid[r][c] === 1) {
                    iceGrid[r][c] = 0; // 标记破冰
                    iceAnims.push({ r, c, life: 24, maxLife: 24 });
                }
                count++;
                const { x, y } = cellCenter(c, r);
                spawnBurstParticles(x, y, COLORS[colorIndex]);
                if (goals.hasOwnProperty(clr)) {
                    goals[clr] = Math.max(0, (goals[clr] || 0) - 1);
                }
            }
        });

        if (count > 0) {
            triggerVibrate(loop ? 80 : 30);
            triggerShake(loop ? 220 : 130, loop ? 6 : 3);
            // 消除成功时播放铃铛音效
            playBellSound();
        }
        return count;
    }

    function applyGravity() {
        for (let c = 0; c < BOARD_COLS; c++) {
            let write = BOARD_ROWS - 1;
            for (let r = BOARD_ROWS - 1; r >= 0; r--) {
                if (grid[r][c] !== null) {
                    if (write !== r) {
                        grid[write][c] = grid[r][c];
                        grid[r][c] = null;
                    }
                    write--;
                }
            }
        }
    }

    function refill() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (grid[r][c] === null) {
                    grid[r][c] = { colorIndex: randColorIndex() };
                }
            }
        }
    }

    // 无解检测：是否存在任意相邻同色
    function hasMoves() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const here = grid[r][c];
                if (!here) continue;
                const neighbors = [
                    { r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }
                ];
                for (const nb of neighbors) {
                    if (isValidCell(nb.r, nb.c)) {
                        const other = grid[nb.r][nb.c];
                        if (other && other.colorIndex === here.colorIndex) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    // 重排：打乱所有棋子（保持冰块位置）
    function reshuffle() {
        const items = [];
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (grid[r][c]) items.push(grid[r][c]);
            }
        }
        // 洗牌
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
        }
        // 重新填回
        let k = 0;
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (grid[r][c] !== null) {
                    grid[r][c] = items[k++];
                }
            }
        }
        triggerShake(180, 4);
        playBeep(360, 0.06, 0.05);
        // 重排后再次检查是否还有无解情况
        setTimeout(() => {
            if (!hasMoves()) {
                reshuffle();
            }
        }, 100);
    }

    // 事件绑定
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    // 触摸事件处理
    canvas.addEventListener('touchstart', function(e){ 
        e.preventDefault(); 
        onPointerDown(e); 
    }, { passive: false });
    
    canvas.addEventListener('touchmove', function(e){ 
        e.preventDefault(); 
        onPointerMove(e); 
    }, { passive: false });
    
    canvas.addEventListener('touchend', function(e){ 
        e.preventDefault(); 
        onPointerUp(e); 
    }, { passive: false });
    
    // 防止页面滚动
    document.addEventListener('touchmove', function(e) {
        if (e.target === canvas) {
            e.preventDefault();
        }
    }, { passive: false });

    btnRestart.addEventListener('click', resetGame);
    overlayRestart.addEventListener('click', resetGame);
    if (btnHint) btnHint.addEventListener('click', showHint);
    if (btnReshuffle) btnReshuffle.addEventListener('click', () => { reshuffle(); render(); });
    if (btnMusic) btnMusic.addEventListener('click', toggleBGM);
    if (startGameBtn) startGameBtn.addEventListener('click', startGame);

    // 粒子系统
    function spawnTrailParticles(x, y, color) {
        for (let i = 0; i < 4; i++) {
            particles.push({
                x: x + (Math.random() * 8 - 4),
                y: y + (Math.random() * 8 - 4),
                vx: (Math.random() * 2 - 1) * 0.8,
                vy: (Math.random() * 2 - 1) * 0.8,
                life: 18 + Math.random() * 10,
                maxLife: 28,
                size: 2 + Math.random() * 2,
                color: color
            });
        }
    }

    function spawnBurstParticles(x, y, color) {
        for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 1.2 + Math.random() * 2.2;
            particles.push({
                x, y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life: 28 + Math.random() * 14,
                maxLife: 42,
                size: 2 + Math.random() * 2.5,
                color: color
            });
        }
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.02; // 轻微下坠
            p.life -= 1;
            if (p.life <= 0) particles.splice(i, 1);
        }
    }

    function updateIceAnims() {
        for (let i = iceAnims.length - 1; i >= 0; i--) {
            const a = iceAnims[i];
            a.life -= 1;
            if (a.life <= 0) iceAnims.splice(i, 1);
        }
    }

    function drawIce() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (iceGrid[r][c] > 0) {
                    const x = offsetX + c * cellSize + 6;
                    const y = offsetY + r * cellSize + 6;
                    const w = cellSize - 12;
                    const h = cellSize - 12;
                    const grd = ctx.createLinearGradient(x, y, x + w, y + h);
                    grd.addColorStop(0, 'rgba(200, 240, 255, 0.55)');
                    grd.addColorStop(1, 'rgba(140, 200, 255, 0.45)');
                    ctx.fillStyle = grd;
                    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                    ctx.lineWidth = 2;
                    ctx.fillRect(x, y, w, h);
                    ctx.strokeRect(x, y, w, h);
                    ctx.beginPath();
                    ctx.moveTo(x + w * 0.2, y + h * 0.2);
                    ctx.lineTo(x + w * 0.5, y + h * 0.4);
                    ctx.lineTo(x + w * 0.8, y + h * 0.2);
                    ctx.moveTo(x + w * 0.3, y + h * 0.7);
                    ctx.lineTo(x + w * 0.6, y + h * 0.55);
                    ctx.lineTo(x + w * 0.8, y + h * 0.8);
                    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
            }
        }
        // 破冰过渡（碎片/淡出）
        for (let i = 0; i < iceAnims.length; i++) {
            const a = iceAnims[i];
            const x = offsetX + a.c * cellSize + cellSize / 2;
            const y = offsetY + a.r * cellSize + cellSize / 2;
            const t = 1 - a.life / a.maxLife;
            const alpha = 1 - t;
            const pieces = 6;
            for (let p = 0; p < pieces; p++) {
                const ang = (Math.PI * 2 / pieces) * p;
                const rx = Math.cos(ang) * (8 + t * 18);
                const ry = Math.sin(ang) * (8 + t * 18);
                ctx.globalAlpha = alpha * 0.8;
                ctx.fillStyle = 'rgba(200,240,255,1)';
                ctx.beginPath();
                ctx.arc(x + rx, y + ry, 3 * (1 - t), 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }
    }

    // 震动与抖动
    function triggerVibrate(ms) {
        if (navigator.vibrate) {
            try { navigator.vibrate(ms); } catch (_) { /* ignore */ }
        }
    }

    function triggerShake(durationMs, magnitude) {
        shakeTime = durationMs;
        shakeMagnitude = magnitude;
    }

    function tick() {
        timeMs += 16;
        if (shakeTime > 0) shakeTime -= 16;
        updateParticles();
        updateIceAnims();
        updateTutorial();
        render();
        requestAnimationFrame(tick);
    }

    function checkLevelComplete() {
        if (levelProgress >= levelTarget) {
            // 关卡完成
            currentLevel++;
            saveProgress();
            
            // 静默进入下一关，不显示弹窗
            nextLevel();
        }
    }

    function nextLevel() {
        // 增加步数奖励
        movesLeft += Math.floor(currentLevel / 2) + 1;
        updateLevelTarget();
        generateBoard();
        generateGoals();
        updateLevelUI();
        render();
        playBeep(660, 0.1, 0.06);
        
        // 确保新手教程状态正确（已完成新手教程的玩家不应该再看到教程）
        if (hasCompletedTutorial) {
            tutorialActive = false;
        }
    }

    function checkWinLose() {
        const allDone = Object.keys(goals).length > 0 && Object.values(goals).every(v => v <= 0);
        if (allDone) {
            // 静默处理目标完成，不显示弹窗
            return;
        }
        if (movesLeft <= 0) {
            // 静默处理步数用尽，不显示弹窗
            return;
        }
    }

    // 检查并自动处理无解情况
    function checkAndHandleNoMoves() {
        if (!hasMoves()) {
            // 静默自动重排，不显示弹窗
            reshuffle();
            render();
            playBeep(500, 0.1, 0.05);
        }
    }

    function computeHint() {
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const here = grid[r][c];
                if (!here) continue;
                const nbs = [ {r:r-1,c}, {r:r+1,c}, {r, c:c-1}, {r, c:c+1} ];
                for (const nb of nbs) {
                    if (!isValidCell(nb.r, nb.c)) continue;
                    const other = grid[nb.r][nb.c];
                    if (other && other.colorIndex === here.colorIndex) {
                        const hp = [ {row:r,col:c}, {row:nb.r,col:nb.c} ];
                        const more = [ {r:nb.r-1,c:nb.c}, {r:nb.r+1,c:nb.c}, {r:nb.r, c:nb.c-1}, {r:nb.r, c:nb.c+1} ];
                        for (const m of more) {
                            if (!isValidCell(m.r, m.c)) continue;
                            if (m.r===r && m.c===c) continue;
                            const dot = grid[m.r][m.c];
                            if (dot && dot.colorIndex === here.colorIndex && areAdjacent({row:nb.r,col:nb.c},{row:m.r,col:m.c})) {
                                hp.push({row:m.r,col:m.c});
                                break;
                            }
                        }
                        return hp;
                    }
                }
            }
        }
        return null;
    }

    function showHint() {
        hintPath = computeHint();
        setTimeout(() => { hintPath = null; }, 1200);
        playBeep(700, 0.06, 0.05);
    }

    // 新手引导相关函数
    function startTutorial() {
        tutorialActive = true;
        tutorialStep = 0;
        tutorialTimer = 0;
        tutorialPath = [];
        
        // 寻找一个简单的连接示例
        findTutorialExample();
    }

    function findTutorialExample() {
        // 寻找至少3个同色圆点的连接路径作为引导示例
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const here = grid[r][c];
                if (!here) continue;
                
                // 使用深度优先搜索寻找至少3个点的路径
                const path = findPathFromPoint(r, c, here.colorIndex, 3);
                if (path && path.length >= 3) {
                    tutorialPath = path;
                    return;
                }
            }
        }
        
        // 如果找不到3个点的路径，至少找2个相邻的点
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const here = grid[r][c];
                if (!here) continue;
                
                const neighbors = [
                    { r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }
                ];
                
                for (const nb of neighbors) {
                    if (isValidCell(nb.r, nb.c)) {
                        const other = grid[nb.r][nb.c];
                        if (other && other.colorIndex === here.colorIndex) {
                            tutorialPath = [
                                { row: r, col: c },
                                { row: nb.r, col: nb.c }
                            ];
                            return;
                        }
                    }
                }
            }
        }
    }

    function findPathFromPoint(startR, startC, colorIndex, minLength) {
        const visited = new Set();
        const path = [];
        
        function dfs(r, c) {
            if (path.length >= minLength) return true;
            if (!isValidCell(r, c)) return false;
            if (visited.has(r + ',' + c)) return false;
            
            const dot = grid[r][c];
            if (!dot || dot.colorIndex !== colorIndex) return false;
            
            visited.add(r + ',' + c);
            path.push({ row: r, col: c });
            
            if (path.length >= minLength) return true;
            
            // 检查相邻位置
            const neighbors = [
                { r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }
            ];
            
            for (const nb of neighbors) {
                if (dfs(nb.r, nb.c)) return true;
            }
            
            // 回溯
            path.pop();
            visited.delete(r + ',' + c);
            return false;
        }
        
        return dfs(startR, startC) ? path : null;
    }

    function updateTutorial() {
        if (!tutorialActive) return;
        
        tutorialTimer += 16;
        
        // 每5秒切换一次引导步骤（给玩家更多时间操作）
        if (tutorialTimer > 5000) {
            tutorialStep = (tutorialStep + 1) % 2;
            tutorialTimer = 0;
            
            if (tutorialStep === 0) {
                // 寻找简单连接示例
                findTutorialExample();
            } else {
                // 寻找回路示例
                findLoopExample();
            }
        }
    }

    function showTutorialHint() {
        // 播放提示音效
        playBeep(400, 0.1, 0.05);
        
        // 重新激活新手引导，确保文字提示继续显示
        if (!hasCompletedTutorial) {
            tutorialActive = true;
            tutorialTimer = 0;
            findTutorialExample();
        }
    }

    function showTutorialSuccess() {
        // 标记新手引导已完成
        hasCompletedTutorial = true;
        hasShownSuccessPopup = true;
        saveTutorialProgress();
        
        // 显示成功提示
        if (overlayTitle) overlayTitle.textContent = '很好！';
        if (overlayDesc) overlayDesc.textContent = '你学会了基本操作，现在可以自由游戏了！';
        overlay.classList.remove('hidden');
        
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 3000);
        
        playBeep(660, 0.1, 0.06);
        playBeep(880, 0.1, 0.06);
    }

    function restartTutorial() {
        // 重新开始引导
        tutorialActive = true;
        tutorialTimer = 0;
        tutorialStep = 0; // 重置到第一步
        findTutorialExample();
        playBeep(300, 0.1, 0.05);
    }

    function findLoopExample() {
        // 寻找至少4个点的回路示例（起点+2个中间点+回到起点）
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const here = grid[r][c];
                if (!here) continue;
                
                // 寻找从起点开始的回路路径
                const loopPath = findLoopFromPoint(r, c, here.colorIndex);
                if (loopPath && loopPath.length >= 4) {
                    tutorialPath = loopPath;
                    return;
                }
            }
        }
        
        // 如果找不到回路示例，回到简单连接
        findTutorialExample();
    }

    function findLoopFromPoint(startR, startC, colorIndex) {
        const visited = new Set();
        const path = [];
        
        function dfs(r, c, isFirst = true) {
            if (!isValidCell(r, c)) return false;
            
            const dot = grid[r][c];
            if (!dot || dot.colorIndex !== colorIndex) return false;
            
            // 如果不是起点，检查是否已经访问过
            if (!isFirst && visited.has(r + ',' + c)) return false;
            
            visited.add(r + ',' + c);
            path.push({ row: r, col: c });
            
            // 如果路径长度至少3个点，检查是否能回到起点
            if (path.length >= 3) {
                const neighbors = [
                    { r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }
                ];
                
                for (const nb of neighbors) {
                    if (isValidCell(nb.r, nb.c) && nb.r === startR && nb.c === startC) {
                        // 找到回到起点的路径，形成回路
                        path.push({ row: startR, col: startC });
                        return true;
                    }
                }
            }
            
            // 继续搜索相邻位置
            const neighbors = [
                { r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }
            ];
            
            for (const nb of neighbors) {
                if (dfs(nb.r, nb.c, false)) return true;
            }
            
            // 回溯
            path.pop();
            visited.delete(r + ',' + c);
            return false;
        }
        
        return dfs(startR, startC) ? path : null;
    }

    // 进度保存和加载
    function saveProgress() {
        const progress = {
            level: currentLevel,
            totalEliminated: totalEliminated,
            bestScore: Math.max(score, getBestScore()),
            hasCompletedTutorial: hasCompletedTutorial
        };
        localStorage.setItem('twoDotsProgress', JSON.stringify(progress));
    }

    function loadProgress() {
        const saved = localStorage.getItem('twoDotsProgress');
        if (saved) {
            try {
                const progress = JSON.parse(saved);
                currentLevel = progress.level || 1;
                totalEliminated = progress.totalEliminated || 0;
                hasCompletedTutorial = progress.hasCompletedTutorial || false;
                return progress.bestScore || 0;
            } catch (e) {
                console.log('无法加载进度');
            }
        }
        return 0;
    }

    function saveTutorialProgress() {
        // 单独保存新手引导状态
        const tutorialData = {
            hasCompletedTutorial: hasCompletedTutorial,
            hasShownSuccessPopup: hasShownSuccessPopup
        };
        localStorage.setItem('twoDotsTutorial', JSON.stringify(tutorialData));
    }

    function loadTutorialProgress() {
        // 加载新手引导状态
        const saved = localStorage.getItem('twoDotsTutorial');
        if (saved) {
            try {
                const tutorialData = JSON.parse(saved);
                hasCompletedTutorial = tutorialData.hasCompletedTutorial || false;
                hasShownSuccessPopup = tutorialData.hasShownSuccessPopup || false;
            } catch (e) {
                console.log('无法加载新手引导状态');
            }
        }
    }

    function getBestScore() {
        const saved = localStorage.getItem('twoDotsProgress');
        if (saved) {
            try {
                const progress = JSON.parse(saved);
                return progress.bestScore || 0;
            } catch (e) {
                return 0;
            }
        }
        return 0;
    }

    // 启动
    loadProgress();
    loadTutorialProgress();
    initBGM();
    resetGame();
    requestAnimationFrame(tick);
    
    // 显示开始弹窗
    if (startOverlay) {
        startOverlay.style.display = 'flex';
    }
})();


