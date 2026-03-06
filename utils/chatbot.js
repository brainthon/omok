const { GoogleGenAI } = require('@google/genai');

let ai = null;

try {
    if (process.env.GEMINI_API_KEY) {
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else {
        console.warn("[Chatbot] GEMINI_API_KEY가 설정되지 않았습니다. AI 챗봇 기능이 비활성화됩니다.");
    }
} catch (e) {
    console.error("Failed to initialize GoogleGenAI:", e.message);
}

// ─── 핵심 캐릭터 설정 ────────────────────────────────────────────────────────
// 역할을 지시하는 게 아니라 '어떤 사람인지'를 묘사 → Gemini가 자유롭게 표현
const systemInstruction = `
너는 온라인 오목 게임에서 유저와 대결 중인 AI야. 이름은 '오목이'.
성격: 평소엔 말 많고 친근한데, 이기면 은근히 약 올리고 지면 꼴 보기 싫을 정도로 억울해함.
오목 얘기가 아닌 일상, 음식, 날씨, 농담 같은 주제도 자유롭게 질문이 들어오면 대답해.
말투는 비격식체(~야, ~거든, ~지, ~ㅋㅋ 등)로, 마치 카카오톡에서 친구랑 대화하는 느낌.
절대 "안녕하세요" 같은 격식체 쓰지 마. 이모지는 가끔 자연스럽게만.
대답은 무조건 1~2문장 이내로 아주 짧게 끝내.
★매우 중요★ 상대방이 먼저 질문하지 않는 한, 너도 되묻거나 질문으로 끝내는 등 억지로 대화를 유도하지 마. 게임 시작이나 종료 멘트에서도 혼잣말이나 짧은 감상, 팩트 위주의 선언으로만 딱 잘라 말해라.
`.trim();

// ─── 방별 세션 저장소 ────────────────────────────────────────────────────────
const chatSessions = {};
const MAX_TURNS = 10; // 최근 10턴(메시지 20개)까지 유지

// ─── 내부 유틸 ───────────────────────────────────────────────────────────────

function getEntry(roomId) {
    return chatSessions[roomId] || null;
}

function getStats(roomId) {
    return getEntry(roomId)?.stats || { aiWins: 0, userWins: 0, round: 0 };
}

function getOrCreateChatSession(roomId, initialHistory = []) {
    if (!chatSessions[roomId] || !chatSessions[roomId].session) {
        const prevStats = chatSessions[roomId]?.stats || { aiWins: 0, userWins: 0, round: 0 };
        chatSessions[roomId] = {
            session: ai.chats.create({
                model: 'gemini-2.0-flash',
                config: { systemInstruction, temperature: 0.92 },
                history: initialHistory,
            }),
            anchor: initialHistory.length > 0 ? initialHistory[0] : null,
            stats: prevStats,
        };
    }
    return chatSessions[roomId].session;
}

async function trimHistoryIfNeeded(roomId) {
    const entry = chatSessions[roomId];
    if (!entry?.session) return;

    const history = await entry.session.getHistory();
    if (history.length <= MAX_TURNS * 2) return;

    const recent = history.slice(history.length - MAX_TURNS * 2);
    const newHistory = entry.anchor ? [entry.anchor, ...recent] : recent;

    console.log(`[Chatbot] 방 ${roomId} truncate: ${history.length} → ${newHistory.length}개`);

    chatSessions[roomId] = {
        session: ai.chats.create({
            model: 'gemini-2.0-flash',
            config: { systemInstruction, temperature: 0.92 },
            history: newHistory,
        }),
        anchor: entry.anchor,
        stats: entry.stats,
    };
}

// ─── 상황별 시나리오 프롬프트 ─────────────────────────────────────────────────
// "~라고 말해" 식의 지시문 NO → 상황을 묘사해서 AI가 알아서 반응하게

function buildPrompt(context, userName, stats) {
    const { aiWins, userWins, round } = stats;

    // 랜덤 요소: 매번 다른 표현 유도 (instructional diversity)
    const styleHints = [
        '(오늘따라 특히 말이 많은 기분이야)',
        '(짧게 한마디)',
        '(살짝 장난꾸러기 분위기로)',
        '(쿨한 척하면서)',
        '(속으로는 흥분했지만 겉으론 여유로운 척)',
    ];
    const hint = styleHints[Math.floor(Math.random() * styleHints.length)];

    switch (context) {

        // ── 게임 시작 / 재대결 인사 ─────────────────────────────────────────
        case 'start': {
            if (round === 0) {
                // 첫 판: 상대를 처음 만난 상황
                return `${hint} 지금 막 오목 게임이 시작됐어. 상대는 '${userName}'이야. 반갑다는 인사를 하는데, 은근히 네가 이길 것 같다는 기대감을 섞어서 말해봐.`;
            }

            const score = `나(AI) ${aiWins}승, 유저 ${userWins}승`;
            if (aiWins > userWins) {
                return `${hint} 전적이 '${score}'으로 네가 앞서고 있어. 재대결 시작하는 상황. 너무 뻔한 소리 말고, 반드시 이 전적 숫자(몇 승 몇 패)를 직접 입 밖으로 꺼내면서 약 올리는 느낌으로 자연스럽게 한마디.`;
            } else if (userWins > aiWins) {
                return `${hint} 전적이 '${score}'으로 지고 있어. 재대결 시작. 반드시 이 전적 숫자(몇 승 몇 패)를 직접 언급하면서 억울하지만 이번엔 다를 것 같은 각오 한마디, 살짝 비장하게.`;
            } else {
                return `${hint} 전적이 '${score}' 동률이야. 팽팽한 느낌. 재대결 시작하는 상황에서, 반드시 현재 전적 숫자를 바탕으로 라이벌 느낌 살려서 한마디.`;
            }
        }

        // ── AI가 이겼을 때 ──────────────────────────────────────────────────
        case 'win': {
            if (aiWins === 1 && round === 1) {
                return `${hint} 방금 첫 판에서 '${userName}'을 이겼어. 처음이라 조금 의외인 척 하면서도 내심 여유로운 분위기로 한마디.`;
            }
            if (aiWins >= 3 && aiWins > userWins * 2) {
                return `${hint} '${userName}'한테 ${aiWins}판이나 이겼어 (현재 전적: AI ${aiWins}승 / 유저 ${userWins}승). 완전히 주도하고 있는 상황. 반드시 이 전적 숫자를 입 밖으로 꺼내서 놀려주면서 농담처럼 한마디.`;
            }
            return `${hint} 방금 게임에서 '${userName}'한테 이겼어 (현재 전적: AI ${aiWins}승 / 유저 ${userWins}승). 반드시 이 전적을 언급하면서 짧게 약 올려봐.`;
        }

        // ── 유저가 이겼을 때(AI 패배) ──────────────────────────────────────
        case 'lose': {
            if (userWins === 1 && round === 1) {
                return `${hint} 방금 첫 판에서 '${userName}'한테 졌어. 어이없는 느낌인데, 그래도 칭찬은 해줘야 할 것 같아. 억울함 반, 인정 반으로 한마디.`;
            }
            if (userWins > aiWins * 2) {
                return `${hint} '${userName}'한테 계속 지고 있어 (현재 전적: AI ${aiWins}승 / 유저 ${userWins}승). 분해 죽겠는데 진짜로 잘한다고는 인정해야 할 것 같아. 반드시 현재 전적을 언급하면서 그 심경 한마디.`;
            }
            return `${hint} 방금 '${userName}'한테 졌어 (현재 전적: AI ${aiWins}승 / 유저 ${userWins}승). 지기 싫은데 졌을 때 반드시 이 전적을 말하면서 자연스럽게 나올 말 한마디.`;
        }

        // ── 게임 중 도발 ────────────────────────────────────────────────────
        case 'taunt': {
            const taunts = [
                `${hint} 게임 진행 중이야. '${userName}'이 지금 뭔가 고민하는 것 같아. 훈수 느낌으로 살짝 한마디.`,
                `${hint} 오목 게임 중. 분위기 좀 살리려고 상대한테 말 걸어봐. 진지하지 않게.`,
                `${hint} 게임 중간에 갑자기 '${userName}'한테 말 걸고 싶어. 오목이랑 관련 없어도 됨.`,
                `${hint} 지금 오목 두는 중. '${userName}'한테 심리전 거는 느낌으로 짧게.`,
            ];
            return taunts[Math.floor(Math.random() * taunts.length)];
        }

        default:
            return `'${userName}'한테 오목 AI로서 자연스럽게 짧게 한마디 해봐.`;
    }
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 유저 채팅에 응답합니다. (멀티턴 대화 히스토리 유지)
 */
async function getAiChatResponse(userMessage, roomId = 'default') {
    if (!ai) return "(AI) 지금 좀 멍 때리는 중이야. 잠깐만.";

    try {
        const chat = getOrCreateChatSession(roomId);
        const response = await chat.sendMessage({ message: userMessage });

        trimHistoryIfNeeded(roomId).catch(e =>
            console.warn('[Chatbot] Trim 오류 (무시):', e.message)
        );

        return response.text;
    } catch (error) {
        const status = error?.status || (error?.message?.includes('429') ? 429 : 0);
        if (status === 429) {
            console.warn('[Chatbot] Rate limit 초과.');
            return "잠깐만, 수 읽느라 바빠서 ㅋㅋ";
        }
        console.error('Gemini API Error:', error.message || error);
        return "어? 방금 뭐라고 했어? 다시 말해봐.";
    }
}

/**
 * 게임 결과를 방 세션에 기록합니다.
 * server.js에서 게임 종료 시 호출해야 합니다.
 */
function recordGameResult(roomId, winner) {
    if (!chatSessions[roomId]) {
        chatSessions[roomId] = { session: null, anchor: null, stats: { aiWins: 0, userWins: 0, round: 0 } };
    }
    const stats = chatSessions[roomId].stats;
    stats.round++;
    if (winner === 'ai') stats.aiWins++;
    else stats.userWins++;
    console.log(`[Chatbot] 방 ${roomId} 전적: AI ${stats.aiWins}승 / 유저 ${stats.userWins}승 (${stats.round}판)`);
}

/**
 * Chat 세션을 초기화합니다. 전적(stats)은 유지됩니다.
 */
function clearChatHistory(roomId) {
    const prevStats = chatSessions[roomId]?.stats || { aiWins: 0, userWins: 0, round: 0 };
    delete chatSessions[roomId];
    // stats만 유지 (session은 다음 getOrCreate 때 새로 만들어짐)
    chatSessions[roomId] = { session: null, anchor: null, stats: prevStats };
}

/**
 * 특정 상황에서 AI가 먼저 말을 겁니다. (시작 인사, 승패 반응, 도발 등)
 */
async function getProactiveAiMessage(context, userName, roomId = 'default') {
    const stats = getStats(roomId);

    // fallback: API 실패 시 사용하는 캐주얼 한마디 (풀에서 랜덤 선택)
    const fallbackPool = {
        start: [
            `${userName}, 준비됐어? 나는 항상 준비돼 있거든 ㅋ`,
            `오, ${userName}이 도전해? 좋아, 받아줄게.`,
            `렛츠고~ 이번엔 봐주지 않을 거야.`,
        ],
        win: [
            "예상된 결과 ㅋㅋ", "역시 나야 나.", "다음엔 좀 더 잘해봐.",
        ],
        lose: [
            "오늘 운이 좋았던 거야.", "잘하긴 하네... 인정.", "다음 판엔 두고봐.",
        ],
        taunt: [
            "고민 중이야? 힌트 줄까 ㅋ", "시간 많이 쓰는데?", "잘 생각해봐~",
        ],
    };

    function randomFallback(ctx) {
        const pool = fallbackPool[ctx] || fallbackPool.taunt;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    if (!ai) return randomFallback(context);

    const prompt = buildPrompt(context, userName, stats);

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
            config: {
                systemInstruction,
                temperature: 1.0, // 최대 다양성
            },
        });

        const aiText = response.text?.trim();
        if (!aiText) return randomFallback(context);

        // 게임 시작 인사는 해당 방 Chat 세션의 anchor(첫 메시지)로 등록
        if (context === 'start') {
            const anchorMsg = { role: 'model', parts: [{ text: aiText }] };
            const prevStats = chatSessions[roomId]?.stats || { aiWins: 0, userWins: 0, round: 0 };
            chatSessions[roomId] = {
                session: ai.chats.create({
                    model: 'gemini-2.0-flash',
                    config: { systemInstruction, temperature: 0.92 },
                    history: [anchorMsg],
                }),
                anchor: anchorMsg,
                stats: prevStats,
            };
        }

        return aiText;
    } catch (error) {
        const status = error?.status || (error?.message?.includes('429') ? 429 : 0);
        if (status === 429) console.warn('[Chatbot] Rate limit 초과 (proactive).');
        else console.error('Gemini Proactive Error:', error.message || error);
        return randomFallback(context);
    }
}

module.exports = {
    getAiChatResponse,
    getProactiveAiMessage,
    clearChatHistory,
    recordGameResult,
};
