// content.js
// NOTE: Runtime content script is loaded from src/content/main.js via manifest.json.
// This legacy file is kept for reference.


// ■ 履歴管理（時間窓で重複判定）
const processedSignatures = new Map();
const HISTORY_TTL_MS = 3 * 60 * 1000;

let config = {
  enabled: true, speakerId: 3, speed: 1.0, volume: 1.0,
  maxLength: 70, readName: false, ignoreCommand: true,
  skipTime: 3,
  blockList: "", audioDeviceId: "",
  dictionary: [] // 辞書初期値
};
let blockedUsersCacheKey = null;
let blockedUsersCache = new Set();

// Active reader lock across dashboard tabs.
const ACTIVE_READER_KEY = "voxActiveReader";
const ACTIVE_READER_TTL_MS = 8000;
const ACTIVE_READER_HEARTBEAT_MS = 2000;
const readerInstanceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let isPrimaryReader = false;
let lastForcedClaimAt = 0;
let heartbeatInterval;
let observer;

function isActiveRecordExpired(record, now) {
  if (!record || !record.lastSeen) return true;
  return (now - record.lastSeen) > ACTIVE_READER_TTL_MS;
}

function setPrimaryFromRecord(record) {
  isPrimaryReader = !!record && record.id === readerInstanceId;
}

function cleanupIfInvalid() {
  try {
    // Accessing chrome.runtime.id can throw if context is invalidated
    if (!chrome.runtime || !chrome.runtime.id) {
      throw new Error("Context invalid");
    }
    return false; // Valid
  } catch (e) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (observer) observer.disconnect();
    return true; // Invalid
  }
}

function claimActiveReader(force = false) {
  if (cleanupIfInvalid()) return;

  try {
    chrome.storage.local.get([ACTIVE_READER_KEY], (items) => {
      if (cleanupIfInvalid()) return;

      // Check for runtime.lastError to avoid "unchecked runtime.lastError"
      if (chrome.runtime.lastError) {
        console.debug("Ignored runtime error in claimActiveReader:", chrome.runtime.lastError);
        return;
      }

      const record = items[ACTIVE_READER_KEY];
      const now = Date.now();

      if (force || isActiveRecordExpired(record, now) || (record && record.id === readerInstanceId)) {
        chrome.storage.local.set({
          [ACTIVE_READER_KEY]: { id: readerInstanceId, lastSeen: now }
        });
        isPrimaryReader = true;
        return;
      }

      isPrimaryReader = false;
    });
  } catch (e) { cleanupIfInvalid(); }
}

function heartbeatActiveReader() {
  if (cleanupIfInvalid()) return;

  try {
    chrome.storage.local.get([ACTIVE_READER_KEY], (items) => {
      if (cleanupIfInvalid()) return;

      if (chrome.runtime.lastError) {
        console.debug("Ignored runtime error in heartbeatActiveReader:", chrome.runtime.lastError);
        return;
      }

      const record = items[ACTIVE_READER_KEY];
      const now = Date.now();

      if (record && record.id === readerInstanceId) {
        chrome.storage.local.set({
          [ACTIVE_READER_KEY]: { id: readerInstanceId, lastSeen: now }
        });
        if (!isPrimaryReader) isPrimaryReader = true;
        return;
      }

      if (isActiveRecordExpired(record, now)) {
        chrome.storage.local.set({
          [ACTIVE_READER_KEY]: { id: readerInstanceId, lastSeen: now }
        });
        isPrimaryReader = true;
        return;
      }

      isPrimaryReader = false;
    });
  } catch (e) { cleanupIfInvalid(); }
}

function initActiveReaderLock() {
  claimActiveReader(false);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (cleanupIfInvalid()) return;
    if (areaName !== "local") return;
    if (!changes[ACTIVE_READER_KEY]) return;
    setPrimaryFromRecord(changes[ACTIVE_READER_KEY].newValue);
  });

  const claimOnUserAction = () => {
    const now = Date.now();
    if (now - lastForcedClaimAt < 1000) return;
    lastForcedClaimAt = now;
    claimActiveReader(true);
  };

  document.addEventListener('pointerdown', claimOnUserAction, true);
  document.addEventListener('keydown', claimOnUserAction, true);

  heartbeatInterval = setInterval(heartbeatActiveReader, ACTIVE_READER_HEARTBEAT_MS);
}

