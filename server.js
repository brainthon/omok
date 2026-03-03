const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getBestMove } = require('./utils/ai.js'); // AI 로직 불러오기

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

    function broadcastRoomList() {
        const publicRooms = Object.values(rooms).filter(r => r !== null).map(r => ({
            id: r.id,
            name: r.name,
            playersCount: r.players.length,
            status: r.status
        }));
        io.to('lobbyViewers').emit('s2p_roomList', publicRooms);
    }

    // 1. 대시보드(로비) 접속 이벤트
    socket.on('p2s_joinLobby', (data) => {
        const nickname = data.nickname || `Guest_${socket.id.substring(0, 4)}`;
        socket.nickname = nickname;

        socket.join('lobbyViewers');
        socket.emit('s2p_roomList', Object.values(rooms).filter(r => r !== null).map(r => ({
            id: r.id,
            name: r.name,
            playersCount: r.players.length,
            status: r.status
        })));
    });

    // 2. 새 방 만들기 요청
    socket.on('p2s_createRoom', () => {
        const roomId = 'room_' + Date.now();
        rooms[roomId] = {
            id: roomId,
            name: `${socket.nickname}님의 방`,
            board: createEmptyBoard(),
            players: [],
            currentTurn: 1,
            status: 'waiting'
        };
        socket.emit('s2p_roomCreated', { roomId });
        broadcastRoomList();
    });

    // 3. 특정 방 입장 이벤트
    socket.on('p2s_joinRoom', (data) => {
        if (joinedRoomId) return; // 이미 방에 입장함

        const roomId = data.roomId;
        if (!rooms[roomId]) return; // 방이 없음

        joinedRoomId = roomId;
        socket.join(roomId);
        socket.leave('lobbyViewers'); // 게임방 진입 시 로비 목록 수신 중단

        const room = rooms[roomId];

        // 최대 2명까지만 플레이어로 등록 (나머지는 관전자로 취급)
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
    socket.on('p2s_createAiRoom', () => {
        if (joinedRoomId) return; // 이미 방에 입장함
        const nickname = socket.nickname || `Guest_${socket.id.substring(0, 4)}`;
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
        }
    }

    // 2. 채팅 메시지
    socket.on('p2s_chat', (data) => {
        if (!joinedRoomId || !rooms[joinedRoomId]) return;
        const roomId = joinedRoomId;
        const room = rooms[roomId];

        io.to(roomId).emit('s2p_chat', {
            type: 'user',
            sender: socket.nickname || `Player ${room.players.find(p => p.id === socket.id)?.number || 'Obs'}`,
            message: data.message
        });
    });

    // 3. 연결 해제
    socket.on('disconnect', () => {
        console.log('플레이어 퇴장:', socket.nickname || socket.id);
        if (!joinedRoomId || !rooms[joinedRoomId]) return;
        const roomId = joinedRoomId;
        const room = rooms[roomId];

        const wasPlayer = room.players.some(p => p.id === socket.id);
        room.players = room.players.filter(p => p.id !== socket.id);

        if (wasPlayer && room.players.length < 2) {
            // 한 명이 나갔으므로 대기 상태로 돌리기
            room.status = 'waiting';
            room.players.forEach(p => p.isReady = false);
            broadcastRoomList();
        }

        if (room.players.length === 0) {
            // 방이 비면 방 삭제
            delete rooms[roomId];
            broadcastRoomList();
        } else {
            io.to(roomId).emit('s2p_chat', {
                type: 'system',
                message: `${socket.nickname || '참여자'}님이 퇴장했습니다.`
            });
            broadcastRoomList();
        }
    });
});

server.listen(PORT, () => {
    console.log(`프리미엄 오목 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
