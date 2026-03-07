require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getBestMove } = require('./utils/ai.js'); // AI 로직 불러오기
const { getAiChatResponse, getProactiveAiMessage, clearChatHistory, recordGameResult } = require('./utils/chatbot.js'); // 제미나이 AI 챗봇 모듈

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 정적 파일 서빙
app.use(express.static('public'));

// 간단한 인메모리 게임 상태 및 룸 관리
const rooms = {};

// 19x19 빈 보드 생성 함수
function createEmptyBoard() {
    return Array(19).fill(null).map(() => Array(19).fill(0));
}

io.on('connection', (socket) => {
    console.log('플레이어 접속 대기:', socket.id);
    let joinedRoomId = null; // 사용자가 현재 입장한 게임 방 ID

    // 전체 접속자 수 브로드캐스트 (모드별 분리)
    function broadcastGlobalUsers() {
        let singlePlayers = 0;

        // 1. 방에 있는 유저 계산 (AI 봇 제외)
        Object.values(rooms).forEach(r => {
            if (r && r.isAiRoom) {
                singlePlayers += r.players.filter(p => p.id !== 'AI_BOT').length;
            }
        });

        // 2. 멀티플레이어 유저는 'lobbyViewers' 방에 접속한 클라이언트 수로 계산
        // (홈 화면에만 접속한 기본 유저는 제외됨)
        const multiPlayers = io.sockets.adapter.rooms.get('lobbyViewers')?.size || 0;

        io.emit('s2p_globalUsers', { single: singlePlayers, multi: multiPlayers });
    }

    broadcastGlobalUsers();

    function broadcastRoomList() {
        const publicRooms = Object.values(rooms).filter(r => r !== null && !r.isAiRoom).map(r => ({
            id: r.id,
            name: r.name,
            playersCount: r.players.length,
            status: r.status,
            isPrivate: !!r.password // 비밀번호가 있으면 비공개 방 플래그 전송
        }));
        io.to('lobbyViewers').emit('s2p_roomList', publicRooms);
    }

    // 1. 대시보드(로비) 접속 이벤트
    socket.on('p2s_joinLobby', (data) => {
        const nickname = data.nickname || `Guest_${socket.id.substring(0, 4)}`;
        socket.nickname = nickname;

        socket.join('lobbyViewers');

        // 방 목록과 함께 현재 전체 접속자 수도 즉시 전송
        broadcastGlobalUsers();

        socket.emit('s2p_roomList', Object.values(rooms).filter(r => r !== null && !r.isAiRoom).map(r => ({
            id: r.id,
            name: r.name,
            playersCount: r.players.length,
            status: r.status,
            isPrivate: !!r.password // 비밀번호가 있으면 비공개 방 플래그 전송
        })));
    });

    // 1-1. 닉네임 중복 체크
    socket.on('p2s_checkNickname', (data, callback) => {
        const requestedNickname = (data.nickname || '').trim();
        if (!requestedNickname) {
            return callback({ isAvailable: false, message: '닉네임을 입력해주세요.' });
        }
        let isAvailable = true;
        for (let [id, s] of io.sockets.sockets) {
            if (s.nickname === requestedNickname && s.id !== socket.id) {
                isAvailable = false;
                break;
            }
        }
        callback({ isAvailable, message: isAvailable ? '사용 가능한 닉네임입니다.' : '이미 접속 중인 유저가 사용하고 있는 닉네임입니다.' });
    });

    // 2. 새 방 만들기 요청 (비밀번호 옵션 포함)
    socket.on('p2s_createRoom', (data) => {
        const roomId = 'room_' + Date.now();
        const roomName = data && data.name ? data.name : `${socket.nickname}님의 방`;
        const password = data && data.password ? data.password : null;

        rooms[roomId] = {
            id: roomId,
            name: roomName,
            password: password, // 비밀번호 저장
            board: createEmptyBoard(),
            players: [],
            currentTurn: 1,
            status: 'waiting'
        };
        socket.emit('s2p_roomCreated', { roomId, password });
        broadcastRoomList();
        broadcastGlobalUsers();
    });

    // 3. 특정 방 입장 이벤트 (비밀번호 검증 포함)
    socket.on('p2s_joinRoom', (data) => {
        if (joinedRoomId) return; // 이미 방에 입장함

        const roomId = data.roomId;
        if (!rooms[roomId]) {
            socket.emit('s2p_joinError', '존재하지 않는 방입니다.');
            return;
        }

        const room = rooms[roomId];

        // 비밀번호 검증 (비공개 방일 경우)
        if (room.password) {
            if (!data.password || data.password !== room.password) {
                socket.emit('s2p_joinError', '비밀번호가 일치하지 않습니다.');
                return;
            }
        }

        joinedRoomId = roomId;
        socket.join(roomId);

        let playerNumber = 0;
        if (room.players.length === 0) {
            playerNumber = 1; // 흑돌
            room.players.push({ id: socket.id, number: 1, nickname: socket.nickname, isReady: false });
        } else if (room.players.length === 1) {
            playerNumber = 2; // 백돌
            room.players.push({ id: socket.id, number: 2, nickname: socket.nickname, isReady: false });
        }

        // 접속한 클라이언트에게 초기 정보 전송
        socket.emit('s2p_init', {
            playerNumber: playerNumber,
            board: room.board,
            currentTurn: room.currentTurn,
            nickname: socket.nickname
        });

        // 시스템 메시지: 플레이어 입장
        const roleName = playerNumber === 1 ? '흑돌' : (playerNumber === 2 ? '백돌' : '관전자');
        io.to(roomId).emit('s2p_chat', {
            type: 'system',
            message: `[${roleName}] ${socket.nickname}님이 입장했습니다.`
        });

        broadcastRoomList(); // 방 인원수 변경 알림

        // 2명이 모두 모였고 아직 대기중이라면 준비 상태로 전환
        if (room.players.length === 2 && room.status === 'waiting' && !room.isAiRoom) {
            room.status = 'ready';
            io.to(roomId).emit('s2p_askReady');
            broadcastRoomList(); // 상태 변경 알림
        }
    });

    // 4. AI 방 만들기 요청
    socket.on('p2s_createAiRoom', (data = {}) => {
        if (joinedRoomId) return; // 이미 방에 입장함
        const nickname = data.nickname || socket.nickname || `Guest_${socket.id.substring(0, 4)}`;
        socket.nickname = nickname;

        const roomId = 'airoom_' + Date.now();
        rooms[roomId] = {
            id: roomId,
            name: `${nickname}님 vs AI`,
            board: createEmptyBoard(),
            players: [],
            currentTurn: 1,
            status: 'playing',
            isAiRoom: true // AI 방임을 표시하는 플래그
        };

        joinedRoomId = roomId;
        socket.join(roomId);
        socket.leave('lobbyViewers');

        const room = rooms[roomId];

        // 1. 유저 (흑돌)
        room.players.push({ id: socket.id, number: 1, nickname: nickname, isReady: true });
        // 2. 인공지능 (백돌)
        room.players.push({ id: 'AI_BOT', number: 2, nickname: '인공지능 봇', isReady: true });

        socket.emit('s2p_init', {
            playerNumber: 1,
            board: room.board,
            currentTurn: room.currentTurn,
            nickname: nickname
        });

        io.to(roomId).emit('s2p_chat', {
            type: 'system',
            message: `[시스템] 인공지능과의 단판 승부가 시작되었습니다!`
        });

        io.to(roomId).emit('s2p_gameStart');
        io.to(roomId).emit('s2p_updateBoard', {
            board: room.board,
            currentTurn: room.currentTurn,
            lastMove: null
        });

        broadcastRoomList();

        // AI가 게임 시작 시 먼저 인사 건네기
        setTimeout(async () => {
            if (rooms[roomId]) {
                const greeting = await getProactiveAiMessage('start', nickname, roomId);
                io.to(roomId).emit('s2p_chat', { type: 'user', sender: '인공지능 봇', message: greeting });
            }
        }, 1200);
    });

    // 레디(준비 완전) 이벤트
    socket.on('p2s_ready', () => {
        if (!joinedRoomId || !rooms[joinedRoomId]) return;
        const roomId = joinedRoomId;
        const room = rooms[roomId];

        const p = room.players.find(player => player.id === socket.id);
        if (p) {
            p.isReady = true;

            // 두 명 모두 준비가 되었다면 게임 시작
            if (room.players.length === 2 && room.players.every(player => player.isReady)) {
                room.status = 'playing';
                room.board = createEmptyBoard(); // 보드 초기화
                room.currentTurn = 1; // 흑돌부터

                // 다음 라운드를 위해 레디 상태 리셋 (AI는 항상 레디상태 유지)
                room.players.forEach(player => {
                    if (player.id !== 'AI_BOT') player.isReady = false;
                });

                // AI 방 재시작 시 대화 히스토리 초기화
                if (room.isAiRoom) {
                    clearChatHistory(roomId);
                    const userName = room.players.find(p => p.number === 1)?.nickname || '유저';
                    setTimeout(async () => {
                        if (rooms[roomId]) {
                            const greeting = await getProactiveAiMessage('start', userName, roomId);
                            io.to(roomId).emit('s2p_chat', { type: 'user', sender: '인공지능 봇', message: greeting });
                        }
                    }, 1200);
                }

                io.to(roomId).emit('s2p_gameStart');
                io.to(roomId).emit('s2p_updateBoard', {
                    board: room.board,
                    currentTurn: room.currentTurn,
                    lastMove: null
                });
                broadcastRoomList(); // 게임 중으로 상태 변경
            }
        }
    });

    // 5목 승리 판별 함수 (가로, 세로, 2개의 대각선)
    function checkWin(board, x, y, player) {
        const directions = [
            [[1, 0], [-1, 0]],   // 가로
            [[0, 1], [0, -1]],   // 세로
            [[1, 1], [-1, -1]],  // 우하향 대각선
            [[1, -1], [-1, 1]]   // 우상향 대각선
        ];

        for (let dir of directions) {
            let count = 1; // 방금 놓은 돌 1개
            for (let d of dir) {
                let dx = x + d[0];
                let dy = y + d[1];
                while (dx >= 0 && dx < 19 && dy >= 0 && dy < 19 && board[dy][dx] === player) {
                    count++;
                    dx += d[0];
                    dy += d[1];
                }
            }
            if (count >= 5) return true; // 5목 이상이면 승리 (육목 허용 룰 - 심플 버전)
        }
        return false;
    }

    // 1. 착수 (돌 놓기)
    socket.on('p2s_placeStone', (data) => {
        if (!joinedRoomId || !rooms[joinedRoomId]) return;
        const roomId = joinedRoomId;
        const room = rooms[roomId];
        const p = room.players.find(player => player.id === socket.id);
        const playerNumber = p ? p.number : 0;

        const { x, y } = data;

        // 유효성 검사
        if (room.status !== 'playing') return; // 게임 진행 상태가 아니면 무시
        if (playerNumber === 0) return; // 관전자는 돌을 둘 수 없음
        if (room.currentTurn !== playerNumber) return; // 자신의 턴이 아님
        if (x < 0 || x >= 19 || y < 0 || y >= 19) return; // 보드 범위를 벗어남
        if (room.board[y][x] !== 0) return; // 이미 돌이 있는 자리

        // 상태 업데이트
        room.board[y][x] = playerNumber;

        // 승리 판별
        const isWin = checkWin(room.board, x, y, playerNumber);

        if (!isWin) {
            // 턴 넘기기
            room.currentTurn = room.currentTurn === 1 ? 2 : 1;

            // 만약 현재 방이 AI 방이고 상대방(서버) 턴이라면 자동으로 수 계산 및 착수 진행
            if (room.isAiRoom && room.currentTurn === 2 && room.status === 'playing') {
                setTimeout(() => {
                    executeAiMove(roomId);
                }, 600); // 0.6초 딜레이 (사람인 척)
            }
        } else {
            // 승리가 결정되면 게임 종료
            room.currentTurn = 0;
            room.status = 'waiting'; // 다시 대기 상태로
            broadcastRoomList();
        }

        // 모든 클라이언트에게 보드 업데이트 및 턴 정보 방송
        io.to(roomId).emit('s2p_updateBoard', {
            board: room.board,
            currentTurn: room.currentTurn,
            lastMove: { x, y, playerNumber }
        });

        // 승리 이벤트 방송
        if (isWin) {
            io.to(roomId).emit('s2p_gameOver', {
                winner: playerNumber,
                winnerName: socket.nickname
            });
            // 방 상태를 ready로 바꾸고 클라이언트에서 재대결을 누르면 다시 p2s_ready를 보내도록 함
            room.status = 'ready';
            broadcastRoomList();

            // AI 방에서 유저가 승리했을 때
            if (room.isAiRoom) {
                // 전적 기록: 유저 승리
                recordGameResult(roomId, 'user');
                setTimeout(async () => {
                    const aiReply = await getProactiveAiMessage('lose', socket.nickname, roomId);
                    io.to(roomId).emit('s2p_chat', { type: 'user', sender: '인공지능 봇', message: aiReply });
                }, 1500);
            }
        }
    });

    // AI 자동 돌 두기 (2번, 백돌 권한)
    function executeAiMove(roomId) {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing' || room.currentTurn !== 2) return;

        // 최고의 수를 계산해온다.
        const aiMove = getBestMove(room.board, 2);
        if (!aiMove) return;

        const { x, y } = aiMove;
        room.board[y][x] = 2; // 돌 놓기

        const isWin = checkWin(room.board, x, y, 2);

        if (!isWin) {
            room.currentTurn = 1; // 턴 다시 유저에게 반환
        } else {
            room.currentTurn = 0;
            room.status = 'ready'; // 재시작을 위해 ready 화면 띄우도록 바꿈
            broadcastRoomList();
        }

        io.to(roomId).emit('s2p_updateBoard', {
            board: room.board,
            currentTurn: room.currentTurn,
            lastMove: { x, y, playerNumber: 2 }
        });

        if (isWin) {
            io.to(roomId).emit('s2p_gameOver', {
                winner: 2,
                winnerName: '인공지능 봇'
            });

            // AI가 승리했을 때
            const userName = room.players.find(p => p.number === 1)?.nickname || '유저';
            // 전적 기록: AI 승리
            recordGameResult(roomId, 'ai');
            setTimeout(async () => {
                const aiReply = await getProactiveAiMessage('win', userName, roomId);
                io.to(roomId).emit('s2p_chat', { type: 'user', sender: '인공지능 봇', message: aiReply });
            }, 1500);
        }
    }

    // 2. 채팅 메시지
    socket.on('p2s_chat', async (data) => {
        if (!joinedRoomId || !rooms[joinedRoomId]) return;
        const roomId = joinedRoomId;
        const room = rooms[roomId];

        const senderNickname = socket.nickname || `Player ${room.players.find(p => p.id === socket.id)?.number || 'Obs'}`;

        // 먼저 유저의 메시지를 방에 브로드캐스트
        io.to(roomId).emit('s2p_chat', {
            type: 'user',
            sender: senderNickname,
            message: data.message
        });

        // 현재 방이 AI 방이고 채팅을 보낸 사람이 사람(AI봇이 아님)일 경우 AI 답변 생성
        if (room.isAiRoom && socket.id !== 'AI_BOT') {
            try {
                // AI 봇이 '입력 중...' 느낌을 주도록 약간의 지연
                setTimeout(async () => {
                    // 방이 아직 존재하는지(게임 진행 중인지) 다시 확인
                    if (rooms[roomId]) {
                        const aiReply = await getAiChatResponse(`플레이어(${senderNickname})의 메시지: ${data.message}`, roomId);
                        io.to(roomId).emit('s2p_chat', {
                            type: 'user',
                            sender: '인공지능 봇',
                            message: aiReply
                        });
                    }
                }, 1000 + Math.random() * 1000); // 1~2초 사이 딜레이
            } catch (error) {
                console.error('AI Chat Error in server:', error);
            }
        }
    });

    // 3. 연결 해제
    socket.on('disconnect', () => {
        console.log('플레이어 퇴장:', socket.nickname || socket.id);
        if (joinedRoomId) {
            leaveRoom(joinedRoomId, socket.id);
        }
        broadcastGlobalUsers();
        if (!joinedRoomId || !rooms[joinedRoomId]) return;
        const roomId = joinedRoomId;
        const room = rooms[roomId];

        const wasPlayer = room.players.some(p => p.id === socket.id);
        const leavingPlayer = room.players.find(p => p.id === socket.id);
        room.players = room.players.filter(p => p.id !== socket.id);

        if (wasPlayer && room.players.length < 2) {
            // 게임 중에 나간 경우 남은 플레이어 승리 처리
            if (room.status === 'playing' && room.players.length === 1 && !room.isAiRoom) {
                const remainingPlayer = room.players[0];
                room.status = 'ready'; // 재대결을 위해 준비 상태로

                io.to(roomId).emit('s2p_gameOver', {
                    winner: remainingPlayer.number,
                    winnerName: remainingPlayer.nickname
                });

                io.to(roomId).emit('s2p_chat', {
                    type: 'system',
                    message: `상대방(${leavingPlayer.nickname})이 도주하여 [${remainingPlayer.number === 1 ? '흑돌' : '백돌'}] ${remainingPlayer.nickname}님이 승리했습니다!`
                });
            } else {
                // 게임 중이 아니거나 한 명만 남았을 경우 대기 상태로 돌리기
                room.status = 'waiting';
            }
            room.players.forEach(p => p.isReady = false);
            broadcastRoomList();
        }

        if (room.players.length === 0) {
            // 방이 비면 방 삭제
            delete rooms[roomId];
            broadcastRoomList();
        } else {
            // 퇴장 메시지는 게임오버 도주 메시지가 발생하지 않았을 때만 표시
            if (!(wasPlayer && room.status === 'ready')) {
                io.to(roomId).emit('s2p_chat', {
                    type: 'system',
                    message: `${socket.nickname || '참여자'}님이 퇴장했습니다.`
                });
            }
            broadcastRoomList();
        }
    });
});

server.listen(PORT, () => {
    console.log(`프리미엄 오목 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
