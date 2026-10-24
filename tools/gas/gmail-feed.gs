// かぞく手帳: カード会社の利用通知メールと、Amazon の注文メール・発送メールを、かぞく手帳へ送る（docs/kakei.md §9.6・§9.7・§9.8）
//
// 2026-10-20 に、送ったかどうかをメール1通ごとにサーバーが覚える作りにした（§9.8）。
// 同じ日に、Zaim を扱わなくなったので関数名を sendZaimMails → sendFeedMails に変えた（ファイル名も zaim-feed.gs → gmail-feed.gs）。
// 前の版を貼ってある場合は、このファイルの中身で貼り直し、関数 setup を1回実行する（古い名前の時間トリガーを消し、新しい名前で作り直す）。
// スクリプト プロパティはそのまま。
//
// 使い方（通知が届く Gmail のアカウントで、1回だけ）
//   1. https://script.google.com で新しいプロジェクトを作り、このファイルの中身を貼る
//   2. エディタの左の「サービス」の ＋ から「Gmail API」を足す（ラベルをメール1通ごとに付けるため）
//   3. プロジェクトの設定 › スクリプト プロパティに次の3つを入れる
//        FEED_URL    https://{プロジェクト}.supabase.co/functions/v1/money-feed-ingest
//        FEED_TOKEN  取り込みの鍵（家計の設定 › Gmail 取り込みで発行）
//        START_AT    取り込みを始める日時（例: 2026-10-12T00:00:00+09:00）。これより前に届いたメールは取り込まない
//   4. 関数 setup を1回実行する（Gmail と外部への送信を許可する）。以後5分ごとに sendFeedMails が動く
//
// 貼り直しのとき（2026-10-23 に、ラベルを「どこからのメールか」の4つにした。§9.8）
//   1. このファイルの中身で貼り直す（関数名・プロパティ・トリガーはそのまま）
//   2. 関数 removeOldLabels を手で1回実行する。前の版のラベル「かぞく手帳/未確認・済・対象外・読めない」と「かぞく手帳」を消す
//      （メールは消えない）。新しいラベルは、次の回から sendFeedMails が付け直す（1回に100通ずつ）
//   2026-10-20 より前の版からなら、先に「Gmail API」のサービスを足し、関数 setup も1回実行する
//
// 5分ごとにすること
//   1. 探す: 差出人（三井住友カード・Amazon の注文・Amazon の発送）で、最後にうまく動いた時刻の1日前（初めは START_AT の1日前）から。
//      全フォルダと迷惑メールも探す（ゴミ箱は探さない）
//   2. まだのものを聞く: 見つけたメールのIDをかぞく手帳に送り、まだ受け取っていないIDを返してもらう
//   3. 送る: まだのメールを50通ずつ送る。残り・送れなかったものは次の回にまた「まだ」として返る
//   4. ラベルとゴミ箱: かぞく手帳が返すとおりに、メール1通ごとにラベルを付け、**受信トレイから外す**（アーカイブ）。
//      確認が済んだメールはゴミ箱へ移す（30日で削除）
//        Olive/クレジット  Olive のクレジットの利用通知。明細を記録した・記録しないにしたらゴミ箱
//        Olive/デビット    Olive のデビットの利用通知。同上
//        Amazon            注文メール・発送メール。発送メールは荷物の明細が片づいたら、注文メールは注文が全部片づいたらゴミ箱
//        対象外            読んだが取り込まない（Amazon のカード・楽天カードの利用通知、0円の注文など）。ゴミ箱へは移さない（人が確かめて消す）
//      取り込みの開始より前のメールには何もしない
//   5. 動いたことを伝える: 同期のたびに、かぞく手帳が時刻を残す。1時間以上届かなければ、家計タブに「Gmail の取り込みが止まっています」
//
// Gmail の画面が「スレッド表示」だと、同じ件名の利用通知が1行にまとまり、ラベルもまとめて出る。
// メール1通ずつ見るには、Gmail の設定でスレッド表示をオフにする。

