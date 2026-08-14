'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';

interface DocumentUploadModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: (file: File, title: string) => Promise<void> | void;
}

export default function DocumentUploadModal({ show, onClose, onSubmit }: DocumentUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  if (!show) return null;

  const reset = () => {
    setFile(null);
    setTitle('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!file) return;
    setIsUploading(true);
    try {
      await onSubmit(file, title || file.name);
      reset();
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">書類を追加</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              placeholder="例: 予防接種スケジュール表"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              画像・写真 <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-600"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!file || isUploading}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl mt-4 shadow-sm active:bg-blue-600 transition disabled:bg-gray-300 flex items-center justify-center"
          >
            {isUploading ? <Loader2 size={18} className="animate-spin" /> : '追加する'}
          </button>
        </div>
      </div>
    </div>
  );
}
