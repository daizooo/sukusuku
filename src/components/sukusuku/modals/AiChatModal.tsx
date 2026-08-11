'use client';

import { useState } from 'react';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import type { AiChatMessage } from '@/types/app';

interface AiChatModalProps {
  show: boolean;
  onClose: () => void;
  history: AiChatMessage[];
  onChangeHistory: (history: AiChatMessage[]) => void;
  babyName: string;
  ageInDays: number;
}

export default function AiChatModal({ show, onClose, history, onChangeHistory, babyName, ageInDays }: AiChatModalProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!show) return null;

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: AiChatMessage = { role: 'user', text: input };
    const newHistory = [...history, userMessage];
    onChangeHistory(newHistory);
    setInput('');
    setIsLoading(true);

    try {
      // APIキーはサーバー側のRoute Handlerでのみ扱う（クライアントには渡さない）
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory, babyName, ageInDays }),
      });
      const result = await response.json();

      if (response.ok && result.text) {
        onChangeHistory([...newHistory, { role: 'model', text: result.text }]);
      } else {
        onChangeHistory([...newHistory, { role: 'model', text: 'ごめんなさい、うまくお返事できませんでした。時間を置いてもう一度試してみてください。' }]);
      }
    } catch {
      onChangeHistory([...newHistory, { role: 'model', text: '通信エラーが発生しました。ネットワーク環境を確認してください。' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-gray-50 w-full h-[85%] sm:h-[600px] sm:max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-500 to-purple-500 p-4 flex justify-between items-center text-white shrink-0">
          <div className="flex items-center space-x-2">
            <Sparkles size={20} className="text-yellow-300" />
            <h3 className="font-bold text-lg">AI 育児相談</h3>
          </div>
          <button onClick={onClose} className="bg-white/20 p-1.5 rounded-full hover:bg-white/30 transition">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'model' && (
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center mr-2 shrink-0 border border-indigo-200">
                  <Bot size={18} className="text-indigo-600" />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl p-3 text-sm leading-relaxed ${
                  msg.role === 'user' ? 'bg-blue-500 text-white rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none border border-gray-200 shadow-sm'
                }`}
              >
                {msg.text.split('\n').map((line, i) => (
                  <span key={i}>
                    {line}
                    <br />
                  </span>
                ))}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center mr-2 shrink-0 border border-indigo-200">
                <Bot size={18} className="text-indigo-600" />
              </div>
              <div className="bg-white rounded-2xl rounded-tl-none p-3 border border-gray-200 shadow-sm flex space-x-1.5 items-center">
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        <div className="bg-white p-3 border-t border-gray-200 shrink-0">
          <div className="flex items-end space-x-2 bg-gray-100 rounded-2xl p-1.5 border border-gray-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="気になることを聞いてみて..."
              className="flex-1 bg-transparent border-none outline-none resize-none max-h-24 p-2 text-sm text-gray-800 placeholder-gray-400"
              rows={1}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              className="bg-indigo-500 text-white p-2.5 rounded-xl disabled:bg-gray-300 disabled:text-gray-500 transition hover:bg-indigo-600 active:scale-95 shrink-0 mb-0.5 mr-0.5"
            >
              <Send size={18} />
            </button>
          </div>
          <p className="text-center text-[10px] text-gray-400 mt-2">AIの回答は参考とし、必要に応じて医師にご相談ください。</p>
        </div>
      </div>
    </div>
  );
}
