// かぞく手帳: Zaim の入出金通知メールと、カード会社の利用通知メール、Amazon の注文メールを、かぞく手帳へ送る（docs/kakei.md §9.5.2・§9.6・§9.7）
//
// Amazon の注文メール（auto-confirm@amazon.co.jp、件名「注文済み: …」）は、品目を覚えておくために送る。
// 2026-10-16 に足した。前の版を貼ってある場合は、このファイルの中身で貼り直す（スクリプト プロパティ・トリガーはそのまま）。
//
// カードは三井住友カード（statement@vpass.ne.jp）と楽天カード（…@mail.rakuten-card.co.jp）の利用通知。
// 2026-10-15 にカードを足した。前の版を貼ってある場合は、このファイルの中身で貼り直す（スクリプト プロパティ・トリガーはそのまま）。
//
// 使い方（通知が届く Gmail のアカウントで、1回だけ）
//   1. https://script.google.com で新しいプロジェクトを作り、このファイルの中身を貼る
//   2. プロジェクトの設定 › スクリプト プロパティに次の3つを入れる
//        FEED_URL    https://{プロジェクト}.supabase.co/functions/v1/money-feed-ingest
//        FEED_TOKEN  取り込みの鍵（家計の設定 › Zaim 取り込みで発行）
//        START_AT    取り込みを始める日時（例: 2026-10-12T00:00:00+09:00）。これより前に届いたメールは送らない
//   3. 関数 setup を1回実行する（Gmail と外部への送信を許可する）。以後5分ごとに sendZaimMails が動く
//
// 送ったメールのスレッドにはラベル「かぞく手帳済」を付け、次からは探さない。
// 送れなかったもの（かぞく手帳が止まっていた等）はラベルを付けず、次の回にまた送る。
// かぞく手帳が「覚えるものが無い」と答えたもの（Amazon の合計0円の注文）には、「かぞく手帳済」ではなくラベル「かぞく手帳対象外」を付ける
// （2026-10-17 に足した。前の版を貼ってある場合は貼り直す。前の版のままでも、0円の注文には「かぞく手帳済」が付くだけで困らない）。
// ラベルを付けたスレッドは、受信トレイからアーカイブする（ラベルの中には残る。2026-10-17）。
// すでにラベルが付いて受信トレイに残っているものは、関数 archiveLabeledThreads を手で実行すると片づく（100件ずつ。残りがあれば繰り返す）。

var LABEL = 'かぞく手帳済';
var LABEL_SKIPPED = 'かぞく手帳対象外';
var BATCH = 50; // Edge Function が1回に受ける数
// 送るメールの差出人（Zaim・カード会社・Amazon の注文）
var SENDERS = ['info@zaim.net', 'statement@vpass.ne.jp', 'rakuten-card.co.jp', 'auto-confirm@amazon.co.jp'];

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendZaimMails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendZaimMails').timeBased().everyMinutes(5).create();
  GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  sendZaimMails();
}

function sendZaimMails() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('FEED_URL');
  var token = props.getProperty('FEED_TOKEN');
  var startAt = new Date(props.getProperty('START_AT') || 0);
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var skippedLabel = GmailApp.getUserLabelByName(LABEL_SKIPPED) || GmailApp.createLabel(LABEL_SKIPPED);

  var query = '{from:info@zaim.net from:statement@vpass.ne.jp from:rakuten-card.co.jp from:auto-confirm@amazon.co.jp}' +
    ' {subject:入金がありました subject:出金がありました subject:利用 subject:注文済み} -label:' + LABEL + ' -label:' + LABEL_SKIPPED +
    ' after:' + Utilities.formatDate(new Date(startAt.getTime() - 86400000), 'Asia/Tokyo', 'yyyy/MM/dd');
  var threads = GmailApp.search(query, 0, BATCH);
  if (threads.length === 0) return;

  var messages = [];
  var byThread = {};
  threads.forEach(function (thread) {
    byThread[thread.getId()] = { thread: thread, ids: [] };
    thread.getMessages().forEach(function (m) {
      if (m.getDate() < startAt) return;
      var from = m.getFrom();
      if (!SENDERS.some(function (s) { return from.indexOf(s) >= 0; })) return;
      byThread[thread.getId()].ids.push(m.getId());
      messages.push({
        id: m.getId(),
        received_at: m.getDate().toISOString(),
        from: from,
        to: m.getTo(),
        subject: m.getSubject(),
        body: m.getPlainBody(),
      });
    });
  });

  var results = {};
  if (messages.length > 0) {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ messages: messages.slice(0, BATCH) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.warn('かぞく手帳に送れませんでした: ' + res.getResponseCode());
      return;
    }
    JSON.parse(res.getContentText()).results.forEach(function (r) { results[r.id] = r.status; });
  }

  // スレッドの中のメールが全部受け付けられたら、ラベルを付ける（開始より前だけのスレッドも付ける）。
  // 全部が「覚えるものが無い」（skipped）なら「対象外」、そうでなければ「済」
  Object.keys(byThread).forEach(function (key) {
    var entry = byThread[key];
    var done = entry.ids.every(function (id) { return results[id] && results[id] !== 'error'; });
    if (!done) return;
    var allSkipped = entry.ids.length > 0 && entry.ids.every(function (id) { return results[id] === 'skipped'; });
    entry.thread.addLabel(allSkipped ? skippedLabel : label);
    // 受信トレイからはアーカイブする（ラベルの中には残る。未読のまま）
    entry.thread.moveToArchive();
  });
}

// すでにラベルが付いて受信トレイに残っているスレッドを、アーカイブする（手で実行する。100件ずつ）
function archiveLabeledThreads() {
  var count = 0;
  [LABEL, LABEL_SKIPPED].forEach(function (name) {
    var threads = GmailApp.search('in:inbox label:' + name, 0, 100);
    threads.forEach(function (thread) { thread.moveToArchive(); });
    count += threads.length;
  });
  console.log('アーカイブした数: ' + count);
}
