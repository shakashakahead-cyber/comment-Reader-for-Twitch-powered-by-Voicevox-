// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const inputs = [
    'enabled', 'speakerId', 'speed', 'volume',
    'maxLength', 'readName', 'ignoreCommand', 'blockList', 'audioDeviceId'
  ];

  const defaults = {
    enabled: true, speakerId: 3, speed: 1.0, volume: 1.0,
    maxLength: 70, readName: false, ignoreCommand: true, skipTime: 3,
    blockList: "", audioDeviceId: ""
  };

  // 1. ダッシュボード接続チェック
  checkDashboardStatus();

  // 2. デバイス一覧の取得
  await fetchAudioDevices();

  // 3. 話者リストの取得
  await fetchSpeakers();

  // 4. 設定UI反映
  chrome.storage.local.get(defaults, (items) => {
    document.getElementById('enabled').checked = items.enabled;
    // 取得できたリストの中から、保存されていたIDを選択する
    setSelectValue('speakerId', items.speakerId, '3');
    setSelectValue('audioDeviceId', items.audioDeviceId, '');

    document.getElementById('speed').value = items.speed;
    document.getElementById('volume').value = items.volume;
    document.getElementById('maxLength').value = items.maxLength;
    document.getElementById('readName').checked = items.readName;
    document.getElementById('ignoreCommand').checked = items.ignoreCommand;
    document.getElementById('blockList').value = items.blockList;

    updateLabels(items);
  });

  // イベントリスナー
  inputs.forEach(id => {
    const el = document.getElementById(id);
    const eventType = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(eventType, () => {
      saveSettings();
      updateLabels({
        speed: document.getElementById('speed').value,
        volume: document.getElementById('volume').value
      });
    });
  });

  // ▼ 追加: キュークリアボタン
  document.getElementById('btnClearQueue').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: "CLEAR_QUEUE" });
    const btn = document.getElementById('btnClearQueue');
    const originalText = btn.textContent;
    btn.textContent = "停止しました";
    setTimeout(() => { btn.textContent = originalText; }, 1000);
  });

  // テスト再生ボタン
  document.getElementById('testSpeak').addEventListener('click', () => {
    const text = "テスト再生です。";
    const speakerId = document.getElementById('speakerId').value;
    const speed = document.getElementById('speed').value;
    const volume = document.getElementById('volume').value;
    const deviceId = document.getElementById('audioDeviceId').value;

    const btn = document.getElementById('testSpeak');
    btn.disabled = true;
    btn.textContent = "生成中...";

    chrome.runtime.sendMessage({
      type: "SPEAK_REQUEST",
      payload: { text, speakerId, speed, volume, deviceId }
    }, () => {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "🔊 テスト再生";
      }, 1000);
    });
  });

  // 権限ボタン
  document.getElementById('btnPermission').addEventListener('click', () => {
    chrome.tabs.create({ url: 'permission.html' });
  });

  // ▼ 追加: 辞書ボタン
  document.getElementById('btnOpenDictionary').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  // ▼ 追加: 再接続ボタンの処理
  document.getElementById('btnReloadSpeakers').addEventListener('click', async () => {
    const btn = document.getElementById('btnReloadSpeakers');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "通信中...";

    await fetchSpeakers();

    // 再取得後に、現在選択中のID（保存値）を再度適用を試みる
    chrome.storage.local.get(['speakerId'], (items) => {
      setSelectValue('speakerId', items.speakerId, '3');
    });

    btn.textContent = "完了";
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = originalText;
    }, 1000);
  });
});

// ▼ ステータスチェック関数
function checkDashboardStatus() {
  const statusEl = document.getElementById('connectionStatus');

  chrome.tabs.query({ url: "*://dashboard.twitch.tv/*" }, (tabs) => {
    statusEl.style.display = 'block';

    if (chrome.runtime.lastError) return;

    if (tabs && tabs.length > 0) {
      statusEl.className = 'status-ok';
      statusEl.innerHTML = '✅ 配信マネージャー接続中';
    } else {
      statusEl.className = 'status-error';
      statusEl.innerHTML = `
        <span>⚠️ 配信マネージャー未検知</span>
        <button id="btnOpenDash">開く</button>
      `;
      document.getElementById('btnOpenDash').addEventListener('click', () => {
        chrome.tabs.create({ url: "https://dashboard.twitch.tv/stream-manager" });
      });
    }
  });
}

// ▼ エラー表示用
function showStatus(msg, type = 'info') {
  const statusEl = document.getElementById('status');
  statusEl.textContent = msg;
  statusEl.className = type; // .error, .success, .info
  statusEl.style.opacity = 1;
  setTimeout(() => { statusEl.style.opacity = 0; }, 3000);
}

function setSelectValue(id, value, fallback) {
  const el = document.getElementById(id);
  // オプションが存在する場合のみ選択する（存在しない場合はfallback）
  if (el.querySelector(`option[value="${value}"]`)) {
    el.value = value;
  } else {
    el.value = fallback;
  }
}

async function fetchAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
    const select = document.getElementById('audioDeviceId');
    const currentVal = select.value;

    while (select.options.length > 1) { select.remove(1); }

    if (audioOutputs.length === 0) {
      const opt = document.createElement('option');
      opt.text = "デバイスが見つかりません";
      opt.disabled = true;
      select.add(opt);
    }

    audioOutputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Speaker ${select.length}`;
      select.appendChild(option);
    });
    setSelectValue('audioDeviceId', currentVal, '');
  } catch (err) {
    console.error("Device enumeration failed:", err);
  }
}

async function fetchSpeakers() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_SPEAKERS" }, (response) => {
      const select = document.getElementById('speakerId');
      select.innerHTML = "";

      if (response && response.success) {
        response.data.forEach(char => {
          const optgroup = document.createElement("optgroup");
          optgroup.label = char.name;
          char.styles.forEach(style => {
            const option = document.createElement("option");
            option.value = style.id;
            option.textContent = `${char.name} (${style.name})`;
            optgroup.appendChild(option);
          });
          select.appendChild(optgroup);
        });
      } else {
        const option = document.createElement("option");
        option.text = "VOICEVOX未接続";
        select.appendChild(option);
        // Show error status
        const statusEl = document.getElementById('status');
        if (statusEl) {
          statusEl.textContent = "VOICEVOXに接続できません。アプリが起動しているか確認してください。";
          statusEl.style.color = "red";
          statusEl.style.opacity = 1;
        }
      }
      resolve();
    });
  });
}

function saveSettings() {
  const settings = {
    enabled: document.getElementById('enabled').checked,
    speakerId: parseInt(document.getElementById('speakerId').value, 10),
    speed: parseFloat(document.getElementById('speed').value),
    volume: parseFloat(document.getElementById('volume').value),
    maxLength: parseInt(document.getElementById('maxLength').value, 10),
    readName: document.getElementById('readName').checked,
    ignoreCommand: document.getElementById('ignoreCommand').checked,
    blockList: document.getElementById('blockList').value,
    audioDeviceId: document.getElementById('audioDeviceId').value,
    skipTime: 3
  };

  chrome.storage.local.set(settings, () => {
    const status = document.getElementById('status');
    status.style.opacity = 1;
    setTimeout(() => { status.style.opacity = 0; }, 1000);
  });
}

function updateLabels(items) {
  document.getElementById('speedValue').textContent = items.speed + 'x';
  document.getElementById('volValue').textContent = Math.round(items.volume * 100) + '%';
}
