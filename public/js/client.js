// 첫 화면(홈)에서도 접속자 수를 실시간으로 받기 위해 자동 연결 사용
const socket = io();

// === Screens ===
const homeScreen = document.getElementById('home-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

function switchScreen(screenId) {
    homeScreen.classList.remove('active');
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('active');
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('active');
    gameScreen.classList.add('hidden');

    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');

        // PIXI 캔버스가 초기에 숨겨진 상태(`display: none`)에서 0x0으로 렌더링되는 문제 해결
        if (screenId === 'game-screen' && typeof app !== 'undefined') {
            // 레이아웃이 완전히 잡힌 뒤 크기를 재계산하도록 아주 짧은 지연시간 부여
            setTimeout(() => {
                app.resize();
                drawBoard();
            }, 50);
        }
    }
}

// === Navigation & Lobby Buttons ===
let isAiMode = false;

document.getElementById('btn-mode-single').addEventListener('click', () => {
    isAiMode = true;
    nicknameModal.classList.remove('hidden');
});

document.getElementById('btn-mode-multi').addEventListener('click', () => {
    isAiMode = false;
    nicknameModal.classList.remove('hidden');
});

document.getElementById('btn-nickname-cancel').addEventListener('click', () => {
    nicknameModal.classList.add('hidden');
});

document.getElementById('btn-lobby-back').addEventListener('click', () => {
    switchScreen('home-screen');
    socket.disconnect(); // 로비에서 나갈 때 소켓 연결 끊어버림
});

const createRoomModal = document.getElementById('create-room-modal');
const createRoomForm = document.getElementById('create-room-form');
const roomNameInput = document.getElementById('room-name-input');
const roomPasswordInput = document.getElementById('room-password-input');
const privateRoomToggle = document.getElementById('private-room-toggle');
const passwordInputContainer = document.getElementById('password-input-container');

privateRoomToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
        passwordInputContainer.style.display = 'block';
        roomPasswordInput.required = true;
    } else {
        passwordInputContainer.style.display = 'none';
        roomPasswordInput.value = '';
        roomPasswordInput.required = false;
    }
});

document.getElementById('btn-create-room').addEventListener('click', () => {
    roomNameInput.value = `${myNickname}님의 방`;
    roomPasswordInput.value = '';
    privateRoomToggle.checked = false;
    passwordInputContainer.style.display = 'none';
    roomPasswordInput.required = false;
    createRoomModal.classList.remove('hidden');
});

document.getElementById('btn-create-room-cancel').addEventListener('click', () => {
    createRoomModal.classList.add('hidden');
});

createRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = roomNameInput.value.trim();
    const roomPassword = roomPasswordInput.value.trim();

    if (roomName) {
        socket.emit('p2s_createRoom', { name: roomName, password: roomPassword, isPrivate: privateRoomToggle.checked });
        createRoomModal.classList.add('hidden');
    }
});

// ==========================================
// 사운드 이펙트 재생 (Web Audio API)
// ==========================================
let isSoundEnabled = true;
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 브라우저 자동재생 정책(Autoplay Policy) 우회를 위해 사용자의 첫 상호작용 시 AudioContext 초기화
document.addEventListener('click', () => {
    initAudio();
}, { once: true });

function playStoneSound() {
    if (!isSoundEnabled) return;
    initAudio();
    if (!audioCtx) return;

    const t = audioCtx.currentTime;

    // 1. 나무에 부딪히는 맑은 타격음 (고주파 짧은 음)
    const clickOsc = audioCtx.createOscillator();
    const clickGain = audioCtx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(1200, t);
    clickOsc.frequency.exponentialRampToValueAtTime(400, t + 0.03);

    clickGain.gain.setValueAtTime(0.7, t);
    clickGain.gain.exponentialRampToValueAtTime(0.01, t + 0.03);

    clickOsc.connect(clickGain);
    clickGain.connect(audioCtx.destination);

    clickOsc.start(t);
    clickOsc.stop(t + 0.03);

    // 2. 바둑판의 묵직한 울림음 (저주파 진동)
    const thudOsc = audioCtx.createOscillator();
    const thudGain = audioCtx.createGain();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(350, t);
    thudOsc.frequency.exponentialRampToValueAtTime(100, t + 0.08);

    thudGain.gain.setValueAtTime(0.6, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    thudOsc.connect(thudGain);
    thudGain.connect(audioCtx.destination);

    thudOsc.start(t);
    thudOsc.stop(t + 0.08);
}

// UI 토글 버튼 배선
const btnToggleSound = document.getElementById('btn-toggle-sound');
if (btnToggleSound) {
    btnToggleSound.addEventListener('click', () => {
        isSoundEnabled = !isSoundEnabled;
        btnToggleSound.innerText = isSoundEnabled ? '🔊' : '🔇';
        if (isSoundEnabled) initAudio(); // 권한 획득 목적
    });
}


document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
    // (서버가 자동 갱신해주지만 UI용 피드백 버튼)
    console.log("새로고침 요청");
});

