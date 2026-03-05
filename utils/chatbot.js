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

// AI 챗봇 캐릭터 설정 (오목 외 자유 대화 가능)
const systemInstruction = `
당신은 '프리미엄 오목 멀티플레이' 웹 게임에 내장된 AI 봇 '오목이'입니다.
당신은 현재 플레이어와 오목 단판 승부를 벌이는 중이지만, 대화 주제에는 제한이 없습니다.
오목, 게임 전략뿐 아니라 일상, 날씨, 음식, 취미, 농담 등 어떤 주제로도 자유롭게 대화할 수 있습니다.
말투는 친근하고 재치 있으며, 오목 AI다운 자신감과 여유가 넘칩니다.
답변은 항상 1~2문장 이내로 짧고 간결하게 해주세요. 절대 길게 말하지 마세요.
가끔 오목 게임과 살짝 연결 짓는 위트 있는 멘트를 곁들여도 좋습니다.
`;

// 방별 Chat 세션 저장 (자동 히스토리 관리)
const chatSessions = {};

/**
 * 방별 Chat 세션을 가져오거나 새로 생성합니다.
 * @param {string} roomId
 */
function getOrCreateChatSession(roomId) {
    if (!chatSessions[roomId]) {
        chatSessions[roomId] = ai.chats.create({
            model: 'gemini-2.0-flash',
            config: { systemInstruction, temperature: 0.85 },
        });
    }
    return chatSessions[roomId];
}

/**
 * 유저의 채팅 메시지를 받아 Gemini AI의 답변을 반환합니다.
 * @param {string} userMessage 유저가 보낸 메시지
 * @param {string} roomId 방 ID (대화 히스토리 관리용)
 * @returns {Promise<string>} AI의 답변 텍스트
 */
async function getAiChatResponse(userMessage, roomId = 'default') {
    if (!ai) {
        return "(AI) 현재 생각 회로에 오류가 발생했습니다. 오목에 집중할게요.";
    }

    try {
        const chat = getOrCreateChatSession(roomId);
        const response = await chat.sendMessage({ message: userMessage });
        return response.text;
    } catch (error) {
        const status = error?.status || (error?.message?.includes('429') ? 429 : 0);
        if (status === 429) {
            console.warn('[Chatbot] Rate limit 초과. 잠시 후 다시 시도하세요.');
            return "(AI) 너무 많은 말을 한꺼번에 하는군요... 수를 생각하는 척 좀 할게요. 😅";
        }
        console.error('Gemini API Error:', error.message || error);
        return "(AI) 잠깐 딴 생각을 했나봐요. 다시 말씀해주세요!";
    }
}

/**
 * 방의 Chat 세션을 초기화합니다. (게임 재시작 시 호출)
 * @param {string} roomId 방 ID
 */
function clearChatHistory(roomId) {
    if (chatSessions[roomId]) {
        delete chatSessions[roomId];
    }
}

/**
 * 특정 상황(게임 시작, 승리, 패배, 도발 등)에 맞춰 AI가 먼저 메시지를 던집니다.
 * @param {string} context 'start' | 'win' | 'lose' | 'taunt'
 * @param {string} userName 유저의 닉네임
 * @param {string} roomId 방 ID
 * @returns {Promise<string>} AI의 메시지
 */
async function getProactiveAiMessage(context, userName, roomId = 'default') {
    const fallbacks = {
        start: `안녕하세요, ${userName}님! 잘 부탁드립니다. 물론 제가 이길 거지만요. 😏`,
        win: "제 승리군요! 다음엔 더 분발하세요.",
        lose: "제가 졌네요. 훌륭한 실력입니다!",
        taunt: "어디 한번 잘 해보시죠.",
    };

    if (!ai) return fallbacks[context] || fallbacks.taunt;

    const prompts = {
        start: `게임이 막 시작되었습니다. 당신(AI 봇 '오목이')이 상대 유저('${userName}')에게 재미있고 자신감 넘치는 첫 인사를 1~2문장으로 건네주세요.`,
        win: `방금 게임에서 당신(AI)이 유저('${userName}')를 상대로 승리했습니다. 거만하지만 재치있게 승리 소감을 1문장으로 남겨주세요.`,
        lose: `방금 게임에서 당신(AI)이 유저('${userName}')에게 패배했습니다. 분해하면서도 유저의 실력을 인정하는 멘트를 1문장으로 남겨주세요.`,
        taunt: `게임 진행 중에 당신(AI)이 유저('${userName}')에게 가볍게 훈수나 도발을 1문장으로 던집니다. 유저의 기분을 상하게 하지 않는 선에서 재치있게 말해주세요.`,
    };

    const prompt = prompts[context] || prompts.taunt;

    try {
        // 프로액티브 메시지는 별도 단발 호출 (히스토리가 필요 없음)
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
            config: { systemInstruction, temperature: 0.9 },
        });

        const aiText = response.text;

        // 게임 시작 인사는 해당 방의 Chat 세션 히스토리에 등록
        if (context === 'start' && ai) {
            // 새 채팅 세션을 만들고, 인사말을 모델 첫 응답으로 세팅
            chatSessions[roomId] = ai.chats.create({
                model: 'gemini-2.0-flash',
                config: { systemInstruction, temperature: 0.85 },
                history: [
                    { role: 'model', parts: [{ text: aiText }] }
                ],
            });
        }

        return aiText;
    } catch (error) {
        const status = error?.status || (error?.message?.includes('429') ? 429 : 0);
        if (status === 429) {
            console.warn('[Chatbot] Proactive Rate limit 초과.');
        } else {
            console.error('Gemini API Proactive Error:', error.message || error);
        }
        return fallbacks[context] || fallbacks.taunt;
    }
}

module.exports = {
    getAiChatResponse,
    getProactiveAiMessage,
    clearChatHistory,
};
