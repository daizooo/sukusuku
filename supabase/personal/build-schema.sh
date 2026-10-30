#!/usr/bin/env bash
# supabase/migrations（旧プロジェクト sukusuku の public）を、統合プロジェクト Persol の
# sukusuku スキーマ用 DDL（0001_sukusuku_schema.sql）に書き出す。
#
# 使い方: 空のローカル Postgres に Supabase の最小スタブ（auth/storage/cron/net/vault）を入れ、
#   migration を順に流したうえで実行する（2026-10-30 の生成手順。docs は PR 本文）。
#   PGURL=postgresql://postgres@localhost:55432/replay supabase/personal/build-schema.sh
#
# 生成物は本番の旧DBと照合済み（列・制約・索引・RLS・ポリシー・トリガー・ビュー・関数本体）。
# 権限は本番の実際の付与に合わせて末尾に明示する（CLAUDE.md の GRANT 方針どおり anon には付けない）。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/0001_sukusuku_schema.sql"

{
  cat <<'HEAD'
-- 統合プロジェクト Persol の sukusuku スキーマに、すくすくの表・関数・トリガー・RLS を作る。
-- 生成: supabase/personal/build-schema.sh（supabase/migrations 0001〜0143 を再生して書き出し、
--       旧プロジェクトの本番DBと定義が一致することを確かめたもの）。手で直さず、作り直すときはスクリプトで。
-- このファイルは sukusuku スキーマの外（public / denken3 / fittrack）に何も作らない。
-- auth.users へのトリガー・cron・Realtime は 0002_sukusuku_platform.sql。

HEAD
  pg_dump "$PGURL" -n public --schema-only --no-owner --no-privileges --no-comments \
    | sed -E \
        -e '/^-- Dumped (from|by) /d' \
        -e '/^\\(un)?restrict /d' \
        -e 's/^CREATE SCHEMA public;$/CREATE SCHEMA IF NOT EXISTS sukusuku;/' \
        -e "s/SET search_path TO 'public'/SET search_path TO 'sukusuku'/" \
        -e "s/nspname = 'public'/nspname = 'sukusuku'/" \
        -e 's/\bpublic\./sukusuku./g' \
        -e 's/Schema: public;/Schema: sukusuku;/' \
        -e 's/^-- Name: public; Type: SCHEMA/-- Name: sukusuku; Type: SCHEMA/'
  cat <<'GRANTS'

--
-- 権限（旧プロジェクトの本番の付与に合わせる。anon には付けない）
--

GRANT USAGE ON SCHEMA sukusuku TO authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA sukusuku FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sukusuku TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA sukusuku TO service_role;

-- users は読む・消すだけ。書き換えてよい列は2つ（0077）。
REVOKE ALL ON sukusuku.users FROM authenticated;
GRANT SELECT, DELETE ON sukusuku.users TO authenticated;
GRANT UPDATE (start_tab, show_care_tab) ON sukusuku.users TO authenticated;
-- 変更台帳は読むだけ（書くのはトリガー）。
REVOKE ALL ON sukusuku.family_sync FROM authenticated;
GRANT SELECT ON sukusuku.family_sync TO authenticated;
-- 招待コードと、Edge Function が読む送信予定のビューは関数・service_role からだけ。
REVOKE ALL ON sukusuku.member_invites FROM authenticated;
REVOKE ALL ON sukusuku.next_feeding_schedule, sukusuku.task_reminder_schedule,
  sukusuku.temperature_reminder_schedule FROM authenticated;

-- 関数: 既定の PUBLIC 実行権を外し、アプリから呼ぶものだけ authenticated に付ける。
-- 計算だけの関数・トリガー関数（旧本番で PUBLIC のままのもの）は PUBLIC を残す。
DO $$
DECLARE
  f regprocedure;
  keep_public text[] := array[
    'contracts_set_notify_after', 'jp_base_holiday_name', 'jp_holiday_name',
    'money_categories_keep_name', 'money_day_of_month', 'money_feed_key', 'money_feed_requester',
    'money_is_business_day', 'money_items_check_record_total', 'money_record_amount',
    'money_rule_date', 'money_shift_business_day', 'money_stores_set_position',
    'money_wallets_card_start', 'my_member_id', 'set_updated_at'];
  for_app text[] := array[
    'create_member_invite', 'create_my_family', 'current_family_id', 'is_family_guardian',
    'lottery_delete_my_test_data', 'lottery_open_box', 'lottery_use_coupon', 'lottery_use_rate_up',
    'money_bootstrap', 'money_feed_fill', 'money_feed_issue_token', 'money_feed_last_sync',
    'money_feed_order_lines', 'money_feed_reprocess', 'money_feed_resolve',
    'money_latest_holding_values', 'push_subscription_family_id', 'redeem_member_invite',
    'request_money_month_close', 'save_money_record'];
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'sukusuku'::regnamespace LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    IF (SELECT proname FROM pg_proc WHERE oid = f) = ANY (keep_public) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', f);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
      IF (SELECT proname FROM pg_proc WHERE oid = f) = ANY (for_app) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
      END IF;
    END IF;
  END LOOP;
END
$$;
GRANTS
} > "$out"
echo "wrote $out"
