'use client';

import { Gift as GiftIcon, Plus } from 'lucide-react';
import type { Gift } from '@/types/app';

interface GiftTabProps {
  gifts: Gift[];
}

export default function GiftTab({ gifts }: GiftTabProps) {
  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">お祝い・内祝い</h2>
        <button className="text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition">
          <Plus size={20} />
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 flex items-start space-x-3 shrink-0">
        <GiftIcon className="text-blue-500 mt-0.5 flex-shrink-0" size={20} />
        <p className="text-xs text-blue-800 leading-relaxed">
          いただいたお祝いと、お返し（内祝い）の状況を管理できます。産後は忘れがちなので夫婦で共有しましょう。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-6">
        {gifts.length === 0 && <p className="text-sm text-gray-400 text-center py-8">記録されたお祝いはありません</p>}
        {gifts.map((gift) => (
          <div key={gift.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-start mb-2 border-b border-gray-50 pb-2">
              <div>
                <span className="text-[10px] text-gray-500">{gift.date}</span>
                <h3 className="font-bold text-gray-800 text-sm mt-0.5">{gift.from} 様より</h3>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-1 rounded-md ${
                  gift.returnStatus === '済' || gift.returnStatus === '不要' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                }`}
              >
                お返し: {gift.returnStatus}
              </span>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex">
                <span className="w-16 text-gray-500 text-xs">頂いた品:</span>
                <span className="font-medium text-gray-800">{gift.item}</span>
              </div>
              {gift.returnItem !== '-' && (
                <div className="flex">
                  <span className="w-16 text-gray-500 text-xs">お返し品:</span>
                  <span className="text-gray-700">{gift.returnItem || '未定'}</span>
                </div>
              )}
              {gift.note && <div className="mt-2 text-xs text-gray-500 bg-gray-50 p-2 rounded-lg">{gift.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
