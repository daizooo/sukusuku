-- 飲ませた搾乳を「搾乳ストックから選ぶ」形にする
--
-- 搾乳を飲ませるときは、量を打ち直すのではなく、ためてある搾乳（type = 'pumping' の記録）の
-- 中から使うものを選ぶ。選んだ搾乳のidを、飲ませた側の記録の details.pumpedFrom に持たせる。
-- 記録する量(details.amountMl)は、選んだ搾乳の合計。
--
--   milk (method: 'pumped') : { method: 'pumped', amountMl: 合計, pumpedFrom: [搾乳のid, ...] }
--
-- 「使ったかどうか」は飲ませた側だけが持ち、搾乳の記録そのものは書き換えない。
-- そのため授乳の記録を消せば、その搾乳はそのままストックに戻る。
-- 列は増えないので、ここで変わるのは details に入る中身の説明だけ。

comment on column public.care_logs.details is
  '記録の種類ごとの項目。milk: method(breast/pumped/formula)/amountMl/pumpedFrom/leftMinutes/rightMinutes/lastSide, diaper: kind/poopColor/poopConsistency, pumping: amountMl';