initActiveReaderLock();

// ■ 設定読み込み
chrome.storage.local.get(config, (items) => {
  if (items) Object.assign(config, items);
});
chrome.storage.onChanged.addListener((changes) => {
  for (let key in changes) if (config[key] !== undefined) config[key] = changes[key].newValue;
});

// 起動時刻
const scriptStartTime = Date.now();

// ■ 監視設定
observer = new MutationObserver((mutations) => {
  if (!config.enabled) return;
  if (!isPrimaryReader) return;
  // 起動直後の誤爆防止バッファ
  if (Date.now() - scriptStartTime < (config.skipTime * 1000)) return;

  // ★対策1：大量ノードの一括検知（再描画ガード）
  let addedMessageCount = 0;
  let candidates = [];

  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType !== 1) return;

      const nodeText = String(node.innerText || "");
      if (node.classList.contains('chat-list__new-messages-indicator') ||
        nodeText.includes("新着メッセージ")) return;

      const containerSelectors = [
        '.chat-line__message',
        'div[data-test-selector="chat-line-message"]',
        '.chat-line__message-container'
      ];

      let found = [];
      if (containerSelectors.some(sel => node.matches && node.matches(sel))) found.push(node);
      for (const sel of containerSelectors) node.querySelectorAll(sel).forEach(el => found.push(el));

      found.forEach(el => {
        if (!candidates.includes(el)) {
          candidates.push(el);
          addedMessageCount++;
        }
      });
    });
  });

  // 一瞬で10件以上来た場合は「再描画」とみなして無視
  // （通常のチャットなら10件同時はまずありえないため）
  if (addedMessageCount >= 50) {
    console.log(`Mass redraw detected (${addedMessageCount} items). Skipping.`);
    candidates.forEach(c => c.dataset.voxRead = "true");
    return;
  }

  // 閾値以下なら処理実行
  candidates.forEach(processMessageContainer);
});

function processMessageContainer(container) {
  if (container.dataset.voxRead) return;
  if (!isPrimaryReader) return;

  const now = Date.now();
  pruneHistory(now);

  const userEl = container.querySelector('.chat-line__username');
  if (!userEl) return;

  // 時刻要素（もし無ければ空文字）
  const timeEl = container.querySelector('.chat-line__timestamp');
  const timeStr = timeEl ? timeEl.innerText : "";

  const rawUserName = userEl.innerText || "";
  let username = rawUserName.replace(/\s*\(.*?\)$/, '').trim();
  const normalizedUsername = normalizeDisplayName(username);

  // 本文抽出
  let rawText = "";
  let bodyElement = container.querySelector('[data-test-selector="chat-line-message-body"], .chat-line__message-body');
  if (bodyElement) {
    rawText = bodyElement.innerText || "";
  } else {
    const clone = container.cloneNode(true);
    const removeSelectors = [
      '.chat-line__timestamp', '.chat-line__username', '.chat-line__username-container',
      '.chat-badge', '[aria-hidden="true"]', '.mention-fragment',
      '.chat-line__status', '.chat-line__message--system'
    ];
    removeSelectors.forEach(sel => clone.querySelectorAll(sel).forEach(el => el.remove()));
    rawText = clone.innerText || "";
  }
  let text = rawText.trim();
  if (!text || text.includes("新着メッセージ")) return;


  // ■■■ 重複・鮮度判定 ■■■

  // 署名を作成（時刻がない場合は "no-time" として扱う）
  const safeTime = timeStr || "no-time";
  const signature = `${username}::${safeTime}::${text}`;

  // 1. 履歴チェック
  if (processedSignatures.has(signature)) {
    container.dataset.voxRead = "true";
    return;
  }

  // 2. 時刻の新しさチェック（時刻がある場合のみ）
  // ★修正: 判定を「過去3分までOK」に緩和しました
  if (timeStr && !isRecentMessage(timeStr)) {
    console.log(`Skipped message due to time check: "${text}" (Time: ${timeStr})`);
    container.dataset.voxRead = "true";
    addHistory(signature, now);
    return;
  }

  // 設定チェック
  if (config.blockList && normalizedUsername) {
    const blockedUsers = getBlockedUsers();
    if (blockedUsers.has(normalizedUsername)) {
      container.dataset.voxRead = "true";
      addHistory(signature, now);
      return;
    }
  }

  if (config.ignoreCommand && text.startsWith("!")) {
    container.dataset.voxRead = "true";
    addHistory(signature, now);
    return;
  }


  // ■■■ 読み上げ実行 ■■■

  addHistory(signature, now);
  container.dataset.voxRead = "true";

  let speakText = text.replace(/https?:\/\/[^\s]+/g, "URL");

  // ▼▼▼ 追加: 辞書置換処理 ▼▼▼
  if (config.dictionary && Array.isArray(config.dictionary)) {
    config.dictionary.forEach(entry => {
      if (entry.from && entry.to) {
        // 大文字小文字を区別せず、全て置換する (re: 'gi')
        // 必要に応じて正規表現エスケープ処理を入れるのが安全だが、今回は簡易実装
        try {
          const regex = new RegExp(escapeRegExp(entry.from), 'gi');
          speakText = speakText.replace(regex, entry.to);
        } catch (e) {
          // 正規表現エラー時は単純置換
          speakText = speakText.split(entry.from).join(entry.to);
        }
      }
    });
  }
  // ▲▲▲ ここまで追加 ▲▲▲

  if (config.readName) {
    speakText = username.replace(/[:：]$/, '') + "さん。" + speakText;
  }
  speakText = speakText.replace(/(.)\1{2,}/g, '$1');

  if (speakText.length > config.maxLength) {
    speakText = speakText.substring(0, config.maxLength) + "、以下省略";
  }

  try {
    chrome.runtime.sendMessage({
      type: "SPEAK_REQUEST",
      payload: {
        text: speakText,
        speakerId: config.speakerId || 3,
        speed: config.speed || 1.0,
        volume: config.volume || 1.0,
        deviceId: config.audioDeviceId || "",
        uniqueId: signature
      }
    });
  } catch (e) {
    console.log("Extension context invalidated or error sending message:", e);
    cleanupIfInvalid();
  }
}