var BATCH = 50; // Edge Function が1回に受ける数
var MAX_IDS = 2000; // 1回に探すメールの数
var LABELS = {
  olive_credit: 'Olive/クレジット',
  olive_debit: 'Olive/デビット',
  amazon: 'Amazon',
  skipped: '対象外',
};
// 前の版のラベル（removeOldLabels で消す。子のラベルを先に）
var OLD_LABELS = ['かぞく手帳/未確認', 'かぞく手帳/済', 'かぞく手帳/対象外', 'かぞく手帳/読めない', 'かぞく手帳', 'かぞく手帳済', 'かぞく手帳対象外'];
// 探すメール（三井住友カードの利用通知・Olive のデビットの利用通知・Amazon の注文メール・Amazon の発送メール。発送メールは 2026-10-23 から。§9.13）
var QUERY = '{from:statement@vpass.ne.jp from:smbc-debit@smbc-card.com from:auto-confirm@amazon.co.jp from:shipment-tracking@amazon.co.jp} {subject:利用 subject:注文済み subject:発送済み} in:anywhere -in:trash';

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    // 前の名前（sendZaimMails）のトリガーも消す
    if (['sendFeedMails', 'sendZaimMails'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendFeedMails').timeBased().everyMinutes(5).create();
  labelIds();
  sendFeedMails();
}

function sendFeedMails() {
  var props = PropertiesService.getScriptProperties();
  var startAt = new Date(props.getProperty('START_AT') || 0);
  var lastOk = Number(props.getProperty('LAST_OK') || 0);
  var from = Math.max(startAt.getTime(), lastOk) - 86400000;
  var startedAt = Date.now();

  // 1. 探す（メール1通ごと）
  var ids = [];
  var pageToken;
  do {
    var page = Gmail.Users.Messages.list('me', {
      q: QUERY + ' after:' + Math.floor(Math.max(from, 0) / 1000),
      maxResults: 500,
      pageToken: pageToken,
      includeSpamTrash: true,
    });
    (page.messages || []).forEach(function (m) { ids.push(m.id); });
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_IDS);

  // 2. まだのものを聞く
  var first = sync(ids.slice(0, MAX_IDS), []);
  if (!first) return;

  // 3. 送る（50通ずつ。開始より前のものも送り、かぞく手帳が「開始より前」として覚える）
  var changes = first.changes;
  if (first.missing.length > 0) {
    var messages = first.missing.slice(0, BATCH).map(function (id) {
      var m = GmailApp.getMessageById(id);
      return {
        id: id,
        received_at: m.getDate().toISOString(),
        from: m.getFrom(),
        to: m.getTo(),
        subject: m.getSubject(),
        body: m.getPlainBody(),
      };
    });
    if (!post({ messages: messages })) return;
    var second = sync([], []);
    if (!second) return;
    changes = second.changes;
  }

  // 4. ラベルとゴミ箱
  var applied = applyChanges(changes);
  if (applied.length > 0 && !sync([], applied)) return;

  // 送り残しが無く、全部うまくいったら、次はこの時刻の1日前から探す
  if (first.missing.length <= BATCH) props.setProperty('LAST_OK', String(startedAt));
}

// かぞく手帳と同期する。返り値 { missing, changes }（送れなければ null）
function sync(ids, applied) {
  var res = post({ action: 'sync', ids: ids, applied: applied });
  return res && { missing: res.missing || [], changes: res.changes || [] };
}

function post(body) {
  var props = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch(props.getProperty('FEED_URL'), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + props.getProperty('FEED_TOKEN') },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.warn('かぞく手帳に送れませんでした: ' + res.getResponseCode());
    return null;
  }
  return JSON.parse(res.getContentText());
}

// ラベルを付け替えて受信トレイから外し、片づいたメールをゴミ箱へ移す。返り値はかぞく手帳に伝える [{ id, label, trashed }]
function applyChanges(changes) {
  if (changes.length === 0) return [];
  var byKey = labelIds();
  var all = Object.keys(byKey).map(function (key) { return byKey[key]; });
  var applied = [];
  changes.forEach(function (c) {
    var labelId = byKey[c.label];
    if (!labelId) return;
    try {
      Gmail.Users.Messages.modify({
        addLabelIds: [labelId],
        removeLabelIds: all.filter(function (id) { return id !== labelId; }).concat(['INBOX']),
      }, 'me', c.id);
      if (c.trash) Gmail.Users.Messages.trash('me', c.id);
      applied.push({ id: c.id, label: c.label, trashed: !!c.trash });
    } catch (e) {
      // 見つからない（人が完全に消した）ものは、片づいたことにする。それ以外は次の回にまた返る
      if (/not found/i.test(String(e))) applied.push({ id: c.id, label: c.label, trashed: true });
      else console.warn('ラベルを付けられませんでした: ' + e);
    }
  });
  return applied;
}

// ラベルのID（無ければ作る）。{ olive_credit: ID, olive_debit: ID, amazon: ID, skipped: ID }
function labelIds() {
  var existing = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach(function (l) { existing[l.name] = l.id; });
  // 「Olive/…」は「Olive」の下に出す
  if (!existing['Olive']) Gmail.Users.Labels.create({ name: 'Olive' }, 'me');
  var ids = {};
  Object.keys(LABELS).forEach(function (key) {
    var name = LABELS[key];
    ids[key] = existing[name] || Gmail.Users.Labels.create({ name: name }, 'me').id;
  });
  return ids;
}

// 前の版のラベルを消す（貼り直しのときに手で1回実行する。ラベルを消すとメールからも外れる。メールは消えない）
function removeOldLabels() {
  var existing = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach(function (l) { existing[l.name] = l.id; });
  OLD_LABELS.forEach(function (name) {
    if (!existing[name]) return;
    Gmail.Users.Labels.remove('me', existing[name]);
    console.log('消したラベル: ' + name);
  });
}
