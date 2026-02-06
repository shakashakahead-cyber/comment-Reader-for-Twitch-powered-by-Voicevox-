import {
    HISTORY_TTL_MS,
    SIGNATURE_DEDUP_WINDOW_MS,
    STABLE_CHECK_DELAY_MS,
    STABLE_CHECK_MAX_TRIES
} from './constants.js';
import { escapeRegExp, isRecentMessage } from '../lib/utils.js';

export class MessageProcessor {
    constructor(config, lockManager) {
        this.config = config;
        this.lockManager = lockManager;
        this.processedSignatures = new Map();
        this.pendingStabilityChecks = new WeakMap();
        this.blockedUsersCacheKey = null;
        this.blockedUsersCache = new Set();
    }

    normalizeDisplayName(name) {
        const raw = String(name ?? "").trim();
        const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKC") : raw;
        return normalized.toLowerCase();
    }

    getBlockedUsers() {
        const rawBlockList = String(this.config.blockList ?? "");
        if (rawBlockList === this.blockedUsersCacheKey) {
            return this.blockedUsersCache;
        }

        const nextBlockedUsers = new Set();
        rawBlockList
            .split(/[,\n]/)
            .map(name => this.normalizeDisplayName(name))
            .filter(Boolean)
            .forEach(name => nextBlockedUsers.add(name));

        this.blockedUsersCacheKey = rawBlockList;
        this.blockedUsersCache = nextBlockedUsers;
        return this.blockedUsersCache;
    }

    scheduleMessageProcessing(container) {
        if (container.dataset.voxRead) return;
        if (!this.lockManager.isPrimary()) return;

        let state = this.pendingStabilityChecks.get(container);
        if (!state) {
            state = { tries: 0, lastKey: null, timerId: null, wasPrimary: false };
            this.pendingStabilityChecks.set(container, state);
        }
        if (state.timerId) return;

        state.wasPrimary = this.lockManager.isPrimary();
        this.scheduleStabilityCheck(container, state);
    }

    scheduleStabilityCheck(container, state) {
        state.timerId = setTimeout(() => {
            state.timerId = null;

            if (!container.isConnected || container.dataset.voxRead) {
                this.pendingStabilityChecks.delete(container);
                return;
            }

            const message = this.extractMessageData(container);
            const ready = !!message && !!message.username && !!message.text &&
                (!message.hasTime || !!message.timeStr);
            const key = ready ? `${message.username}::${message.timeStr || "no-time"}::${message.text}` : null;

            state.tries += 1;

            if (ready && state.lastKey && state.lastKey === key) {
                this.pendingStabilityChecks.delete(container);
                this.processMessageContainer(container, state.wasPrimary);
                return;
            }

            state.lastKey = key;

            if (state.tries >= STABLE_CHECK_MAX_TRIES) {
                this.pendingStabilityChecks.delete(container);
                if (ready) this.processMessageContainer(container, state.wasPrimary);
                return;
            }

            this.scheduleStabilityCheck(container, state);
        }, STABLE_CHECK_DELAY_MS);
    }

    extractMessageData(container) {
        const userEl = container.querySelector('.chat-line__username');
        if (!userEl) return null;

        const timeEl = container.querySelector('.chat-line__timestamp');
        const timeStr = timeEl ? timeEl.innerText : "";
        const messageId = this.extractMessageId(container);

        const rawUserName = userEl.innerText || "";
        const username = rawUserName.replace(/\s*\(.*?\)$/, '').trim();

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
        const text = rawText.trim();

        return { username, timeStr, text, hasTime: !!timeEl, messageId };
    }

    extractMessageId(container) {
        return (
            container.getAttribute('data-message-id') ||
            container.getAttribute('id') ||
            container.dataset.messageId ||
            ""
        ).trim();
    }

    buildSignature(message) {
        const { username, timeStr, text, messageId } = message;
        if (messageId) return `id::${messageId}`;
        return `${username}::${timeStr || "no-time"}::${text}`;
    }

