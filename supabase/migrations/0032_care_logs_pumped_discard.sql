-- 搾乳ストックを丸ごと破棄できるようにする
--
-- 飲みきれずに捨てた分（milk の details.discardedMl）は飲ませた側の記録が持っているが、
-- 一度も飲ませないまま置きすぎて捨てるパックは、飲ませた側の記録そのものが無い。
-- そのため搾乳の記録自身に「捨てた日時」を持たせ、その印が付いたパックを
-- 搾乳ストックから外す。
--
--   pumping : { amountMl: 搾った量, discardedAt: '2026-08-28T09:00:00.000Z' }
--
-- 搾った事実は残るので、その日の搾乳量は今までどおり。印を外せばストックに戻る。
-- 列は増えないので、ここで変わるのは details に入る中身の説明だけ。

comment on column public.care_logs.details is
  '記録の種類ごとの項目。milk: method(breast/pumped/formula)/amountMl/leftMinutes/rightMinutes/lastSide, diaper: kind/poopColor/poopConsistency, pumping: amountMl/discardedAt, temperature: celsius, spitup: amount(little/lot/projectile)/minutesAfterMilk';
