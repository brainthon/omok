// utils/ai.js
// 싱글 플레이 모드를 위한 기초적인 오목 AI (그리디 평가 함수 + 휴리스틱 반영)

function evaluateLine(count, openEnds) {
    // 승리 확정 (5목 이상)
    if (count >= 5) return 100000;

    // 4목
    if (count === 4) {
        if (openEnds === 2) return 10000; // 양쪽 열린 4목 (필승)
        if (openEnds === 1) return 1000;  // 한쪽 막힌 4목 (공격 우선권)
    }

    // 3목
    if (count === 3) {
        if (openEnds === 2) return 500;   // 양쪽 열린 3목 (유리함)
        if (openEnds === 1) return 50;    // 한쪽 막힌 3목
    }

    // 2목
    if (count === 2) {
        if (openEnds === 2) return 10;    // 양쪽 열린 2목
        if (openEnds === 1) return 1;     // 한쪽 막힌 2목
    }
    return 0;
}

function calculateScore(board, x, y, player) {
    let score = 0;
    const directions = [
        [[1, 0], [-1, 0]],   // 가로
        [[0, 1], [0, -1]],   // 세로
        [[1, 1], [-1, -1]],  // 우하향 대각선
        [[1, -1], [-1, 1]]   // 우상향 대각선
    ];

    for (let dir of directions) {
        let count = 1;
        let openEnds = 0;

        for (let d of dir) {
            let dx = x + d[0];
            let dy = y + d[1];

            // 같은 돌이 몇 개 연속되어 있는지 확인
            while (dx >= 0 && dx < 19 && dy >= 0 && dy < 19 && board[dy][dx] === player) {
                count++;
                dx += d[0];
                dy += d[1];
            }

            // 끝이 열려있는지(0인지) 확인
            if (dx >= 0 && dx < 19 && dy >= 0 && dy < 19 && board[dy][dx] === 0) {
                openEnds++;
            }
        }
        score += evaluateLine(count, openEnds);
    }
    return score;
}

function getBestMove(board, aiPlayerNumber) {
    const humanPlayerNumber = aiPlayerNumber === 1 ? 2 : 1;
    let bestScore = -1;
    let bestMove = null;

    // 만약 보드가 완전히 비어있다면 정중앙(9, 9)을 선호
    let isEmpty = true;
    for (let i = 0; i < 19; i++) {
        for (let j = 0; j < 19; j++) {
            if (board[i][j] !== 0) { isEmpty = false; break; }
        }
        if (!isEmpty) break;
    }
    // 선공일 때 가운데 보너스
    if (isEmpty) return { x: 9, y: 9 };

    // 모든 빈칸 탐색
    for (let y = 0; y < 19; y++) {
        for (let x = 0; x < 19; x++) {
            if (board[y][x] === 0) {
                // 공격 점수 (AI가 여기에 두었을 때 얻는 이득)
                const attackScore = calculateScore(board, x, y, aiPlayerNumber);

                // 방어 점수 (상대가 여기에 두었을 때 얻을 이득을 차단하는 효과)
                const defenseScore = calculateScore(board, x, y, humanPlayerNumber);

                // 휴리스틱 점수 계산
                // 방어를 약간 더 우선시하지만, 내가 확실히 이길 수 있는 수(10000점 이상)가 있다면 공격 최우선
                let totalScore = attackScore + defenseScore * 1.2;

                if (attackScore >= 100000) {
                    totalScore += 200000; // 내가 즉시 이기는 수
                } else if (defenseScore >= 100000) {
                    totalScore += 100000; // 상대가 즉시 이기는 수를 막아야 함
                }

                // 위치 가중치: 난전 상황일수록 보드 중앙 쪽에 두는 것을 선호
                const centerWeight = 1 - (Math.abs(9 - x) + Math.abs(9 - y)) / 18;
                totalScore += centerWeight;

                if (totalScore > bestScore) {
                    bestScore = totalScore;
                    bestMove = { x, y };
                }
            }
        }
    }

    // 만약 둘 곳을 전혀 찾지 못했다면(거의 불가능하지만 예외처리) 첫 빈칸 반환
    if (!bestMove) {
        for (let y = 0; y < 19; y++) {
            for (let x = 0; x < 19; x++) {
                if (board[y][x] === 0) return { x, y };
            }
        }
    }

    return bestMove;
}

module.exports = { getBestMove };
