'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Camera, ClipboardCheck, Gift as GiftIcon, Image as ImageIcon, MapPin, Navigation, Phone, Plus, Trash2 } from 'lucide-react';
import type { DocumentItem, Gift, Nursery } from '@/types/app';
import { countChecked, NURSERY_CHECK_TOTAL } from '@/lib/nurseryChecklist';
import { formatDateWithWeekday, parseDateString } from '@/lib/dateUtils';
import TabHeading from '../ui/TabHeading';
import SegmentedTabs from '../ui/SegmentedTabs';
import GiftFormModal, { type GiftDraft } from '../modals/GiftFormModal';
import DocumentUploadModal from '../modals/DocumentUploadModal';
import NurseryFormModal, { type NurseryDraft } from '../modals/NurseryFormModal';

type MemoView = 'gift' | 'nursery' | 'documents';

interface MemoTabProps {
  gifts: Gift[];
  isLoadingGifts?: boolean;
  onAddGift: (draft: GiftDraft) => void;
  onUpdateGift: (gift: Gift, draft: GiftDraft) => void;
  onDeleteGift: (id: string) => void;
  documents: DocumentItem[];
  isLoadingDocuments?: boolean;
  onAddDocument: (file: File, title: string) => Promise<void>;
  onDeleteDocument: (doc: DocumentItem) => void;
  getDocumentUrl: (filePath: string) => Promise<string | null>;
  nurseries: Nursery[];
  isLoadingNurseries?: boolean;
  onAddNursery: (draft: NurseryDraft) => void;
  onUpdateNursery: (nursery: Nursery, draft: NurseryDraft) => void;
  onDeleteNursery: (id: string) => void;
  onAddDefaultNurseries: () => void;
}

const VIEW_TITLES: Record<MemoView, string> = {
  gift: 'お祝い・内祝い',
  nursery: '保活メモ',
  documents: '書類箱',
};