// UI Elements
const playerIndicator = document.getElementById('player-indicator');
const turnIndicator = document.getElementById('turn-indicator');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const canvasContainer = document.getElementById('game-canvas-container');

// 모달 요소 바인딩
const nicknameModal = document.getElementById('nickname-modal');
const nicknameForm = document.getElementById('nickname-form');
const nicknameInput = document.getElementById('nickname-input');

const readyModal = document.getElementById('ready-modal');
const btnReady = document.getElementById('btn-ready');
const readyStatusText = document.getElementById('ready-status-text');

const gameOverModal = document.getElementById('game-over-modal');
const winnerText = document.getElementById('winner-text');
const winnerSubtext = document.getElementById('winner-subtext');
const btnPlayAgain = document.getElementById('btn-play-again');
const playAgainStatusText = document.getElementById('play-again-status-text');
const btnExit = document.getElementById('btn-exit');

let myPlayerNumber = 0; // 1: 흑, 2: 백
let myNickname = '';
let currentTurn = 1;
const BOARD_SIZE = 19;
let cellSize = 0;
let boardPixelSize = 0;

const app = new PIXI.Application({
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: true,
    resizeTo: canvasContainer
});
canvasContainer.appendChild(app.view);

const boardContainer = new PIXI.Container();
const stonesContainer = new PIXI.Container();
app.stage.addChild(boardContainer);
app.stage.addChild(stonesContainer);

const gridGraphics = new PIXI.Graphics();
boardContainer.addChild(gridGraphics);

window.addEventListener('resize', () => {
    drawBoard();
});

function drawBoard() {
    gridGraphics.clear();

    const padding = 40;
    // 고해상도(DPI) 디스플레이에서 실제 렌더링 크기가 아닌 논리적 CSS 크기(screen)를 기준으로 계산해야 잘림 방지 가능
    const minDiemension = Math.min(app.screen.width, app.screen.height);
    boardPixelSize = minDiemension - (padding * 2);
    cellSize = boardPixelSize / (BOARD_SIZE - 1);

    boardContainer.x = (app.screen.width - boardPixelSize) / 2;
    boardContainer.y = (app.screen.height - boardPixelSize) / 2;
    stonesContainer.x = boardContainer.x;
    stonesContainer.y = boardContainer.y;

    // 나무판에 어울리는 어두운 묵색(진한 갈색/검정) 라인
    gridGraphics.lineStyle(1.5, 0x4a3219, 0.8);

    for (let i = 0; i < BOARD_SIZE; i++) {
        // 가로선
        gridGraphics.moveTo(0, i * cellSize);
        gridGraphics.lineTo(boardPixelSize, i * cellSize);
        // 세로선
        gridGraphics.moveTo(i * cellSize, 0);
        gridGraphics.lineTo(i * cellSize, boardPixelSize);
    }

    // 오목방/바둑판 전통 화점 (15x15 기준 보통 5개)
    // 좀 더 선명하고 전통적인 느낌을 위해 검은색으로 표시
    // 19x19 바둑판 화점(9개)
    const starPoints = [
        [3, 3], [9, 3], [15, 3],
        [3, 9], [9, 9], [15, 9],
        [3, 15], [9, 15], [15, 15]
    ];
    gridGraphics.lineStyle(0);
    gridGraphics.beginFill(0x3a2311, 0.9);
    starPoints.forEach(([x, y]) => {
        gridGraphics.drawCircle(x * cellSize, y * cellSize, 4);
    });
    gridGraphics.endFill();

    gridGraphics.interactive = true;
    gridGraphics.cursor = 'pointer';
    gridGraphics.hitArea = new PIXI.Rectangle(
        -cellSize / 2, -cellSize / 2,
        boardPixelSize + cellSize, boardPixelSize + cellSize
    );
}