    rememberExistingContainer(container, now = Date.now()) {
        const message = this.extractMessageData(container);
        if (!message || !message.text) {
            container.dataset.voxRead = "true";
            return;
        }

        const signature = this.buildSignature(message);
        this.addHistory(signature, now);
        container.dataset.voxRead = "true";
    }

    processMessageContainer(container, allowStalePrimary = false) {
        if (container.dataset.voxRead) return;
        if (!this.lockManager.isPrimary() && !allowStalePrimary) return;

        const now = Date.now();
        this.pruneHistory(now);

        const message = this.extractMessageData(container);
        if (!message || !message.text) return;

        const { username, timeStr, text, messageId } = message;
        const normalizedUsername = this.normalizeDisplayName(username);

        // Deduplication key
        const signature = this.buildSignature(message);
        const lastSeenAt = this.processedSignatures.get(signature);

        if (lastSeenAt) {
            // Message IDs should never be replayed within history TTL.
            if (messageId) {
                container.dataset.voxRead = "true";
                return;
            }

            // Fallback signature (name+time+text) has a shorter dedup window.
            if ((now - lastSeenAt) < SIGNATURE_DEDUP_WINDOW_MS) {
                container.dataset.voxRead = "true";
                return;
            }
        }

        if (timeStr && !isRecentMessage(timeStr)) {
            console.log(`Skipped message due to time check: "${text}" (Time: ${timeStr})`);
            container.dataset.voxRead = "true";
            this.addHistory(signature, now);
            return;
        }

        if (this.config.blockList && normalizedUsername) {
            const blockedUsers = this.getBlockedUsers();
            if (blockedUsers.has(normalizedUsername)) {
                container.dataset.voxRead = "true";
                this.addHistory(signature, now);
                return;
            }
        }

        if (this.config.ignoreCommand && text.startsWith("!")) {
            container.dataset.voxRead = "true";
            this.addHistory(signature, now);
            return;
        }

        // Execute
        this.addHistory(signature, now);
        container.dataset.voxRead = "true";
        this.speak(text, username, signature);
    }

    speak(text, username, signature) {
        let speakText = text.replace(/https?:\/\/[^\s]+/g, "URL");

        // Dictionary replacement
        if (this.config.dictionary && Array.isArray(this.config.dictionary)) {
            this.config.dictionary.forEach(entry => {
                if (entry.from && entry.to) {
                    try {
                        const regex = new RegExp(escapeRegExp(entry.from), 'gi');
                        speakText = speakText.replace(regex, entry.to);
                    } catch (e) {
                        speakText = speakText.split(entry.from).join(entry.to);
                    }
                }
            });
        }

        if (this.config.readName) {
            speakText = username.replace(/[:：]$/, '') + "さん。" + speakText;
        }
        speakText = speakText.replace(/(.)\1{2,}/g, '$1');

        if (speakText.length > this.config.maxLength) {
            speakText = speakText.substring(0, this.config.maxLength) + "、以下省略";
        }

        try {
            chrome.runtime.sendMessage({
                type: "SPEAK_REQUEST",
                payload: {
                    text: speakText,
                    speakerId: this.config.speakerId || 3,
                    speed: this.config.speed || 1.0,
                    volume: this.config.volume || 1.0,
                    deviceId: this.config.audioDeviceId || "",
                    uniqueId: signature
                }
            });
        } catch (e) {
            console.log("Error sending message:", e);
            this.lockManager.cleanupIfInvalid();
        }
    }

    addHistory(sig, now) {
        this.processedSignatures.set(sig, now);
    }

    pruneHistory(now) {
        for (const [sig, timestamp] of this.processedSignatures.entries()) {
            if (now - timestamp > HISTORY_TTL_MS) {
                this.processedSignatures.delete(sig);
            }
        }
    }
}
