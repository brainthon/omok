const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// AI 챗봇 컨텍스트 (간단한 역할 부여)
const systemInstruction = `
당신은 '프리미엄 오목 멀티플레이' 웹 게임의 내장 인공지능(AI) 봇입니다. 
당신은 플레이어와 오목 단판 승부를 벌이고 있습니다.
플레이어가 채팅을 걸면, 오목 전문 인공지능다운 여유와 약간의 재치(또는 도발)를 섞어 아주 짧고 간결하게 대답해주세요.
절대 길게 말하지 마세요. 1~2문장 이내로만 답변해야 합니다.
`;

/**
 * 유저의 채팅 메시지를 받아 Gemini API를 통해 AI의 답변을 반환합니다.
 * @param {string} userMessage 유저가 보낸 메시지
 * @returns {Promise<string>} AI의 답변 텍스트
 */
async function getAiChatResponse(userMessage) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: userMessage,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
            }
        });

        return response.text;
    } catch (error) {
        console.error('Gemini API Error:', error);
        return "(AI) 현재 생각 회로에 오류가 발생했습니다. 오목에 집중할게요.";
    }
}

/**
 * 특정 상황(승리, 패배, 도발 등)에 맞춰 AI가 먼저 메시지를 던지는 기능을 추가합니다.
 * @param {string} context 'win' (AI 승리), 'lose' (AI 패배), 'taunt' (게임 중 도발)
 * @param {string} userName 유저의 닉네임
 * @returns {Promise<string>} AI의 도발/축하 메시지
 */
async function getProactiveAiMessage(context, userName) {
    let prompt = '';
    if (context === 'win') {
        prompt = `방금 게임에서 당신(AI)이 유저('${userName}')를 상대로 승리했습니다. 거만하지만 재치있게 승리 소감을 1문장으로 남겨주세요.`;
    } else if (context === 'lose') {
        prompt = `방금 게임에서 당신(AI)이 유저('${userName}')에게 패배했습니다. 분해하면서도 유저의 실력을 인정하는 멘트를 1문장으로 남겨주세요.`;
    } else if (context === 'taunt') {
        prompt = `게임 진행 중에 당신(AI)이 유저('${userName}')에게 가볍게 훈수나 도발을 1문장으로 던집니다. 유저의 기분을 상하게 하지는 않는 선에서 재치있게 말해주세요.`;
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.8,
            }
        });
        return response.text;
    } catch (error) {
        console.error('Gemini API Proactive Error:', error);
        return context === 'win' ? "제 승리군요! 다음엔 더 분발하세요." : (context === 'lose' ? "제가 졌네요. 훌륭한 실력입니다!" : "어디 한번 잘 해보시죠.");
    }
}

module.exports = {
    getAiChatResponse,
    getProactiveAiMessage
};