function DocumentCard({
  doc,
  getDocumentUrl,
  onDelete,
}: {
  doc: DocumentItem;
  getDocumentUrl: (filePath: string) => Promise<string | null>;
  onDelete: (doc: DocumentItem) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDocumentUrl(doc.filePath).then((signedUrl) => {
      if (!cancelled) setUrl(signedUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [doc.filePath, getDocumentUrl]);

  return (
    <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition relative group">
      <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" className="block">
        <div className="w-full h-28 bg-gray-100 rounded-lg flex items-center justify-center mb-2 text-gray-400 border border-gray-200 overflow-hidden">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={doc.title} className="w-full h-full object-cover" />
          ) : (
            <ImageIcon size={32} />
          )}
        </div>
        <p className="font-bold text-gray-800 text-xs leading-tight mb-1 line-clamp-2">{doc.title}</p>
        <p className="text-[10px] text-gray-400">{new Date(doc.date).toLocaleDateString('ja-JP')}</p>
      </a>
      <button
        onClick={() => onDelete(doc)}
        className="absolute top-1.5 right-1.5 bg-white/90 text-red-500 p-1.5 rounded-full shadow-sm hover:bg-red-50 transition"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function MemoTab({
  gifts,
  isLoadingGifts,
  onAddGift,
  onUpdateGift,
  onDeleteGift,
  documents,
  isLoadingDocuments,
  onAddDocument,
  onDeleteDocument,
  getDocumentUrl,
  nurseries,
  isLoadingNurseries,
  onAddNursery,
  onUpdateNursery,
  onDeleteNursery,
  onAddDefaultNurseries,
}: MemoTabProps) {
  const [memoView, setMemoView] = useState<MemoView>('gift');
  const [giftModal, setGiftModal] = useState<{ mode: 'add' | 'edit'; gift: Gift | null } | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [nurseryModal, setNurseryModal] = useState<{ mode: 'add' | 'edit'; nursery: Nursery | null } | null>(null);

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <TabHeading title={VIEW_TITLES[memoView]}>
        {memoView === 'gift' && (
          <button
            onClick={() => setGiftModal({ mode: 'add', gift: null })}
            className="text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition"
          >
            <Plus size={20} />
          </button>
        )}
        {memoView === 'documents' && (
          <button onClick={() => setShowUpload(true)} className="text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition">
            <Plus size={20} />
          </button>
        )}
        {memoView === 'nursery' && (
          <button
            onClick={() => setNurseryModal({ mode: 'add', nursery: null })}
            className="text-blue-500 bg-blue-50 p-2 rounded-full hover:bg-blue-100 transition"
          >
            <Plus size={20} />
          </button>
        )}
      </TabHeading>

      <SegmentedTabs
        ariaLabel="メモの表示"
        value={memoView}
        onChange={setMemoView}
        className="mb-3 shrink-0"
        options={[
          { id: 'gift', label: 'お祝い' },
          { id: 'nursery', label: '保活' },
          { id: 'documents', label: '書類' },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        {memoView === 'gift' && (
          <div className="space-y-4 pb-6">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start space-x-3">
              <GiftIcon className="text-blue-500 mt-0.5 flex-shrink-0" size={20} />
              <p className="text-xs text-blue-800 leading-relaxed">
                いただいたお祝いと、お返し（内祝い）の状況を管理できます。産後は忘れがちなので夫婦で共有しましょう。
              </p>
            </div>
            {isLoadingGifts && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}
            {!isLoadingGifts && gifts.length === 0 && <p className="text-sm text-gray-400 text-center py-8">記録されたお祝いはありません</p>}
            {gifts.map((gift) => (
              <button
                key={gift.id}
                onClick={() => setGiftModal({ mode: 'edit', gift })}
                className="w-full text-left bg-white p-4 rounded-xl shadow-sm border border-gray-100 hover:bg-gray-50 transition"
              >
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
              </button>
            ))}
          </div>
        )}

        {memoView === 'nursery' && (
          <div className="space-y-4 pb-6">
            <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl text-xs text-orange-800 leading-relaxed">
              園の連絡先・見学の日時・見学チェックリスト（10項目）を園ごとに1枚でまとめて残せます。カードを開いて編集してください。
            </div>
            {isLoadingNurseries && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}
            {!isLoadingNurseries && nurseries.length === 0 && (
              <div className="text-center py-8 space-y-3">
                <p className="text-sm text-gray-400">保育園の記録はまだありません</p>
                <button
                  onClick={onAddDefaultNurseries}
                  className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 hover:bg-blue-100 transition"
                >
                  見学候補の3園を追加
                  <span className="block font-normal text-[10px] text-blue-400 mt-1">
                    舞原保育園・くすのき保育園・和光こども園
                  </span>
                </button>
              </div>
            )}
            {nurseries.map((nursery) => {
              const checkedCount = countChecked(nursery.checklist);
              const visitDate = parseDateString(nursery.visitDate ?? '');
              return (
                <button
                  key={nursery.id}
                  onClick={() => setNurseryModal({ mode: 'edit', nursery })}
                  className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm hover:bg-gray-50 transition"
                >
                  <div className="p-4">
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
                      {nursery.address && (
                        <p className="flex items-start text-gray-600">
                          <MapPin size={12} className="mr-1 mt-0.5 shrink-0" /> {nursery.address}
                        </p>
                      )}
                      {nursery.phone && (
                        <p className="flex items-center text-blue-500">
                          <Phone size={12} className="mr-1 shrink-0" /> {nursery.phone}
                        </p>
                      )}
                      {nursery.distance && (
                        <p className="flex items-center text-gray-600">
                          <Navigation size={12} className="mr-1 shrink-0" /> {nursery.distance}
                        </p>
                      )}
                      <p className={`flex items-center ${visitDate ? 'text-gray-700 font-bold' : 'text-gray-400'}`}>
                        <CalendarDays size={12} className="mr-1 shrink-0" />
                        {visitDate ? `${formatDateWithWeekday(visitDate)}${nursery.visitTime ? ` ${nursery.visitTime}〜` : ''}` : '見学日は未定'}
                      </p>
                      {nursery.memo && (
                        <div className="mt-3 bg-gray-50 p-3 rounded-lg text-gray-700 border border-gray-100">
                          <strong className="block text-[10px] text-gray-400 mb-1">メモ</strong>
                          {nursery.memo}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5">
                    <span className="flex items-center text-[11px] font-bold text-gray-500">
                      <ClipboardCheck size={13} className="mr-1.5 text-blue-500" /> 見学チェックリスト
                    </span>
                    <span className="flex items-center">
                      <span className="w-16 h-1.5 bg-gray-100 rounded-full mr-2 overflow-hidden">
                        <span
                          className="block h-full bg-blue-400 rounded-full"
                          style={{ width: `${(checkedCount / NURSERY_CHECK_TOTAL) * 100}%` }}
                        />
                      </span>
                      <span className="text-[10px] font-bold text-gray-500">
                        {checkedCount}/{NURSERY_CHECK_TOTAL}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {memoView === 'documents' && (
          <div className="space-y-4 pb-6">
            <button
              onClick={() => setShowUpload(true)}
              className="w-full bg-blue-50 text-blue-600 border border-blue-200 border-dashed rounded-xl py-5 flex flex-col items-center justify-center hover:bg-blue-100 transition shadow-sm"
            >
              <Camera size={28} className="mb-2" />
              <span className="text-sm font-bold">カメラで書類を追加</span>
              <span className="text-xs text-blue-400 mt-1">健診案内や控えを保存</span>
            </button>
            {isLoadingDocuments && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}
            {!isLoadingDocuments && documents.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">保存された書類はありません</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {documents.map((doc) => (
                <DocumentCard key={doc.id} doc={doc} getDocumentUrl={getDocumentUrl} onDelete={onDeleteDocument} />
              ))}
            </div>
          </div>
        )}
      </div>

      <GiftFormModal
        key={`gift-${giftModal ? `${giftModal.mode}-${giftModal.gift?.id ?? 'new'}` : 'none'}`}
        mode={giftModal?.mode ?? null}
        gift={giftModal?.gift ?? null}
        onClose={() => setGiftModal(null)}
        onSubmit={(draft) => {
          if (giftModal?.mode === 'edit' && giftModal.gift) {
            onUpdateGift(giftModal.gift, draft);
          } else {
            onAddGift(draft);
          }
          setGiftModal(null);
        }}
        onDelete={(id) => {
          onDeleteGift(id);
          setGiftModal(null);
        }}
      />
      <DocumentUploadModal
        show={showUpload}
        onClose={() => setShowUpload(false)}
        onSubmit={async (file, title) => {
          await onAddDocument(file, title);
          setShowUpload(false);
        }}
      />
      <NurseryFormModal
        key={`nursery-${nurseryModal ? `${nurseryModal.mode}-${nurseryModal.nursery?.id ?? 'new'}` : 'none'}`}
        mode={nurseryModal?.mode ?? null}
        nursery={nurseryModal?.nursery ?? null}
        onClose={() => setNurseryModal(null)}
        onSubmit={(draft) => {
          if (nurseryModal?.mode === 'edit' && nurseryModal.nursery) {
            onUpdateNursery(nurseryModal.nursery, draft);
          } else {
            onAddNursery(draft);
          }
          setNurseryModal(null);
        }}
        onDelete={(id) => {
          onDeleteNursery(id);
          setNurseryModal(null);
        }}
      />
    </div>
  );
}