gridGraphics.on('pointerdown', (e) => {
    if (myPlayerNumber === 0) return;
    if (currentTurn !== myPlayerNumber) return;

    const localPos = boardContainer.toLocal(e.global);
    let gridX = Math.round(localPos.x / cellSize);
    let gridY = Math.round(localPos.y / cellSize);

    if (gridX >= 0 && gridX < BOARD_SIZE && gridY >= 0 && gridY < BOARD_SIZE) {
        socket.emit('p2s_placeStone', { x: gridX, y: gridY });
    }
});

function drawStones(boardState) {
    stonesContainer.removeChildren();

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const stoneValue = boardState[y][x];
            if (stoneValue !== 0) {
                const stone = new PIXI.Graphics();

                if (stoneValue === 1) { // 흑돌
                    stone.beginFill(0x1a1a1e);
                    stone.drawCircle(0, 0, cellSize * 0.45);
                    stone.endFill();
                    stone.beginFill(0xffffff, 0.1);
                    stone.drawCircle(-cellSize * 0.1, -cellSize * 0.1, cellSize * 0.15);
                    stone.endFill();
                } else if (stoneValue === 2) { // 백돌
                    stone.beginFill(0xf1f2f6);
                    stone.drawCircle(0, 0, cellSize * 0.45);
                    stone.endFill();
                    const shadow = new PIXI.Graphics();
                    shadow.beginFill(0x000000, 0.1);
                    shadow.drawCircle(2, 4, cellSize * 0.45);
                    shadow.endFill();
                    stonesContainer.addChild(shadow);
                    shadow.x = x * cellSize;
                    shadow.y = y * cellSize;
                }

                stone.x = x * cellSize;
                stone.y = y * cellSize;

                stone.scale.set(0.5);
                stone.alpha = 0;

                stonesContainer.addChild(stone);

                let animProgress = 0;
                const ticker = new PIXI.Ticker();
                ticker.add(() => {
                    animProgress += 0.1;
                    if (animProgress >= 1) {
                        stone.scale.set(1);
                        stone.alpha = 1;
                        ticker.destroy();
                    } else {
                        const ease = 1 - Math.pow(1 - animProgress, 3);
                        stone.scale.set(0.5 + ease * 0.5);
                        stone.alpha = ease;
                    }
                });
                ticker.start();
            }
        }
    }
}

// 캔버스 초기화 시 소켓 연결 전이라도 빈 바둑판 먼저 그리기
setTimeout(() => {
    drawBoard();
}, 100);

// === 시스템/모달 로직 ===
// 닉네임 입력 이벤트 (Form 전송 -> 상황에 따라 로비 또는 AI게임방으로 이동)
nicknameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    myNickname = nicknameInput.value.trim();
    const msgEl = document.getElementById('nickname-message');

    if (myNickname) {
        // 소켓이 연결되지 않았다면 연결
        if (!socket.connected) {
            socket.connect();
        }

        const proceedToRoom = () => {
            if (isAiMode) {
                // 싱글 플레이: AI 방 생성 후 게임방 진입
                socket.emit('p2s_createAiRoom', { nickname: myNickname });
                switchScreen('game-screen');
                nicknameModal.classList.add('hidden');
                if (msgEl) msgEl.innerText = '';
            } else {
                // 온라인 대전: 멀티 로비로 진입
                switchScreen('lobby-screen');
                document.getElementById('lobby-nickname-display').innerText = myNickname;
                socket.emit('p2s_joinLobby', { nickname: myNickname });
                nicknameModal.classList.add('hidden');
                if (msgEl) msgEl.innerText = '';
            }
        };

        const checkAndProceed = () => {
            // 중복 체크 로직
            socket.emit('p2s_checkNickname', { nickname: myNickname }, (response) => {
                if (response.isAvailable) {
                    if (msgEl) {
                        msgEl.style.color = '#00b894';
                        msgEl.innerText = response.message;
                    }
                    // 성공 메시지 보여준 후 약간의 딜레이 뒤 입장
                    setTimeout(() => {
                        proceedToRoom();
                    }, 500);
                } else {
                    if (msgEl) {
                        msgEl.style.color = '#ff7675';
                        msgEl.innerText = response.message;
                    }
                }
            });
        };

        if (socket.connected) {
            checkAndProceed();
        } else {
            socket.once('connect', checkAndProceed);
        }
    }
});

