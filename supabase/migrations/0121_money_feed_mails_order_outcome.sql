-- かぞく手帳: Amazon の注文メールを「明細のメール」と取り違えてゴミ箱へ移していたのを直す（docs/kakei.md §9.10）
--
-- Amazon の注文メールを読めるようになる前（0109 より前）に、注文メールが Zaim の通知として送られ、
-- 「読めない」の明細（source = 'zaim_mail'）になっていたものがある。0117 で受け取ったメールの台帳を作るとき、
-- この明細から扱いを 'feed' としたため、その明細を「記録しない」にした時点で、注文メールが片づいたとみなされてゴミ箱へ移った。
-- 注文を覚えたメールは扱いを 'order' にし、ゴミ箱へ移した印を外す（Gmail のメールはゴミ箱から戻した）。
-- 削除を含む文は無い

update public.money_feed_mails m
   set outcome = 'order', trashed_at = null
 where m.outcome = 'feed'
   and exists (select 1 from public.money_amazon_orders o where o.family_id = m.family_id and o.source_id = m.message_id);
