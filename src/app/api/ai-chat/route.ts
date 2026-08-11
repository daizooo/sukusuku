import { NextResponse } from 'next/server';

// AI育児相談チャットのサーバーサイドRoute Handler。
// GEMINI_API_KEY はここでのみ参照し、クライアントには一切渡さない。
// (基本設計書 6章「AI機能（Gemini API）の運用」参照)

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  babyName?: string;
  ageInDays?: number;
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_HISTORY = 20;

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'サーバーにGEMINI_API_KEYが設定されていません。' },
      { status: 500 },
    );
  }

  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: 'メッセージがありません。' }, { status: 400 });
  }

  const babyName = typeof body.babyName === 'string' && body.babyName ? body.babyName : '赤ちゃん';
  const ageInDays = typeof body.ageInDays === 'number' ? body.ageInDays : 0;

  const systemPrompt = `あなたはプロの小児科医であり保育士でもある、親身な育児アシスタントです。
ユーザーは日本に住むパパ・ママです。
赤ちゃんの名前: ${babyName}
生後日数: ${ageInDays >= 0 ? `生後${ageInDays}日` : `出産まであと${Math.abs(ageInDays)}日`}
回答のルール:
1. 優しく共感的なトーンで話すこと。
2. 簡潔に分かりやすく、箇条書きなども用いて答えること。
3. 医療的な断言（「絶対に○○です」など）は避け、心配な場合は病院受診を勧めること。`;

  const contents = messages.slice(-MAX_HISTORY).map((msg) => ({
    role: msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.text }],
  }));

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      return NextResponse.json({ error: 'AIとの通信に失敗しました。' }, { status: 502 });
    }

    const result = await response.json();
    const text: string | undefined = result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return NextResponse.json({ error: 'AIから有効な返答が得られませんでした。' }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('AI chat route error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました。' }, { status: 500 });
  }
}
