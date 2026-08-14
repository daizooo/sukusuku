'use client';

import { useState } from 'react';
import { Camera, ClipboardList, Folder, Gift as GiftIcon, Image as ImageIcon, MapPin, Phone, Plus } from 'lucide-react';
import type { DocumentItem, Gift, Nursery } from '@/types/app';

type MemoView = 'gift' | 'nursery' | 'documents';

interface MemoTabProps {
  gifts: Gift[];
  documents: DocumentItem[];
  nurseries: Nursery[];
}

const VIEW_TITLES: Record<MemoView, string> = {
  gift: 'お祝い・内祝い',
  nursery: '保活メモ',
  documents: '書類箱',
};

export default function MemoTab({ gifts, documents, nurseries }: MemoTabProps) {
  const [memoView, setMemoView] = useState<MemoView>('gift');

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h2 className="text-xl font-bold text-gray-800 flex items-center">
          {memoView === 'gift' ? (
            <GiftIcon className="mr-2" size={24} />
          ) : memoView === 'nursery' ? (
            <ClipboardList className="mr-2" size={24} />
          ) : (
            <Folder className="mr-2" size={24} />
          )}
          {VIEW_TITLES[memoView]}
        </h2>
        <button className="text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition">
          <Plus size={20} />
        </button>
      </div>

      <div className="flex bg-gray-200 p-1 rounded-lg mb-4 shrink-0">
        <button onClick={() => setMemoView('gift')} className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center transition ${memoView === 'gift' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
          お祝い
        </button>
        <button onClick={() => setMemoView('nursery')} className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center transition ${memoView === 'nursery' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
          保活
        </button>
        <button onClick={() => setMemoView('documents')} className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center transition ${memoView === 'documents' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
          書籍
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {memoView === 'gift' && (
          <div className="space-y-4 pb-6">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start space-x-3">
              <GiftIcon className="text-blue-500 mt-0.5 flex-shrink-0" size={20} />
              <p className="text-xs text-blue-800 leading-relaxed">
                いただいたお祝いと、お返し（内祝い）の状況を管理できます。産後は忘れがちなので夫婦で共有しましょう。
              </p>
            </div>
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
        )}

        {memoView === 'nursery' && (
          <div className="space-y-4 pb-6">
            <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl text-xs text-orange-800 leading-relaxed">
              候補の保育園情報や、見学時のメモを夫婦で共有しましょう。見学時のチェックポイントなども残せます。
            </div>
            {nurseries.map((nursery) => (
              <div key={nursery.id} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-bold text-gray-800 text-sm">{nursery.name}</h3>
                  <span
                    className={`text-[10px] font-bold px-2 py-1 rounded-md whitespace-nowrap ml-2 ${
                      nursery.status === '見学済' ? 'bg-green-100 text-green-700' : nursery.status === '未見学' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {nursery.status}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <p className="flex items-center text-gray-600">
                    <MapPin size={12} className="mr-1" /> {nursery.distance}
                  </p>
                  <p className="flex items-center text-blue-500">
                    <Phone size={12} className="mr-1" /> <a href={`tel:${nursery.phone}`}>{nursery.phone}</a>
                  </p>
                  <div className="mt-3 bg-gray-50 p-3 rounded-lg text-gray-700 border border-gray-100">
                    <strong className="block text-[10px] text-gray-400 mb-1">メモ</strong>
                    {nursery.memo}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {memoView === 'documents' && (
          <div className="space-y-4 pb-6">
            <button className="w-full bg-blue-50 text-blue-600 border border-blue-200 border-dashed rounded-xl py-5 flex flex-col items-center justify-center hover:bg-blue-100 transition shadow-sm">
              <Camera size={28} className="mb-2" />
              <span className="text-sm font-bold">カメラで書類を追加</span>
              <span className="text-xs text-blue-400 mt-1">健診案内や控えを保存</span>
            </button>
            <div className="grid grid-cols-2 gap-3">
              {documents.map((doc) => (
                <div key={doc.id} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition cursor-pointer">
                  <div className="w-full h-28 bg-gray-100 rounded-lg flex items-center justify-center mb-2 text-gray-400 border border-gray-200">
                    <ImageIcon size={32} />
                  </div>
                  <p className="font-bold text-gray-800 text-xs leading-tight mb-1 line-clamp-2">{doc.title}</p>
                  <p className="text-[10px] text-gray-400">{doc.date}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