// ==========================================
// Socket 커넥션 로직 및 로비 렌더링
// ==========================================
socket.on('s2p_roomList', (rooms) => {
    const listContainer = document.getElementById('room-list');
    listContainer.innerHTML = '';

    if (rooms.length === 0) {
        listContainer.innerHTML = '<p class="empty-msg">개설된 방이 없습니다. 새 게임 방을 만들어보세요!</p>';
        return;
    }

    rooms.forEach(room => {
        const item = document.createElement('div');
        item.className = 'room-item';

        // <h4> 버그 수정 (보안상 textContent 사용)
        const info = document.createElement('div');
        info.className = 'room-info';

        const titleEl = document.createElement('h4');
        titleEl.textContent = room.name;
        // 비밀번호가 있는 방이면 자물쇠 아이콘 추가
        if (room.isPrivate) {
            titleEl.textContent = '🔒 ' + titleEl.textContent;
        }

        const countEl = document.createElement('p');
        countEl.textContent = `현재 인원: ${room.playersCount}/2명`;

        info.appendChild(titleEl);
        info.appendChild(countEl);

        const status = document.createElement('div');
        status.className = 'room-status ' + (room.status === 'playing' ? 'status-playing' : 'status-waiting');
        status.innerText = room.status === 'playing' ? '게임 중' : '대기 중';

        item.appendChild(info);
        item.appendChild(status);

        // 들어갈 수 있는 방이면 클릭 이벤트 등록
        if (room.status === 'waiting' && room.playersCount < 2) {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                if (room.isPrivate) {
                    const pwd = prompt('비공개 방입니다. 비밀번호를 입력해주세요:');
                    if (pwd !== null) {
                        socket.emit('p2s_joinRoom', { roomId: room.id, password: pwd });
                    }
                } else {
                    socket.emit('p2s_joinRoom', { roomId: room.id });
                }
            });
        } else {
            item.style.opacity = '0.5';
            item.style.cursor = 'not-allowed';
        }

        listContainer.appendChild(item);
    });
});

socket.on('s2p_globalUsers', (stats) => {
    // 1. 홈 화면 (모드별 접속자 수 분리)
    const homeSingleUsers = document.getElementById('home-single-users');
    const homeMultiUsers = document.getElementById('home-multi-users');

    // 예외처리: 이전 서버 코드와 호환성을 위해 stats가 숫자로 올 경우
    if (typeof stats === 'number') {
        const usersDisplay = document.getElementById('global-users-display');
        if (usersDisplay) usersDisplay.innerText = `🟢 현재 접속자: ${stats}명`;
        return;
    }

    if (homeSingleUsers) {
        homeSingleUsers.innerText = `접속자: ${stats.single}명`;
    }
    if (homeMultiUsers) {
        homeMultiUsers.innerText = `대기실/진행: ${stats.multi}명`;
    }

    // 2. 로비 화면 (온라인 대전 총 접속자 수 표시)
    const usersDisplay = document.getElementById('global-users-display');
    if (usersDisplay) {
        usersDisplay.innerText = `🟢 멀티플레이 접속자: ${stats.multi}명`;
    }
});

socket.on('s2p_joinError', (msg) => {
    alert(msg);
});

socket.on('s2p_roomCreated', (data) => {
    socket.emit('p2s_joinRoom', { roomId: data.roomId, password: data.password });
    // switchScreen은 s2p_init에서 처리
});

