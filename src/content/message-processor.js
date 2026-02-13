import {
    HISTORY_TTL_MS,
    SIGNATURE_DEDUP_WINDOW_MS,
    STABLE_CHECK_DELAY_MS,
    STABLE_CHECK_MAX_TRIES
} from './constants.js';
import { escapeRegExp, isRecentMessage } from '../lib/utils.js';

const MESSAGE_BODY_SELECTOR = '[data-test-selector="chat-line-message-body"], .chat-line__message-body';

const BASE_REMOVE_SELECTORS = [
    '.chat-line__timestamp',
    '.chat-line__username',
    '.chat-line__username-container',
    '.chat-badge',
    '[aria-hidden="true"]',
    '.mention-fragment',
    '.chat-line__status',
    '.chat-line__message--system'
];

const REPLY_CONTEXT_SELECTORS = [
    '[data-test-selector*="reply"]',
    '[data-a-target*="reply"]',
    '.reply-line--mentioned-comment-author',
    '.reply-line--mentioned-comment-text'
];

const REPLY_TARGET_AUTHOR_SELECTORS = [
    '.reply-line--mentioned-comment-author',
    '[data-test-selector*="reply-author"]',
    '[data-a-target*="reply-author"]'
];

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

    hasReplyContext(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

        return REPLY_CONTEXT_SELECTORS.some(selector =>
            (typeof element.matches === "function" && element.matches(selector)) ||
            !!element.querySelector(selector)
        );
    }

    sanitizeReplyTargetUsername(name) {
        let sanitized = String(name ?? "").trim();
        if (!sanitized) return "";

        sanitized = sanitized.replace(/^[@＠]+/, "");
        sanitized = sanitized.replace(/[,:：、。.!?！？]+$/g, "");
        return sanitized.trim();
    }

    extractReplyTargetFromElement(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";

        for (const selector of REPLY_TARGET_AUTHOR_SELECTORS) {
            const candidate = (typeof element.matches === "function" && element.matches(selector))
                ? element
                : element.querySelector(selector);

            if (!candidate) continue;

            const candidateText = this.sanitizeReplyTargetUsername(candidate.textContent || "");
            if (candidateText) return candidateText;
        }

        return "";
    }

    extractLeadingMention(text) {
        const mentionMatch = String(text ?? "").match(/^[@＠]([^\s@＠]+)\s*/);
        if (!mentionMatch) return null;

        return {
            raw: mentionMatch[0],
            username: this.sanitizeReplyTargetUsername(mentionMatch[1])
        };
    }

    stripLeadingMentionsForTarget(text, targetUsername) {
        const normalizedTarget = this.normalizeDisplayName(targetUsername);
        if (!normalizedTarget) return String(text ?? "").trim();

        let remaining = String(text ?? "");
        while (remaining) {
            const mention = this.extractLeadingMention(remaining);
            if (!mention || !mention.username) break;

            const normalizedMention = this.normalizeDisplayName(mention.username);
            if (normalizedMention !== normalizedTarget) break;

            remaining = remaining.slice(mention.raw.length);
        }

        return remaining.trim();
    }

    extractMessageTextAndReplyMeta(container) {
        const bodyElement = container.querySelector(MESSAGE_BODY_SELECTOR);
        const sourceElement = bodyElement || container;
        const clone = sourceElement.cloneNode(true);

        let replyTargetUsername = this.extractReplyTargetFromElement(sourceElement);
        if (!replyTargetUsername) {
            replyTargetUsername = this.extractReplyTargetFromElement(container);
        }

        const isReply = this.hasReplyContext(sourceElement) || this.hasReplyContext(container);

        const removeSelectors = [...BASE_REMOVE_SELECTORS, ...REPLY_CONTEXT_SELECTORS];
        removeSelectors.forEach(selector => {
            clone.querySelectorAll(selector).forEach(element => element.remove());
        });

        const rawText = String(clone.innerText || "").trim();
        let text = rawText;

        if (isReply) {
            const leadingMention = this.extractLeadingMention(text);
            if (!replyTargetUsername && leadingMention?.username) {
                replyTargetUsername = leadingMention.username;
            }

            if (replyTargetUsername) {
                text = this.stripLeadingMentionsForTarget(text, replyTargetUsername);
            }
        }

        return {
            text: text.trim(),
            rawText,
            isReply,
            replyTargetUsername
        };
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
            const ready = !!message && !!message.username && !!message.rawText &&
                (!message.hasTime || !!message.timeStr);
            const key = ready
                ? `${message.username}::${message.timeStr || "no-time"}::${message.isReply ? "reply" : "normal"}::${message.replyTargetUsername || "no-reply-target"}::${message.rawText}`
                : null;

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

        const {
            text,
            rawText,
            isReply,
            replyTargetUsername
        } = this.extractMessageTextAndReplyMeta(container);

        return {
            username,
            timeStr,
            text,
            rawText,
            hasTime: !!timeEl,
            messageId,
            isReply,
            replyTargetUsername
        };
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
        const { username, timeStr, text, messageId, replyTargetUsername } = message;
        if (messageId) return `id::${messageId}`;
        return `${username}::${timeStr || "no-time"}::${replyTargetUsername || "no-reply-target"}::${text}`;
    }

    rememberExistingContainer(container, now = Date.now()) {
        const message = this.extractMessageData(container);
        if (!message || !message.rawText) {
            container.dataset.voxRead = "true";
            return;
        }

        const signature = this.buildSignature(message);
        this.addHistory(signature, now);
        container.dataset.voxRead = "true";
    }

    buildDisplayNameForSpeech(name) {
        const safeName = String(name ?? "").trim().replace(/[:：]$/, "");
        if (!safeName) return "";
        return `${safeName}さん。`;
    }

    buildSpeakBody(text) {
        let speakBody = String(text ?? "").replace(/https?:\/\/[^\s]+/g, "URL");

        if (this.config.dictionary && Array.isArray(this.config.dictionary)) {
            this.config.dictionary.forEach(entry => {
                if (!entry.from || !entry.to) return;

                try {
                    const regex = new RegExp(escapeRegExp(entry.from), 'gi');
                    speakBody = speakBody.replace(regex, entry.to);
                } catch (e) {
                    speakBody = speakBody.split(entry.from).join(entry.to);
                }
            });
        }

        return speakBody;
    }

    buildSpeakText(text, username, isReply, replyTargetUsername) {
        const prefixes = [];

        if (this.config.readName) {
            prefixes.push(this.buildDisplayNameForSpeech(username));
        }

        if (isReply && replyTargetUsername) {
            prefixes.push(this.buildDisplayNameForSpeech(replyTargetUsername));
        }

        return `${prefixes.join("")}${this.buildSpeakBody(text)}`;
    }

    processMessageContainer(container, allowStalePrimary = false) {
        if (container.dataset.voxRead) return;
        if (!this.lockManager.isPrimary() && !allowStalePrimary) return;

        const now = Date.now();
        this.pruneHistory(now);

        const message = this.extractMessageData(container);
        if (!message || !message.rawText) return;

        const { username, timeStr, text, messageId, isReply, replyTargetUsername } = message;
        const normalizedUsername = this.normalizeDisplayName(username);

        const signature = this.buildSignature(message);
        const lastSeenAt = this.processedSignatures.get(signature);

        if (lastSeenAt) {
            if (messageId) {
                container.dataset.voxRead = "true";
                return;
            }

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

        if (!text) {
            container.dataset.voxRead = "true";
            this.addHistory(signature, now);
            return;
        }

        this.addHistory(signature, now);
        container.dataset.voxRead = "true";
        this.speak(text, username, signature, { isReply, replyTargetUsername });
    }

    speak(text, username, signature, options = {}) {
        const { isReply = false, replyTargetUsername = "" } = options;
        let speakText = this.buildSpeakText(text, username, isReply, replyTargetUsername);
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
