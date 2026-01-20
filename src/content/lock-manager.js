import { ACTIVE_READER_KEY, ACTIVE_READER_TTL_MS, ACTIVE_READER_HEARTBEAT_MS } from './constants.js';

export class LockManager {
    constructor() {
        this.readerInstanceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        this.isPrimaryReader = false;
        this.lastForcedClaimAt = 0;
        this.heartbeatInterval = null;
    }

    isPrimary() {
        return this.isPrimaryReader;
    }

    isActiveRecordExpired(record, now) {
        if (!record || !record.lastSeen) return true;
        return (now - record.lastSeen) > ACTIVE_READER_TTL_MS;
    }

    setPrimaryFromRecord(record) {
        this.isPrimaryReader = !!record && record.id === this.readerInstanceId;
    }

    cleanupIfInvalid() {
        try {
            if (!chrome.runtime || !chrome.runtime.id) {
                throw new Error("Context invalid");
            }
            return false;
        } catch (e) {
            if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
            return true;
        }
    }

    claimActiveReader(force = false) {
        if (this.cleanupIfInvalid()) return;

        try {
            chrome.storage.local.get([ACTIVE_READER_KEY], (items) => {
                if (this.cleanupIfInvalid()) return;

                if (chrome.runtime.lastError) {
                    console.debug("Ignored runtime error:", chrome.runtime.lastError);
                    return;
                }

                const record = items[ACTIVE_READER_KEY];
                const now = Date.now();

                if (force || this.isActiveRecordExpired(record, now) || (record && record.id === this.readerInstanceId)) {
                    chrome.storage.local.set({
                        [ACTIVE_READER_KEY]: { id: this.readerInstanceId, lastSeen: now }
                    });
                    this.isPrimaryReader = true;
                    return;
                }

                this.isPrimaryReader = false;
            });
        } catch (e) { this.cleanupIfInvalid(); }
    }

    heartbeatActiveReader() {
        if (this.cleanupIfInvalid()) return;

        try {
            chrome.storage.local.get([ACTIVE_READER_KEY], (items) => {
                if (this.cleanupIfInvalid()) return;

                if (chrome.runtime.lastError) return;

                const record = items[ACTIVE_READER_KEY];
                const now = Date.now();

                if (record && record.id === this.readerInstanceId) {
                    chrome.storage.local.set({
                        [ACTIVE_READER_KEY]: { id: this.readerInstanceId, lastSeen: now }
                    });
                    if (!this.isPrimaryReader) this.isPrimaryReader = true;
                    return;
                }

                if (this.isActiveRecordExpired(record, now)) {
                    chrome.storage.local.set({
                        [ACTIVE_READER_KEY]: { id: this.readerInstanceId, lastSeen: now }
                    });
                    this.isPrimaryReader = true;
                    return;
                }

                this.isPrimaryReader = false;
            });
        } catch (e) { this.cleanupIfInvalid(); }
    }

    init() {
        this.claimActiveReader(false);

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (this.cleanupIfInvalid()) return;
            if (areaName !== "local") return;
            if (!changes[ACTIVE_READER_KEY]) return;
            this.setPrimaryFromRecord(changes[ACTIVE_READER_KEY].newValue);
        });

        const claimOnUserAction = () => {
            const now = Date.now();
            if (now - this.lastForcedClaimAt < 1000) return;
            this.lastForcedClaimAt = now;
            this.claimActiveReader(true);
        };

        document.addEventListener('pointerdown', claimOnUserAction, true);
        document.addEventListener('keydown', claimOnUserAction, true);

        this.heartbeatInterval = setInterval(() => this.heartbeatActiveReader(), ACTIVE_READER_HEARTBEAT_MS);
    }
}