socket.on('s2p_init', (data) => {
    myPlayerNumber = data.playerNumber;
    updateUI();

    // 방 접속에 성공했을 때 무조건 게임 화면으로 전환!
    switchScreen('game-screen');

    // 연결 후 상태 다시 그리기
    setTimeout(() => {
        drawBoard();
        drawStones(data.board);
    }, 100);
});

// 재대결 버튼 및 준비 완료 버튼 로직 공통화
function emitReady() {
    socket.emit('p2s_ready');
}

const btnReadyCancel = document.getElementById('btn-ready-cancel');
if (btnReadyCancel) {
    btnReadyCancel.addEventListener('click', () => {
        socket.disconnect(); // 방 폭파 및 연결 해제 트리거
        readyModal.classList.add('hidden');

        setTimeout(() => {
            if (isAiMode) {
                switchScreen('home-screen');
            } else {
                switchScreen('lobby-screen');
                socket.connect(); // 재접속
                document.getElementById('lobby-nickname-display').innerText = myNickname;
                socket.emit('p2s_joinLobby', { nickname: myNickname });
            }
        }, 500);
    });
}

btnReady.addEventListener('click', () => {
    emitReady();
    btnReady.innerText = '대기 중...';
    btnReady.disabled = true;
    readyStatusText.innerText = '상대방의 준비를 기다리고 있습니다.';
});

// 재대결 (서버로 ready 신호 보냄)
btnPlayAgain.addEventListener('click', () => {
    emitReady();
    btnPlayAgain.innerText = '대기 중...';
    btnPlayAgain.disabled = true;
    playAgainStatusText.innerText = '상대방의 준비를 기다리고 있습니다.';
});

// 나가기 (게임에서 완전히 빠져나와서 로비나 홈으로 복귀)
btnExit.addEventListener('click', () => {
    socket.disconnect(); // 기존 방폭파 및 연결 해제 트리거

    setTimeout(() => {
        gameOverModal.classList.add('hidden');
        if (isAiMode) {
            // 싱글 플레이는 홈 화면으로 복귀
            switchScreen('home-screen');
        } else {
            // 멀티 플레이는 로비로 재접속
            socket.connect();
            socket.emit('p2s_joinLobby', { nickname: myNickname });
            switchScreen('lobby-screen');
        }
    }, 500);
});


socket.on('s2p_askReady', () => {
    // 2명이 모였을 때 준비창 팝업
    gameOverModal.classList.add('hidden'); // 혹시 열려있으면 닫기
    readyModal.classList.remove('hidden');

    // 버튼 상태 초기화
    btnReady.innerText = '준비 완료 (Ready!)';
    btnReady.disabled = false;
    readyStatusText.innerText = '';

    // 재대결 버튼 초기화
    btnPlayAgain.innerText = '재대결 (준비하기)';
    btnPlayAgain.disabled = false;
    playAgainStatusText.innerText = '';
});

socket.on('s2p_gameStart', () => {
    // 양쪽 모두 레디 완료: 게임 시작!
    readyModal.classList.add('hidden');
    gameOverModal.classList.add('hidden');
    addChatMessage('system', '양쪽 모두 준비가 완료되어 게임이 시작됩니다!');
});

socket.on('s2p_updateBoard', (data) => {
    currentTurn = data.currentTurn;
    updateUI();
    drawStones(data.board);

    // 만약 라운드가 재시작되어 보드가 비워진 상태라면 게임 오버 창이 떠있으면 닫아줌
    if (data.lastMove === null) {
        gameOverModal.classList.add('hidden');
    } else {
        // 착수한 돌이 있다면 효과음 재생
        playStoneSound();
    }
});

socket.on('s2p_gameOver', (data) => {
    // 5목 승리 판정 이벤트
    const winnerColor = data.winner === 1 ? '흑돌' : '백돌';
    const isMe = data.winner === myPlayerNumber;

    // 채팅창 알림
    addChatMessage('system', `축하합니다![${winnerColor}] ${data.winnerName}님이 승리했습니다!`);

    // 모달 팝업
    winnerText.innerText = isMe ? '🎉 승리했습니다! 🎉' : '💀 패배했습니다...';
    winnerText.style.color = isMe ? '#00b894' : '#ff7675';
    winnerSubtext.innerText = `[${winnerColor}] ${data.winnerName}님의 ${data.winner === 1 ? '흑' : '백'} 승입니다.`;

    // 2번째 판부터 재대결 버튼이 계속 '대기 중...'으로 잠겨있는 버그 수정 (초기화)
    btnPlayAgain.innerText = '재대결 (준비하기)';
    btnPlayAgain.disabled = false;
    playAgainStatusText.innerText = '';

    gameOverModal.classList.remove('hidden');
});