function addHistory(sig, now) {
  processedSignatures.set(sig, now);
}

function pruneHistory(now) {
  for (const [sig, timestamp] of processedSignatures.entries()) {
    if (now - timestamp > HISTORY_TTL_MS) {
      processedSignatures.delete(sig);
    }
  }
}

// ★修正した時刻判定関数
function normalizeDisplayName(name) {
  const raw = String(name ?? "").trim();
  const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKC") : raw;
  return normalized.toLowerCase();
}

function getBlockedUsers() {
  const rawBlockList = String(config.blockList ?? "");
  if (rawBlockList === blockedUsersCacheKey) {
    return blockedUsersCache;
  }

  const nextBlockedUsers = new Set();
  rawBlockList
    .split(/[,\n]/)
    .map(name => normalizeDisplayName(name))
    .filter(Boolean)
    .forEach(name => nextBlockedUsers.add(name));

  blockedUsersCacheKey = rawBlockList;
  blockedUsersCache = nextBlockedUsers;
  return blockedUsersCache;
}

function isRecentMessage(timeStr) {
  // 時刻が取れない場合は、安全側に倒して「新しい」とみなす（MassGuardに任せる）
  if (!timeStr) return true;

  const matches = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!matches) return true;

  let h = parseInt(matches[1], 10);
  let m = parseInt(matches[2], 10);
  const now = new Date();

  // AM/PM対応
  const lowerStr = timeStr.toLowerCase();
  if (lowerStr.includes('pm') && h < 12) h += 12;
  if (lowerStr.includes('am') && h === 12) h = 0;

  const nowH = now.getHours();
  const nowM = now.getMinutes();

  let msgMinutes = h * 60 + m;
  let nowMinutes = nowH * 60 + nowM;

  let diff = nowMinutes - msgMinutes;

  // 日付またぎ補正
  if (diff < -1000) diff += 1440;
  if (diff > 1000) diff -= 1440;

  // ★ここを緩和: 「1分未来 〜 3分過去」まで許容
  // これにより、分が変わった直後のコメントも弾かれなくなります
  return diff >= -10 && diff <= 10;
}

// 正規表現エスケープ用ヘルパー
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

observer.observe(document.body, { childList: true, subtree: true });