socket.on('s2p_chat', (data) => {
    addChatMessage(data.type, data.message, data.sender);
});

function updateUI() {
    let roleText = '관전자';
    if (myPlayerNumber === 1) roleText = '당신은 ⚫ 흑돌입니다.';
    if (myPlayerNumber === 2) roleText = '당신은 ⚪ 백돌입니다.';
    playerIndicator.innerText = roleText;

    if (currentTurn === myPlayerNumber) {
        turnIndicator.innerText = "당신의 차례입니다.";
        turnIndicator.style.color = "var(--accent)";
    } else {
        turnIndicator.innerText = "상대방 차례입니다.";
        turnIndicator.style.color = "var(--text-muted)";
    }
}

function addChatMessage(type, message, sender = null) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('msg', type);

    let senderName = sender;
    // 내가 보낸 메시지인지 판단하는 조건: 애칭이 내 애칭과 같을 경우
    if (type === 'user' && sender === myNickname) {
        msgDiv.classList.add('me');
        senderName = '나';
    }

    if (type === 'system') {
        msgDiv.innerText = message;
    } else {
        const span = document.createElement('span');
        span.className = 'msg-sender';
        span.textContent = senderName;
        msgDiv.appendChild(span);
        msgDiv.appendChild(document.createTextNode(' ' + message));
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg) {
        socket.emit('p2s_chat', { message: msg });
        chatInput.value = '';
    }
});

// ==========================================
// 브라우저 뒤로가기 및 새로고침 이탈 방지
// ==========================================

// 1. 실수로 탭을 닫거나, 새로고침하거나, 게임 밖으로 완전히 나갈 때 경고
window.addEventListener('beforeunload', (e) => {
    const activeScreen = document.querySelector('.screen-container.active');
    if (activeScreen && (activeScreen.id === 'game-screen' || activeScreen.id === 'lobby-screen')) {
        e.preventDefault();
        e.returnValue = ''; // 크롬 등에서 기본 경고창을 띄우기 위한 필수 설정
    }
});

// 2. SPA 내에서 뒤로가기 버튼 방어 로직 (해시 기반)
window.location.hash = "playing"; // 초기 로드 시 해시 추가

window.addEventListener('popstate', (e) => {
    // 사용자가 뒤로가기를 눌러 해시가 없어졌을 때
    if (window.location.hash !== "#playing") {
        // 해시 강제 복구 (브라우저 기본 뒤로가기 무효화)
        history.pushState(null, null, "#playing");

        const activeScreen = document.querySelector('.screen-container.active');
        if (activeScreen && activeScreen.id === 'game-screen') {
            const confirmExit = confirm("정말 게임 방을 나가시겠습니까?\n진행 중인 게임이나 매칭이 취소됩니다.");
            if (confirmExit) {
                socket.disconnect(); // 방 나가기 및 초기화

                const readyModal = document.getElementById('ready-modal');
                const gameOverModal = document.getElementById('game-over-modal');
                if (readyModal) readyModal.classList.add('hidden');
                if (gameOverModal) gameOverModal.classList.add('hidden');

                setTimeout(() => {
                    if (isAiMode) {
                        switchScreen('home-screen');
                    } else {
                        switchScreen('lobby-screen');
                        socket.connect();
                        document.getElementById('lobby-nickname-display').innerText = myNickname;
                        socket.emit('p2s_joinLobby', { nickname: myNickname });
                    }
                }, 500);
            }
        } else if (activeScreen && activeScreen.id === 'lobby-screen') {
            const confirmExit = confirm("로비에서 나가 홈 화면으로 돌아가시겠습니까?");
            if (confirmExit) {
                switchScreen('home-screen');
                socket.disconnect();
            }
        }
    }
});
